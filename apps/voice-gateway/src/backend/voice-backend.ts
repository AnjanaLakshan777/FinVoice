import {
  INTERNAL_TOKEN_HEADER,
  type AgentLanguage,
  type AnalyticsEventRequest,
  type VoiceSessionSetupResponse,
  type VoiceToolExecutionRequest,
  type VoiceToolExecutionResponse,
} from "@finvoice/contracts";

/**
 * What the voice gateway needs from the FinVoice API. The gateway never reads the database and
 * holds no business logic: the prompt, the tool declarations and tool execution (allowlist,
 * argument contracts, finance engine, knowledge service) all stay in the API.
 */
export type VoiceBackend = {
  getSessionSetup(language: AgentLanguage): Promise<VoiceSessionSetupResponse>;
  executeTool(request: VoiceToolExecutionRequest): Promise<VoiceToolExecutionResponse>;
  /**
   * Sends one privacy-safe analytics event (a finished voice session: language, duration, outcome;
   * never audio, transcripts or tool data). Callers must not await it on the voice path.
   */
  recordAnalyticsEvent(event: AnalyticsEventRequest): Promise<void>;
};

export type VoiceBackendFailure =
  /** INTERNAL_API_TOKEN is not set on the gateway, or the API rejected it or has none. */
  | "not_configured"
  /** The API could not be reached, timed out or failed. */
  | "unavailable";

/** A failed backend call. The message is for logs only and contains no secrets. */
export class VoiceBackendError extends Error {
  constructor(
    readonly failure: VoiceBackendFailure,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "VoiceBackendError";
  }
}

export type HttpVoiceBackendSettings = {
  /** Base URL of the API, e.g. http://127.0.0.1:4000. */
  url: string;
  token: string | null;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

/** Calls the API's token-protected internal voice endpoints (Option A: internal HTTP). */
export class HttpVoiceBackend implements VoiceBackend {
  constructor(
    private readonly settings: HttpVoiceBackendSettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  getSessionSetup(language: AgentLanguage): Promise<VoiceSessionSetupResponse> {
    return this.call<VoiceSessionSetupResponse>(
      "GET",
      `/internal/voice/session-setup?language=${encodeURIComponent(language)}`,
    );
  }

  executeTool(request: VoiceToolExecutionRequest): Promise<VoiceToolExecutionResponse> {
    return this.call<VoiceToolExecutionResponse>("POST", "/internal/voice/tools/execute", request);
  }

  async recordAnalyticsEvent(event: AnalyticsEventRequest): Promise<void> {
    await this.call<unknown>("POST", "/internal/analytics/events", event);
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const { token } = this.settings;
    if (token === null) {
      throw new VoiceBackendError("not_configured", "INTERNAL_API_TOKEN is not set");
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.settings.url}${path}`, {
        method,
        headers: {
          [INTERNAL_TOKEN_HEADER]: token,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.settings.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch {
      throw new VoiceBackendError("unavailable", "The FinVoice API could not be reached");
    }
    if (response.status === 401 || response.status === 503) {
      await response.body?.cancel();
      throw new VoiceBackendError(
        response.status === 401 ? "not_configured" : "unavailable",
        response.status === 401
          ? "The FinVoice API rejected the internal token"
          : "The FinVoice API internal endpoints are unavailable",
        response.status,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new VoiceBackendError(
        "unavailable",
        `The FinVoice API answered ${String(response.status)}`,
        response.status,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new VoiceBackendError("unavailable", "The FinVoice API returned invalid JSON");
    }
  }
}
