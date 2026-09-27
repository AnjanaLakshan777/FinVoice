import { VOICE_OUTPUT_SAMPLE_RATE } from "./protocol";
import { base64ToBytes, pcm16ToFloat32 } from "./pcm";

/** Delay before an answer starts playing: absorbs uneven arrival of the first chunks. */
export const INITIAL_LEAD_SECONDS = 0.15;
/** Added to the lead each time playback runs dry in the middle of an answer. */
export const LEAD_STEP_SECONDS = 0.1;
export const MAX_LEAD_SECONDS = 0.6;

/** Playback queue measurements (stages C and D), in milliseconds. Numbers only. */
export type PlaybackStats = {
  /** Speech scheduled but not yet played, now. */
  queueMs: number;
  /** Queue left when each chunk arrived in the middle of an answer (buffer health). */
  minQueueMs: number | null;
  maxQueueMs: number | null;
  avgQueueMs: number | null;
  /** Times playback ran dry in the middle of an answer (speech arrived later than it played). */
  underruns: number;
  /** Longest silence caused by an underrun, including the re-buffering lead. */
  longestUnderrunMs: number;
  /** Total speech scheduled for playback, and the part that has finished playing. */
  queuedMs: number;
  playedMs: number;
  /** Current start lead of the adaptive jitter buffer. */
  leadMs: number;
};

/**
 * Streams FinVoice's speech (24 kHz 16-bit PCM chunks) through Web Audio.
 *
 * Each chunk becomes an AudioBuffer created at 24 kHz and is scheduled right after the previous
 * one, so playback is continuous. The AudioContext keeps its own (hardware) sample rate; Web
 * Audio resamples each buffer on playback, so pitch and speed are unchanged and nothing assumes
 * a 24 kHz context. Speech is never time-stretched or sped up.
 *
 * Small adaptive jitter buffer: when the queue is empty, the next chunk starts `lead` seconds
 * ahead instead of immediately. If the queue runs dry in the middle of an answer (speech arrived
 * later than it plays, which is audible as a gap), the lead grows for the rest of the session,
 * up to MAX_LEAD_SECONDS. Values are never altered, only their start times.
 *
 * `clear()` stops everything immediately (barge-in) and forgets the queue.
 */
export class PcmPlayer {
  private readonly sources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  private inAnswer = false;
  private leadSeconds = INITIAL_LEAD_SECONDS;
  private underrunCount = 0;
  private longestUnderrun = 0;
  private queuedSeconds = 0;
  private playedSeconds = 0;
  private queueSamples = { count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: 0 };

  constructor(private readonly context: AudioContext) {}

  get isPlaying(): boolean {
    return this.sources.size > 0;
  }

  /** Times playback ran dry in the middle of an answer (diagnostics). */
  get gaps(): number {
    return this.underrunCount;
  }

  get lead(): number {
    return this.leadSeconds;
  }

  stats(): PlaybackStats {
    const { count, sum, min, max } = this.queueSamples;
    return {
      queueMs: ms(Math.max(0, this.nextStartTime - this.context.currentTime)),
      minQueueMs: count === 0 ? null : ms(min),
      maxQueueMs: count === 0 ? null : ms(max),
      avgQueueMs: count === 0 ? null : ms(sum / count),
      underruns: this.underrunCount,
      longestUnderrunMs: ms(this.longestUnderrun),
      queuedMs: ms(this.queuedSeconds),
      playedMs: ms(this.playedSeconds),
      leadMs: ms(this.leadSeconds),
    };
  }

  enqueue(base64: string): void {
    const samples = pcm16ToFloat32(base64ToBytes(base64));
    if (samples.length === 0) {
      return;
    }
    const buffer = this.context.createBuffer(1, samples.length, VOICE_OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const now = this.context.currentTime;
    let startAt = this.nextStartTime;
    if (this.inAnswer) {
      this.sampleQueue(Math.max(0, this.nextStartTime - now));
    }
    if (startAt <= now) {
      if (this.inAnswer) {
        this.underrunCount++;
        this.leadSeconds = Math.min(MAX_LEAD_SECONDS, this.leadSeconds + LEAD_STEP_SECONDS);
        // Silence from the end of the previous chunk until this one starts.
        this.longestUnderrun = Math.max(
          this.longestUnderrun,
          now + this.leadSeconds - this.nextStartTime,
        );
      }
      startAt = now + this.leadSeconds;
    }
    this.inAnswer = true;
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.queuedSeconds += buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.playedSeconds += buffer.duration;
      this.sources.delete(source);
      source.disconnect();
    };
  }

  /** FinVoice finished its answer: the next chunk starts a new answer (not a gap). */
  endAnswer(): void {
    this.inAnswer = false;
  }

  /** Stops playback now and drops every queued chunk. */
  clear(): void {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }
    this.sources.clear();
    this.nextStartTime = 0;
    this.inAnswer = false;
  }

  private sampleQueue(seconds: number): void {
    const samples = this.queueSamples;
    samples.count++;
    samples.sum += seconds;
    samples.min = Math.min(samples.min, seconds);
    samples.max = Math.max(samples.max, seconds);
  }
}

function ms(seconds: number): number {
  return Math.round(seconds * 1000);
}
