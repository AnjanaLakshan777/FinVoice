import { GoogleGenAI, type Interactions } from "@google/genai";

import {
  LanguageModelError,
  type ConversationRequest,
  type LanguageModel,
  type ModelConversation,
  type ModelToolCall,
  type ModelToolResult,
  type ModelTurn,
} from "../model/language-model.js";

type Step = NonNullable<Interactions.Interaction["steps"]>[number];
type CreateParams = Interactions.CreateModelInteractionParamsNonStreaming;

/** The part of the SDK the adapter uses; injectable so tests never call Google. */
export type InteractionsClient = {
  create(
    params: CreateParams,
    options?: { timeout?: number; maxRetries?: number },
  ): Promise<Interactions.Interaction>;
};

export type GeminiSettings = {
  /** Null when not configured: conversations then fail with `not_configured`. */
  apiKey: string | null;
  model: string;
};

export type InteractionsClientFactory = (apiKey: string) => InteractionsClient;

const defaultClientFactory: InteractionsClientFactory = (apiKey) =>
  new GoogleGenAI({ apiKey }).interactions;

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 2048;
const FAILED_STATUSES = new Set(["failed", "cancelled", "incomplete", "budget_exceeded"]);

/**
 * LanguageModel backed by the Gemini Interactions API (@google/genai).
 *
 * - Stateless on Google's side: `store: false`, and the full step history of the request (user
 *   input, the model's thought and function-call steps, our function results) is sent on every
 *   turn. Nothing is kept at Google between requests, and no interaction id is exposed.
 * - Function calling only: the model receives our declarations and returns `function_call`
 *   steps; FinVoice executes them and sends `function_result` steps back. No built-in tools
 *   (Google Search, code execution, …) are enabled.
 * - The API key is only passed to the SDK client. It never appears in errors or logs: SDK error
 *   messages are not propagated, only the HTTP status.
 */
export class GeminiLanguageModel implements LanguageModel {
  private client: InteractionsClient | undefined;

  constructor(
    private readonly settings: GeminiSettings,
    private readonly clientFactory: InteractionsClientFactory = defaultClientFactory,
  ) {}

  startConversation(request: ConversationRequest): ModelConversation {
    const { apiKey } = this.settings;
    if (!apiKey) {
      throw new LanguageModelError("not_configured", "Gemini API key is not configured");
    }
    this.client ??= this.clientFactory(apiKey);
    return new GeminiConversation(this.client, this.settings.model, request);
  }
}

class GeminiConversation implements ModelConversation {
  /** The request's full history, re-sent on each turn because nothing is stored at Google. */
  private readonly steps: Step[];
  /** Serialised steps already in `steps`, to avoid duplicating any the API echoes back. */
  private readonly known = new Set<string>();

  constructor(
    private readonly client: InteractionsClient,
    private readonly model: string,
    private readonly request: ConversationRequest,
  ) {
    this.steps = [{ type: "user_input", content: [{ type: "text", text: request.userMessage }] }];
    this.remember(this.steps);
  }

  async next(toolResults: readonly ModelToolResult[]): Promise<ModelTurn> {
    const results: Step[] = toolResults.map((result) => ({
      type: "function_result",
      call_id: result.callId,
      name: result.name,
      result: result.result,
      is_error: result.isError,
    }));
    this.steps.push(...results);
    this.remember(results);

    let interaction: Interactions.Interaction;
    try {
      interaction = await this.client.create(
        {
          model: this.model,
          system_instruction: this.request.systemInstruction,
          tools: this.request.tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
          input: [...this.steps],
          store: false,
          generation_config: { max_output_tokens: MAX_OUTPUT_TOKENS },
        },
        { timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 },
      );
    } catch (error) {
      throw toLanguageModelError(error);
    }
    return this.readTurn(interaction);
  }

  private readTurn(interaction: Interactions.Interaction): ModelTurn {
    if (FAILED_STATUSES.has(interaction.status)) {
      throw new LanguageModelError("upstream", `Gemini interaction ended as ${interaction.status}`);
    }

    // Keep the model's new steps (including thought signatures) for the next turn.
    const newSteps = (interaction.steps ?? []).filter(
      (step) =>
        step.type !== "user_input" &&
        step.type !== "function_result" &&
        !this.known.has(JSON.stringify(step)),
    );
    this.steps.push(...newSteps);
    this.remember(newSteps);

    const calls: ModelToolCall[] = newSteps.flatMap((step) =>
      step.type === "function_call"
        ? [{ id: step.id, name: step.name, arguments: step.arguments }]
        : [],
    );
    if (calls.length > 0) {
      return { type: "tool_calls", calls };
    }

    const text = (interaction.output_text ?? textOf(newSteps)).trim();
    if (!text) {
      throw new LanguageModelError("upstream", "Gemini returned no text");
    }
    return { type: "final", text };
  }

  private remember(steps: readonly Step[]): void {
    for (const step of steps) {
      this.known.add(JSON.stringify(step));
    }
  }
}

/** Text of the model's output steps. Thought steps are never included. */
function textOf(steps: readonly Step[]): string {
  return steps
    .flatMap((step) => (step.type === "model_output" ? (step.content ?? []) : []))
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("");
}

/**
 * Classifies an SDK error by HTTP status and error type only. The SDK's message is deliberately
 * dropped: it could contain request details.
 */
export function toLanguageModelError(error: unknown): LanguageModelError {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : undefined;
  const name = error instanceof Error ? error.name : "";

  if (status === undefined) {
    const temporary = /timeout|connection|abort|network/i.test(name);
    return new LanguageModelError(
      temporary ? "unavailable" : "upstream",
      temporary ? "Gemini could not be reached" : "Gemini request failed",
    );
  }
  if (status === 401 || status === 403) {
    return new LanguageModelError(
      "unavailable",
      "Gemini rejected the configured credentials",
      status,
    );
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new LanguageModelError("unavailable", "Gemini is temporarily unavailable", status);
  }
  return new LanguageModelError("upstream", "Gemini rejected the request", status);
}
