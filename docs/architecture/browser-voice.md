# Browser voice

> **Status:** Step 7. A **local/development** real-time voice experience: a user talks to FinVoice from the browser in Sinhala, Tamil or English, and FinVoice answers with generated speech. There is no authentication yet (see [§18](#18-security)); do not expose the voice gateway publicly with this setup.

## 1. Browser voice architecture

```text
Browser (apps/web, /voice)
  microphone → AudioWorklet (16 kHz PCM)            Web Audio playback (24 kHz PCM)
        │                                                   ▲
        ▼            WebSocket, JSON messages               │
Voice Gateway (apps/voice-gateway, ws://127.0.0.1:4100/voice)
        │   @google/genai ai.live.connect (server-side API key)
        ▼
Gemini Live (native audio)
        │   tool call (e.g. calculate_loan)
        ▼
Voice Gateway ── internal HTTP + shared token ──▶ Backend API (apps/api, /internal/voice/*)
                                                   │  AgentToolRegistry (Step 6)
                                                   ▼
                                     finance engine · knowledge service → PostgreSQL
```

Each browser connection owns exactly one WebSocket, at most one Gemini Live session at a time, one playback queue (in the browser) and one resumption state (in the gateway). There is no global mutable session state, and everything is released when the connection ends.

Dependency direction: **web → voice gateway → API → database / finance engine**. The web app never talks to Gemini or the database, the gateway never touches Prisma, and Gemini reaches data only through allowlisted tools that the API executes. The browser is never trusted: it only picks a language and streams microphone audio.

## 2. Voice Gateway role

The gateway ([apps/voice-gateway](../../apps/voice-gateway)) is a real-time adapter, not a business service:

| Module                                | Responsibility                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/gateway/voice-gateway-server.ts` | HTTP server (`GET /health`), WebSocket upgrade on `/voice`, Origin check, session limit, payload limit, shutdown    |
| `src/gateway/voice-session.ts`        | One connection's state machine: protocol, lifecycle, audio/transcript bridging, tool calls, resumption, rate limits |
| `src/gateway/protocol.ts`             | Parsing browser messages with the shared contract; serializing server messages                                      |
| `src/live/live-session.ts`            | Provider-neutral Live session types (`LiveConnector`, `LiveConnection`, `LiveEvent`)                                |
| `src/live/gemini-live-connector.ts`   | The Gemini Live adapter over the official SDK: config, message mapping, connect timeout, error mapping              |
| `src/backend/voice-backend.ts`        | Client for the API's internal voice endpoints (session setup and tool execution)                                    |
| `src/logger.ts`                       | Structured JSON logs with an allowlist of fields                                                                    |

It holds no prompts, no tool logic and no database access.

## 3. Gemini Live role

Gemini Live listens to the user's audio, detects when they finish speaking, requests tool calls when it needs facts or numbers, and answers with native audio (`responseModalities: [AUDIO]`; there is no separate text-to-speech). The model is `GEMINI_LIVE_MODEL` (default `gemini-3.8-live`), separate from the text agent's `GEMINI_MODEL`. The voice is the prebuilt voice `GEMINI_LIVE_VOICE` (default `Kore`, defined once in `@finvoice/config`), sent as `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`. Both are server settings: the browser only chooses the language.

The connection uses the existing `@google/genai` SDK (2.24.0): `ai.live.connect({ model, config, callbacks })`, then `session.sendRealtimeInput`, `session.sendToolResponse` and `session.close`. The configuration fields were taken from the installed SDK typings (`LiveConnectConfig`), not from older examples:

```ts
{
  responseModalities: [Modality.AUDIO],
  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_LIVE_VOICE } } },
  systemInstruction: buildLiveSystemInstruction(language),   // from the API
  tools: [{ functionDeclarations: [/* the five allowlisted tools, parametersJsonSchema */] }],
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  sessionResumption: {} | { handle },
  contextWindowCompression: { slidingWindow: {} },
}
```

The SDK's `connect()` waits for Gemini's `setupComplete` and does not settle if the socket closes first, so the adapter adds its own guards: a close during setup rejects immediately (`rejected`), setup is limited to 15 s (`unavailable`), and a session that completes after the gateway gave up is closed at once.

The system instruction is built by the API (`buildLiveSystemInstruction` in [agent.prompt.ts](../../apps/api/src/ai/agent/agent.prompt.ts)). It contains exactly the same rules as the text agent (shared text, checked by a test): facts only from the knowledge tools, calculations only from the calculation tools, no own arithmetic, no invented rates, laws or policies, no "best bank", no approval or return guarantees, never ask for PINs, OTPs or passwords, and user claims are not authoritative. Only the language, speaking and number sections differ:

- **Language:** an explicit `RESPOND IN SINHALA` / `RESPOND IN TAMIL` / `RESPOND IN ENGLISH` line, plus wording guidance for the selected language only:
  - English: simple, everyday conversational English; no formal, corporate or academic wording or long sentences.
  - Sinhala: natural, everyday Sri Lankan Sinhala as people speak it, not formal written Sinhala; no word-for-word translation from English; common Sinhala words where they exist (ඉතුරුම්, ණය, පොලිය); English terms that are common in Sri Lanka (loan, OTP, PIN, ATM, card) may stay, with a simple Sinhala explanation the first time.
  - Tamil: natural, everyday Tamil as commonly spoken in Sri Lanka, not formal literary Tamil; no word-for-word translation; common Tamil words (சேமிப்பு, கடன், வட்டி); common English terms may stay, with a simple Tamil explanation.
  - For every language: "Natural wording changes only how you say something, never what you say": every fact, number, condition and warning from the source stays exactly the same, and nothing is added.
- **How to speak:** a friendly, patient person, not a document read aloud; short sentences; one idea at a time, finished before the next (natural pauses); brief answers, most important point first; at most three spoken items instead of lists; no Markdown, bullet points, tables, emojis or symbols such as `*`, `#`, `/` or `%`; no links read aloud; ask the user to repeat instead of guessing what they said.
- **Numbers and money:** numbers are said naturally in the selected language (not digit by digit, except phone numbers or codes); amounts are said in rupees and cents exactly as the tool returned them, never rounded, estimated, recalculated or called "about"; each calculation result gets its own short sentence ("Your regular monthly payment is sixteen thousand six hundred and seven rupees and fifteen cents. Your final payment is …").

