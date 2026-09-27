import {
  AGENT_TOOL_NAMES,
  VOICE_OUTPUT_MIME_TYPE,
  type AgentLanguage,
  type AgentToolName,
  type VoiceErrorCode,
  type VoiceServerMessage,
  type VoiceSessionSetupResponse,
  type VoiceStallReason,
} from "@finvoice/contracts";
import { SpeechActivityDetector, USER_TURN_OPTIONS } from "@finvoice/shared";

import { VoiceBackendError, type VoiceBackend } from "../backend/voice-backend.js";
import {
  LiveConnectError,
  type LiveCloseInfo,
  type LiveConnection,
  type LiveConnector,
  type LiveEvent,
  type LiveFunctionCall,
  type LiveToolResponse,
} from "../live/live-session.js";
import { sanitizeProviderText, type LogFields, type Logger } from "../logger.js";
import { pcm24kDurationMs, TurnMetrics, type TurnOutcome } from "../diagnostics/turn-metrics.js";
import { parseClientMessage } from "./protocol.js";

/**
 * Lifecycle of one browser connection. Each connection carries at most one voice session and
 * therefore at most one Gemini Live session at a time.
 *
 *   (connect) → WAITING_FOR_START → STARTING_GEMINI → ACTIVE → STOPPING → CLOSED
 *
 * Any state can go straight to CLOSED when the browser disconnects.
 */
export type VoiceSessionState =
  "WAITING_FOR_START" | "STARTING_GEMINI" | "ACTIVE" | "STOPPING" | "CLOSED";

export type VoiceSessionLimits = {
  /** Upper bound on tool calls per model turn (the API's own limit applies if lower). */
  maxToolCallsPerTurn: number;
  /** Consecutive resumption attempts after unexpected provider disconnects. */
  maxReconnectAttempts: number;
  /** Time the browser has to send start_session after connecting. */
  startTimeoutMs: number;
  /** Messages accepted per second (a 40 ms audio stream is 25/s). */
  maxMessagesPerSecond: number;
  /** Invalid messages tolerated before the connection is closed. */
  maxInvalidMessages: number;
  /**
   * An answer in progress with no model speech or transcription for this long is treated as
   * stalled (0 disables). See STALL_TIMEOUT_MS.
   */
  stallTimeoutMs: number;
  /**
   * After a user turn is detected, how long the model may take to show any progress before the
   * turn is treated as unanswered (0 disables). See RESPONSE_START_TIMEOUT_MS.
   */
  responseStartTimeoutMs: number;
};

/**
 * 10 s from the end of the user's turn to the model's first sign of progress (speech, output
 * transcription, tool call, generationComplete or turnComplete). Measured in real sessions, that
 * wait was 0.7–1.3 s with text input and 1.5–2.7 s from the end of the user's speech with
 * browser microphone input (Gemini's own end-of-speech detection is included), and the
 * no-response case seen in testing lasted more than 70 s. 10 s is more than three times the
 * slowest healthy start: the user is not left waiting indefinitely, and a slow but healthy
 * response is not cut off.
 */
export const RESPONSE_START_TIMEOUT_MS = 10_000;

/**
 * 10 s without model progress, counted from when the speech already received would have finished
 * playing in real time. Gemini often delivers an answer 2–4× faster than real time and sends
 * turnComplete only when that speech would have finished playing, so a plain "no events for N
 * seconds" rule fires on healthy answers (it did in testing: after a 28 s answer arrived in
 * 8.5 s, nothing came for about 20 s). Measured in real sessions, the longest gap between model
 * events while an answer was being generated was about 2.7 s (tool time excluded), and the stall
 * seen in testing was a stop of more than 70 s. 10 s past the end of the received speech is far
 * from normal pauses and short enough that the user is not left waiting indefinitely.
 */
export const STALL_TIMEOUT_MS = 10_000;

export const DEFAULT_VOICE_SESSION_LIMITS: VoiceSessionLimits = {
  maxToolCallsPerTurn: 5,
  maxReconnectAttempts: 3,
  startTimeoutMs: 30_000,
  maxMessagesPerSecond: 100,
  maxInvalidMessages: 20,
  stallTimeoutMs: STALL_TIMEOUT_MS,
  responseStartTimeoutMs: RESPONSE_START_TIMEOUT_MS,
};

