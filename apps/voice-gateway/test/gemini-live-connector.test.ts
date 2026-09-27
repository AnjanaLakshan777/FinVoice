import { DEFAULT_GEMINI_LIVE_VOICE, loadVoiceGatewayConfig } from "@finvoice/config";
import {
  InteractionStatus,
  Modality,
  VoiceActivityType,
  type LiveConnectParameters,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import { describe, expect, it, vi } from "vitest";

import {
  buildLiveConnectConfig,
  GeminiLiveConnector,
  toLiveEvents,
  type GeminiLiveClient,
} from "../src/live/gemini-live-connector.js";
import {
  LiveConnectError,
  type LiveEvent,
  type LiveHandlers,
  type LiveSessionSetup,
} from "../src/live/live-session.js";

const FAKE_KEY = "fake-gemini-key-for-tests-only";

const SETUP: LiveSessionSetup = {
  systemInstruction: "You are FinVoice. RESPOND IN TAMIL.",
  tools: [
    {
      name: "calculate_loan",
      description: "Loan repayment",
      parameters: { type: "object", properties: { principal: { type: "string" } } },
    },
  ],
  resumptionHandle: null,
};

/** A fake SDK: records connect() parameters and the calls made on the returned Session. */
class FakeGenAi {
  readonly params: LiveConnectParameters[] = [];
  readonly session = {
    sendRealtimeInput: vi.fn(),
    sendToolResponse: vi.fn(),
    close: vi.fn(),
  };
  /** How connect() behaves; by default it resolves like the SDK after setupComplete. */
  connectImpl: (params: LiveConnectParameters) => Promise<Session> = () =>
    Promise.resolve(this.session as unknown as Session);
  readonly factory = vi.fn<(apiKey: string) => GeminiLiveClient>(() => ({
    live: {
      connect: (params) => {
        this.params.push(params);
        return this.connectImpl(params);
      },
    },
  }));

  get callbacks(): LiveConnectParameters["callbacks"] {
    const params = this.params.at(-1);
    if (!params) {
      throw new Error("connect() was not called");
    }
    return params.callbacks;
  }

  message(message: Partial<LiveServerMessage>): void {
    this.callbacks.onmessage(message as LiveServerMessage);
  }

  close(code = 1011, reason = "internal"): void {
    this.callbacks.onclose?.({ code, reason } as CloseEvent);
  }
}

/** A server message; the SDK class also has getters the adapter does not use. */
function msg(message: Partial<LiveServerMessage>): LiveServerMessage {
  return message as LiveServerMessage;
}

function recorder(): LiveHandlers & { events: LiveEvent[]; closes: number } {
  const handlers = {
    events: [] as LiveEvent[],
    closes: 0,
    onEvent: (event: LiveEvent) => {
      handlers.events.push(event);
    },
    onClose: () => {
      handlers.closes++;
    },
  };
  return handlers;
}

function connector(
  genai: FakeGenAi,
  overrides: { apiKey?: string | null; timeoutMs?: number } = {},
) {
  return new GeminiLiveConnector(
    {
      apiKey: overrides.apiKey === undefined ? FAKE_KEY : overrides.apiKey,
      model: "gemini-live-test-model",
      voice: "Kore",
      ...(overrides.timeoutMs === undefined ? {} : { connectTimeoutMs: overrides.timeoutMs }),
    },
    genai.factory,
  );
}

describe("Live session configuration", () => {
  it("connects with the configured model and the API key only through the SDK client", async () => {
    const genai = new FakeGenAi();
    await connector(genai).connect(SETUP, recorder());

    expect(genai.factory).toHaveBeenCalledWith(FAKE_KEY);
    expect(genai.params[0]?.model).toBe("gemini-live-test-model");
    expect(JSON.stringify(genai.params[0]?.config)).not.toContain(FAKE_KEY);
  });

  it("requests native audio output only", () => {
    expect(buildLiveConnectConfig(SETUP, "Kore").responseModalities).toEqual([Modality.AUDIO]);
  });

  it("uses the server-provided system instruction, including the response language", () => {
    const config = buildLiveConnectConfig(SETUP, "Kore");
    expect(config.systemInstruction).toBe(SETUP.systemInstruction);
    expect(config.systemInstruction).toContain("RESPOND IN TAMIL");
  });

  it("declares exactly the server-provided tools as JSON-schema function declarations", () => {
    expect(buildLiveConnectConfig(SETUP, "Kore").tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "calculate_loan",
            description: "Loan repayment",
            parametersJsonSchema: SETUP.tools[0]?.parameters,
          },
        ],
      },
    ]);
  });

  it("enables transcription, resumption and context compression, and keeps automatic VAD", () => {
    const config = buildLiveConnectConfig(SETUP, "Kore");
    expect(config.inputAudioTranscription).toEqual({});
    expect(config.outputAudioTranscription).toEqual({});
    expect(config.sessionResumption).toEqual({});
    expect(config.contextWindowCompression).toEqual({ slidingWindow: {} });
    expect(config.realtimeInputConfig).toBeUndefined();
  });

  it("speaks with the configured prebuilt voice", () => {
    expect(buildLiveConnectConfig(SETUP, "Puck").speechConfig).toEqual({
      voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
    });
  });

  it.each([
    ["the default voice when GEMINI_LIVE_VOICE is not set", {}, DEFAULT_GEMINI_LIVE_VOICE],
    ["a custom GEMINI_LIVE_VOICE", { GEMINI_LIVE_VOICE: "Charon" }, "Charon"],
  ])("sends %s to Gemini Live", async (_case, env, voice) => {
    const config = loadVoiceGatewayConfig({ GEMINI_API_KEY: FAKE_KEY, ...env });
    const genai = new FakeGenAi();

    await new GeminiLiveConnector(
      {
        apiKey: config.gemini.apiKey,
        model: config.gemini.liveModel,
        voice: config.gemini.liveVoice,
      },
      genai.factory,
    ).connect(SETUP, recorder());

    expect(genai.params[0]?.config?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName).toBe(
      voice,
    );
    expect(DEFAULT_GEMINI_LIVE_VOICE).toBe("Kore");
  });

  it("passes the resumption handle when resuming", () => {
    expect(
      buildLiveConnectConfig({ ...SETUP, resumptionHandle: "handle-7" }, "Kore").sessionResumption,
    ).toEqual({ handle: "handle-7" });
  });
});

