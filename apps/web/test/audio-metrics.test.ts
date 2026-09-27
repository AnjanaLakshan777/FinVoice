import { describe, expect, it } from "vitest";

import { formatAudioLine, pcm24kDurationMs, ReceiveTurnTracker } from "../lib/voice/audio-metrics";
import type { PlaybackStats } from "../lib/voice/pcm-player";

const PLAYBACK: PlaybackStats = {
  queueMs: 180,
  minQueueMs: 0,
  maxQueueMs: 900,
  avgQueueMs: 300,
  underruns: 3,
  longestUnderrunMs: 420,
  queuedMs: 4800,
  playedMs: 4000,
  leadMs: 450,
};

describe("audio metrics", () => {
  it("computes 24 kHz 16-bit duration from bytes", () => {
    expect(pcm24kDurationMs(48_000)).toBe(1000);
  });

  it("measures delivery per answer as received by the browser", () => {
    const tracker = new ReceiveTurnTracker();
    tracker.audio(48_000, 1000, 0);
    tracker.audio(48_000, 2000, 1);
    tracker.audio(134_400, 7200, 3); // 2.8 s

    expect(tracker.snapshot(3)?.outcome).toBe("in progress");
    expect(tracker.end("complete", 3)).toEqual({
      outcome: "complete",
      receivedAudioChunks: 3,
      receivedAudioBytes: 230_400,
      receivedAudioDurationMs: 4800,
      receiveWallClockDurationMs: 6200,
      deliveryFactor: 0.77,
      underruns: 3,
    });
    expect(tracker.end("complete", 3)).toBeNull();
  });

  it("formats the development summary line", () => {
    const tracker = new ReceiveTurnTracker();
    tracker.audio(48_000, 0, 0);
    tracker.audio(182_400, 6200, 3);

    expect(formatAudioLine(tracker.end("complete", 3), PLAYBACK)).toBe(
      "Audio: received 4.8s / 6.2s wall time · delivery 0.77x · queue 180ms · underruns 3",
    );
    expect(formatAudioLine(null, null)).toBe(
      "Audio: received — · delivery — · queue — · underruns 0",
    );
  });
});
