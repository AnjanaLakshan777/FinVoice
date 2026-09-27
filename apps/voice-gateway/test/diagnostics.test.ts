import { describe, expect, it } from "vitest";

import {
  parseTestSignalParams,
  speechLikePcm,
  speechLikeSample,
} from "../src/diagnostics/test-signal.js";
import { deliveryFactor, pcm24kDurationMs, TurnMetrics } from "../src/diagnostics/turn-metrics.js";

describe("audio duration and delivery factor", () => {
  it("computes 24 kHz 16-bit mono duration from bytes", () => {
    expect(pcm24kDurationMs(48_000)).toBe(1000);
    expect(pcm24kDurationMs(4800)).toBe(100);
    expect(pcm24kDurationMs(0)).toBe(0);
  });

  it("divides received audio by arrival wall-clock time", () => {
    expect(deliveryFactor(5000, 2500)).toBe(2);
    expect(deliveryFactor(5000, 10_000)).toBe(0.5);
    expect(deliveryFactor(5000, 0)).toBeNull();
  });
});

describe("TurnMetrics", () => {
  it("summarizes one turn", () => {
    const metrics = new TurnMetrics(1000);
    metrics.transcript(2000);
    metrics.audio(48_000, 2500); // 1 s of audio
    metrics.audio(48_000, 3000);
    metrics.audio(96_000, 4500); // 2 s

    expect(metrics.end("complete", 5000)).toEqual({
      turn: 1,
      outcome: "complete",
      turnStartMs: 1000,
      firstAudioMs: 500,
      turnCompleteMs: 3000,
      responseStartWaitMs: null,
      generationCompleteMs: null,
      receivedAudioChunks: 3,
      receivedAudioBytes: 192_000,
      receivedAudioDurationMs: 4000,
      receiveWallClockDurationMs: 2000,
      deliveryFactor: 2,
      maxProgressGapMs: 1500,
      toolMs: 0,
    });
    expect(metrics.active).toBe(false);
    expect(metrics.end("complete", 6000)).toBeNull();
  });

  it("records the response-start wait and the answer's generationComplete", () => {
    const metrics = new TurnMetrics(0);
    metrics.toolStarted(1000);
    metrics.responseStart(700);
    metrics.responseStart(9999); // only the first call counts
    metrics.generationComplete(1001); // after the tool call
    metrics.toolFinished(1100);
    metrics.audio(48_000, 2000);
    metrics.generationComplete(4000); // the answer's

    expect(metrics.end("complete", 12_000)).toMatchObject({
      responseStartWaitMs: 700,
      generationCompleteMs: 3000,
      turnCompleteMs: 11_000,
    });
  });

  it("reports slower-than-real-time delivery", () => {
    const metrics = new TurnMetrics(0);
    metrics.audio(48_000, 0);
    metrics.audio(48_000, 4000);

    expect(metrics.end("complete", 4000)?.deliveryFactor).toBe(0.5);
  });

  it("does not count tool time as a model pause", () => {
    const metrics = new TurnMetrics(0);
    metrics.transcript(0);
    metrics.toolStarted(100);
    metrics.toolFinished(5100);
    metrics.audio(4800, 5600);

    const summary = metrics.end("complete", 6000);
    expect(summary?.toolMs).toBe(5000);
    expect(summary?.maxProgressGapMs).toBe(500);
  });

  it("numbers turns and totals speech over ended turns", () => {
    const metrics = new TurnMetrics(0);
    metrics.audio(48_000, 0);
    metrics.audio(48_000, 1000);
    metrics.end("interrupted", 1000);
    metrics.audio(24_000, 2000);
    const second = metrics.end("stalled", 3000);

    expect(second).toMatchObject({ turn: 2, outcome: "stalled", deliveryFactor: null });
    expect(metrics.totals()).toEqual({ speechMs: 2500, speechArrivalMs: 1000 });
  });
});

describe("synthetic test signal", () => {
  it("is deterministic and within range", () => {
    const a = speechLikePcm(1000, 2400);
    const b = speechLikePcm(1000, 2400);
    expect(a.equals(b)).toBe(true);
    for (let n = 0; n < 24_000; n += 7) {
      expect(Math.abs(speechLikeSample(n))).toBeLessThanOrEqual(1);
    }
  });

  it("contains speech-like syllables and pauses", () => {
    // Syllable 2 (0.5–0.75 s) is silent; syllable 0 is not.
    expect(speechLikePcm(0.55 * 24_000, 100).every((byte) => byte === 0)).toBe(true);
    expect(speechLikePcm(0.12 * 24_000, 100).some((byte) => byte !== 0)).toBe(true);
  });

  it("bounds its parameters", () => {
    expect(parseTestSignalParams(new URLSearchParams("seconds=999&chunkMs=1&pace=100"))).toEqual({
      seconds: 30,
      chunkMs: 20,
      pace: 4,
    });
    expect(parseTestSignalParams(new URLSearchParams("pace=abc"))).toEqual({
      seconds: 10,
      chunkMs: 200,
      pace: 1,
    });
  });
});