**Money formatting for speech.** For voice, the API adds `spokenAmounts` to successful calculation results ([spoken-amounts.ts](../../apps/api/src/ai/voice/spoken-amounts.ts)): each money field written as `"Rs. 16,607.15"` next to the unchanged engine value `"16607.15"`. It is pure text formatting (digit grouping and the `Rs.` prefix; a deficit is `"-Rs. 12,500.00"`): no arithmetic and no rounding, and removing the formatting gives back the exact engine string (tested). Rates, months and statuses are not formatted. Gemini then says the amount naturally in the selected language.

## 4. WebSocket protocol

JSON text frames only (binary frames are rejected). The contract is in [packages/contracts/src/voice.ts](../../packages/contracts/src/voice.ts); browser messages are validated with a strict zod discriminated union, so unknown types and unknown fields are rejected.

**Browser → gateway**

| Message                                   | Meaning                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `{ "type": "start_session", "language" }` | Start the connection's one voice session. `language` is `SI`, `TA` or `EN` (Step 5 contract).  |
| `{ "type": "audio", "data" }`             | One microphone frame: base64 of 16 kHz mono Int16 little-endian PCM, whole samples, ≤ 3,200 B. |
| `{ "type": "stop_session" }`              | End the session.                                                                               |
| `{ "type": "ping" }`                      | Keep-alive (the web app sends one every 20 s).                                                 |

The browser cannot send a model, system instruction, tools, generation settings or any other configuration: such fields make the message invalid.

**Gateway → browser**

