import type { VoiceServerMessage } from "@finvoice/contracts";
import { VOICE_OUTPUT_MIME_TYPE } from "@finvoice/contracts";

import type { Logger } from "../logger.js";

/**
 * Development-only transport test (stage B: gateway → browser, and stage C/D: browser queue and
 * playback). Streams a deterministic, synthetic, speech-like 24 kHz signal to the browser in the
 * normal `audio` message format at a chosen pace, without Gemini, a microphone or any user
 * audio. Comparing the browser's measurements with the pace sent here shows whether transport or
 * playback add delay or gaps.
 */

const SAMPLE_RATE = 24_000;

export type TestSignalParams = {
  /** Length of the signal, 1–30 s. */
  seconds: number;
  /** Duration of each chunk, 20–1,000 ms (Gemini's chunks are typically 40–400 ms). */
  chunkMs: number;
  /** Delivery speed relative to real time, 0.25–4 (1 = exactly real time). */
  pace: number;
};

export const DEFAULT_TEST_SIGNAL: TestSignalParams = { seconds: 10, chunkMs: 200, pace: 1 };

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Reads bounded parameters from the WebSocket URL's query string. */
export function parseTestSignalParams(search: URLSearchParams): TestSignalParams {
  const read = (name: keyof TestSignalParams) => Number(search.get(name) ?? Number.NaN);
  return {
    seconds: clamp(read("seconds"), 1, 30, DEFAULT_TEST_SIGNAL.seconds),
    chunkMs: Math.round(clamp(read("chunkMs"), 20, 1000, DEFAULT_TEST_SIGNAL.chunkMs)),
    pace: clamp(read("pace"), 0.25, 4, DEFAULT_TEST_SIGNAL.pace),
  };
}

/**
 * Speech-like samples: a 140 Hz harmonic tone (8 harmonics falling off as 1/k) shaped into four
 * "syllables" per second, with every third syllable silent. Deterministic: sample n always has
 * the same value.
 */
export function speechLikeSample(n: number): number {
  const t = n / SAMPLE_RATE;
  const syllable = Math.floor(t * 4);
  if (syllable % 3 === 2) {
    return 0;
  }
  const envelope = Math.sin(Math.PI * ((t * 4) % 1)) ** 2;
  let value = 0;
  for (let k = 1; k <= 8; k++) {
    value += Math.sin(2 * Math.PI * 140 * k * t) / k;
  }
  return 0.25 * envelope * (value / 2.72);
}

/** 16-bit little-endian PCM of samples [start, start + count). */
export function speechLikePcm(start: number, count: number): Buffer {
  const pcm = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) {
    const value = Math.max(-1, Math.min(1, speechLikeSample(start + i)));
    pcm.writeInt16LE(Math.round(value * 0x7fff), i * 2);
  }
  return pcm;
}

export type TestSignalSink = {
  send(message: VoiceServerMessage): void;
  isOpen(): boolean;
  close(): void;
};

/**
 * Sends the signal: chunk k leaves at k × chunkMs / pace after the start (drift-free), then
 * `turn_complete`; after the last chunk has had time to play, `session_closed` and a close.
 */
export async function streamTestSignal(
  sink: TestSignalSink,
  params: TestSignalParams,
  logger: Logger,
): Promise<void> {
  const chunkSamples = Math.round((SAMPLE_RATE * params.chunkMs) / 1000);
  const totalSamples = Math.round(SAMPLE_RATE * params.seconds);
  const started = performance.now();
  let sent = 0;
  let chunks = 0;
  while (sent < totalSamples && sink.isOpen()) {
    const due = started + (chunks * params.chunkMs) / params.pace;
    const wait = due - performance.now();
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    const count = Math.min(chunkSamples, totalSamples - sent);
    sink.send({
      type: "audio",
      data: speechLikePcm(sent, count).toString("base64"),
      mimeType: VOICE_OUTPUT_MIME_TYPE,
    });
    sent += count;
    chunks++;
  }
  const sendMs = performance.now() - started;
  if (!sink.isOpen()) {
    return;
  }
  sink.send({ type: "turn_complete" });
  logger.info("test_signal_sent", {
    count: chunks,
    durationMs: Math.round(sendMs),
    audioBytesOut: sent * 2,
  });
  // Let the browser play the tail before closing.
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, params.seconds * 1000 - sendMs) + 1500),
  );
  if (sink.isOpen()) {
    sink.send({ type: "session_closed" });
    sink.close();
  }
}
