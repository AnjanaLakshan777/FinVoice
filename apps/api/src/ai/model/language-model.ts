/**
 * FinVoice's provider-neutral view of a tool-calling language model. The agent depends only on
 * these types; the Gemini adapter (../gemini) is the only code that knows the Google SDK, so the
 * provider or SDK version can change without touching the agent or its tools.
 */

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

/** A function the model may ask the server to run. `parameters` is a JSON Schema object. */
export type ModelToolDeclaration = {
  name: string;
  description: string;
  parameters: JsonObject;
};

/** A tool call requested by the model. Its arguments are untrusted input. */
export type ModelToolCall = {
  /** Provider-assigned id, echoed back with the result. Internal: never exposed to API clients. */
  id: string;
  name: string;
  arguments: unknown;
};

/** The server's result for one tool call, sent back to the model. Always JSON. */
export type ModelToolResult = {
  callId: string;
  name: string;
  result: JsonObject;
  isError: boolean;
};

export type ModelTurn =
  { type: "tool_calls"; calls: ModelToolCall[] } | { type: "final"; text: string };

export type ConversationRequest = {
  systemInstruction: string;
  tools: readonly ModelToolDeclaration[];
  userMessage: string;
};

/**
 * One request's exchange with the model. `next([])` sends the user message; each following call
 * sends the results of the tool calls from the previous turn. The conversation keeps any
 * provider state (for example earlier steps) itself and never exposes it.
 */
export type ModelConversation = {
  next(toolResults: readonly ModelToolResult[]): Promise<ModelTurn>;
};

export type LanguageModel = {
  startConversation(request: ConversationRequest): ModelConversation;
};

/** Dependency-injection token for the LanguageModel implementation. */
export const LANGUAGE_MODEL = Symbol("LANGUAGE_MODEL");

/**
 * - `not_configured`: no credentials; the model cannot be called at all.
 * - `unavailable`: temporary (rate limit, timeout, network, provider overload, rejected key).
 * - `upstream`: the provider failed or returned something unusable.
 */
export type LanguageModelFailure = "not_configured" | "unavailable" | "upstream";

/**
 * A model failure. The message is written by FinVoice and never contains provider messages,
 * request details or credentials; `status` is the provider's HTTP status, if any, for logs.
 */
export class LanguageModelError extends Error {
  constructor(
    readonly failure: LanguageModelFailure,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LanguageModelError";
  }
}