| Message                                                           | Meaning                                                                                                                                                         |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ "type": "session_started", "language" }`                       | Gemini is ready; audio may be sent.                                                                                                                             |
| `{ "type": "audio", "data", "mimeType": "audio/pcm;rate=24000" }` | A chunk of FinVoice's speech.                                                                                                                                   |
| `{ "type": "input_transcript", "text", "languageCode"? }`         | Incremental transcription of the user, with the detected language when Gemini reports it (diagnostics).                                                         |
| `{ "type": "output_transcript", "text" }`                         | Incremental transcription of FinVoice.                                                                                                                          |
| `{ "type": "tool_status", "name" }`                               | FinVoice is running an allowlisted tool (name only).                                                                                                            |
| `{ "type": "interrupted" }`                                       | The user spoke over FinVoice: stop playback and drop queued audio now.                                                                                          |
| `{ "type": "turn_complete" }`                                     | FinVoice finished its answer for this turn.                                                                                                                     |
| `{ "type": "turn_stalled", "reason"? }`                           | The answer was ended because the model showed no progress (`no_response` after the user's turn, or `no_progress` mid-answer); the session stays open (see §15). |
| `{ "type": "pong" }`                                              | Reply to `ping`.                                                                                                                                                |
| `{ "type": "error", "code", "message" }`                          | A client-safe error (codes below).                                                                                                                              |
| `{ "type": "session_closed" }`                                    | The session has ended; the gateway closes the socket next.                                                                                                      |

`turn_complete` and `pong` are additions to the minimum protocol: the first lets the browser group transcript lines per answer (it is sent only when FinVoice finishes an answer, not when it pauses for a tool), the second answers `ping`.

**Error codes**

| Code                         | When                                                                                     | Ends the session?  |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ------------------ |
| `VOICE_CONFIG_ERROR`         | `GEMINI_API_KEY` or `INTERNAL_API_TOKEN` missing, or the API rejects the token           | yes                |
| `VOICE_PROVIDER_UNAVAILABLE` | Gemini unreachable, timed out, or refused the session (quota, key, model)                | yes                |
| `VOICE_SESSION_ERROR`        | API unavailable at start, Gemini disconnected and could not be resumed, no start in 30 s | yes                |
| `VOICE_INVALID_MESSAGE`      | Invalid or out-of-order browser message                                                  | no (after 20: yes) |
| `VOICE_TOOL_ERROR`           | The API could not run a tool (the model receives a `TOOL_FAILED` result)                 | no                 |
| `VOICE_LIMIT_REACHED`        | Tool-call limit for this turn (no), message rate or capacity (yes)                       | depends            |

Messages are fixed, client-safe texts. Provider and API details are never sent to the browser; they are logged in sanitized form (close code, a truncated close reason with anything key-like redacted, HTTP status).

WebSocket close codes: `1000` after `stop_session`, `1001` on gateway shutdown, `1008` for policy violations (invalid-message or rate limits, start timeout), `1009` when a frame exceeds 8 KiB, `1011` when the session fails, `1013` when the gateway is at capacity.

## 5. Audio formats

| Direction        | Format                                           | MIME type              |
| ---------------- | ------------------------------------------------ | ---------------------- |
| Browser → Gemini | mono, 16,000 Hz, 16-bit signed little-endian PCM | `audio/pcm;rate=16000` |
| Gemini → browser | mono, 24,000 Hz, 16-bit signed little-endian PCM | `audio/pcm;rate=24000` |

Audio travels as base64 inside JSON on the browser WebSocket and is passed through the gateway unchanged (no decoding or resampling in the gateway).

## 6. 16 kHz input

The browser captures the microphone with `getUserMedia` and processes it in an **AudioWorklet** ([public/voice/pcm-capture-worklet.js](../../apps/web/public/voice/pcm-capture-worklet.js)); `ScriptProcessorNode` is not used. The worklet:

1. mixes all channels to mono;
2. resamples from the AudioContext's actual rate (`sampleRate` in the worklet; any rate, typically 48 kHz or 44.1 kHz) to exactly 16 kHz with a windowed-sinc resampler;
3. clamps to [-1, 1] and writes 16-bit signed little-endian samples with an explicit `DataView` (non-finite values become 0).

**Resampling method.** Output sample _n_ is taken at the exact input position _n × inputRate / 16,000_, computed from integer indexes, so there is no drift and any rate ratio works (3 for 48 kHz, 2.75625 for 44.1 kHz). Its value is the weighted sum of the input samples around that position. The weights come from a sinc low-pass filter with a cutoff of 90% of the output Nyquist frequency (7.2 kHz), shaped by a Blackman window spanning 16 zero crossings on each side. The kernel is tabulated once (128 points per input sample, linearly interpolated). Weights are normalized per output sample, so a constant signal stays exactly constant. The filter removes content above 8 kHz before it can fold back as aliasing, which plain sample dropping or averaging would not. It adds about 1.1 ms of latency (the kernel half-width) and costs about 100 multiply-adds per output sample. It is deterministic, and the output does not depend on how the input is split into buffers. Tests cover 48, 44.1, 32, 22.05 and 16 kHz input, silence, constant signals, 440 Hz and 1 kHz sines (error < 0.002), 9 and 12 kHz tones (removed, RMS < 0.001), 1-sample buffers, repeatability, and valid, unclipped int16 output.

**Microphone settings.** Echo cancellation, noise suppression, automatic gain control and one channel are requested as preferences (`{ ideal: … }`), and only those that `getSupportedConstraints()` reports. Preferences never make `getUserMedia` fail. If a browser still rejects them, the page tries once more with plain `audio: true`. Permission errors are never retried. The audio is not encoded or compressed anywhere; it stays raw PCM.

**Diagnostics (development only).** Everything below is numbers only (no audio, speech or transcript content), exists only when `NODE_ENV` is not `production`, and is never part of an API response. The audio path is measured in four independent stages:

| Stage                | Where                                           | What                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Gemini → gateway  | gateway log `turn_metrics`, one line per answer | `turnStartMs`, `responseStartWaitMs` (end of the user’s speech → first model progress), `firstAudioMs`, `generationCompleteMs`, `turnCompleteMs`, `receivedAudioChunks`, `receivedAudioBytes`, `receivedAudioDurationMs` (bytes / (24,000 × 2) × 1,000), `receiveWallClockDurationMs` (first to last chunk), `deliveryFactor` (duration / wall clock), `maxProgressGapMs` (longest wait between model events, tool time excluded), `toolMs`, `outcome` |
| B. Gateway → browser | same line, and the /voice page                  | `maxBrowserBacklogBytes` (bytes waiting in the gateway's socket); the page's own per-answer receive duration, wall clock and delivery factor                                                                                                                                                                                                                                                                                                           |
| C. Browser queue     | /voice page                                     | queue now, queue on each chunk's arrival (min / avg / max), speech queued and played                                                                                                                                                                                                                                                                                                                                                                   |
| D. Playback          | /voice page                                     | underruns, longest underrun, current jitter-buffer lead                                                                                                                                                                                                                                                                                                                                                                                                |

The /voice page shows a collapsible "Audio diagnostics" panel with a summary line (`Audio: received 4.8s / 6.2s wall time · delivery 0.77x · queue 180ms · underruns 3`), the microphone facts (sample rates, channels, chunk size and bytes, processing flags), the detected input language when Gemini reports it, and the last interruption: estimated user speech onset → `interrupted` event → playback cleared. The onset is estimated from the level of outgoing microphone frames for this measurement only; it controls nothing. The gateway also logs one line per session at `session_closed`, with audio counters, speech totals (`speechMs`, `speechArrivalMs`) and stall handling counters (`responseStartTimeouts`, `generationStalls`, `geminiInterruptions`); stalls are logged as `turn_stalled` and `response_start_timeout`. The panel also shows local barge-ins and Gemini interruptions, local barge-in → playback cleared, speech detected → Gemini interrupted, and the last stall reason.

**Isolation tools (development only).**

- _Text input, stage A alone:_ `pnpm --filter @finvoice/voice-gateway probe:live-text -- EN "What is an emergency fund?"` ([scripts/live-text-probe.ts](../../apps/voice-gateway/scripts/live-text-probe.ts)). It opens a Live session with the real server configuration (model, voice, Live instruction, tools through the API), sends text instead of audio, and prints the per-turn metrics. No browser, microphone, worklet, resampler or playback is involved. It is a script, not an endpoint, and needs the API running.
- _Synthetic signal, stages B–D without Gemini:_ with diagnostics on, the gateway also accepts `ws://…/voice/test-signal?pace=1&seconds=10&chunkMs=200` (same Origin check; 404 in production). It streams a deterministic speech-like 24 kHz signal (a 140 Hz harmonic tone in four syllables per second, every third one silent) in normal `audio` messages at the requested pace, then `turn_complete` and `session_closed`. No user audio is involved. The panel's "Test playback path" button (pace 1×, 0.8× or 2×) plays it through the normal queue and shows the measurements.

