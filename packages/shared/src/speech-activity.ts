/**
 * A small energy (RMS) based speech-activity detector for 16 kHz 16-bit mono PCM frames.
 *
 * It is NOT a voice activity detector for the conversation: Gemini's own server-side VAD decides
 * turns and interruptions. FinVoice uses this detector only as a local aid:
 *
 * - in the browser, to stop FinVoice's playback the moment the user starts talking over it;
 * - in the voice gateway, to notice that the user has spoken (and stopped), so a turn that gets
 *   no response at all can be reported instead of waiting forever.
 *
 * Rules: a frame is "loud" when its RMS level reaches `thresholdDbfs`. Speech starts when a
 * candidate stretch of audio has at least `minSpeechMs` of loud frames AND loud frames make up at
 * least 60% of it. Quiet gaps of up to 200 ms (pauses between syllables) keep the candidate; longer
 * gaps reset it. So continuous speech triggers quickly, while clicks, key taps and typing (short
 * loud frames far apart) never do. Speech ends after `hangoverMs` of quiet, which also keeps
 * pauses between words inside one utterance. Two starts are at least `cooldownMs` apart.
 * Deterministic and allocation-free per frame.
 */

export type SpeechActivityOptions = {
  /** RMS level (dBFS) at or above which a frame counts as loud. */
  thresholdDbfs: number;
  /** Loud audio needed before speech is reported as started. */
  minSpeechMs: number;
  /** Quiet audio needed before speech is reported as ended. */
  hangoverMs: number;
  /** Minimum time between two reported speech starts. */
  cooldownMs: number;
};

export type SpeechActivityEvent = "speech_start" | "speech_end";

/** Share of loud frames needed in a candidate stretch before speech starts. */
const MIN_LOUD_RATIO = 0.6;
/** A quiet gap longer than this inside a candidate stretch resets it. */
const MAX_ONSET_GAP_MS = 200;

/** Sample rate of the frames this detector reads (FinVoice microphone audio). */
export const SPEECH_ACTIVITY_SAMPLE_RATE = 16_000;

/**
 * Speech (after browser noise suppression and gain control) measured at about -16 to -30 dBFS
 * per second in FinVoice's browser tests, and processed silence at about -97 dBFS. -38 dBFS sits
 * well between speech and a quiet room's residual noise.
 */
const DEFAULT_THRESHOLD_DBFS = -38;

/**
 * For stopping playback in the browser: react fast (160 ms = four 40 ms frames of speech), which
 * still rejects clicks and key taps (one or two frames).
 */
export const LOCAL_BARGE_IN_OPTIONS: SpeechActivityOptions = {
  thresholdDbfs: DEFAULT_THRESHOLD_DBFS,
  minSpeechMs: 160,
  hangoverMs: 400,
  cooldownMs: 700,
};

/**
 * For noticing a user turn in the gateway: need clearly sustained speech (300 ms) and 800 ms of
 * quiet to call it finished, similar to how long people pause at the end of a question.
 */
export const USER_TURN_OPTIONS: SpeechActivityOptions = {
  thresholdDbfs: DEFAULT_THRESHOLD_DBFS,
  minSpeechMs: 300,
  hangoverMs: 800,
  cooldownMs: 0,
};

/** RMS level of little-endian 16-bit PCM, in dBFS (-120 for silence or empty input). */
export function pcm16LevelDbfs(bytes: Uint8Array): number {
  const samples = Math.floor(bytes.byteLength / 2);
  if (samples === 0) {
    return -120;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2);
  let energy = 0;
  for (let i = 0; i < samples; i++) {
    const value = view.getInt16(i * 2, true) / 32768;
    energy += value * value;
  }
  const mean = energy / samples;
  return mean > 0 ? Math.max(-120, 10 * Math.log10(mean)) : -120;
}

export class SpeechActivityDetector {
  private speaking = false;
  private loudMs = 0;
  private windowMs = 0;
  private dipMs = 0;
  private quietMs = 0;
  private lastStartAt = Number.NEGATIVE_INFINITY;
  private lastLevel = -120;

  constructor(private readonly options: SpeechActivityOptions) {}

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Level of the last processed frame, in dBFS. */
  get lastLevelDbfs(): number {
    return this.lastLevel;
  }

  /** Whether the last processed frame reached the loudness threshold. */
  get lastFrameLoud(): boolean {
    return this.lastLevel >= this.options.thresholdDbfs;
  }

  /** Processes one frame of 16 kHz 16-bit mono PCM received at time `now` (ms). */
  processPcm16(bytes: Uint8Array, now: number): SpeechActivityEvent | null {
    const frameMs = (Math.floor(bytes.byteLength / 2) / SPEECH_ACTIVITY_SAMPLE_RATE) * 1000;
    return this.processLevel(pcm16LevelDbfs(bytes), frameMs, now);
  }

  /** Processes one frame given its level (dBFS) and duration (ms). */
  processLevel(levelDbfs: number, frameMs: number, now: number): SpeechActivityEvent | null {
    this.lastLevel = levelDbfs;
    const loud = levelDbfs >= this.options.thresholdDbfs;
    if (!this.speaking) {
      if (loud) {
        this.loudMs += frameMs;
        this.windowMs += frameMs;
        this.dipMs = 0;
        if (
          this.loudMs >= this.options.minSpeechMs &&
          this.loudMs >= MIN_LOUD_RATIO * this.windowMs &&
          now - this.lastStartAt >= this.options.cooldownMs
        ) {
          this.speaking = true;
          this.quietMs = 0;
          this.lastStartAt = now;
          return "speech_start";
        }
      } else if (this.windowMs > 0) {
        this.dipMs += frameMs;
        this.windowMs += frameMs;
        if (this.dipMs > MAX_ONSET_GAP_MS) {
          this.resetCandidate();
        }
      }
      return null;
    }
    if (loud) {
      this.quietMs = 0;
      return null;
    }
    this.quietMs += frameMs;
    if (this.quietMs >= this.options.hangoverMs) {
      this.speaking = false;
      this.resetCandidate();
      return "speech_end";
    }
    return null;
  }

  private resetCandidate(): void {
    this.loudMs = 0;
    this.windowMs = 0;
    this.dipMs = 0;
  }
}