/** WebSocket close codes used towards the browser. */
export const CLOSE_NORMAL = 1000;
export const CLOSE_GOING_AWAY = 1001;
export const CLOSE_POLICY_VIOLATION = 1008;
export const CLOSE_INTERNAL_ERROR = 1011;

/** Sent to the model instead of running a tool once the per-turn limit is reached. */
export const TOOL_LIMIT_RESULT = {
  error: {
    code: "TOOL_LIMIT_REACHED",
    message:
      "The tool-call limit for this answer has been reached. Answer with the information you already have, or tell the user you cannot complete this request now.",
  },
};

/** Same structure and text as the API's registry, for names that never leave the gateway. */
export const UNKNOWN_TOOL_RESULT = {
  error: {
    code: "UNKNOWN_TOOL",
    message: "This tool does not exist. Use only the declared tools.",
  },
};

export const TOOL_FAILED_RESULT = {
  error: {
    code: "TOOL_FAILED",
    message: "The tool could not be completed. Do not guess the answer.",
  },
};

/** Client-safe messages. Provider and API details are logged (sanitized), never sent. */
const MESSAGES = {
  alreadyStarted: "A voice session has already been started on this connection.",
  audioBeforeStart: "Audio is accepted only after session_started.",
  configError: "Voice is not configured on the server.",
  providerUnavailable: "The voice service is unavailable right now. Please try again later.",
  backendUnavailable: "FinVoice is unavailable right now. Please try again later.",
  sessionEnded: "The voice session ended unexpectedly. Please start again.",
  sessionFailed: "The voice session could not be started. Please try again.",
  startTimeout: "No voice session was started in time.",
  tooManyMessages: "Too many messages. The connection was closed.",
  tooManyInvalid: "Too many invalid messages. The connection was closed.",
  toolLimit: "FinVoice reached the limit of lookups and calculations for this answer.",
  toolUnavailable: "A FinVoice lookup or calculation is unavailable right now.",
} as const;

export type VoiceSessionOptions = {
  id: string;
  send(message: VoiceServerMessage): void;
  /** Closes the browser WebSocket. */
  closeSocket(code: number, reason: string): void;
  backend: VoiceBackend;
  connector: LiveConnector;
  logger: Logger;
  limits?: Partial<VoiceSessionLimits>;
  /** Logs per-turn audio metrics (development only). */
  diagnostics?: boolean;
  /** Bytes queued for the browser but not yet sent (measures gateway → browser backlog). */
  browserBacklog?: () => number;
};

/**
 * One browser voice connection: validates browser messages, drives the lifecycle, bridges audio
 * and transcripts between the browser and Gemini Live, runs tool calls through the API and
 * resumes the Live session after unexpected provider disconnects.
 *
 * Policies:
 * - A second start_session is rejected (VOICE_INVALID_MESSAGE); the running session continues.
 * - Audio before session_started is rejected and dropped. Audio received while the Live session
 *   is being resumed is dropped.
 * - stop_session, errors and server shutdown all end with session_closed and a closed socket;
 *   a new session needs a new connection.
 * - The tool-call counter resets when the model completes its answer or is interrupted. Gemini
 *   also reports turnComplete right after each tool call (before the tool response); that one
 *   neither resets the counter nor reaches the browser, so chained tool calls stay limited.
 * - Stall detection: while an answer is in progress (after the model's first speech,
 *   transcription or tool result), a lack of any model speech or output transcription for
 *   `stallTimeoutMs` ends the answer: the browser gets `turn_stalled`, and the Live session is
 *   resumed on a fresh connection when a resumption handle exists (the conversation is kept; the
 *   stalled answer is not). The browser session stays open either way. Tool execution time does
 *   not count, and a finished, interrupted or cancelled answer disarms the detector.
 */