The AudioContext runs at the device rate on purpose: some browsers cannot connect a microphone to a context with a different sample rate.

## 7. 24 kHz output

Gemini's speech arrives as 24 kHz PCM chunks (only `audio/pcm` parts are forwarded; other parts are dropped). The browser decodes each chunk to floats and creates an `AudioBuffer` **at 24,000 Hz** in its normal-rate AudioContext; Web Audio resamples the buffer to the device rate during playback. Nothing assumes a 24 kHz context.

## 8. Chunking

- Microphone frames are **40 ms**: 640 samples = 1,280 bytes (≈ 1.7 KB base64). That is within the 20–40 ms target (320–640 samples) and 25 messages per second.
- The worklet keeps at most one frame; the web client drops frames instead of queueing when the socket has more than 64 KiB unsent. The gateway accepts at most 100 ms per frame (3,200 bytes) and 8 KiB per WebSocket message.
- Frames are sent as soon as they are produced; nothing is batched.

## 9. Audio playback

`PcmPlayer` ([lib/voice/pcm-player.ts](../../apps/web/lib/voice/pcm-player.ts)) schedules each chunk as an `AudioBufferSourceNode` exactly where the previous one ends, so playback is continuous. It has a small adaptive jitter buffer. When the queue is empty, the next chunk starts 150 ms ahead instead of immediately. If the queue runs dry in the middle of an answer (speech arrived later than it plays, which is heard as a gap), the lead grows by 100 ms for the rest of the session, up to 600 ms. The start of a new answer (after `turn_complete`) is not counted as a gap. Chunks are only scheduled, never altered, so pitch and speed are unchanged. `clear()` stops every scheduled source immediately and resets the queue. On Stop, the player is cleared and the AudioContext is closed. The gateway drops speech chunks for a browser whose socket has more than 2 MiB unsent, rather than buffering without bound.

