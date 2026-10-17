/**
 * Development-only isolation test (not an endpoint, not part of the build): opens a Gemini Live
 * session with FinVoice's real server-side configuration (model, voice, Live instruction, tools
 * from the API), sends TEXT instead of microphone audio, and measures how the model's speech
 * arrives (stage A: Gemini → this process). No browser, microphone, AudioWorklet, resampler or
 * playback is involved.
 *
 * Usage (API running, root .env with GEMINI_API_KEY and INTERNAL_API_TOKEN):
 *   pnpm --filter @finvoice/voice-gateway probe:live-text -- EN "What is an emergency fund?"
 *
 * Prints numbers only, plus the first characters of each answer's transcript. Never prints the
 * API key and never stores audio.
 */
import { loadVoiceGatewayConfig, type VoiceGatewayConfig } from "@finvoice/config";
import type { AgentLanguage } from "@finvoice/contracts";
import { GoogleGenAI, type LiveServerMessage, type Session } from "@google/genai";

import { HttpVoiceBackend } from "../src/backend/voice-backend.js";
import { TurnMetrics, type TurnMetricsSummary } from "../src/diagnostics/turn-metrics.js";
import { buildLiveConnectConfig, toLiveEvents } from "../src/live/gemini-live-connector.js";

const TURN_TIMEOUT_MS = 120_000;
const TRANSCRIPT_PREVIEW = 90;

type ProbeResult = {
  prompt: string;
  summary: TurnMetricsSummary | null;
  toolCalls: string[];
  transcriptPreview: string;
  /** No turnComplete within the timeout. */
  timedOut: boolean;
  /** When each lifecycle event first arrived, ms after the text was sent (numbers only). */
  timeline: Record<string, number | string>;
  /** Text sent → first model progress (speech, output transcription or tool call). */
  responseStartWaitMs: number | null;
};

async function probe(
  config: VoiceGatewayConfig,
  language: AgentLanguage,
  prompt: string,
): Promise<ProbeResult> {
  const apiKey = config.gemini.apiKey;
  if (apiKey === null) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  const backend = new HttpVoiceBackend(config.internalApi);
  const setup = await backend.getSessionSetup(language);
  const metrics = new TurnMetrics(performance.now());
  const toolCalls: string[] = [];
  let transcript = "";
  let toolPending = false;
  let sentAt = 0;
  let responseStartWaitMs: number | null = null;
  const timeline: Record<string, number | string> = {};
  const counts: Record<string, number> = {};
  /** First occurrence of each event; lifecycle events are recorded every time they occur. */
  const mark = (name: string, now: number) => {
    const count = (counts[name] = (counts[name] ?? 0) + 1);
    const repeatable =
      name.startsWith("generation_complete") ||
      name.startsWith("turn_complete") ||
      name === "waiting_for_input" ||
      name === "interrupted";
    if (count === 1) {
      timeline[name] = Math.round(now - sentAt);
    } else if (repeatable) {
      timeline[`${name}#${String(count)}`] = Math.round(now - sentAt);
    }
  };
  const live: { session?: Session } = {};
  let finish: (timedOut: boolean) => void = () => undefined;
  const finished = new Promise<boolean>((resolve) => {
    finish = resolve;
  });

  const onMessage = (message: LiveServerMessage) => {
    for (const event of toLiveEvents(message)) {
      const now = performance.now();
      mark(
        event.type === "turn_complete" && toolPending ? "turn_complete_after_tool" : event.type,
        now,
      );
      if (
        responseStartWaitMs === null &&
        (event.type === "audio" || event.type === "output_transcript" || event.type === "tool_call")
      ) {
        responseStartWaitMs = Math.round(now - sentAt);
      }
      switch (event.type) {
        case "audio":
          metrics.audio(Buffer.from(event.data, "base64").length, now);
          break;
        case "output_transcript":
          metrics.transcript(now);
          transcript += event.text;
          break;
        case "tool_call":
          toolPending = true;
          metrics.toolStarted(now);
          void Promise.all(
            event.calls.map(async (call) => {
              toolCalls.push(call.name);
              const execution = await backend.executeTool({
                name: call.name,
                arguments: call.args,
                language,
              });
              return { id: call.id, name: call.name, response: execution.result };
            }),
          ).then((responses) => {
            metrics.toolFinished(performance.now());
            live.session?.sendToolResponse({ functionResponses: responses });
          });
          break;
        case "turn_complete":
          if (event.interactionStatus !== undefined) {
            timeline.interactionStatus = event.interactionStatus;
          }
          if (toolPending) {
            toolPending = false; // Gemini's turnComplete after a tool call, before the answer.
          } else {
            finish(false);
          }
          break;
        default:
          break;
      }
    }
  };

  const session = await new GoogleGenAI({ apiKey }).live.connect({
    model: config.gemini.liveModel,
    config: buildLiveConnectConfig(
      {
        language,
        systemInstruction: setup.systemInstruction,
        tools: setup.tools,
        resumptionHandle: null,
      },
      config.gemini.liveVoice,
    ),
    callbacks: {
      onmessage: onMessage,
      onerror: () => undefined,
      onclose: () => {
        finish(true);
      },
    },
  });
  live.session = session;
  const timer = setTimeout(() => {
    finish(true);
  }, TURN_TIMEOUT_MS);
  sentAt = performance.now();
  session.sendRealtimeInput({ text: prompt });
  const timedOut = await finished;
  clearTimeout(timer);
  session.close();
  return {
    prompt,
    summary: metrics.end(timedOut ? "stalled" : "complete", performance.now()),
    toolCalls,
    transcriptPreview: transcript.slice(0, TRANSCRIPT_PREVIEW),
    timedOut,
    timeline,
    responseStartWaitMs,
  };
}

async function main(): Promise<void> {
  const [language = "EN", ...prompts] = process.argv.slice(2).filter((arg) => arg !== "--");
  if (!["EN", "SI", "TA"].includes(language) || prompts.length === 0) {
    console.error('Usage: live-text-probe <EN|SI|TA> "prompt" ["prompt" ...]');
    process.exitCode = 2;
    return;
  }
  const config = loadVoiceGatewayConfig();
  console.info(`model ${config.gemini.liveModel}, voice ${config.gemini.liveVoice}, text input`);
  for (const prompt of prompts) {
    const result = await probe(config, language as AgentLanguage, prompt);
    const s = result.summary;
    console.info(
      JSON.stringify({
        prompt: result.prompt,
        timedOut: result.timedOut,
        tools: result.toolCalls,
        firstAudioMs: s?.firstAudioMs ?? null,
        receivedAudioDurationMs: s?.receivedAudioDurationMs ?? 0,
        receiveWallClockDurationMs: s?.receiveWallClockDurationMs ?? 0,
        deliveryFactor: s?.deliveryFactor ?? null,
        maxProgressGapMs: s?.maxProgressGapMs ?? 0,
        chunks: s?.receivedAudioChunks ?? 0,
        toolMs: s?.toolMs ?? 0,
        responseStartWaitMs: result.responseStartWaitMs,
      }),
    );
    console.info(`  events (ms after text sent): ${JSON.stringify(result.timeline)}`);
    console.info(`  transcript: ${result.transcriptPreview}…`);
  }
}

main().catch((error: unknown) => {
  console.error(`probe failed: ${error instanceof Error ? error.name : "unknown error"}`);
  process.exitCode = 1;
});
