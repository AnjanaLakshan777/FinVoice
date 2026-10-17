"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { formatAudioLine, type ReceiveTurnStats } from "../../lib/voice/audio-metrics";
import { VOICE_LANGUAGES, type AgentLanguage } from "../../lib/voice/protocol";
import {
  VoiceClient,
  type ConnectionState,
  type MicrophoneState,
  type TranscriptEntry,
  type VoiceDiagnostics,
} from "../../lib/voice/voice-client";
import styles from "./voice.module.css";

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  active: "Connected, listening",
  stopping: "Stopping…",
  closed: "Session ended",
  error: "Error",
};

const MICROPHONE_LABELS: Record<MicrophoneState, string> = {
  off: "Off",
  requesting: "Waiting for permission…",
  on: "On",
  denied: "Permission denied",
  unavailable: "Unavailable",
};

const TOOL_LABELS: Record<string, string> = {
  search_knowledge: "Looking up verified information…",
  get_knowledge_article: "Reading a verified article…",
  calculate_loan: "Calculating loan repayments…",
  calculate_savings: "Calculating a savings plan…",
  calculate_budget: "Calculating a budget…",
};

function latest(transcript: TranscriptEntry[], speaker: TranscriptEntry["speaker"]): string {
  return transcript.findLast((entry) => entry.speaker === speaker)?.text ?? "—";
}

function flag(value: boolean | null): string {
  return value === null ? "not reported" : value ? "on" : "off";
}

