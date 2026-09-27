import { VOICE_INPUT_MIME_TYPE } from "@finvoice/contracts";
import {
  GoogleGenAI,
  Modality,
  VoiceActivityType,
  type LiveConnectConfig,
  type LiveConnectParameters,
  type LiveServerMessage,
  type Session,
} from "@google/genai";

import {
  LiveConnectError,
  type LiveCloseInfo,
  type LiveConnection,
  type LiveConnector,
  type LiveEvent,
  type LiveHandlers,
  type LiveSessionSetup,
} from "./live-session.js";

/** How long opening a Live session (WebSocket + setup) may take. */
export const LIVE_CONNECT_TIMEOUT_MS = 15_000;

/** The part of the SDK client this adapter uses; replaced by a fake in tests. */
export type GeminiLiveClient = {
  live: { connect(params: LiveConnectParameters): Promise<Session> };
};

export type GeminiLiveClientFactory = (apiKey: string) => GeminiLiveClient;

export const createGoogleGenAiClient: GeminiLiveClientFactory = (apiKey) =>
  new GoogleGenAI({ apiKey });

export type GeminiLiveSettings = {
  /** Null when GEMINI_API_KEY is not set: every connect then fails with "not_configured". */
  apiKey: string | null;
  model: string;
  /** Prebuilt voice name, e.g. "Kore" (from GEMINI_LIVE_VOICE). */
  voice: string;
  connectTimeoutMs?: number;
};

/** Gemini's output audio format; anything else is not forwarded to the browser. */
const OUTPUT_AUDIO_MIME = /^audio\/pcm(;\s*rate=24000)?$/i;

/**
 * The Live session configuration. Everything is server-controlled:
 *
 * - native audio output (`responseModalities: [AUDIO]`), no separate text-to-speech, spoken with
 *   the configured prebuilt voice;
 * - the FinVoice Live system instruction and the allowlisted FinVoice tools from the API;
 * - input and output transcription;
 * - session resumption (with the latest handle when reconnecting);
 * - context window compression with a sliding window, so long conversations do not hit the
 *   context limit (server defaults for the token thresholds).
 *
 * Voice activity detection is left at Gemini's automatic default (`realtimeInputConfig` unset).
 */
export function buildLiveConnectConfig(setup: LiveSessionSetup, voice: string): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    systemInstruction: setup.systemInstruction,
    tools: [
      {
        functionDeclarations: setup.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.parameters,
        })),
      },
    ],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    sessionResumption: setup.resumptionHandle === null ? {} : { handle: setup.resumptionHandle },
    contextWindowCompression: { slidingWindow: {} },
  };
}

/** Maps one Live server message to provider-neutral events, in the order they must be handled. */
export function toLiveEvents(message: LiveServerMessage): LiveEvent[] {
  const events: LiveEvent[] = [];
  const content = message.serverContent;
  if (content) {
    if (content.interrupted === true) {
      events.push({ type: "interrupted" });
    }
    for (const part of content.modelTurn?.parts ?? []) {
      const data = part.inlineData?.data;
      const mimeType = part.inlineData?.mimeType ?? "";
      if (data && OUTPUT_AUDIO_MIME.test(mimeType)) {
        events.push({ type: "audio", data });
      }
    }
    const input = content.inputTranscription?.text;
    if (input) {
      const languageCode = content.inputTranscription?.languageCode;
      events.push({
        type: "input_transcript",
        text: input,
        ...(languageCode ? { languageCode } : {}),
      });
    }
    if (content.interimInputTranscription?.text) {
      events.push({ type: "input_activity" });
    }
    const output = content.outputTranscription?.text;
    if (output) {
      events.push({ type: "output_transcript", text: output });
    }
    if (content.generationComplete === true) {
      events.push({ type: "generation_complete" });
    }
    if (content.waitingForInput === true) {
      events.push({ type: "waiting_for_input" });
    }
    if (content.turnComplete === true) {
      events.push({
        type: "turn_complete",
        ...(content.interactionStatus ? { interactionStatus: content.interactionStatus } : {}),
      });
    }
  }
  const activity = message.voiceActivity?.voiceActivityType;
  if (
    activity === VoiceActivityType.ACTIVITY_START ||
    activity === VoiceActivityType.ACTIVITY_END
  ) {
    events.push({
      type: "voice_activity",
      activity: activity === VoiceActivityType.ACTIVITY_START ? "start" : "end",
    });
  }
  const calls = message.toolCall?.functionCalls;
  if (calls && calls.length > 0) {
    events.push({
      type: "tool_call",
      calls: calls.map((call) => ({
        id: call.id ?? "",
        name: call.name ?? "",
        args: call.args ?? {},
      })),
    });
  }
  const cancelled = message.toolCallCancellation?.ids;
  if (cancelled && cancelled.length > 0) {
    events.push({ type: "tool_call_cancellation", ids: cancelled });
  }
  const update = message.sessionResumptionUpdate;
  if (update?.resumable === true && update.newHandle) {
    events.push({ type: "resumption_update", handle: update.newHandle });
  }
  if (message.goAway) {
    events.push({ type: "go_away" });
  }
  return events;
}