## 10. VAD

Voice activity detection is Gemini's **automatic** VAD (the default; `realtimeInputConfig` is not set). Gemini alone decides when the user's turn starts and ends and when an answer is interrupted; nothing is sent to it about FinVoice's own speech detection (no `activityStart`/`activityEnd`). FinVoice has a small energy-based speech detector ([speech-activity.ts](../../packages/shared/src/speech-activity.ts)), which is not a VAD for the conversation. It is used only to stop local playback (§11) and to notice unanswered turns (§15). `audioStreamEnd` is not sent: with automatic VAD, Gemini detects the end of speech from the audio itself, and when the user stops, the whole session ends instead of pausing the stream.

## 11. Interruption handling

There are two distinct interruptions:

- **Local playback interruption (immediate, UX only).** The browser runs the speech detector on each outgoing microphone frame (40 ms, after the browser's echo cancellation and noise suppression). When it detects that the user has started speaking while FinVoice's speech is playing, it clears the playback queue at once, stops every scheduled chunk, and drops the rest of that answer's audio and transcript until Gemini confirms the interruption or the turn ends. Otherwise the already-generated remainder would resume playing. The microphone keeps streaming normally, the WebSocket stays open, and nothing about the local detection is sent to the gateway or Gemini.
- **Gemini interruption (authoritative).** When Gemini's VAD decides the user interrupted, it sends `serverContent.interrupted`; the gateway forwards `{ "type": "interrupted" }` straight away and resets the per-turn tool-call counter. The browser clears playback again (harmless if the local barge-in already did), ends local suppression so the new answer plays, and starts a new FinVoice transcript line. The session is never closed by an interruption, and repeated interruptions are handled the same way.

Detector settings (`LOCAL_BARGE_IN_OPTIONS`, configurable through `VoiceClient`'s `bargeIn` option): a frame counts as loud from -38 dBFS RMS. Speech starts after 160 ms of loud frames that make up at least 60% of the candidate stretch; gaps over 200 ms reset it, so clicks, key taps and typing never add up to speech. Speech ends after 400 ms of quiet, and two starts are at least 700 ms apart, so continuous speech triggers once. -38 dBFS lies between processed speech (about -16 to -30 dBFS in FinVoice's tests) and processed room silence (about -97 dBFS). Deterministic tests cover silence, noise at -70/-55/-45 dBFS, clicks, fast typing, short bursts, sustained speech-like input, speech followed by silence, and syllables with short pauses. A local false positive (for example a cough) cuts off the rest of the current answer; the user can ask again.

## 12. Transcription

Input and output transcription are enabled (`inputAudioTranscription: {}`, `outputAudioTranscription: {}`, no language hints, so Gemini detects the language). Transcripts arrive as incremental text fragments and are forwarded as `input_transcript` / `output_transcript`. The web page appends fragments to the current line per speaker, shows the latest user and FinVoice lines and the conversation so far, and starts new lines after `turn_complete` or `interrupted`. Transcripts are shown only; they are never stored or logged.

## 13. Tool calling

**Architecture decision: Option A, internal HTTP to the API.** The Step 6 tools depend on the NestJS `KnowledgeService` (Prisma) and the finance engine; extracting them into a package would move a lot of code, and the gateway would then need database access. Instead the API exposes two token-protected internal endpoints that reuse `AgentToolRegistry` unchanged:

| Endpoint                                      | Returns                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /internal/voice/session-setup?language=` | `{ agentVersion, language, systemInstruction, tools, maxToolCallsPerTurn }` (Live instruction and registry declarations) |
| `POST /internal/voice/tools/execute`          | `{ tool, result, isError }` from `AgentToolRegistry.execute({ name, arguments }, { language })`                          |

They sit outside the public `/api/v1` API (excluded from the global prefix), and both need the `x-finvoice-internal-token` header equal to `INTERNAL_API_TOKEN` (compared as SHA-256 digests in constant time). Without a configured token they answer `503`; a missing or wrong token gets `401` before any validation. This keeps one implementation of the prompt, the tool declarations and tool execution; the gateway has no business logic and no circular dependencies (`voice-gateway → contracts/config`, `api → contracts/config/finance-engine`).

Flow for one Gemini `toolCall`:

1. The gateway checks each name against `AGENT_TOOL_NAMES`. Unknown names get the same `UNKNOWN_TOOL` result as in Step 6, without an API call.
2. For allowlisted names it sends `tool_status { name }` to the browser and `POST /internal/voice/tools/execute` with the model's arguments and the session language.
3. The results go back to Gemini with `session.sendToolResponse({ functionResponses: [{ id, name, response }] })`, in the order of the calls, as one message per `toolCall`.
4. Calls named in a `toolCallCancellation` are not answered.

Tool results are plain JSON from the API: money stays a decimal string (`"16607.15"`), and knowledge results carry the Step 6 `guidance`, `authoritativeContent`, source and review fields. Results and arguments are never logged or sent to the browser.

## 14. Tool validation

Validation happens once, in the API, with the Step 6 contracts: `voiceToolExecutionRequestSchema` checks the envelope (`name` ≤ 64 characters, `arguments` a JSON object, `language` SI/TA/EN, no extra fields), then the registry validates the arguments with each tool's input schema and again in the finance engine. Invalid arguments return `INVALID_ARGUMENTS` with field issues to the model, which can ask the user for the correct value. The gateway adds only the allowlist check and a per-turn limit.

**Tool-call limit.** At most 5 tool calls per model turn (`MAX_TOOL_CALLS_PER_REQUEST`, sent by the API as `maxToolCallsPerTurn`; the gateway uses the lower of that and its own limit). The counter belongs to the session and is reset when Gemini finishes its answer (`turnComplete`) or is `interrupted`, and after a resumption. Gemini also sends `turnComplete` right after every tool call, before it receives the result (observed in the live smoke test: `toolCall → turnComplete → audio → turnComplete`); that `turnComplete` does not reset the counter and is not forwarded to the browser, so a chain of tool calls for one question stays limited. Calls beyond the limit are not executed: the model receives `TOOL_LIMIT_REACHED` ("answer with what you have, or say you cannot complete this request now"), and the browser gets one non-fatal `VOICE_LIMIT_REACHED` per turn.

## 15. Session lifecycle

```text
(connect) → WAITING_FOR_START → STARTING_GEMINI → ACTIVE → STOPPING → CLOSED
```

- **Connect.** The upgrade is accepted only on `/voice`, from an allowed Origin, below `VOICE_MAX_SESSIONS`.
- **WAITING_FOR_START.** Only `start_session` and `ping` are useful. Audio is rejected (`VOICE_INVALID_MESSAGE`). Without `start_session` within 30 s, the connection is closed.
- **STARTING_GEMINI.** The gateway fetches the setup from the API and opens the Live session. Audio is still rejected.
- **ACTIVE.** After `session_started`, audio flows both ways.
- **STOPPING → CLOSED.** On `stop_session`, a fatal error or shutdown: the Live session is closed, `session_closed` is sent and the socket is closed. On a browser disconnect everything is released without messages.

Policies:

- **Unanswered turns (response-start watchdog).** When a genuine user turn has been detected and no model turn is in progress, the gateway expects the model to show progress: speech, output transcription, a tool call, `generationComplete` or `turnComplete`. A genuine turn is Gemini's input transcription (final or interim), a voice-activity end if the provider sends one, or sustained speech followed by quiet in the microphone audio: at least 300 ms of speech, then 800 ms of quiet (`USER_TURN_OPTIONS`). An open microphone with silence or noise does not arm it, and neither does the session setup. `waitingForInput` from Gemini disarms it, because the model is deliberately waiting. A tool call is progress, and tool time is covered by the generation-stall rule below. If there is no progress for 10 s (`RESPONSE_START_TIMEOUT_MS`), the turn is reported as `turn_stalled` with reason `no_response`. Why 10 s: measured from the end of the user's speech (last loud microphone frame) or from sending text, the model's first progress came within 0.7–1.3 s with text input and 1.5–2.7 s from the end of the user's speech with browser microphone input (9 turns, including Gemini's own end-of-speech detection), while the no-response case lasted more than 70 s. 10 s is more than three times the slowest healthy start. User speech during an answer in progress does not arm the watchdog; Gemini's interruption covers that.
- **Stalled answers.** While an answer is in progress (after the model's first speech, output transcription or tool result), the gateway watches for model progress. The clock starts only when the speech already received would have finished playing in real time (Gemini often delivers 2–4× faster than real time and sends `turnComplete` only around the end of real-time playback), and time spent running FinVoice tools does not count. Gemini's explicit `generationComplete` disarms this detector: the answer is fully generated and only its playback remains. Measured, `generationComplete` arrives when generation ends, and `turnComplete` arrives much later, around when the speech would have finished playing; for example 8.6 s vs 19.5 s for an emergency-fund answer. `generationComplete` also arrives right after each tool call, and that one is not treated as the end of the answer. If nothing arrives for 10 s after that point (`STALL_TIMEOUT_MS`), the answer is ended (reason `no_progress`): the browser gets `turn_stalled` and shows "Voice response is taking longer than expected. You can ask again or say something new." instead of waiting indefinitely. The browser WebSocket and voice session stay open, and the user can speak again or interrupt. If a resumption handle exists and reconnection attempts remain (3, reset by each completed answer), the Live session is resumed on a fresh connection with the same conversation; the stalled answer is not repeated or invented. Otherwise the current connection is kept as it is: a stall never loops and never closes a healthy session by itself. A resumption that fails ends the session with `VOICE_SESSION_ERROR`. The detector is not armed before the model starts answering, so a question that gets no response at all is not detected. Why 10 s: measured gaps between model events while an answer was being generated were at most about 2.7 s (tool time excluded), and the stall seen in testing lasted more than 70 s. A first version counted from the last event, not from the end of real-time playback, and falsely reported 5 of 7 healthy answers as stalled in real browser tests; the playout-aware version reported none in the same 7 scenarios.
- **Repeated `start_session`** is rejected with `VOICE_INVALID_MESSAGE`; the running session continues. A connection never holds more than one Gemini session.
- **One session per connection.** After a session ends, the browser opens a new WebSocket to start again (the web page does this on each Start).
- **Stop while starting.** If the browser stops or disconnects while Gemini is connecting, the Live session is closed as soon as it opens; no orphan sessions remain.
- **Shutdown.** On SIGINT/SIGTERM the gateway sends `session_closed` to every browser, closes every Live session and then the server.

## 16. Session resumption

`sessionResumption` is always enabled. The gateway keeps the latest `newHandle` from `sessionResumptionUpdate` messages marked `resumable`, in memory only, per session; it is never sent to the browser or logged. When the Gemini connection closes unexpectedly, or Gemini sends `GoAway` (the connection will end soon), the gateway reconnects with `sessionResumption: { handle }` and the same setup, without telling the browser. Audio received while reconnecting is dropped, and events from the replaced connection are ignored. The gateway tries up to 3 consecutive resumptions (reset after each completed turn). If there is no handle or resumption fails, the browser gets `VOICE_SESSION_ERROR` ("The voice session ended unexpectedly. Please start again.") and the session ends.

## 17. Context compression

`contextWindowCompression: { slidingWindow: {} }` (fields as in the SDK's `ContextWindowCompressionConfig`/`SlidingWindow`) lets Gemini drop the oldest turns when the context grows, so long conversations do not hit the context limit. The trigger and target token counts are left at the server defaults.

## 18. Security

- **No authentication yet.** Step 7 is a local/development voice system: anyone who can reach the gateway and send an allowed Origin can open a session that uses the server's Gemini quota. The gateway listens on `127.0.0.1` by default. **Do not expose it publicly with this architecture.** Production authentication and authorization come in a later step.
- **Origin check (not CORS).** CORS does not apply to WebSockets: browsers do not send preflight requests and the server's CORS headers do not stop a page on another site from opening a socket. What browsers do send is the `Origin` header on the handshake, so the gateway accepts upgrades only when `Origin` exactly matches one of `VOICE_WEB_ORIGIN` (default `http://localhost:3000,http://127.0.0.1:3000`; `*` is rejected by config validation). A missing Origin is rejected. This stops other websites from using a visitor's browser to talk to the gateway; it is not authentication, since non-browser clients can send any Origin.
- **Limits.** 8 KiB per message, 3,200 bytes of audio per frame, 100 messages per second, 20 invalid messages, 30 s to start, `VOICE_MAX_SESSIONS` (default 10) concurrent connections, 5 tool calls per turn, 3 resumption attempts, 15 s Gemini setup timeout, 10 s per internal API call.
- **Internal endpoints** need the shared token and are not part of `/api/v1`. The API listens on `127.0.0.1` by default.
- **Logs** are JSON lines with an allowlist of fields: session id (a random UUID, never used for authorization), language, state, event, tool name, duration, error codes and close codes. There is no field for audio, transcripts, tool arguments or results, keys, tokens or `DATABASE_URL`, and tests check that audio and transcript text never reach the logs.

## 19. Browser/API key separation

`GEMINI_API_KEY` exists only in the gateway's (and the API's) process environment. The browser never receives it: the web page reads only `NEXT_PUBLIC_VOICE_GATEWAY_URL` (a public WebSocket URL), the gateway connects to Gemini with its own key, and no protocol message carries it. The SDK puts the key in its WebSocket URL, so SDK error messages are never forwarded or logged; a test feeds an error containing a fake key through the adapter and checks that neither the browser messages nor the logs contain it. A web test also checks that browser code reads only `NEXT_PUBLIC_*` variables and never references the key or the internal token. The same applies to `INTERNAL_API_TOKEN`, which only the API and the gateway know.