function msOrDash(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${String(value)} ms`;
}

function turnSummary(turn: ReceiveTurnStats | null): string {
  if (turn === null) {
    return "—";
  }
  const factor = turn.deliveryFactor === null ? "—" : `${turn.deliveryFactor.toFixed(2)}x`;
  return `${turn.outcome}: ${String(turn.receivedAudioDurationMs)} ms audio in ${String(turn.receiveWallClockDurationMs)} ms (${factor}), ${String(turn.receivedAudioChunks)} chunks, ${String(turn.underruns)} underruns`;
}

const PLAYBACK_TEST_PACES = [1, 0.8, 2] as const;

/**
 * Development-only view of the audio pipeline: formats, timings and counters, never audio. The
 * transcript above already shows what Gemini heard.
 */
function DiagnosticsPanel({
  diagnostics,
  language,
  running,
  onPlaybackTest,
}: {
  diagnostics: VoiceDiagnostics | null;
  language: AgentLanguage;
  running: boolean;
  onPlaybackTest: (pace: number) => void;
}) {
  const [pace, setPace] = useState<number>(1);
  const microphone = diagnostics?.microphone ?? null;
  const playback = diagnostics?.playback ?? null;
  const rows: [string, string][] = [
    ["Mode", diagnostics?.mode ?? "—"],
    ["Selected language", language],
    ["Detected input language", diagnostics?.detectedInputLanguage ?? "not reported"],
  ];
  if (microphone !== null) {
    rows.push(
      ["Input sample rate (AudioContext)", `${String(microphone.inputSampleRate)} Hz`],
      [
        "Microphone track sample rate",
        microphone.trackSampleRate === null
          ? "not reported"
          : `${String(microphone.trackSampleRate)} Hz`,
      ],
      [
        "Microphone channels",
        microphone.channelCount === null ? "not reported" : String(microphone.channelCount),
      ],
      ["Output to gateway", `${String(microphone.outputSampleRate)} Hz, mono, 16-bit PCM`],
      [
        "Chunk size",
        `${String(microphone.frameSamples)} samples, ${String(microphone.frameBytes)} bytes (40 ms)`,
      ],
      ["Echo cancellation", flag(microphone.echoCancellation)],
      ["Noise suppression", flag(microphone.noiseSuppression)],
      ["Automatic gain control", flag(microphone.autoGainControl)],
    );
  }
  if (diagnostics !== null) {
    rows.push(
      ["Chunks sent", String(diagnostics.framesSent)],
      ["Bytes sent", String(diagnostics.bytesSent)],
      ["Speech chunks received", String(diagnostics.speechChunksReceived)],
      ["Current answer", turnSummary(diagnostics.currentTurn)],
      ["Last answer", turnSummary(diagnostics.lastTurn)],
      ["Queue now", msOrDash(playback?.queueMs)],
      [
        "Queue on arrival (min / avg / max)",
        playback === null
          ? "—"
          : `${msOrDash(playback.minQueueMs)} / ${msOrDash(playback.avgQueueMs)} / ${msOrDash(playback.maxQueueMs)}`,
      ],
      ["Underruns", String(playback?.underruns ?? 0)],
      ["Longest underrun", msOrDash(playback?.longestUnderrunMs)],
      [
        "Speech queued / played",
        playback === null ? "—" : `${String(playback.queuedMs)} / ${String(playback.playedMs)} ms`,
      ],
      ["Playback buffer (lead)", msOrDash(playback?.leadMs)],
      ["Local barge-ins (playback stopped)", String(diagnostics.bargeIn.localBargeInTriggered)],
      ["Gemini interruptions", String(diagnostics.bargeIn.geminiInterrupted)],
      [
        "Local barge-in → playback cleared",
        msOrDash(diagnostics.bargeIn.localBargeInToPlaybackClearMs),
      ],
      [
        "Speech detected → Gemini interrupted",
        msOrDash(diagnostics.bargeIn.geminiInterruptionLatencyMs),
      ],
      ["Last stall reason", diagnostics.lastStallReason ?? "—"],
    );
  }
  const current = diagnostics?.currentTurn ?? diagnostics?.lastTurn ?? null;
  return (
    <details className={styles.diagnostics} data-testid="diagnostics">
      <summary>Audio diagnostics (development only)</summary>
      <p className={styles.audioLine} data-testid="audio-line">
        {formatAudioLine(current, playback)}
      </p>
      <dl>
        {rows.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd data-testid={`diagnostic-${name}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.controls}>
        <label className={styles.field}>
          <span>Synthetic signal pace</span>
          <select
            aria-label="Synthetic signal pace"
            value={pace}
            disabled={running}
            onChange={(event) => {
              setPace(Number(event.target.value));
            }}
          >
            {PLAYBACK_TEST_PACES.map((value) => (
              <option key={value} value={value}>
                {value}× real time
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={running}
          onClick={() => {
            onPlaybackTest(pace);
          }}
        >
          Test playback path
        </button>
      </div>
    </details>
  );
}

export function VoiceConsole({
  gatewayUrl,
  showDiagnostics = false,
}: {
  gatewayUrl: string;
  /** Shows the audio pipeline diagnostics (development builds only). */
  showDiagnostics?: boolean;
}) {
  const [client] = useState(() => new VoiceClient({ url: gatewayUrl }));
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const running = state.connection === "connecting" || state.connection === "active";

  // Leaving the page ends the session and releases the microphone.
  useEffect(
    () => () => {
      client.stop();
    },
    [client],
  );

  return (
    <section className={styles.console} aria-label="Voice conversation">
      <div className={styles.controls}>
        <label className={styles.field}>
          <span>Language</span>
          <select
            value={state.language}
            disabled={running}
            onChange={(event) => {
              client.setLanguage(event.target.value as AgentLanguage);
            }}
          >
            {VOICE_LANGUAGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={styles.start}
          disabled={running}
          onClick={() => {
            void client.start();
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm7 9a7 7 0 0 1-14 0m7 7v2"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          Start voice
        </button>
        <button
          type="button"
          disabled={!running}
          onClick={() => {
            client.stop();
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />
          </svg>
          Stop
        </button>
      </div>

      <dl className={styles.status}>
        <div>
          <dt>Connection</dt>
          <dd data-testid="connection-state" data-state={state.connection}>
            {CONNECTION_LABELS[state.connection]}
          </dd>
        </div>
        <div>
          <dt>Microphone</dt>
          <dd data-testid="microphone-state" data-state={state.microphone}>
            {MICROPHONE_LABELS[state.microphone]}
          </dd>
        </div>
      </dl>

      {state.activeTool !== null && (
        <p role="status" className={styles.tool}>
          {TOOL_LABELS[state.activeTool] ?? "Working…"}
        </p>
      )}

      {state.notice !== null && (
        <p role="status" className={styles.notice} data-testid="notice">
          {state.notice}
        </p>
      )}

      {state.error !== null && (
        <p role="alert" className={styles.error}>
          {state.error.message}
        </p>
      )}

      <div className={styles.latest}>
        <p>
          <strong>You said:</strong>{" "}
          <span data-testid="latest-user">{latest(state.transcript, "user")}</span>
        </p>
        <p>
          <strong>FinVoice said:</strong>{" "}
          <span data-testid="latest-finvoice">{latest(state.transcript, "finvoice")}</span>
        </p>
      </div>

      {showDiagnostics && (
        <DiagnosticsPanel
          diagnostics={state.diagnostics}
          language={state.language}
          running={running}
          onPlaybackTest={(pace) => {
            client.startPlaybackTest({ pace });
          }}
        />
      )}

      <h2 className={styles.transcriptTitle}>Transcript</h2>
      {state.transcript.length === 0 ? (
        <p className={styles.empty}>Press Start voice and speak. The conversation appears here.</p>
      ) : (
        <ol className={styles.transcript} aria-label="Transcript">
          {state.transcript.map((entry) => (
            <li key={entry.id} className={entry.speaker === "user" ? styles.user : styles.finvoice}>
              <span className={styles.speaker}>
                {entry.speaker === "user" ? "You" : "FinVoice"}
              </span>
              {entry.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
