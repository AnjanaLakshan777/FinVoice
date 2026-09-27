/**
 * Per-turn timing and size metrics of the model's speech, measured where it arrives in the gateway
 * (stage A: Gemini → gateway). Numbers only: no audio and no text is kept.
 */

/** Bytes per millisecond of 24 kHz mono 16-bit PCM (24,000 samples/s × 2 bytes / 1,000). */
const OUTPUT_BYTES_PER_MS = (24_000 * 2) / 1000;

/** Duration of 24 kHz mono 16-bit PCM: bytes / (24,000 × 2) × 1,000 ms. */
export function pcm24kDurationMs(bytes: number): number {
  return bytes / OUTPUT_BYTES_PER_MS;
}

/**
 * Speech duration received divided by the wall-clock time it took to arrive (first to last
 * chunk). Above 1: faster than real time. Below 1: playback will run dry unless buffered. Null
 * when it cannot be measured (fewer than two chunks).
 */
export function deliveryFactor(audioMs: number, wallMs: number): number | null {
  return wallMs > 0 ? audioMs / wallMs : null;
}

export type TurnOutcome = "complete" | "interrupted" | "stalled" | "closed";

export type TurnMetricsSummary = {
  turn: number;
  outcome: TurnOutcome;
  /** When the model's first activity of this turn arrived, ms after the session opened. */
  turnStartMs: number;
  /** First speech chunk, ms after turn start (null: no speech). */
  firstAudioMs: number | null;
  /** End of the turn (turnComplete, interruption, stall or close), ms after turn start. */
  turnCompleteMs: number;
  /** User finished speaking (or was last heard) → the model's first progress; null if unknown. */
  responseStartWaitMs: number | null;
  /** Gemini's generationComplete for the answer, ms after turn start (null: not received). */
  generationCompleteMs: number | null;
  receivedAudioChunks: number;
  receivedAudioBytes: number;
  receivedAudioDurationMs: number;
  /** First to last speech chunk, wall clock. */
  receiveWallClockDurationMs: number;
  deliveryFactor: number | null;
  /** Longest wait between two model events (speech or transcription) in this turn. */
  maxProgressGapMs: number;
  /** Time spent waiting for FinVoice tools (not the model). */
  toolMs: number;
};

type OpenTurn = {
  startedAt: number;
  firstAudioAt: number | null;
  lastAudioAt: number;
  lastProgressAt: number;
  chunks: number;
  bytes: number;
  maxGap: number;
  toolMs: number;
  toolStartedAt: number | null;
  responseStartWaitMs: number | null;
  generationCompleteAt: number | null;
};

/**
 * Tracks the current model turn. A turn starts with the model's first activity (speech,
 * transcription or a tool call) and ends with `end()`. Waiting for tools does not count as a
 * progress gap.
 */
export class TurnMetrics {
  private current: OpenTurn | null = null;
  private turns = 0;
  private totalAudioMs = 0;
  private totalWallMs = 0;

  constructor(private readonly sessionStartedAt: number) {}

  get active(): boolean {
    return this.current !== null;
  }

  audio(bytes: number, now: number): void {
    const turn = this.progress(now);
    turn.chunks++;
    turn.bytes += bytes;
    turn.firstAudioAt ??= now;
    turn.lastAudioAt = now;
  }

  transcript(now: number): void {
    this.progress(now);
  }

  toolStarted(now: number): void {
    const turn = this.progress(now);
    turn.toolStartedAt ??= now;
  }

  /** Records how long the model took to start responding (first call per turn wins). */
  responseStart(waitMs: number): void {
    if (this.current !== null) {
      this.current.responseStartWaitMs ??= waitMs;
    }
  }

  /** Gemini reported generationComplete; the last one of the turn (the answer's) is kept. */
  generationComplete(now: number): void {
    const turn = this.progress(now);
    turn.generationCompleteAt = now;
  }

  toolFinished(now: number): void {
    const turn = this.current;
    if (turn && turn.toolStartedAt !== null) {
      turn.toolMs += now - turn.toolStartedAt;
      turn.toolStartedAt = null;
      // Waiting for tools is not a model pause.
      turn.lastProgressAt = now;
    }
  }

  end(outcome: TurnOutcome, now: number): TurnMetricsSummary | null {
    const turn = this.current;
    if (turn === null) {
      return null;
    }
    this.current = null;
    this.turns++;
    const audioMs = pcm24kDurationMs(turn.bytes);
    const wallMs = turn.firstAudioAt === null ? 0 : turn.lastAudioAt - turn.firstAudioAt;
    this.totalAudioMs += audioMs;
    this.totalWallMs += wallMs;
    return {
      turn: this.turns,
      outcome,
      turnStartMs: round(turn.startedAt - this.sessionStartedAt),
      firstAudioMs: turn.firstAudioAt === null ? null : round(turn.firstAudioAt - turn.startedAt),
      turnCompleteMs: round(now - turn.startedAt),
      responseStartWaitMs:
        turn.responseStartWaitMs === null ? null : round(turn.responseStartWaitMs),
      generationCompleteMs:
        turn.generationCompleteAt === null
          ? null
          : round(turn.generationCompleteAt - turn.startedAt),
      receivedAudioChunks: turn.chunks,
      receivedAudioBytes: turn.bytes,
      receivedAudioDurationMs: round(audioMs),
      receiveWallClockDurationMs: round(wallMs),
      deliveryFactor: roundFactor(deliveryFactor(audioMs, wallMs)),
      maxProgressGapMs: round(turn.maxGap),
      toolMs: round(turn.toolMs),
    };
  }

  /** Totals over all ended turns: received speech and the wall-clock time it arrived over. */
  totals(): { speechMs: number; speechArrivalMs: number } {
    return { speechMs: round(this.totalAudioMs), speechArrivalMs: round(this.totalWallMs) };
  }

  private progress(now: number): OpenTurn {
    let turn = this.current;
    if (turn === null) {
      turn = {
        startedAt: now,
        firstAudioAt: null,
        lastAudioAt: now,
        lastProgressAt: now,
        chunks: 0,
        bytes: 0,
        maxGap: 0,
        toolMs: 0,
        toolStartedAt: null,
        responseStartWaitMs: null,
        generationCompleteAt: null,
      };
      this.current = turn;
    } else if (turn.toolStartedAt === null) {
      turn.maxGap = Math.max(turn.maxGap, now - turn.lastProgressAt);
    }
    turn.lastProgressAt = now;
    return turn;
  }
}

function round(value: number): number {
  return Math.round(value);
}

function roundFactor(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}
