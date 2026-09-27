import { describe, expect, it } from "vitest";

import {
  INITIAL_LEAD_SECONDS,
  LEAD_STEP_SECONDS,
  MAX_LEAD_SECONDS,
  PcmPlayer,
} from "../lib/voice/pcm-player";
import { FakeAudioContext } from "./support/browser-fakes";

/** 2,400 samples of 24 kHz PCM = 100 ms of speech, base64. */
const CHUNK_100_MS = btoa(String.fromCharCode(...new Uint8Array(4800)));

function player() {
  const context = new FakeAudioContext();
  return { context, player: new PcmPlayer(context as unknown as AudioContext) };
}

function startTimes(context: FakeAudioContext): number[] {
  return context.sources.map((source) => source.start.mock.calls[0]?.[0] as number);
}

describe("PcmPlayer", () => {
  it("creates 24 kHz buffers and plays chunks back to back after a short lead", () => {
    const { context, player: p } = player();
    context.currentTime = 1;

    p.enqueue(CHUNK_100_MS);
    p.enqueue(CHUNK_100_MS);
    p.enqueue(CHUNK_100_MS);

    expect(context.buffers.every((b) => b.sampleRate === 24_000 && b.length === 2400)).toBe(true);
    const [first, second, third] = startTimes(context);
    expect(first).toBeCloseTo(1 + INITIAL_LEAD_SECONDS, 9);
    expect(second).toBeCloseTo(1 + INITIAL_LEAD_SECONDS + 0.1, 9);
    expect(third).toBeCloseTo(1 + INITIAL_LEAD_SECONDS + 0.2, 9);
    expect(p.gaps).toBe(0);
  });

  it("counts a gap and grows the lead when speech arrives later than it plays", () => {
    const { context, player: p } = player();
    p.enqueue(CHUNK_100_MS);
    context.currentTime = 5; // the queue ran dry long ago

    p.enqueue(CHUNK_100_MS);

    expect(p.gaps).toBe(1);
    expect(p.lead).toBeCloseTo(INITIAL_LEAD_SECONDS + LEAD_STEP_SECONDS, 9);
    expect(startTimes(context)[1]).toBeCloseTo(5 + INITIAL_LEAD_SECONDS + LEAD_STEP_SECONDS, 9);
  });

  it("caps the lead", () => {
    const { context, player: p } = player();
    for (let i = 0; i < 20; i++) {
      context.currentTime = i * 10;
      p.enqueue(CHUNK_100_MS);
    }
    expect(p.lead).toBe(MAX_LEAD_SECONDS);
  });

  it("does not count the start of a new answer as a gap", () => {
    const { context, player: p } = player();
    p.enqueue(CHUNK_100_MS);
    p.endAnswer();
    context.currentTime = 30;

    p.enqueue(CHUNK_100_MS);

    expect(p.gaps).toBe(0);
    expect(p.lead).toBe(INITIAL_LEAD_SECONDS);
  });

  it("measures the queue on arrival, underruns, and queued and played speech", () => {
    const { context, player: p } = player();
    context.currentTime = 0;
    p.enqueue(CHUNK_100_MS); // starts at 0.15, ends at 0.25
    context.currentTime = 0.05;
    p.enqueue(CHUNK_100_MS); // queue on arrival: 0.20 s
    context.currentTime = 1; // queue ran dry at 0.35
    p.enqueue(CHUNK_100_MS); // underrun: silence 0.35 → 1.25

    context.sources[0]?.onended?.();

    expect(p.stats()).toEqual({
      queueMs: 350,
      minQueueMs: 0,
      maxQueueMs: 200,
      avgQueueMs: 100,
      underruns: 1,
      longestUnderrunMs: 900,
      queuedMs: 300,
      playedMs: 100,
      leadMs: 250,
    });
  });

  it("stops every queued chunk at once on clear (barge-in)", () => {
    const { context, player: p } = player();
    p.enqueue(CHUNK_100_MS);
    p.enqueue(CHUNK_100_MS);

    p.clear();

    expect(context.sources.every((source) => source.stop.mock.calls.length === 1)).toBe(true);
    expect(p.isPlaying).toBe(false);
    context.currentTime = 2;
    p.enqueue(CHUNK_100_MS);
    expect(p.gaps).toBe(0);
    expect(startTimes(context)[2]).toBeCloseTo(2 + INITIAL_LEAD_SECONDS, 9);
  });
});