export class VoiceSession {
  private stateValue: VoiceSessionState = "WAITING_FOR_START";
  private language: AgentLanguage | null = null;
  private setup: VoiceSessionSetupResponse | null = null;
  private connection: LiveConnection | null = null;
  /** Incremented per Live connection; events from older connections are ignored. */
  private generation = 0;
  private resumptionHandle: string | null = null;
  private reconnectAttempts = 0;
  private reconnecting = false;
  private toolCallsThisTurn = 0;
  private toolLimitNotified = false;
  /** A tool call happened since the last turnComplete: that turnComplete ends a tool-call step. */
  private toolCallPending = false;
  private readonly cancelledCalls = new Set<string>();
  private invalidMessages = 0;
  /** Audio counters, logged once when the session closes (diagnostics; no content). */
  private readonly audio = { chunksIn: 0, bytesIn: 0, chunksOut: 0, bytesOut: 0 };
  private readonly metrics: TurnMetrics;
  /** Largest gateway → browser backlog seen during the current turn. */
  private maxBrowserBacklog = 0;
  private stallTimer: NodeJS.Timeout | undefined;
  /**
   * When the speech received so far would finish playing if played in real time from its arrival
   * (performance.now() time). The stall clock starts only after this point.
   */
  private playoutEnd = 0;
  private responseTimer: NodeJS.Timeout | undefined;
  /** Notices when the user speaks and stops, from the microphone level (see USER_TURN_OPTIONS). */
  private readonly userTurn = new SpeechActivityDetector(USER_TURN_OPTIONS);
  private userSpeaking = false;
  /** When the user's latest turn was last heard, until the model shows progress. */
  private awaitingResponseSince: number | null = null;
  /** Last loud microphone frame, and the end of the last model turn (for responseStartWaitMs). */
  private lastUserLoudAt: number | null = null;
  private lastTurnEndedAt = Number.NEGATIVE_INFINITY;
  private lastInteractionStatus: string | undefined;
  /** The provider closed the stalled connection while a stall refresh was being attempted. */
  private previousConnectionClosed = false;
  private readonly stallCounters = {
    responseStartTimeouts: 0,
    generationStalls: 0,
    geminiInterruptions: 0,
  };
  private windowStart = 0;
  private messagesInWindow = 0;
  private readonly openedAt = performance.now();
  private startTimer: NodeJS.Timeout | undefined;
  private readonly limits: VoiceSessionLimits;

  constructor(private readonly options: VoiceSessionOptions) {
    this.limits = { ...DEFAULT_VOICE_SESSION_LIMITS, ...options.limits };
    this.metrics = new TurnMetrics(this.openedAt);
    this.startTimer = setTimeout(() => {
      if (this.stateValue === "WAITING_FOR_START") {
        this.fail("VOICE_SESSION_ERROR", MESSAGES.startTimeout, CLOSE_POLICY_VIOLATION);
      }
    }, this.limits.startTimeoutMs);
    this.log("info", "connection_opened");
  }

  get state(): VoiceSessionState {
    return this.stateValue;
  }

  /** Handles one WebSocket message; `data` is null for binary frames. */
  handleMessage(data: string | null): void {
    if (this.stateValue === "STOPPING" || this.stateValue === "CLOSED") {
      return;
    }
    if (!this.withinRateLimit()) {
      this.log("warn", "rate_limit_exceeded");
      this.fail("VOICE_LIMIT_REACHED", MESSAGES.tooManyMessages, CLOSE_POLICY_VIOLATION);
      return;
    }
    const parsed = parseClientMessage(data);
    if (!parsed.ok) {
      this.reject(parsed.reason);
      return;
    }
    const message = parsed.message;
    switch (message.type) {
      case "ping":
        this.options.send({ type: "pong" });
        return;
      case "start_session":
        if (this.stateValue !== "WAITING_FOR_START") {
          this.reject(MESSAGES.alreadyStarted);
          return;
        }
        void this.start(message.language);
        return;
      case "audio":
        if (this.stateValue !== "ACTIVE") {
          this.reject(MESSAGES.audioBeforeStart);
          return;
        }
        // Null while the Live session is being resumed: the frame is dropped.
        this.audio.chunksIn++;
        this.audio.bytesIn += base64Bytes(message.data);
        this.connection?.sendAudio(message.data);
        this.observeUserAudio(message.data);
        return;
      case "stop_session":
        this.stop();
        return;
    }
  }

  /** The browser disconnected: release everything. */
  handleSocketClosed(closeCode: number): void {
    if (this.stateValue === "CLOSED") {
      return;
    }
    this.log("info", "browser_disconnected", { closeCode });
    this.release();
  }