describe("sending", () => {
  it("sends microphone audio as 16 kHz PCM", async () => {
    const genai = new FakeGenAi();
    const connection = await connector(genai).connect(SETUP, recorder());

    connection.sendAudio("AAAA");

    expect(genai.session.sendRealtimeInput).toHaveBeenCalledWith({
      audio: { data: "AAAA", mimeType: "audio/pcm;rate=16000" },
    });
  });

  it("sends tool responses with the call id and name", async () => {
    const genai = new FakeGenAi();
    const connection = await connector(genai).connect(SETUP, recorder());

    connection.sendToolResponses([
      { id: "call-1", name: "calculate_loan", response: { monthlyPayment: "16607.15" } },
    ]);

    expect(genai.session.sendToolResponse).toHaveBeenCalledWith({
      functionResponses: [
        { id: "call-1", name: "calculate_loan", response: { monthlyPayment: "16607.15" } },
      ],
    });
  });

  it("closes once and then ignores sends, messages and the close callback", async () => {
    const genai = new FakeGenAi();
    const handlers = recorder();
    const connection = await connector(genai).connect(SETUP, handlers);

    connection.close();
    connection.close();
    connection.sendAudio("AAAA");
    genai.message({ serverContent: { turnComplete: true } });
    genai.close(1000, "");

    expect(genai.session.close).toHaveBeenCalledTimes(1);
    expect(genai.session.sendRealtimeInput).not.toHaveBeenCalled();
    expect(handlers.events).toEqual([]);
    expect(handlers.closes).toBe(0);
  });

  it("does not throw when a send fails on a closing socket", async () => {
    const genai = new FakeGenAi();
    genai.session.sendRealtimeInput.mockImplementation(() => {
      throw new Error("WebSocket is not open");
    });
    const connection = await connector(genai).connect(SETUP, recorder());

    expect(() => {
      connection.sendAudio("AAAA");
    }).not.toThrow();
  });
});

