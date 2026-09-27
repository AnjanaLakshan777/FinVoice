import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  VOICE_OUTPUT_SAMPLE_RATE as CONTRACT_OUTPUT_SAMPLE_RATE,
  VOICE_ERROR_CODES,
} from "@finvoice/contracts";
import { describe, expect, it } from "vitest";

import { base64ToBytes, bytesToBase64, pcm16ToFloat32 } from "../lib/voice/pcm";
import { parseServerMessage, VOICE_OUTPUT_SAMPLE_RATE } from "../lib/voice/protocol";

type Processor = { process(inputs: Float32Array[][]): boolean };

type Resampler = {
  readonly halfWidth: number;
  push(input: Float32Array, emit: (sample: number) => void): void;
};

type WorkletModule = {
  StreamingResampler: new (inputRate: number, outputRate: number) => Resampler;
  floatToPcm16: (value: number) => number;
};

const WORKLET_SOURCE = readFileSync(
  join(import.meta.dirname, "..", "public", "voice", "pcm-capture-worklet.js"),
  "utf8",
);

/**
 * Evaluates public/voice/pcm-capture-worklet.js (the exact file the browser loads) in a minimal
 * AudioWorkletGlobalScope. Returns a processor instance, the frames it posts, and the module's
 * resampler and conversion function.
 */
function loadWorklet(contextSampleRate: number) {
  const frames: ArrayBuffer[] = [];
  let registered: (new () => Processor) | undefined;
  class AudioWorkletProcessor {
    readonly port = {
      postMessage: (buffer: ArrayBuffer) => {
        frames.push(buffer);
      },
    };
  }
  const registerProcessor = (_name: string, processor: new () => Processor) => {
    registered = processor;
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- evaluates our own static file
  const evaluate = new Function(
    "AudioWorkletProcessor",
    "registerProcessor",
    "sampleRate",
    `${WORKLET_SOURCE}\nreturn { StreamingResampler, floatToPcm16 };`,
  ) as (processorBase: unknown, register: typeof registerProcessor, rate: number) => WorkletModule;
  const exported = evaluate(AudioWorkletProcessor, registerProcessor, contextSampleRate);
  if (!registered) {
    throw new Error("The worklet did not register a processor");
  }
  return { processor: new registered(), frames, ...exported };
}

/** Resamples `signal` to 16 kHz, pushing it in render-quantum-sized chunks. */
function resample(inputRate: number, signal: Float32Array, chunk = 128): number[] {
  const { StreamingResampler } = loadWorklet(inputRate);
  const resampler = new StreamingResampler(inputRate, 16_000);
  const output: number[] = [];
  for (let i = 0; i < signal.length; i += chunk) {
    resampler.push(signal.subarray(i, i + chunk), (sample) => output.push(sample));
  }
  return output;
}

function sine(rate: number, frequency: number, seconds: number, amplitude = 0.5): Float32Array {
  return Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / rate),
  );
}

function rms(values: number[]): number {
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
}

/** Output samples after the start-up ramp (the stream starts from silence). */
function steady(values: number[]): number[] {
  return values.slice(32, -32);
}

function samples(frame: ArrayBuffer | undefined): number[] {
  if (!frame) {
    throw new Error("Missing frame");
  }
  const view = new DataView(frame);
  return Array.from({ length: frame.byteLength / 2 }, (_, i) => view.getInt16(i * 2, true));
}

