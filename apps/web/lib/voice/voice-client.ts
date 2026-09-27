import {
  LOCAL_BARGE_IN_OPTIONS,
  SpeechActivityDetector,
  type SpeechActivityOptions,
} from "@finvoice/shared";

import { ReceiveTurnTracker, type ReceiveTurnStats, type TurnOutcome } from "./audio-metrics";
import {
  MicrophoneError,
  startMicrophone,
  type MicrophoneCapture,
  type MicrophoneDiagnostics,
} from "./microphone";
import { base64ToBytes, bytesToBase64 } from "./pcm";
import { PcmPlayer, type PlaybackStats } from "./pcm-player";
import {
  parseServerMessage,
  serializeClientMessage,
  type AgentLanguage,
  type VoiceClientMessage,
  type VoiceServerMessage,
} from "./protocol";

export type ConnectionState = "idle" | "connecting" | "active" | "stopping" | "closed" | "error";

export type MicrophoneState = "off" | "requesting" | "on" | "denied" | "unavailable";

export type TranscriptEntry = {
  id: number;
  speaker: "user" | "finvoice";
  text: string;
};

/**
 * Development diagnostics of the audio pipeline: formats, timings and counters only, never audio
 * or transcript content.
 */
export type VoiceDiagnostics = {
  /** "playback-test": the gateway's synthetic signal, without Gemini or the microphone. */
  mode: "voice" | "playback-test";
  microphone: MicrophoneDiagnostics | null;
  framesSent: number;
  bytesSent: number;
  speechChunksReceived: number;
  /** Language Gemini detected in the user's speech (a BCP-47 code), when it reports one. */
  detectedInputLanguage: string | null;
  playback: PlaybackStats | null;
  /** The answer currently arriving, and the last finished one (as received by the browser). */
  currentTurn: ReceiveTurnStats | null;
  lastTurn: ReceiveTurnStats | null;
  /** Local playback stops and Gemini interruptions (see VoiceClient's barge-in notes). */
  bargeIn: BargeInStats;
  /** Why the gateway ended the last answer early, if it did. */
  lastStallReason: string | null;
};

export type BargeInStats = {
  /** Times the local detector stopped FinVoice's playback because the user started speaking. */
  localBargeInTriggered: number;
  /** Interruption events from Gemini. */
  geminiInterrupted: number;
  /** Last local barge-in: speech detected → playback queue cleared. */
  localBargeInToPlaybackClearMs: number | null;
  /** Last Gemini interruption: user speech detected locally → Gemini's interrupted event. */
  geminiInterruptionLatencyMs: number | null;
};

export type VoiceViewState = {
  connection: ConnectionState;
  microphone: MicrophoneState;
  language: AgentLanguage;
  /** The allowlisted tool FinVoice is running, e.g. "calculate_loan". */
  activeTool: string | null;
  error: { code: string; message: string } | null;
  /** A non-error status for the user, e.g. after a stalled answer. */
  notice: string | null;
  transcript: TranscriptEntry[];
  /** Set while a session runs; shown only in development. */
  diagnostics: VoiceDiagnostics | null;
};

export type VoiceClientOptions = {
  /** Voice gateway WebSocket URL, e.g. ws://127.0.0.1:4100/voice. */
  url: string;
  /** Local barge-in detector settings; false disables local playback stopping. */
  bargeIn?: SpeechActivityOptions | false;
};

export type PlaybackTestOptions = {
  /** Delivery speed relative to real time (1 = real time). */
  pace: number;
  seconds?: number;
  chunkMs?: number;
};

/** Frames are dropped instead of queued when the socket is this far behind (about 2 s). */
const MAX_BUFFERED_BYTES = 64 * 1024;
const KEEP_ALIVE_MS = 20_000;
/** Diagnostics counters are published at most this often, to avoid re-rendering per frame. */
const DIAGNOSTICS_INTERVAL_MS = 500;
/** User speech detected longer ago than this is not related to an interruption. */
const SPEECH_RELEVANCE_MS = 60_000;

const NO_BARGE_IN: BargeInStats = {
  localBargeInTriggered: 0,
  geminiInterrupted: 0,
  localBargeInToPlaybackClearMs: null,
  geminiInterruptionLatencyMs: null,
};

export const MICROPHONE_MESSAGES: Record<"denied" | "not_found" | "unavailable", string> = {
  denied:
    "Microphone access was denied. Allow microphone access for this site in your browser settings, then press Start voice again.",
  not_found: "No microphone was found. Connect a microphone, then press Start voice again.",
  unavailable: "The microphone could not be started in this browser.",
};

