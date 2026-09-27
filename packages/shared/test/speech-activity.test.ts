import { describe, expect, it } from "vitest";

import {
  LOCAL_BARGE_IN_OPTIONS,
  pcm16LevelDbfs,
  SpeechActivityDetector,
  USER_TURN_OPTIONS,
  type SpeechActivityEvent,
  type SpeechActivityOptions,
} from "../src/index.js";

const RATE = 16_000;
const FRAME_SAMPLES = 640; // 40 ms

/** Deterministic pseudo-random numbers in [-1, 1). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 1_073_741_824 - 1;
  };
}

type Signal = (n: number) => number;

const silence: Signal = () => 0;

/** White noise at roughly `dbfs` RMS. */
function noise(dbfs: number, seed = 7): Signal {
  const next = random(seed);
  const amplitude = 10 ** (dbfs / 20) * Math.sqrt(3);
  return () => amplitude * next();
}

/** A speech-like harmonic tone (140 Hz, 6 harmonics) at roughly `dbfs` RMS. */
function speechLike(dbfs: number): Signal {
  const amplitude = 10 ** (dbfs / 20) * Math.SQRT2 * 0.8;
  return (n) => {
    const t = n / RATE;
    let value = 0;
    for (let k = 1; k <= 6; k++) {
      value += Math.sin(2 * Math.PI * 140 * k * t) / k;
    }
    return (amplitude * value) / 1.5;
  };
}

type Segment = [ms: number, signal: Signal];

/** Runs segments through a detector in 40 ms frames; returns events with their times. */
function run(options: SpeechActivityOptions, segments: Segment[]) {
  const detector = new SpeechActivityDetector(options);
  const events: [number, SpeechActivityEvent][] = [];
  let n = 0;
  let now = 0;
  for (const [ms, signal] of segments) {
    const frames = Math.round(ms / 40);
    for (let f = 0; f < frames; f++) {
      const frame = new DataView(new ArrayBuffer(FRAME_SAMPLES * 2));
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        const value = Math.max(-1, Math.min(1, signal(n++)));
        frame.setInt16(i * 2, Math.round(value * 32767), true);
      }
      now += 40;
      const event = detector.processPcm16(new Uint8Array(frame.buffer), now);
      if (event !== null) {
        events.push([now, event]);
      }
    }
  }
  return events;
}

/** A click: one frame of a full-scale transient, as from a key tap or a mouse click. */
const click: Signal = (n) => (n % 640 < 40 ? 0.9 * Math.sin(n) : 0);

describe("pcm16LevelDbfs", () => {
  it("measures RMS level", () => {
    const frame = new DataView(new ArrayBuffer(1280));
    for (let i = 0; i < 640; i++) {
      frame.setInt16(i * 2, i % 2 === 0 ? 16384 : -16384, true); // ±0.5 → -6 dBFS
    }
    expect(pcm16LevelDbfs(new Uint8Array(frame.buffer))).toBeCloseTo(-6.02, 1);
    expect(pcm16LevelDbfs(new Uint8Array(1280))).toBe(-120);
    expect(pcm16LevelDbfs(new Uint8Array(0))).toBe(-120);
  });
});

describe.each([
  ["local barge-in", LOCAL_BARGE_IN_OPTIONS],
  ["user turn", USER_TURN_OPTIONS],
] as const)("SpeechActivityDetector (%s settings)", (_name, options) => {
  it("stays quiet on silence", () => {
    expect(run(options, [[5000, silence]])).toEqual([]);
  });

  it.each([-70, -55, -45])("ignores continuous low-level noise at %i dBFS", (dbfs) => {
    expect(run(options, [[5000, noise(dbfs)]])).toEqual([]);
  });

  it("ignores fast typing (short loud frames 160 ms apart)", () => {
    const typing: Segment[] = [];
    for (let i = 0; i < 30; i++) {
      typing.push([40, click], [120, silence]);
    }
    expect(run(options, typing)).toEqual([]);
  });

  it("ignores short clicks and key taps", () => {
    const taps: Segment[] = [];
    for (let i = 0; i < 10; i++) {
      taps.push([40, click], [360, silence]);
    }
    expect(run(options, taps)).toEqual([]);
  });

  it("ignores a short loud noise burst below the minimum speech duration", () => {
    const burstMs = options.minSpeechMs - 80;
    expect(
      run(options, [
        [400, silence],
        [burstMs, noise(-20)],
        [2000, silence],
      ]),
    ).toEqual([]);
  });

  it("reports sustained speech-like input once, shortly after it starts", () => {
    const events = run(options, [
      [400, silence],
      [2000, speechLike(-22)],
    ]);
    // Frames are 40 ms: the start is reported on the first frame boundary at or after minSpeechMs.
    expect(events).toEqual([[400 + Math.ceil(options.minSpeechMs / 40) * 40, "speech_start"]]);
  });

  it("reports the end of speech after the hangover", () => {
    const events = run(options, [
      [400, silence],
      [1200, speechLike(-22)],
      [2000, silence],
    ]);
    expect(events.map(([, event]) => event)).toEqual(["speech_start", "speech_end"]);
    expect(events[1]?.[0]).toBe(400 + 1200 + options.hangoverMs);
  });

  it("does not re-trigger during continuous speech with short pauses between syllables", () => {
    const syllables: Segment[] = [[200, silence]];
    for (let i = 0; i < 12; i++) {
      syllables.push([240, speechLike(-22)], [120, silence]);
    }
    const events = run(options, syllables);
    expect(events.filter(([, event]) => event === "speech_start")).toHaveLength(1);
  });

  it("reports a new utterance after a real pause", () => {
    const events = run(options, [
      [200, silence],
      [800, speechLike(-22)],
      [2000, silence],
      [800, speechLike(-22)],
      [2000, silence],
    ]);
    expect(events.map(([, event]) => event)).toEqual([
      "speech_start",
      "speech_end",
      "speech_start",
      "speech_end",
    ]);
  });

  it("is deterministic", () => {
    const segments: Segment[] = [
      [400, noise(-50)],
      [1000, speechLike(-25)],
      [1500, noise(-50)],
    ];
    expect(run(options, segments)).toEqual(run(options, segments));
  });
});

describe("cooldown", () => {
  it("keeps two starts at least cooldownMs apart", () => {
    const options = { ...LOCAL_BARGE_IN_OPTIONS, hangoverMs: 80, cooldownMs: 1500 };
    const events = run(options, [
      [200, silence],
      [400, speechLike(-22)],
      [200, silence],
      [400, speechLike(-22)],
      [1500, silence],
      [400, speechLike(-22)],
    ]);
    const starts = events.filter(([, event]) => event === "speech_start").map(([t]) => t);
    expect(starts).toHaveLength(2);
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(1500);
  });
});
