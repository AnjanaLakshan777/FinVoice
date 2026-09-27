// FinVoice microphone capture (AudioWorklet). Runs on the audio rendering thread.
//
// Converts the microphone input to what the voice gateway expects:
//   mono (channels are averaged), 16 kHz, 16-bit signed little-endian PCM,
// and posts one 40 ms frame (640 samples = 1,280 bytes) at a time, so nothing is buffered beyond
// a single frame. Audio never leaves this processor except as those frames.
//
// `sampleRate` is the AudioContext's actual rate (often 48,000 or 44,100 Hz, but any rate works).
// Sample-rate conversion uses a windowed-sinc resampler (see StreamingResampler below).

const TARGET_SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 640;

/** Zero crossings of the sinc on each side of the kernel centre: sharpness vs. latency. */
const ZERO_CROSSINGS = 16;
/** Low-pass cutoff as a fraction of the lower Nyquist frequency (0.9 × 8 kHz = 7.2 kHz). */
const CUTOFF_FRACTION = 0.9;
/** Kernel table entries per input sample; values in between are linearly interpolated. */
const TABLE_RESOLUTION = 128;

/**
 * Streaming band-limited resampler for any input and output rate.
 *
 * Each output sample n sits at the exact input position n × (inputRate / outputRate). Its value is
 * the weighted sum of the input samples around that position, with weights from a sinc low-pass
 * filter (cutoff 0.9 × the lower Nyquist frequency) shaped by a Blackman window over 16 zero
 * crossings on each side. The low-pass removes content above the new Nyquist frequency before it
 * can fold back as aliasing (sample dropping or plain averaging would not); the window keeps the
 * kernel short. Weights are normalized per output sample, so a constant signal stays exactly
 * constant. The kernel is tabulated once, positions are computed from integer indexes (no drift),
 * and the added latency is the kernel half-width: about 1.1 ms at 48 kHz.
 *
 * Deterministic: the same input always gives the same output.
 */
class StreamingResampler {
  constructor(inputRate, outputRate) {
    if (!(inputRate > 0) || !(outputRate > 0)) {
      throw new RangeError("Sample rates must be positive");
    }
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    /** Input samples per output sample. */
    this.step = inputRate / outputRate;
    /** Cutoff in cycles per input sample. */
    const cutoff = 0.5 * Math.min(1, outputRate / inputRate) * CUTOFF_FRACTION;
    /** Kernel half-width in input samples. */
    this.halfWidth = ZERO_CROSSINGS / (2 * cutoff);
    const size = Math.ceil(this.halfWidth * TABLE_RESOLUTION) + 2;
    this.table = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      const t = i / TABLE_RESOLUTION;
      if (t <= this.halfWidth) {
        const x = 2 * cutoff * t;
        const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
        const w = t / this.halfWidth; // 0 at the centre, 1 at the edge
        const blackman = 0.42 + 0.5 * Math.cos(Math.PI * w) + 0.08 * Math.cos(2 * Math.PI * w);
        this.table[i] = sinc * blackman;
      }
    }
    this.buffer = new Float32Array(4096);
    this.length = 0;
    /** Absolute input index of buffer[0]. */
    this.bufferStart = 0;
    /** Index of the next output sample. */
    this.outputIndex = 0;
  }

  /** Adds input samples and calls `emit` for every output sample that can now be computed. */
  push(input, emit) {
    this.append(input);
    const end = this.bufferStart + this.length;
    for (;;) {
      const centre = this.outputIndex * this.step;
      const last = Math.floor(centre + this.halfWidth);
      if (last >= end) {
        break;
      }
      const first = Math.ceil(centre - this.halfWidth);
      let sum = 0;
      let weights = 0;
      for (let k = first; k <= last; k++) {
        const weight = this.weight(Math.abs(k - centre));
        const index = k - this.bufferStart;
        // Positions before the start of the stream are silence.
        sum += (index >= 0 ? this.buffer[index] : 0) * weight;
        weights += weight;
      }
      emit(weights > 0 ? sum / weights : 0);
      this.outputIndex++;
    }
    this.discardOld();
  }

  weight(distance) {
    const position = distance * TABLE_RESOLUTION;
    const i = Math.floor(position);
    const fraction = position - i;
    return this.table[i] + (this.table[i + 1] - this.table[i]) * fraction;
  }

  append(input) {
    if (this.length + input.length > this.buffer.length) {
      const grown = new Float32Array(Math.max(this.buffer.length * 2, this.length + input.length));
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
    }
    this.buffer.set(input, this.length);
    this.length += input.length;
  }

  /** Drops input samples that no future output sample needs. */
  discardOld() {
    const keepFrom = Math.ceil(this.outputIndex * this.step - this.halfWidth);
    const drop = Math.min(this.length, keepFrom - this.bufferStart);
    if (drop > 0) {
      this.buffer.copyWithin(0, drop, this.length);
      this.length -= drop;
      this.bufferStart += drop;
    }
  }
}

/** Float sample → 16-bit signed integer, clamped to the valid range. */
function floatToPcm16(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const clamped = Math.max(-1, Math.min(1, value));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

class PcmCaptureProcessor extends AudioWorkletProcessor {
  resampler = new StreamingResampler(sampleRate, TARGET_SAMPLE_RATE);
  mono = new Float32Array(128);
  frame = new DataView(new ArrayBuffer(FRAME_SAMPLES * 2));
  frameSamples = 0;

  emit = (sample) => {
    this.frame.setInt16(this.frameSamples * 2, floatToPcm16(sample), true);
    this.frameSamples++;
    if (this.frameSamples === FRAME_SAMPLES) {
      const buffer = this.frame.buffer;
      this.port.postMessage(buffer, [buffer]);
      this.frame = new DataView(new ArrayBuffer(FRAME_SAMPLES * 2));
      this.frameSamples = 0;
    }
  };

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) {
      return true;
    }
    const length = channels[0].length;
    if (this.mono.length < length) {
      this.mono = new Float32Array(length);
    }
    const mono = this.mono.subarray(0, length);
    mono.fill(0);
    for (const channel of channels) {
      for (let i = 0; i < length; i++) {
        mono[i] += channel[i] / channels.length;
      }
    }
    this.resampler.push(mono, this.emit);
    return true;
  }
}

registerProcessor("finvoice-pcm-capture", PcmCaptureProcessor);