describe("resampler", () => {
  it.each([48_000, 44_100, 32_000, 22_050, 16_000])(
    "produces 16,000 samples per second from %i Hz",
    (rate) => {
      const output = resample(rate, new Float32Array(rate * 2));
      // Output lags input by the kernel half-width only (a few samples).
      expect(output.length).toBeLessThanOrEqual(32_000);
      expect(output.length).toBeGreaterThan(32_000 - 40);
    },
  );

  it.each([48_000, 44_100])("keeps silence silent at %i Hz", (rate) => {
    expect(new Set(resample(rate, new Float32Array(rate)))).toEqual(new Set([0]));
  });

  it.each([48_000, 44_100])("keeps a constant signal exactly constant at %i Hz", (rate) => {
    const output = steady(resample(rate, new Float32Array(rate).fill(0.25)));
    for (const value of output) {
      expect(value).toBeCloseTo(0.25, 6);
    }
  });

  it.each([48_000, 44_100])("reproduces a 440 Hz and a 1 kHz sine at %i Hz", (rate) => {
    for (const frequency of [440, 1000]) {
      const output = resample(rate, sine(rate, frequency, 0.5));
      // Output sample n is the signal at time n / 16,000 s: compare with the ideal sine.
      const errors = steady(output).map((value, i) => {
        const n = i + 32;
        return Math.abs(value - 0.5 * Math.sin((2 * Math.PI * frequency * n) / 16_000));
      });
      expect(Math.max(...errors)).toBeLessThan(0.002);
    }
  });

  it.each([
    [48_000, 12_000],
    [44_100, 12_000],
    [48_000, 9_000],
  ])(
    "removes content above 8 kHz instead of aliasing it (%i Hz input, %i Hz tone)",
    (rate, tone) => {
      // Sample dropping would turn a 12 kHz tone into a full-strength 4 kHz tone.
      expect(rms(steady(resample(rate, sine(rate, tone, 0.5))))).toBeLessThan(0.001);
    },
  );

  it("keeps speech frequencies at full level", () => {
    const output = steady(resample(48_000, sine(48_000, 3000, 0.5)));
    expect(rms(output)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("gives the same output for any chunk size, including very short buffers", () => {
    const signal = sine(44_100, 700, 0.25);
    const reference = resample(44_100, signal, 128);
    for (const chunk of [1, 3, 64, 441, 5000]) {
      const output = resample(44_100, signal, chunk);
      expect(output.length).toBe(reference.length);
      output.forEach((value, i) => {
        expect(value).toBeCloseTo(reference[i] ?? Number.NaN, 6);
      });
    }
  });

  it("is deterministic", () => {
    const signal = sine(48_000, 1234, 0.3, 0.8);
    expect(resample(48_000, signal)).toEqual(resample(48_000, signal));
  });

  it("never produces NaN or infinity, and does not clip a near-full-scale signal", () => {
    const { floatToPcm16 } = loadWorklet(48_000);
    const output = resample(48_000, sine(48_000, 1000, 0.5, 0.99));
    expect(output.every(Number.isFinite)).toBe(true);
    expect(Math.max(...output.map(Math.abs))).toBeLessThanOrEqual(0.995);
    const pcm = output.map(floatToPcm16);
    expect(Math.max(...pcm)).toBeLessThan(32767);
    expect(Math.min(...pcm)).toBeGreaterThan(-32768);
  });

  it("rejects invalid sample rates", () => {
    const { StreamingResampler } = loadWorklet(48_000);
    expect(() => new StreamingResampler(0, 16_000)).toThrow(RangeError);
    expect(() => new StreamingResampler(Number.NaN, 16_000)).toThrow(RangeError);
  });
});

describe("16-bit conversion", () => {
  it("maps floats to the int16 range and clamps out-of-range values", () => {
    const { floatToPcm16 } = loadWorklet(48_000);
    expect([0, 0.5, -0.5, 1, -1, 2, -2].map(floatToPcm16)).toEqual([
      0, 16384, -16384, 32767, -32768, 32767, -32768,
    ]);
    expect([Number.NaN, Number.POSITIVE_INFINITY].map(floatToPcm16)).toEqual([0, 0]);
  });
});

describe("capture worklet", () => {
  /** Feeds `seconds` of a constant signal in 128-sample render quanta. */
  function feed(processor: Processor, rate: number, seconds: number, channels: number[]) {
    for (let i = 0; i < (rate * seconds) / 128; i++) {
      processor.process([channels.map((value) => new Float32Array(128).fill(value))]);
    }
  }

  it.each([48_000, 44_100])(
    "posts 40 ms frames of 16 kHz little-endian Int16 (640 samples) from %i Hz",
    (rate) => {
      const { processor, frames } = loadWorklet(rate);
      feed(processor, rate, 0.5, [0.5]);

      // 0.5 s = 12.5 frames of 40 ms, minus the resampler's short start-up delay.
      expect(frames).toHaveLength(12);
      expect(frames.every((frame) => frame.byteLength === 1280)).toBe(true);
      expect(new Set(samples(frames[5]))).toEqual(new Set([16384]));
    },
  );

  it("mixes channels down to mono", () => {
    const { processor, frames } = loadWorklet(48_000);
    feed(processor, 48_000, 0.1, [0.5, -0.5]);

    expect(new Set(samples(frames[1]))).toEqual(new Set([0]));
  });

  it("clamps out-of-range input", () => {
    const { processor, frames } = loadWorklet(44_100);
    feed(processor, 44_100, 0.1, [2]);

    expect(new Set(samples(frames[1]))).toEqual(new Set([32767]));
  });

  it("keeps running without input", () => {
    const { processor, frames } = loadWorklet(48_000);
    expect(processor.process([[]])).toBe(true);
    expect(frames).toHaveLength(0);
  });
});

describe("PCM helpers", () => {
  it("round-trips base64", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(bytesToBase64(new Uint8Array([1, 0, 255, 255]))).toBe("AQD//w==");
  });

  it("decodes 16-bit little-endian PCM to floats", () => {
    const pcm = new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x00, 0x00, 0x00, 0x40]);
    expect(Array.from(pcm16ToFloat32(pcm))).toEqual([-1, 32767 / 32768, 0, 0.5]);
  });
});

describe("protocol", () => {
  it("matches the shared contracts", () => {
    expect(VOICE_OUTPUT_SAMPLE_RATE).toBe(CONTRACT_OUTPUT_SAMPLE_RATE);
    expect(VOICE_ERROR_CODES).toContain("VOICE_PROVIDER_UNAVAILABLE");
  });

  it.each([
    ["{", null],
    [JSON.stringify({ type: "unknown" }), null],
    [JSON.stringify({ type: "audio" }), null],
    [JSON.stringify({ type: "error", code: "X" }), null],
    [JSON.stringify({ type: "pong" }), { type: "pong" }],
    [
      JSON.stringify({ type: "input_transcript", text: "hi" }),
      { type: "input_transcript", text: "hi" },
    ],
  ])("parses %s", (data, expected) => {
    expect(parseServerMessage(data)).toEqual(expected);
  });

  it("ignores binary data", () => {
    expect(parseServerMessage(new ArrayBuffer(2))).toBeNull();
  });
});