export const STALL_NOTICE =
  "Voice response is taking longer than expected. You can ask again or say something new.";

const CONNECTION_LOST = "The connection to the voice service was lost.";

const INITIAL_STATE: VoiceViewState = {
  connection: "idle",
  microphone: "off",
  language: "SI",
  activeTool: null,
  error: null,
  notice: null,
  transcript: [],
  diagnostics: null,
};

/** The gateway's development-only synthetic signal URL next to the voice URL. */
export function playbackTestUrl(voiceUrl: string, options: PlaybackTestOptions): string {
  const url = new URL(voiceUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/test-signal`;
  url.search = new URLSearchParams({
    pace: String(options.pace),
    seconds: String(options.seconds ?? 10),
    chunkMs: String(options.chunkMs ?? 200),
  }).toString();
  return url.toString();
}

/**
 * Browser side of a voice session: microphone → gateway → speaker, plus transcripts.
 *
 * One `start()` opens one WebSocket and one voice session; `stop()` (or any error) releases the
 * microphone, the audio context, the playback queue and the socket. Nothing is recorded: audio
 * frames are sent as they are captured and speech chunks are played and dropped.
 *
 * The state is an immutable snapshot for React's useSyncExternalStore.
 */
export class VoiceClient {
  private state: VoiceViewState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  private player: PcmPlayer | null = null;
  private microphone: MicrophoneCapture | null = null;
  private keepAlive: ReturnType<typeof setInterval> | undefined;
  /** Incremented per start(); callbacks from an older run are ignored. */
  private run = 0;
  private nextEntryId = 1;
  /** Whether the next transcript text starts a new entry for each speaker. */
  private openEntry: Record<TranscriptEntry["speaker"], number | null> = {
    user: null,
    finvoice: null,
  };
  private counters = { framesSent: 0, bytesSent: 0, speechChunksReceived: 0 };
  private receiveTurn = new ReceiveTurnTracker();
  private speech: SpeechActivityDetector | null = null;
  /** When the local detector last heard the user start speaking (performance.now()). */
  private speechDetectedAt: number | null = null;
  /**
   * Set by a local barge-in: the rest of the interrupted answer is dropped until Gemini confirms
   * the interruption (or the turn ends), so it does not resume playing.
   */
  private suppressAnswer = false;
  private diagnosticsPublishedAt = 0;

  constructor(private readonly options: VoiceClientOptions) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): VoiceViewState => this.state;

  get isRunning(): boolean {
    return this.state.connection === "connecting" || this.state.connection === "active";
  }

  setLanguage(language: AgentLanguage): void {
    if (!this.isRunning) {
      this.update({ language });
    }
  }

  /** Must be called from a user gesture (a click), so audio playback is allowed. */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    const run = this.begin("voice");

    let microphone: MicrophoneCapture;
    const context = this.requireContext();
    try {
      microphone = await startMicrophone(context, (pcm) => {
        this.sendAudio(run, pcm);
      });
    } catch (error) {
      if (run !== this.run) {
        return;
      }
      const failure = error instanceof MicrophoneError ? error.failure : "unavailable";
      this.cleanup();
      this.update({
        connection: "error",
        microphone: failure === "denied" ? "denied" : "unavailable",
        error: { code: "MICROPHONE", message: MICROPHONE_MESSAGES[failure] },
      });
      return;
    }
    if (run !== this.run) {
      microphone.stop();
      return;
    }
    this.microphone = microphone;
    this.update({
      microphone: "on",
      diagnostics: this.state.diagnostics && {
        ...this.state.diagnostics,
        microphone: microphone.diagnostics,
      },
    });
    this.openSocket(run, this.options.url, () => {
      this.send({ type: "start_session", language: this.state.language });
    });
  }

  /**
   * Development only: plays the gateway's synthetic test signal through the same socket handling
   * and playback queue, without Gemini or the microphone. Isolates transport and playback.
   */
  startPlaybackTest(options: PlaybackTestOptions): void {
    if (this.isRunning) {
      return;
    }
    const run = this.begin("playback-test");
    this.update({ microphone: "off" });
    this.openSocket(run, playbackTestUrl(this.options.url, options), () => {
      this.update({ connection: "active" });
    });
  }

  /** Ends the session and releases the microphone, audio and connection. */
  stop(): void {
    if (this.state.connection === "idle" || this.state.connection === "closed") {
      return;
    }
    this.run++;
    this.send({ type: "stop_session" });
    this.endReceiveTurn("closed");
    this.cleanup();
    this.update({
      connection: this.state.connection === "error" ? "error" : "closed",
      microphone: this.state.microphone === "denied" ? "denied" : "off",
      activeTool: null,
    });
  }

  /** Resets per-session state and creates the audio context (inside the user's click). */
  private begin(mode: VoiceDiagnostics["mode"]): number {
    const run = ++this.run;
    this.openEntry = { user: null, finvoice: null };
    this.counters = { framesSent: 0, bytesSent: 0, speechChunksReceived: 0 };
    this.receiveTurn = new ReceiveTurnTracker();
    this.speech =
      this.options.bargeIn === false
        ? null
        : new SpeechActivityDetector(this.options.bargeIn ?? LOCAL_BARGE_IN_OPTIONS);
    this.speechDetectedAt = null;
    this.suppressAnswer = false;
    this.update({
      connection: "connecting",
      microphone: mode === "voice" ? "requesting" : "off",
      activeTool: null,
      error: null,
      notice: null,
      transcript: [],
      diagnostics: {
        mode,
        microphone: null,
        ...this.counters,
        detectedInputLanguage: null,
        playback: null,
        currentTurn: null,
        lastTurn: null,
        bargeIn: NO_BARGE_IN,
        lastStallReason: null,
      },
    });
    // Created synchronously inside the click so the browser allows it to play audio.
    const context = new AudioContext();
    this.context = context;
    this.player = new PcmPlayer(context);
    void context.resume().catch(() => undefined);
    return run;
  }

  private openSocket(run: number, url: string, onOpen: () => void): void {
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      if (run === this.run) {
        onOpen();
        this.keepAlive = setInterval(() => {
          this.send({ type: "ping" });
        }, KEEP_ALIVE_MS);
      }
    };
    socket.onmessage = (event: MessageEvent) => {
      if (run === this.run) {
        const message = parseServerMessage(event.data);
        if (message) {
          this.handle(message);
        }
      }
    };
    socket.onclose = () => {
      if (run !== this.run) {
        return;
      }
      this.run++;
      this.endReceiveTurn("closed");
      this.cleanup();
      this.update({
        connection: "error",
        microphone: "off",
        activeTool: null,
        error: this.state.error ?? { code: "CONNECTION", message: CONNECTION_LOST },
      });
    };
  }

  private handle(message: VoiceServerMessage): void {
    switch (message.type) {
      case "session_started":
        this.update({ connection: "active" });
        return;
      case "audio":
        if (this.suppressAnswer) {
          return; // The rest of an answer the user already talked over.
        }
        this.player?.enqueue(message.data);
        this.counters.speechChunksReceived++;
        this.receiveTurn.audio(
          base64ToBytes(message.data).length,
          performance.now(),
          this.player?.gaps ?? 0,
        );
        if (this.state.notice !== null) {
          this.update({ notice: null });
        }
        this.publishDiagnostics();
        return;
      case "input_transcript":
        this.appendTranscript("user", message.text);
        if (this.state.notice !== null) {
          this.update({ notice: null });
        }
        if (message.languageCode !== undefined && this.state.diagnostics) {
          this.update({
            diagnostics: {
              ...this.state.diagnostics,
              detectedInputLanguage: message.languageCode,
            },
          });
        }
        return;
      case "output_transcript":
        if (!this.suppressAnswer) {
          this.appendTranscript("finvoice", message.text);
        }
        return;
      case "tool_status":
        this.update({ activeTool: message.name });
        return;
      case "interrupted": {
        // Gemini's authoritative interruption: drop queued speech (again, if a local barge-in
        // already did; clearing an empty queue is harmless) and let the new answer play.
        const eventAt = performance.now();
        this.player?.clear();
        this.suppressAnswer = false;
        const detectedAt = this.speechDetectedAt;
        const latency =
          detectedAt !== null && eventAt - detectedAt <= SPEECH_RELEVANCE_MS
            ? Math.round(eventAt - detectedAt)
            : null;
        this.openEntry.finvoice = null;
        this.endReceiveTurn("interrupted");
        this.updateBargeIn((stats) => ({
          ...stats,
          geminiInterrupted: stats.geminiInterrupted + 1,
          geminiInterruptionLatencyMs: latency,
        }));
        this.update({ activeTool: null });
        return;
      }
      case "turn_complete":
        this.suppressAnswer = false;
        this.player?.endAnswer();
        this.openEntry = { user: null, finvoice: null };
        this.endReceiveTurn("complete");
        this.update({ activeTool: null });
        return;
      case "turn_stalled":
        // The gateway ended an answer that stopped making progress; the session stays open.
        this.suppressAnswer = false;
        this.player?.endAnswer();
        this.openEntry = { user: null, finvoice: null };
        this.endReceiveTurn("stalled");
        this.update({
          activeTool: null,
          notice: STALL_NOTICE,
          diagnostics: this.state.diagnostics && {
            ...this.state.diagnostics,
            lastStallReason: message.reason ?? "unspecified",
          },
        });
        return;
      case "error":
        this.update({ error: { code: message.code, message: message.message } });
        return;
      case "session_closed":
        // The gateway ended the session (after an error, on shutdown, or after a playback test).
        this.run++;
        this.endReceiveTurn("closed");
        this.cleanup();
        this.update({
          connection: this.state.error ? "error" : "closed",
          microphone: "off",
          activeTool: null,
        });
        return;
      case "pong":
        return;
    }
  }

  private appendTranscript(speaker: TranscriptEntry["speaker"], text: string): void {
    const openId = this.openEntry[speaker];
    // A new utterance by one speaker ends the other speaker's current entry.
    this.openEntry[speaker === "user" ? "finvoice" : "user"] = null;
    if (openId !== null) {
      this.update({
        transcript: this.state.transcript.map((entry) =>
          entry.id === openId ? { ...entry, text: entry.text + text } : entry,
        ),
      });
      return;
    }
    const id = this.nextEntryId++;
    this.openEntry[speaker] = id;
    this.update({ transcript: [...this.state.transcript, { id, speaker, text }] });
  }

  private sendAudio(run: number, pcm: ArrayBuffer): void {
    if (run !== this.run || this.state.connection !== "active") {
      return;
    }
    this.detectBargeIn(pcm);
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      return;
    }
    socket.send(
      serializeClientMessage({ type: "audio", data: bytesToBase64(new Uint8Array(pcm)) }),
    );
    this.counters.framesSent++;
    this.counters.bytesSent += pcm.byteLength;
    this.publishDiagnostics();
  }

  /**
   * Local barge-in. When the user starts talking while FinVoice's speech is playing, stop the
   * playback immediately instead of waiting for Gemini's interruption (which can take seconds).
   * This only controls local playback: the microphone keeps streaming, nothing is sent to Gemini
   * about it, and Gemini's own voice activity detection still decides the conversation.
   */
  private detectBargeIn(pcm: ArrayBuffer): void {
    const now = performance.now();
    if (this.speech?.processPcm16(new Uint8Array(pcm), now) !== "speech_start") {
      return;
    }
    this.speechDetectedAt = now;
    const player = this.player;
    if (!player?.isPlaying) {
      return;
    }
    player.clear();
    this.suppressAnswer = true;
    this.openEntry.finvoice = null;
    const clearMs = Math.round((performance.now() - now) * 10) / 10;
    this.updateBargeIn((stats) => ({
      ...stats,
      localBargeInTriggered: stats.localBargeInTriggered + 1,
      localBargeInToPlaybackClearMs: clearMs,
    }));
  }

  private updateBargeIn(change: (stats: BargeInStats) => BargeInStats): void {
    const diagnostics = this.state.diagnostics;
    if (diagnostics) {
      this.update({ diagnostics: { ...diagnostics, bargeIn: change(diagnostics.bargeIn) } });
    }
  }

  private endReceiveTurn(outcome: Exclude<TurnOutcome, "in progress">): void {
    const finished = this.receiveTurn.end(outcome, this.player?.gaps ?? 0);
    if (finished !== null && this.state.diagnostics) {
      this.update({ diagnostics: { ...this.state.diagnostics, lastTurn: finished } });
    }
    this.publishDiagnostics(true);
  }

  private publishDiagnostics(force = false): void {
    const diagnostics = this.state.diagnostics;
    const now = Date.now();
    if (!diagnostics || (!force && now - this.diagnosticsPublishedAt < DIAGNOSTICS_INTERVAL_MS)) {
      return;
    }
    this.diagnosticsPublishedAt = now;
    const player = this.player;
    this.update({
      diagnostics: {
        ...diagnostics,
        ...this.counters,
        // After cleanup there is no player: keep the last published figures.
        playback: player === null ? diagnostics.playback : player.stats(),
        currentTurn: this.receiveTurn.snapshot(player?.gaps ?? 0),
      },
    });
  }

  private requireContext(): AudioContext {
    if (this.context === null) {
      throw new Error("Audio context is not created");
    }
    return this.context;
  }

  private send(message: VoiceClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(serializeClientMessage(message));
    }
  }

  private cleanup(): void {
    this.publishDiagnostics(true);
    clearInterval(this.keepAlive);
    this.keepAlive = undefined;
    this.microphone?.stop();
    this.microphone = null;
    this.player?.clear();
    this.player = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, "stopped");
      }
    }
  }

  private update(patch: Partial<VoiceViewState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }
}
