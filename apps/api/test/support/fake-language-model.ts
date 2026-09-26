import type {
  ConversationRequest,
  LanguageModel,
  ModelConversation,
  ModelToolCall,
  ModelToolResult,
  ModelTurn,
} from "../../src/ai/model/language-model.js";

export type FakeTurnContext = {
  request: ConversationRequest;
  /** Tool results sent with this turn (empty for the first turn). */
  toolResults: readonly ModelToolResult[];
  /** 0 for the first turn of a conversation. */
  turn: number;
};

export type FakeScript = (context: FakeTurnContext) => ModelTurn | Promise<ModelTurn>;

/**
 * Scriptable stand-in for Gemini. Records every request and every tool result it receives, so
 * tests can assert exactly what would have been sent to the provider.
 */
export class FakeLanguageModel implements LanguageModel {
  readonly requests: ConversationRequest[] = [];
  readonly receivedToolResults: ModelToolResult[][] = [];

  constructor(private readonly script: FakeScript) {}

  startConversation(request: ConversationRequest): ModelConversation {
    this.requests.push(request);
    let turn = 0;
    return {
      next: async (toolResults) => {
        this.receivedToolResults.push([...toolResults]);
        const context = { request, toolResults, turn };
        turn += 1;
        return this.script(context);
      },
    };
  }

  /** All tool results received, flattened. */
  allToolResults(): ModelToolResult[] {
    return this.receivedToolResults.flat();
  }
}

export function callTools(...calls: [name: string, args: unknown][]): ModelTurn {
  return {
    type: "tool_calls",
    calls: calls.map(([name, args], index): ModelToolCall => ({
      id: `call-${String(index)}`,
      name,
      arguments: args,
    })),
  };
}

export function answer(text: string): ModelTurn {
  return { type: "final", text };
}

/** A script that makes the given tool calls on the first turn, then answers with `text`. */
export function toolsThenAnswer(
  calls: [name: string, args: unknown][],
  text = "Done.",
): FakeScript {
  return ({ turn }) => (turn === 0 ? callTools(...calls) : answer(text));
}
