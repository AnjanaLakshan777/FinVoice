import type {
  AgentLanguage,
  AnalyticsEventRequest,
  VoiceSessionSetupResponse,
  VoiceToolExecutionRequest,
  VoiceToolExecutionResponse,
} from "@finvoice/contracts";

import type { VoiceBackend } from "../../src/backend/voice-backend.js";
import type {
  LiveCloseInfo,
  LiveConnection,
  LiveConnector,
  LiveEvent,
  LiveHandlers,
  LiveSessionSetup,
  LiveToolResponse,
} from "../../src/live/live-session.js";
import type { LogFields, Logger } from "../../src/logger.js";

export const TEST_SYSTEM_INSTRUCTION = "Test Live instruction. RESPOND IN SINHALA.";

export function testSetup(language: AgentLanguage): VoiceSessionSetupResponse {
  return {
    agentVersion: "1",
    language,
    systemInstruction: `${TEST_SYSTEM_INSTRUCTION} (${language})`,
    tools: [
      {
        name: "calculate_loan",
        description: "Loan repayment",
        parameters: { type: "object", properties: {} },
      },
    ],
    maxToolCallsPerTurn: 5,
  };
}

/** An in-memory VoiceBackend: records calls and answers from overridable handlers. */
export class FakeVoiceBackend implements VoiceBackend {
  readonly setupRequests: AgentLanguage[] = [];
  readonly toolRequests: VoiceToolExecutionRequest[] = [];

  setup: (language: AgentLanguage) => Promise<VoiceSessionSetupResponse> = (language) =>
    Promise.resolve(testSetup(language));

  tool: (request: VoiceToolExecutionRequest) => Promise<VoiceToolExecutionResponse> = (request) =>
    Promise.resolve({
      tool: "calculate_loan",
      isError: false,
      result: { echoed: request.name, monthlyPayment: "16607.15" },
    });

  getSessionSetup(language: AgentLanguage): Promise<VoiceSessionSetupResponse> {
    this.setupRequests.push(language);
    return this.setup(language);
  }

  executeTool(request: VoiceToolExecutionRequest): Promise<VoiceToolExecutionResponse> {
    this.toolRequests.push(request);
    return this.tool(request);
  }

  readonly analyticsEvents: AnalyticsEventRequest[] = [];

  analytics: (event: AnalyticsEventRequest) => Promise<void> = () => Promise.resolve();

  recordAnalyticsEvent(event: AnalyticsEventRequest): Promise<void> {
    this.analyticsEvents.push(event);
    return this.analytics(event);
  }
}

/** One fake Live connection: records what the gateway sends, lets tests emit provider events. */
export class FakeLiveConnection implements LiveConnection {
  readonly audio: string[] = [];
  readonly toolResponses: LiveToolResponse[][] = [];
  closed = false;

  constructor(
    readonly setup: LiveSessionSetup,
    private readonly handlers: LiveHandlers,
  ) {}

  sendAudio(data: string): void {
    this.audio.push(data);
  }

  sendToolResponses(responses: LiveToolResponse[]): void {
    this.toolResponses.push(responses);
  }

  close(): void {
    this.closed = true;
  }

  emit(event: LiveEvent): void {
    if (!this.closed) {
      this.handlers.onEvent(event);
    }
  }

  closeFromProvider(info: LiveCloseInfo = { code: 1011, reason: "internal" }): void {
    if (!this.closed) {
      this.closed = true;
      this.handlers.onClose(info);
    }
  }
}

/** A LiveConnector whose connections are FakeLiveConnections; `next` can delay or fail them. */
export class FakeLiveConnector implements LiveConnector {
  readonly connections: FakeLiveConnection[] = [];
  readonly setups: LiveSessionSetup[] = [];
  /** Replaces the next connect() outcome: throw to fail it, await to delay it. */
  before: (() => Promise<void>) | null = null;

  async connect(setup: LiveSessionSetup, handlers: LiveHandlers): Promise<LiveConnection> {
    this.setups.push(setup);
    const before = this.before;
    this.before = null;
    if (before) {
      await before();
    }
    const connection = new FakeLiveConnection(setup, handlers);
    this.connections.push(connection);
    return connection;
  }

  get latest(): FakeLiveConnection {
    const connection = this.connections.at(-1);
    if (!connection) {
      throw new Error("No Live connection was opened");
    }
    return connection;
  }
}

/** A logger that keeps every entry, so tests can check what is (and is not) logged. */
export class RecordingLogger implements Logger {
  readonly entries: { level: string; event: string; fields: LogFields }[] = [];

  info(event: string, fields: LogFields = {}): void {
    this.entries.push({ level: "info", event, fields });
  }

  warn(event: string, fields: LogFields = {}): void {
    this.entries.push({ level: "warn", event, fields });
  }

  error(event: string, fields: LogFields = {}): void {
    this.entries.push({ level: "error", event, fields });
  }

  events(): string[] {
    return this.entries.map((entry) => entry.event);
  }

  text(): string {
    return JSON.stringify(this.entries);
  }
}

/** Waits until `condition` holds, polling briefly (for effects of async message handling). */
export async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