/**
 * Opens Gemini Live sessions with the official SDK (`ai.live.connect`). The API key stays in this
 * process: it is never logged, and errors never carry it (the SDK puts it in the WebSocket URL,
 * so SDK error messages are never forwarded or logged).
 */
export class GeminiLiveConnector implements LiveConnector {
  private client: GeminiLiveClient | undefined;

  constructor(
    private readonly settings: GeminiLiveSettings,
    private readonly clientFactory: GeminiLiveClientFactory = createGoogleGenAiClient,
  ) {}

  async connect(setup: LiveSessionSetup, handlers: LiveHandlers): Promise<LiveConnection> {
    const { apiKey } = this.settings;
    if (apiKey === null) {
      throw new LiveConnectError("not_configured", "GEMINI_API_KEY is not set");
    }
    this.client ??= this.clientFactory(apiKey);

    let state: "connecting" | "open" | "closed" = "connecting";
    const currentState = () => state;
    /** Events that arrive before connect() resolves are delivered once the session is open. */
    const early: LiveEvent[] = [];
    let failConnect: (error: LiveConnectError) => void = () => undefined;
    const connectFailed = new Promise<never>((_resolve, reject) => {
      failConnect = reject;
    });
    connectFailed.catch(() => undefined);

    const params: LiveConnectParameters = {
      model: this.settings.model,
      config: buildLiveConnectConfig(setup, this.settings.voice),
      callbacks: {
        onmessage: (message) => {
          const events = toLiveEvents(message);
          if (state === "connecting") {
            early.push(...events);
          } else if (state === "open") {
            for (const event of events) {
              handlers.onEvent(event);
            }
          }
        },
        // Errors are always followed by a close; the close carries what is safe to report.
        onerror: () => undefined,
        onclose: (event) => {
          const info: LiveCloseInfo = { code: event.code, reason: event.reason };
          if (state === "connecting") {
            state = "closed";
            failConnect(
              new LiveConnectError("rejected", "Live connection closed during setup", info),
            );
          } else if (state === "open") {
            state = "closed";
            handlers.onClose(info);
          }
        },
      },
    };

    const client = this.client;
    const connecting = client.live.connect(params);
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new LiveConnectError("unavailable", "Live connection timed out"));
      }, this.settings.connectTimeoutMs ?? LIVE_CONNECT_TIMEOUT_MS);
    });

    let session: Session;
    try {
      session = await Promise.race([connecting, connectFailed, timedOut]);
    } catch (error) {
      state = "closed";
      // A connection that completes after we gave up must not stay open.
      connecting.then(closeQuietly, () => undefined);
      throw error instanceof LiveConnectError
        ? error
        : new LiveConnectError("unavailable", "Live connection failed");
    } finally {
      clearTimeout(timer);
    }

    // The provider may have closed the connection while connect() was resolving.
    if (currentState() !== "connecting") {
      closeQuietly(session);
      throw new LiveConnectError("rejected", "Live connection closed during setup");
    }
    state = "open";
    for (const event of early) {
      handlers.onEvent(event);
    }

    return {
      sendAudio: (data) => {
        if (state === "open") {
          sendQuietly(() => {
            session.sendRealtimeInput({ audio: { data, mimeType: VOICE_INPUT_MIME_TYPE } });
          });
        }
      },
      sendToolResponses: (responses) => {
        if (state === "open" && responses.length > 0) {
          sendQuietly(() => {
            session.sendToolResponse({
              functionResponses: responses.map(({ id, name, response }) => ({
                id,
                name,
                response,
              })),
            });
          });
        }
      },
      close: () => {
        if (state !== "closed") {
          state = "closed";
          closeQuietly(session);
        }
      },
    };
  }
}

function closeQuietly(session: Session): void {
  try {
    session.close();
  } catch {
    // Already closed.
  }
}

/** A send on a socket that is closing fails; the close callback reports the closure itself. */
function sendQuietly(send: () => void): void {
  try {
    send();
  } catch {
    // The connection is closing; onclose follows.
  }
}