describe("receiving", () => {
  it("maps server messages to events", () => {
    expect(
      toLiveEvents(
        msg({
          serverContent: {
            modelTurn: {
              parts: [
                { inlineData: { data: "AAEC", mimeType: "audio/pcm;rate=24000" } },
                { inlineData: { data: "IMAGE", mimeType: "image/png" } },
                { text: "thinking" },
              ],
            },
            inputTranscription: { text: "hello", languageCode: "en-US" },
            outputTranscription: { text: "hi there" },
            turnComplete: true,
          },
        }),
      ),
    ).toEqual([
      { type: "audio", data: "AAEC" },
      { type: "input_transcript", text: "hello", languageCode: "en-US" },
      { type: "output_transcript", text: "hi there" },
      { type: "turn_complete" },
    ]);
  });

  it("maps interruption, tool calls, cancellations, resumption updates and GoAway", () => {
    expect(toLiveEvents(msg({ serverContent: { interrupted: true } }))).toEqual([
      { type: "interrupted" },
    ]);
    expect(
      toLiveEvents(
        msg({
          toolCall: { functionCalls: [{ id: "c1", name: "calculate_loan", args: { a: 1 } }] },
        }),
      ),
    ).toEqual([
      { type: "tool_call", calls: [{ id: "c1", name: "calculate_loan", args: { a: 1 } }] },
    ]);
    expect(toLiveEvents(msg({ toolCallCancellation: { ids: ["c1"] } }))).toEqual([
      { type: "tool_call_cancellation", ids: ["c1"] },
    ]);
    expect(
      toLiveEvents(
        msg({
          sessionResumptionUpdate: { newHandle: "h2", resumable: true },
        }),
      ),
    ).toEqual([{ type: "resumption_update", handle: "h2" }]);
    expect(
      toLiveEvents(
        msg({
          sessionResumptionUpdate: { newHandle: "h3", resumable: false },
        }),
      ),
    ).toEqual([]);
    expect(toLiveEvents(msg({ goAway: { timeLeft: "10s" } }))).toEqual([{ type: "go_away" }]);
  });

  it("maps the explicit lifecycle events", () => {
    expect(
      toLiveEvents(
        msg({
          serverContent: {
            interimInputTranscription: { text: "wha" },
            generationComplete: true,
            waitingForInput: true,
            turnComplete: true,
            interactionStatus: InteractionStatus.IDLE,
          },
        }),
      ),
    ).toEqual([
      { type: "input_activity" },
      { type: "generation_complete" },
      { type: "waiting_for_input" },
      { type: "turn_complete", interactionStatus: "IDLE" },
    ]);
    expect(
      toLiveEvents(msg({ voiceActivity: { voiceActivityType: VoiceActivityType.ACTIVITY_END } })),
    ).toEqual([{ type: "voice_activity", activity: "end" }]);
    expect(
      toLiveEvents(msg({ voiceActivity: { voiceActivityType: VoiceActivityType.ACTIVITY_START } })),
    ).toEqual([{ type: "voice_activity", activity: "start" }]);
  });

  it("delivers messages that arrive during setup once the session is open", async () => {
    const genai = new FakeGenAi();
    genai.connectImpl = () => {
      genai.message({ sessionResumptionUpdate: { newHandle: "early", resumable: true } });
      return Promise.resolve(genai.session as unknown as Session);
    };
    const handlers = recorder();

    await connector(genai).connect(SETUP, handlers);

    expect(handlers.events).toEqual([{ type: "resumption_update", handle: "early" }]);
  });

  it("reports a provider close once", async () => {
    const genai = new FakeGenAi();
    const handlers = recorder();
    await connector(genai).connect(SETUP, handlers);

    genai.close(1011, "internal");
    genai.close(1011, "internal");

    expect(handlers.closes).toBe(1);
  });
});

describe("connection errors", () => {
  it("fails with not_configured without a key, without creating a client", async () => {
    const genai = new FakeGenAi();
    await expect(
      connector(genai, { apiKey: null }).connect(SETUP, recorder()),
    ).rejects.toMatchObject({ failure: "not_configured" });
    expect(genai.factory).not.toHaveBeenCalled();
  });

  it("fails with rejected when the provider closes during setup", async () => {
    const genai = new FakeGenAi();
    genai.connectImpl = () => {
      queueMicrotask(() => {
        genai.close(1008, "You exceeded your current quota");
      });
      return new Promise(() => undefined);
    };

    const error: unknown = await connector(genai)
      .connect(SETUP, recorder())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LiveConnectError);
    expect(error).toMatchObject({
      failure: "rejected",
      closeInfo: { code: 1008, reason: "You exceeded your current quota" },
    });
  });

  it("fails with unavailable on timeout and closes a session that opens later", async () => {
    const genai = new FakeGenAi();
    let open: () => void = () => undefined;
    genai.connectImpl = () =>
      new Promise((resolve) => {
        open = () => {
          resolve(genai.session as unknown as Session);
        };
      });

    await expect(
      connector(genai, { timeoutMs: 10 }).connect(SETUP, recorder()),
    ).rejects.toMatchObject({ failure: "unavailable" });

    open();
    await vi.waitFor(() => {
      expect(genai.session.close).toHaveBeenCalledTimes(1);
    });
  });

  it("maps SDK errors to unavailable without keeping their message", async () => {
    const genai = new FakeGenAi();
    genai.connectImpl = () => Promise.reject(new Error(`failed wss://x?key=${FAKE_KEY}`));

    const error: unknown = await connector(genai)
      .connect(SETUP, recorder())
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ failure: "unavailable" });
    expect((error as Error).message).not.toContain(FAKE_KEY);
  });
});