  /** The gateway is shutting down. */
  shutdown(): void {
    if (this.stateValue === "CLOSED") {
      return;
    }
    this.finish(CLOSE_GOING_AWAY, "server shutting down");
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private async start(language: AgentLanguage): Promise<void> {
    this.stateValue = "STARTING_GEMINI";
    this.language = language;
    clearTimeout(this.startTimer);
    const started = performance.now();
    this.log("info", "session_starting");
    try {
      const setup = await this.options.backend.getSessionSetup(language);
      if (!this.isIn("STARTING_GEMINI")) {
        return;
      }
      this.setup = setup;
      const connection = await this.openLive(null);
      if (!this.isIn("STARTING_GEMINI")) {
        connection.close();
        return;
      }
      this.connection = connection;
      this.stateValue = "ACTIVE";
      this.options.send({ type: "session_started", language });
      this.log("info", "session_started", { durationMs: elapsed(started) });
    } catch (error) {
      if (!this.isIn("STARTING_GEMINI")) {
        return;
      }
      const { code, message } = this.describeStartError(error);
      this.fail(code, message, CLOSE_INTERNAL_ERROR);
    }
  }

  private stop(): void {
    this.log("info", "session_stop_requested");
    this.finish(CLOSE_NORMAL, "session closed");
  }

  /** Ends the session with an error the browser can show. */
  private fail(code: VoiceErrorCode, message: string, closeCode: number): void {
    if (this.stateValue === "STOPPING" || this.stateValue === "CLOSED") {
      return;
    }
    this.log("warn", "session_failed", { code });
    this.options.send({ type: "error", code, message });
    this.finish(closeCode, "session closed");
  }

  private finish(closeCode: number, reason: string): void {
    if (this.stateValue === "STOPPING" || this.stateValue === "CLOSED") {
      return;
    }
    this.stateValue = "STOPPING";
    this.closeLive();
    this.options.send({ type: "session_closed" });
    this.release();
    this.options.closeSocket(closeCode, reason);
  }

  private release(): void {
    clearTimeout(this.startTimer);
    this.disarmResponseWatchdog();
    this.closeLive();
    this.stateValue = "CLOSED";
    this.endTurn("closed");
    this.log("info", "session_closed", {
      durationMs: elapsed(this.openedAt),
      audioChunksIn: this.audio.chunksIn,
      audioBytesIn: this.audio.bytesIn,
      audioChunksOut: this.audio.chunksOut,
      audioBytesOut: this.audio.bytesOut,
      ...this.metrics.totals(),
      ...this.stallCounters,
    });
  }

  // -------------------------------------------------------------------------
  // Gemini Live
  // -------------------------------------------------------------------------

  private openLive(resumptionHandle: string | null): Promise<LiveConnection> {
    const setup = this.requireSetup();
    const generation = ++this.generation;
    return this.options.connector.connect(
      { systemInstruction: setup.systemInstruction, tools: setup.tools, resumptionHandle },
      {
        onEvent: (event) => {
          this.onLiveEvent(generation, event);
        },
        onClose: (info) => {
          this.onLiveClosed(generation, info);
        },
      },
    );
  }

  private closeLive(): void {
    this.generation++;
    const connection = this.connection;
    this.connection = null;
    connection?.close();
  }

  private onLiveEvent(generation: number, event: LiveEvent): void {
    if (generation !== this.generation || this.stateValue !== "ACTIVE") {
      return;
    }
    switch (event.type) {
      case "audio": {
        const bytes = base64Bytes(event.data);
        this.audio.chunksOut++;
        this.audio.bytesOut += bytes;
        const now = performance.now();
        this.metrics.audio(bytes, now);
        this.modelProgress(now);
        this.playoutEnd = Math.max(this.playoutEnd, now) + pcm24kDurationMs(bytes);
        this.options.send({ type: "audio", data: event.data, mimeType: VOICE_OUTPUT_MIME_TYPE });
        this.maxBrowserBacklog = Math.max(
          this.maxBrowserBacklog,
          this.options.browserBacklog?.() ?? 0,
        );
        this.armStall(generation);
        return;
      }
      case "input_transcript":
        this.userHeard();
        this.options.send({
          type: "input_transcript",
          text: event.text,
          ...(event.languageCode === undefined ? {} : { languageCode: event.languageCode }),
        });
        return;
      case "input_activity":
        this.userHeard();
        return;
      case "voice_activity":
        if (event.activity === "start") {
          this.disarmResponseWatchdog();
        } else {
          this.userHeard();
        }
        return;
      case "output_transcript":
        this.metrics.transcript(performance.now());
        this.modelProgress(performance.now());
        this.options.send({ type: "output_transcript", text: event.text });
        this.armStall(generation);
        return;
      case "interrupted":
        this.stallCounters.geminiInterruptions++;
        this.endTurn("interrupted");
        this.resetTurn();
        this.options.send({ type: "interrupted" });
        return;
      case "generation_complete":
        this.metrics.generationComplete(performance.now());
        this.modelProgress(performance.now());
        if (!this.toolCallPending) {
          // The answer is fully generated: it cannot stall any more. turnComplete follows when its
          // speech would have finished playing.
          this.disarmStall();
        }
        return;
      case "waiting_for_input":
        // The model is deliberately waiting for the user: not an unanswered turn.
        this.disarmResponseWatchdog();
        this.awaitingResponseSince = null;
        return;
      case "turn_complete":
        this.modelProgress(performance.now());
        this.lastInteractionStatus = event.interactionStatus;
        if (this.toolCallPending) {
          // The model paused for tool results; its answer is still to come.
          this.toolCallPending = false;
          return;
        }
        this.endTurn("complete");
        this.resetTurn();
        this.reconnectAttempts = 0;
        this.options.send({ type: "turn_complete" });
        return;
      case "tool_call":
        this.toolCallPending = true;
        // Tools run in FinVoice, not in the model: not a stall.
        this.disarmStall();
        this.metrics.toolStarted(performance.now());
        this.modelProgress(performance.now());
        void this.runToolCalls(generation, event.calls);
        return;
      case "tool_call_cancellation":
        for (const id of event.ids) {
          this.cancelledCalls.add(id);
        }
        return;
      case "resumption_update":
        this.resumptionHandle = event.handle;
        return;
      case "go_away":
        this.log("info", "provider_go_away");
        void this.resume();
        return;
    }
  }

  private onLiveClosed(generation: number, info: LiveCloseInfo): void {
    if (this.reconnecting && generation === this.generation - 1) {
      this.previousConnectionClosed = true;
    }
    if (generation !== this.generation || this.stateValue !== "ACTIVE") {
      return;
    }
    this.log("warn", "provider_closed", {
      closeCode: info.code,
      providerReason: sanitizeProviderText(info.reason),
    });
    this.connection = null;
    this.endTurn("closed");
    void this.resume();
  }

  /** Reopens the Live session with the latest resumption handle, keeping the conversation. */
  private async resume(): Promise<void> {
    if (this.reconnecting || this.stateValue !== "ACTIVE") {
      return;
    }
    const handle = this.resumptionHandle;
    if (handle === null || this.reconnectAttempts >= this.limits.maxReconnectAttempts) {
      this.fail("VOICE_SESSION_ERROR", MESSAGES.sessionEnded, CLOSE_INTERNAL_ERROR);
      return;
    }
    this.reconnecting = true;
    this.reconnectAttempts++;
    this.endTurn("closed");
    this.closeLive();
    this.resetTurn();
    this.log("info", "session_resuming", { count: this.reconnectAttempts });
    const started = performance.now();
    try {
      const connection = await this.openLive(handle);
      if (!this.isIn("ACTIVE")) {
        connection.close();
        return;
      }
      this.connection = connection;
      this.log("info", "session_resumed", { durationMs: elapsed(started) });
    } catch (error) {
      this.log("warn", "session_resume_failed", errorFields(error));
      this.fail("VOICE_SESSION_ERROR", MESSAGES.sessionEnded, CLOSE_INTERNAL_ERROR);
    } finally {
      this.reconnecting = false;
    }
  }

  // -------------------------------------------------------------------------
  // Tools
  // -------------------------------------------------------------------------

  private async runToolCalls(generation: number, calls: LiveFunctionCall[]): Promise<void> {
    const responses = await Promise.all(calls.map((call) => this.runTool(call)));
    const connection = this.connection;
    if (generation !== this.generation || this.stateValue !== "ACTIVE" || connection === null) {
      return;
    }
    const current = responses.filter((response) => !this.cancelledCalls.has(response.id));
    for (const response of responses) {
      this.cancelledCalls.delete(response.id);
    }
    connection.sendToolResponses(current);
    this.metrics.toolFinished(performance.now());
    // The model now owes progress on its answer.
    this.armStall(generation);
  }

  // -------------------------------------------------------------------------
  // Turn metrics and stall detection
  // -------------------------------------------------------------------------

  /** Ends the current turn's metrics (logged in development) and disarms stall detection. */
  private endTurn(outcome: TurnOutcome): void {
    this.disarmStall();
    this.playoutEnd = 0;
    this.lastTurnEndedAt = performance.now();
    const summary = this.metrics.end(outcome, performance.now());
    if (summary !== null && this.options.diagnostics === true) {
      this.log("info", "turn_metrics", {
        turnMetrics: {
          ...summary,
          maxBrowserBacklogBytes: this.maxBrowserBacklog,
          ...(this.lastInteractionStatus === undefined
            ? {}
            : { interactionStatus: this.lastInteractionStatus }),
        },
      });
    }
    this.maxBrowserBacklog = 0;
    this.lastInteractionStatus = undefined;
  }

  // -------------------------------------------------------------------------
  // Response-start watchdog
  // -------------------------------------------------------------------------

  /** Feeds the user-turn detector with one microphone frame (level only; nothing is kept). */
  private observeUserAudio(data: string): void {
    const now = performance.now();
    const event = this.userTurn.processPcm16(Buffer.from(data, "base64"), now);
    if (this.userTurn.lastFrameLoud) {
      this.lastUserLoudAt = now;
    }
    if (event === "speech_start") {
      this.userSpeaking = true;
      this.disarmResponseWatchdog();
    } else if (event === "speech_end") {
      this.userSpeaking = false;
      this.userHeard();
    }
  }

  /**
   * A genuine user turn was heard (sustained speech that stopped, Gemini's input transcription or
   * voice-activity end): the model now owes a response. Ignored while the model's own answer is
   * in progress (Gemini's interruption handles that) and while the user is still speaking.
   */
  private userHeard(): void {
    if (this.metrics.active || this.userSpeaking) {
      return;
    }
    this.awaitingResponseSince = performance.now();
    this.armResponseWatchdog(this.generation);
  }

  /** Any model activity: the response has started (or the turn has ended). */
  private modelProgress(now: number): void {
    // Response-start wait: from the user's last loud frame (the end of their speech) when they
    // spoke since the previous turn, otherwise from the watchdog's user-turn signal.
    const userEnd =
      this.lastUserLoudAt !== null && this.lastUserLoudAt > this.lastTurnEndedAt
        ? this.lastUserLoudAt
        : this.awaitingResponseSince;
    if (userEnd !== null) {
      this.metrics.responseStart(now - userEnd);
    }
    this.awaitingResponseSince = null;
    this.disarmResponseWatchdog();
  }

  private armResponseWatchdog(generation: number): void {
    this.disarmResponseWatchdog();
    if (this.limits.responseStartTimeoutMs > 0) {
      this.responseTimer = setTimeout(() => {
        if (generation === this.generation && this.isIn("ACTIVE") && !this.reconnecting) {
          this.reportStall("no_response");
        }
      }, this.limits.responseStartTimeoutMs);
    }
  }

  private disarmResponseWatchdog(): void {
    clearTimeout(this.responseTimer);
    this.responseTimer = undefined;
  }

  /** (Re)starts the stall clock: stallTimeoutMs after the received speech would finish playing. */
  private armStall(generation: number): void {
    this.disarmStall();
    if (this.limits.stallTimeoutMs > 0) {
      const untilPlayedOut = Math.max(0, this.playoutEnd - performance.now());
      this.stallTimer = setTimeout(() => {
        this.onStall(generation);
      }, untilPlayedOut + this.limits.stallTimeoutMs);
    }
  }

  private disarmStall(): void {
    clearTimeout(this.stallTimer);
    this.stallTimer = undefined;
  }

  private onStall(generation: number): void {
    if (generation !== this.generation || !this.isIn("ACTIVE") || this.reconnecting) {
      return;
    }
    this.reportStall("no_progress");
  }

  /**
   * Ends a stalled or unanswered turn: the browser gets turn_stalled and shows a notice; the
   * session stays open. With a resumption handle and attempts left, the Live session is resumed
   * on a fresh connection with the same conversation (never repeated without limit: attempts are
   * counted and reset only by a completed answer). Otherwise the current connection is kept.
   */
  private reportStall(reason: VoiceStallReason): void {
    if (reason === "no_response") {
      this.stallCounters.responseStartTimeouts++;
      this.log("warn", "response_start_timeout", {
        durationMs: this.limits.responseStartTimeoutMs,
      });
    } else {
      this.stallCounters.generationStalls++;
      this.log("warn", "turn_stalled", { durationMs: this.limits.stallTimeoutMs });
    }
    this.awaitingResponseSince = null;
    this.disarmResponseWatchdog();
    this.endTurn("stalled");
    this.resetTurn();
    this.options.send({ type: "turn_stalled", reason });
    void this.refreshAfterStall();
  }

  /**
   * After a stall: open a resumed Live connection (same conversation) BEFORE letting go of the
   * current one, and switch only if it opens. If it fails, the current connection is kept, so a
   * stall never ends a session that may still be usable. Limited by maxReconnectAttempts (reset
   * by each completed answer), so it cannot loop.
   */
  private stalledConnectionClosed(): boolean {
    return this.previousConnectionClosed;
  }

  private async refreshAfterStall(): Promise<void> {
    const handle = this.resumptionHandle;
    if (
      handle === null ||
      this.reconnecting ||
      this.reconnectAttempts >= this.limits.maxReconnectAttempts
    ) {
      return;
    }
    this.reconnecting = true;
    this.reconnectAttempts++;
    const previous = this.connection;
    const previousGeneration = this.generation;
    this.previousConnectionClosed = false;
    this.log("info", "session_resuming", { count: this.reconnectAttempts });
    const started = performance.now();
    try {
      // openLive() advances the generation: the stalled connection's events are ignored meanwhile.
      const connection = await this.openLive(handle);
      if (!this.isIn("ACTIVE")) {
        connection.close();
        return;
      }
      previous?.close();
      this.connection = connection;
      this.log("info", "session_resumed", { durationMs: elapsed(started) });
    } catch (error) {
      this.log("warn", "session_resume_failed", errorFields(error));
      // Re-read after the await: the provider may have closed it meanwhile.
      if (this.stalledConnectionClosed() || previous === null) {
        this.fail("VOICE_SESSION_ERROR", MESSAGES.sessionEnded, CLOSE_INTERNAL_ERROR);
        return;
      }
      // Keep the current connection and deliver its events again.
      this.generation = previousGeneration;
    } finally {
      this.reconnecting = false;
    }
  }

  private async runTool(call: LiveFunctionCall): Promise<LiveToolResponse> {
    const respond = (response: Record<string, unknown>): LiveToolResponse => ({
      id: call.id,
      name: call.name,
      response,
    });
    if (this.toolCallsThisTurn >= this.maxToolCallsPerTurn()) {
      this.log("warn", "tool_limit_reached", { count: this.toolCallsThisTurn });
      if (!this.toolLimitNotified) {
        this.toolLimitNotified = true;
        this.options.send({
          type: "error",
          code: "VOICE_LIMIT_REACHED",
          message: MESSAGES.toolLimit,
        });
      }
      return respond(TOOL_LIMIT_RESULT);
    }
    this.toolCallsThisTurn++;
    if (!isAllowedToolName(call.name)) {
      this.log("warn", "tool_not_allowed");
      return respond(UNKNOWN_TOOL_RESULT);
    }
    const tool = call.name;
    this.options.send({ type: "tool_status", name: tool });
    const started = performance.now();
    try {
      const execution = await this.options.backend.executeTool({
        name: tool,
        arguments: call.args,
        language: this.requireLanguage(),
      });
      this.log("info", "tool_executed", {
        tool,
        durationMs: elapsed(started),
        ...(execution.isError ? { code: errorCodeOf(execution.result) } : {}),
      });
      return respond(execution.result);
    } catch (error) {
      this.log("error", "tool_failed", {
        tool,
        durationMs: elapsed(started),
        ...errorFields(error),
      });
      if (this.stateValue === "ACTIVE") {
        this.options.send({
          type: "error",
          code: "VOICE_TOOL_ERROR",
          message: MESSAGES.toolUnavailable,
        });
      }
      return respond(TOOL_FAILED_RESULT);
    }
  }

  private maxToolCallsPerTurn(): number {
    return Math.min(this.limits.maxToolCallsPerTurn, this.requireSetup().maxToolCallsPerTurn);
  }

  private resetTurn(): void {
    this.toolCallsThisTurn = 0;
    this.toolLimitNotified = false;
    this.toolCallPending = false;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private reject(reason: string): void {
    this.invalidMessages++;
    this.log("warn", "invalid_message", { count: this.invalidMessages });
    if (this.invalidMessages > this.limits.maxInvalidMessages) {
      this.fail("VOICE_LIMIT_REACHED", MESSAGES.tooManyInvalid, CLOSE_POLICY_VIOLATION);
      return;
    }
    this.options.send({ type: "error", code: "VOICE_INVALID_MESSAGE", message: reason });
  }

  private withinRateLimit(): boolean {
    const now = performance.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.messagesInWindow = 0;
    }
    this.messagesInWindow++;
    return this.messagesInWindow <= this.limits.maxMessagesPerSecond;
  }

  private describeStartError(error: unknown): { code: VoiceErrorCode; message: string } {
    this.log("warn", "session_start_failed", errorFields(error));
    if (error instanceof LiveConnectError) {
      return error.failure === "not_configured"
        ? { code: "VOICE_CONFIG_ERROR", message: MESSAGES.configError }
        : { code: "VOICE_PROVIDER_UNAVAILABLE", message: MESSAGES.providerUnavailable };
    }
    if (error instanceof VoiceBackendError) {
      return error.failure === "not_configured"
        ? { code: "VOICE_CONFIG_ERROR", message: MESSAGES.configError }
        : { code: "VOICE_SESSION_ERROR", message: MESSAGES.backendUnavailable };
    }
    return { code: "VOICE_SESSION_ERROR", message: MESSAGES.sessionFailed };
  }

  /** State check that is re-evaluated after an await (the state may change meanwhile). */
  private isIn(state: VoiceSessionState): boolean {
    return this.stateValue === state;
  }

  private requireSetup(): VoiceSessionSetupResponse {
    if (this.setup === null) {
      throw new Error("Voice session setup is not loaded");
    }
    return this.setup;
  }

  private requireLanguage(): AgentLanguage {
    if (this.language === null) {
      throw new Error("Voice session language is not set");
    }
    return this.language;
  }

  private log(level: "info" | "warn" | "error", event: string, fields: LogFields = {}): void {
    this.options.logger[level](event, {
      sessionId: this.options.id,
      state: this.stateValue,
      ...(this.language === null ? {} : { language: this.language }),
      ...fields,
    });
  }
}

function isAllowedToolName(name: string): name is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(name);
}

/** The code of a structured tool error result, for logs. */
function errorCodeOf(result: Record<string, unknown>): string {
  const error = result.error;
  if (typeof error === "object" && error !== null && "code" in error) {
    return typeof error.code === "string" ? error.code : "TOOL_ERROR";
  }
  return "TOOL_ERROR";
}

/** Safe log fields for an error: its class, failure kind and provider close info, never its message. */
function errorFields(error: unknown): LogFields {
  if (error instanceof LiveConnectError) {
    return {
      errorName: error.name,
      code: error.failure,
      ...(error.closeInfo
        ? {
            closeCode: error.closeInfo.code,
            providerReason: sanitizeProviderText(error.closeInfo.reason),
          }
        : {}),
    };
  }
  if (error instanceof VoiceBackendError) {
    return {
      errorName: error.name,
      code: error.failure,
      ...(error.status === undefined ? {} : { httpStatus: error.status }),
    };
  }
  return { errorName: error instanceof Error ? error.name : "unknown" };
}

/** Bytes encoded by a padded base64 string, without decoding it. */
function base64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}
