import { analyticsEventSchema, type AnalyticsEvent } from "@finvoice/contracts";

import { AnalyticsRecorder } from "../../src/analytics/analytics-recorder.js";

/** Keeps recorded events in memory, validated like the real recorder, for unit tests. */
export class InMemoryAnalyticsRecorder extends AnalyticsRecorder {
  readonly events: AnalyticsEvent[] = [];
  private failures = 0;

  get failuresSinceStart(): number {
    return this.failures;
  }

  record(event: AnalyticsEvent): void {
    const parsed = analyticsEventSchema.safeParse(event);
    if (parsed.success) {
      this.events.push(parsed.data);
    } else {
      this.failures += 1;
    }
  }
}

/** A recorder whose storage always fails, as when the analytics table is unavailable. */
export class FailingAnalyticsRecorder extends AnalyticsRecorder {
  attempts = 0;

  get failuresSinceStart(): number {
    return this.attempts;
  }

  record(): void {
    this.attempts += 1;
  }
}