Ephemeral tokens (letting the browser talk to Gemini directly) were not used: the gateway must stay in the middle to run FinVoice tools and enforce the rules.

## 20. No recording

Microphone audio and Gemini audio are never stored: frames are forwarded as they arrive, and speech chunks are played and discarded. Transcripts are shown on the page only. No database tables, migrations or files were added for conversations; stopping or leaving the page releases the microphone (the browser's recording indicator turns off), the AudioContext, the playback queue and the socket.

## 21. Limitations

- **Speech delivery pace (measured, Step 7 diagnostic pass).** The gateway measures Gemini's delivery before the browser is involved (stage A). With text input it was 2.2–4.9× real time. With browser microphone input in the final 7-scenario Chrome run it was 1.8–4.4×. The browser received exactly the gateway's pace (receive factors equal to two decimals, 0 bytes of gateway socket backlog). The synthetic signal showed the transport adds no delay (9,807 ms sent vs 9,781 ms received at 1.0×) and that playback has 0 underruns whenever delivery keeps up with real time, but underruns at 0.8× (5 in 10 s). An earlier pass measured slower-than-real-time sessions at the gateway (down to about 0.3×). They were not reproduced in this pass, so their cause is not established; when they happen they are visible at stage A, before the browser.
- **Barge-in latency (measured, reliability pass).** The local detector clears playback 0.2–0.3 ms after it detects the user's speech, which happens 160 ms into the speech. Gemini's own `interrupted` event followed 0.45–1.1 s after local detection while Gemini was healthy, and up to about 30 s during a slow period, which is why the local stop matters. The detector fires once, at the start of an utterance: if FinVoice's speech only starts while the user is already talking, it plays until Gemini interrupts it. In one headless Chrome run, the browser's echo cancellation attenuated the barge-in speech by about 50–60 dB while FinVoice was playing, so neither the local detector nor Gemini heard it. Other runs with the same setup were not affected. Behaviour on real devices, and false local triggers from echo on speakers without echo cancellation, need a real-device test.
- **Stalls and no-response turns (upstream).** With text input and no browser, Gemini once made no progress for about 71 s after receiving a tool result, and once a Tamil question got no response at all for 70 s. Both kinds are now detected: mid-answer stalls (`no_progress`, observed once in a real browser run: 1.75 s of speech, then nothing) and unanswered turns (`no_response`, which could not be reproduced on demand and is covered by tests with a simulated provider). When the resumed connection could not be opened during a Gemini slowdown, the earlier recovery ended the session; recovery now keeps the current connection in that case.
- **Provider slow periods.** During this pass, some sessions took 3–10 s to set up, one setup was refused (close 1006), and some answers arrived at 0.25–0.5× real time (measured at the gateway), with playback underruns up to 5 s. The same questions minutes later ran at 3–4.6×.
- Development only: no authentication, per-user quotas or abuse protection beyond the limits above.
- The Origin check is not an authentication mechanism.
- One session per WebSocket; nothing survives a page reload (no conversation history).
- If Gemini hangs during setup without closing, the SDK keeps its socket until Gemini closes it; the gateway reports a timeout and closes the session if it completes later.
- Transcription quality for Sinhala and Tamil depends on Gemini; no language hints are sent.
- Recovery from Gemini disconnects depends on a resumption handle; without one, the user has to press Start again.
- `NEXT_PUBLIC_VOICE_GATEWAY_URL` is read by Next.js from `apps/web/.env.local` or the environment (not the root `.env`); the default works for local development.

## 22. Future telephone/Asterisk path

The telephone path in [system-overview.md](system-overview.md) (SIP → Asterisk → AudioSocket → voice gateway) will reuse everything behind the WebSocket edge: `VoiceSession`'s Live bridging, tool execution through the API, resumption and limits, the Live system instruction and the `LiveConnector` abstraction. Only the edge changes: an AudioSocket server instead of the browser WebSocket, and audio conversion from telephony formats (for example 8 kHz μ-law or 16 kHz linear PCM from Asterisk) to 16 kHz PCM for Gemini and from 24 kHz back to the call's rate, done in the gateway because a phone has no browser to do it.

## Running it locally

1. In the root `.env`, set `GEMINI_API_KEY` and an `INTERNAL_API_TOKEN` of at least 32 characters (the same value is read by the API and the gateway).
2. Start PostgreSQL and apply migrations and the knowledge seed (see the README).
3. Start the API (`pnpm dev:api`), the gateway (`pnpm dev:voice-gateway`) and the web app (`pnpm dev:web`), or all three with `pnpm dev`.
4. Open http://localhost:3000/voice, choose a language, press **Start voice**, allow the microphone and speak. Press **Stop** to end.
