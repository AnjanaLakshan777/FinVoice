import type { Interactions } from "@google/genai";
import { describe, expect, it, vi } from "vitest";

import {
  GeminiLanguageModel,
  toLanguageModelError,
  type InteractionsClient,
} from "../../src/ai/gemini/gemini.language-model.js";
import { LanguageModelError, type ConversationRequest } from "../../src/ai/model/language-model.js";

const FAKE_KEY = "fake-key-never-sent-anywhere";

const REQUEST: ConversationRequest = {
  systemInstruction: "You are FinVoice.",
  tools: [
    {
      name: "calculate_loan",
      description: "Loan tool",
      parameters: { type: "object", properties: {} },
    },
  ],
  userMessage: "EMI for 500000 at 12% for 36 months?",
};

function interaction(fields: Partial<Interactions.Interaction>): Interactions.Interaction {
  return { id: "int-1", status: "completed", ...fields };
}

function createModel(responses: (Interactions.Interaction | Error)[]) {
  const create = vi.fn<InteractionsClient["create"]>();
  for (const response of responses) {
    if (response instanceof Error) {
      create.mockRejectedValueOnce(response);
    } else {
      create.mockResolvedValueOnce(response);
    }
  }
  const factory = vi.fn((apiKey: string): InteractionsClient => {
    expect(apiKey).toBe(FAKE_KEY);
    return { create };
  });
  const model = new GeminiLanguageModel({ apiKey: FAKE_KEY, model: "gemini-test-model" }, factory);
  return { model, create, factory };
}

const THOUGHT = {
  type: "thought",
  signature: "sig-123",
  summary: [{ type: "text", text: "I should call the tool." }],
};
const CALL = {
  type: "function_call",
  id: "fc-1",
  name: "calculate_loan",
  arguments: { principal: "500000.00" },
};

describe("GeminiLanguageModel", () => {
  it("fails as not configured without a key, and never creates a client", () => {
    const factory = vi.fn();
    const model = new GeminiLanguageModel({ apiKey: null, model: "gemini-test-model" }, factory);

    expect(() => model.startConversation(REQUEST)).toThrow(LanguageModelError);
    expect(() => model.startConversation(REQUEST)).toThrow("Gemini API key is not configured");
    expect(factory).not.toHaveBeenCalled();
  });

  it("sends a stateless Interactions request with our instruction, function tools and the user's message", async () => {
    const { model, create } = createModel([interaction({ output_text: "Hello." })]);

    const turn = await model.startConversation(REQUEST).next([]);

    expect(turn).toEqual({ type: "final", text: "Hello." });
    expect(create).toHaveBeenCalledTimes(1);
    const [params, options] = create.mock.calls[0] ?? [];
    expect(params).toEqual({
      model: "gemini-test-model",
      system_instruction: "You are FinVoice.",
      tools: [
        {
          type: "function",
          name: "calculate_loan",
          description: "Loan tool",
          parameters: { type: "object", properties: {} },
        },
      ],
      input: [{ type: "user_input", content: [{ type: "text", text: REQUEST.userMessage }] }],
      store: false,
      generation_config: { max_output_tokens: 2048 },
    });
    expect(options).toEqual({ timeout: 30_000, maxRetries: 1 });
    expect(JSON.stringify(params)).not.toContain(FAKE_KEY);
  });

  it("turns function_call steps into tool calls, then sends the full history with our results", async () => {
    const { model, create } = createModel([
      interaction({
        status: "requires_action",
        steps: [THOUGHT, CALL] as Interactions.Interaction["steps"],
      }),
      interaction({
        // The API may echo earlier steps; they must not be duplicated.
        steps: [
          THOUGHT,
          CALL,
          {
            type: "model_output",
            content: [{ type: "text", text: "Your payment is Rs. 16,607.15." }],
          },
        ] as Interactions.Interaction["steps"],
      }),
    ]);
    const conversation = model.startConversation(REQUEST);

    const first = await conversation.next([]);
    const second = await conversation.next([
      {
        callId: "fc-1",
        name: "calculate_loan",
        result: { monthlyPayment: "16607.15" },
        isError: false,
      },
    ]);

    expect(first).toEqual({
      type: "tool_calls",
      calls: [{ id: "fc-1", name: "calculate_loan", arguments: { principal: "500000.00" } }],
    });
    expect(second).toEqual({ type: "final", text: "Your payment is Rs. 16,607.15." });
    expect(create.mock.calls[1]?.[0].input).toEqual([
      { type: "user_input", content: [{ type: "text", text: REQUEST.userMessage }] },
      THOUGHT,
      CALL,
      {
        type: "function_result",
        call_id: "fc-1",
        name: "calculate_loan",
        result: { monthlyPayment: "16607.15" },
        is_error: false,
      },
    ]);
  });

  it("never returns thought text as the answer", async () => {
    const { model } = createModel([
      interaction({
        steps: [
          THOUGHT,
          { type: "model_output", content: [{ type: "text", text: "Visible answer." }] },
        ] as Interactions.Interaction["steps"],
      }),
    ]);

    await expect(model.startConversation(REQUEST).next([])).resolves.toEqual({
      type: "final",
      text: "Visible answer.",
    });
  });

  it.each(["failed", "incomplete", "cancelled", "budget_exceeded"])(
    "treats an interaction that ended as %s as an upstream failure",
    async (status) => {
      const { model } = createModel([interaction({ status })]);

      await expect(model.startConversation(REQUEST).next([])).rejects.toMatchObject({
        failure: "upstream",
      });
    },
  );

  it("treats an empty answer as an upstream failure", async () => {
    const { model } = createModel([interaction({ output_text: "   " })]);

    await expect(model.startConversation(REQUEST).next([])).rejects.toMatchObject({
      failure: "upstream",
    });
  });

  it("does not propagate SDK error messages, which could contain request details", async () => {
    const sdkError = Object.assign(new Error(`Request failed: https://api/?key=${FAKE_KEY}`), {
      status: 429,
    });
    const { model } = createModel([sdkError]);

    const error = await model
      .startConversation(REQUEST)
      .next([])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LanguageModelError);
    expect(error).toMatchObject({ failure: "unavailable", status: 429 });
    expect((error as Error).message).not.toContain(FAKE_KEY);
    expect(JSON.stringify(error)).not.toContain(FAKE_KEY);
  });
});

describe("toLanguageModelError", () => {
  function errorWith(status: number | undefined, name = "Error") {
    return Object.assign(
      new Error("secret details"),
      { name },
      status === undefined ? {} : { status },
    );
  }

  it.each([
    [401, "unavailable"],
    [403, "unavailable"],
    [408, "unavailable"],
    [429, "unavailable"],
    [500, "unavailable"],
    [503, "unavailable"],
    [400, "upstream"],
    [404, "upstream"],
  ] as const)("classifies HTTP %i as %s", (status, failure) => {
    expect(toLanguageModelError(errorWith(status))).toMatchObject({ failure, status });
  });

  it.each([
    ["RequestTimeoutError", "unavailable"],
    ["ConnectionError", "unavailable"],
    ["TypeError", "upstream"],
  ] as const)("classifies %s without a status as %s", (name, failure) => {
    const error = toLanguageModelError(errorWith(undefined, name));

    expect(error.failure).toBe(failure);
    expect(error.message).not.toContain("secret details");
  });
});
