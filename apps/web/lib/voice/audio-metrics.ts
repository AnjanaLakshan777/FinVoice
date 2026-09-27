import type { PlaybackStats } from "./pcm-player";

/**
 * Browser-side audio measurements for development diagnostics (stage B: gateway → browser
 * arrival). Numbers only: no audio or text is kept.
 */

/** Duration of 24 kHz mono 16-bit PCM: bytes / (24,000 × 2) × 1,000 ms. */
export function pcm24kDurationMs(bytes: number): number {
  return (bytes / (24_000 * 2)) * 1000;
}

export type TurnOutcome = "in progress" | "complete" | "interrupted" | "stalled" | "closed";

export type ReceiveTurnStats = {
  outcome: TurnOutcome;
  receivedAudioChunks: number;
  receivedAudioBytes: number;
  receivedAudioDurationMs: number;
  /** First to last speech chunk, as received by the browser. */
  receiveWallClockDurationMs: number;
  /** receivedAudioDurationMs / receiveWallClockDurationMs; null with fewer than two chunks. */
  deliveryFactor: number | null;
  /** Playback underruns during this turn. */
  underruns: number;
};

type OpenTurn = {
  firstAt: number;
  lastAt: number;
  chunks: number;
  bytes: number;
  underruns0: number;
};

/** Tracks the speech of the current answer as it reaches the browser. */
export class ReceiveTurnTracker {
  private current: OpenTurn | null = null;

  audio(bytes: number, now: number, underrunsSoFar: number): void {
    this.current ??= { firstAt: now, lastAt: now, chunks: 0, bytes: 0, underruns0: underrunsSoFar };
    this.current.chunks++;
    this.current.bytes += bytes;
    this.current.lastAt = now;
  }

  snapshot(underrunsSoFar: number): ReceiveTurnStats | null {
    return this.current === null ? null : summarize(this.current, "in progress", underrunsSoFar);
  }

  end(
    outcome: Exclude<TurnOutcome, "in progress">,
    underrunsSoFar: number,
  ): ReceiveTurnStats | null {
    const turn = this.current;
    this.current = null;
    return turn === null ? null : summarize(turn, outcome, underrunsSoFar);
  }
}

function summarize(turn: OpenTurn, outcome: TurnOutcome, underrunsSoFar: number): ReceiveTurnStats {
  const audioMs = pcm24kDurationMs(turn.bytes);
  const wallMs = turn.lastAt - turn.firstAt;
  return {
    outcome,
    receivedAudioChunks: turn.chunks,
    receivedAudioBytes: turn.bytes,
    receivedAudioDurationMs: Math.round(audioMs),
    receiveWallClockDurationMs: Math.round(wallMs),
    deliveryFactor: wallMs > 0 ? Math.round((audioMs / wallMs) * 100) / 100 : null,
    underruns: underrunsSoFar - turn.underruns0,
  };
}

/**
 * The one-line summary shown in development, e.g.
 * "Audio: received 4.8s / 6.2s wall time · delivery 0.77x · queue 180ms · underruns 3".
 */
export function formatAudioLine(
  turn: ReceiveTurnStats | null,
  playback: PlaybackStats | null,
): string {
  const seconds = (msValue: number) => `${(msValue / 1000).toFixed(1)}s`;
  const parts = [
    turn === null
      ? "received —"
      : `received ${seconds(turn.receivedAudioDurationMs)} / ${seconds(turn.receiveWallClockDurationMs)} wall time`,
    `delivery ${turn?.deliveryFactor == null ? "—" : `${turn.deliveryFactor.toFixed(2)}x`}`,
    `queue ${playback === null ? "—" : `${String(playback.queueMs)}ms`}`,
    `underruns ${String(turn?.underruns ?? playback?.underruns ?? 0)}`,
  ];
  return `Audio: ${parts.join(" · ")}`;
}
