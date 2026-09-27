import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VoicePage from "../app/voice/page";
import { VoiceConsole } from "../app/voice/voice-console";
import { DEFAULT_VOICE_GATEWAY_URL } from "../lib/voice/config";
import { MICROPHONE_MESSAGES, STALL_NOTICE } from "../lib/voice/voice-client";
import {
  FakeAudioContext,
  FakeAudioWorkletNode,
  FakeWebSocket,
  installBrowserFakes,
  type FakeMedia,
} from "./support/browser-fakes";

const URL = "ws://gateway.test/voice";

let media: FakeMedia;

beforeEach(() => {
  media = installBrowserFakes();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function renderConsole() {
  return render(<VoiceConsole gatewayUrl={URL} />);
}

/** Clicks Start and waits until the socket exists (microphone granted). */
async function startVoice(): Promise<FakeWebSocket> {
  fireEvent.click(screen.getByRole("button", { name: "Start voice" }));
  await waitFor(() => {
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
  return FakeWebSocket.latest;
}

/** Starts and completes the session handshake. */
async function startSession(): Promise<FakeWebSocket> {
  const socket = await startVoice();
  act(() => {
    socket.open();
    socket.receive({ type: "session_started", language: "SI" });
  });
  return socket;
}

describe("/voice page", () => {
  it("renders the voice controls", () => {
    render(<VoicePage />);

    expect(screen.getByRole("heading", { name: "Talk to FinVoice" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Language" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start voice" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("connection-state").textContent).toBe("Not connected");
    expect(screen.getByTestId("microphone-state").textContent).toBe("Off");
  });

  it("offers Sinhala, Tamil and English and starts the session in the chosen language", async () => {
    renderConsole();
    const select = screen.getByRole<HTMLSelectElement>("combobox", { name: "Language" });
    expect([...select.options].map((option) => option.value)).toEqual(["SI", "TA", "EN"]);

    fireEvent.change(select, { target: { value: "TA" } });
    const socket = await startVoice();
    act(() => {
      socket.open();
    });

    expect(socket.sentMessages()[0]).toEqual({ type: "start_session", language: "TA" });
    expect(select.disabled).toBe(true);
  });

  it("asks for the microphone, then opens the session on the gateway", async () => {
    renderConsole();

    const socket = await startVoice();

    expect(media.getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
        channelCount: { ideal: 1 },
      },
    });
    expect(FakeAudioContext.latest.audioWorklet.addModule).toHaveBeenCalledWith(
      "/voice/pcm-capture-worklet.js",
    );
    expect(socket.url).toBe(URL);
    expect(screen.getByTestId("microphone-state").textContent).toBe("On");

    act(() => {
      socket.open();
      socket.receive({ type: "session_started", language: "SI" });
    });
    expect(screen.getByTestId("connection-state").textContent).toBe("Connected, listening");
  });

  it("sends microphone frames only after session_started, as base64 PCM", async () => {
    renderConsole();
    const socket = await startVoice();
    const worklet = FakeAudioWorkletNode.instances[0];
    act(() => {
      socket.open();
      worklet?.emitFrame([1, 0, 255, 255]);
    });
    expect(socket.sentMessages().map((message) => message.type)).toEqual(["start_session"]);

    act(() => {
      socket.receive({ type: "session_started", language: "SI" });
      worklet?.emitFrame([1, 0, 255, 255]);
    });

    expect(socket.sentMessages()[1]).toEqual({ type: "audio", data: "AQD//w==" });
  });

  it("Stop ends the session and releases microphone, audio and connection", async () => {
    renderConsole();
    const socket = await startSession();
    const context = FakeAudioContext.latest;
    const worklet = FakeAudioWorkletNode.instances[0];

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(socket.sentMessages().at(-1)).toEqual({ type: "stop_session" });
    expect(socket.closeCalls).toHaveLength(1);
    expect(media.track.stop).toHaveBeenCalled();
    expect(worklet?.port.close).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
    expect(screen.getByTestId("connection-state").textContent).toBe("Session ended");
    expect(screen.getByTestId("microphone-state").textContent).toBe("Off");
    expect(screen.getByRole("button", { name: "Start voice" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("renders the transcripts and the latest utterances", async () => {
    renderConsole();
    const socket = await startSession();

    act(() => {
      socket.receive({ type: "input_transcript", text: "What is an " });
      socket.receive({ type: "input_transcript", text: "emergency fund?" });
      socket.receive({ type: "tool_status", name: "search_knowledge" });
    });
    expect(screen.getByRole("status").textContent).toBe("Looking up verified information…");

    act(() => {
      socket.receive({ type: "output_transcript", text: "An emergency fund is money " });
      socket.receive({ type: "output_transcript", text: "kept aside." });
      socket.receive({ type: "turn_complete" });
    });

    expect(screen.getByTestId("latest-user").textContent).toBe("What is an emergency fund?");
    expect(screen.getByTestId("latest-finvoice").textContent).toBe(
      "An emergency fund is money kept aside.",
    );
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      "YouWhat is an emergency fund?",
      "FinVoiceAn emergency fund is money kept aside.",
    ]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows gateway errors", async () => {
    renderConsole();
    const socket = await startSession();

    act(() => {
      socket.receive({
        type: "error",
        code: "VOICE_PROVIDER_UNAVAILABLE",
        message: "The voice service is unavailable right now. Please try again later.",
      });
      socket.receive({ type: "session_closed" });
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "The voice service is unavailable right now. Please try again later.",
    );
    expect(screen.getByTestId("connection-state").textContent).toBe("Error");
    expect(media.track.stop).toHaveBeenCalled();
  });

  it("shows a clear message when microphone permission is denied, without retrying", async () => {
    media = installBrowserFakes("denied");
    renderConsole();

    fireEvent.click(screen.getByRole("button", { name: "Start voice" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(MICROPHONE_MESSAGES.denied);
    });
    expect(screen.getByTestId("microphone-state").textContent).toBe("Permission denied");
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(FakeAudioContext.latest.close).toHaveBeenCalled();
  });

  it("falls back to plain audio once when the browser cannot apply the speech settings", async () => {
    media = installBrowserFakes("overconstrained");
    renderConsole();

    await startVoice();

    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
    expect(media.getUserMedia).toHaveBeenLastCalledWith({ audio: true });
    expect(screen.getByTestId("microphone-state").textContent).toBe("On");
  });

  it("shows audio pipeline diagnostics in development, without audio", async () => {
    render(<VoiceConsole gatewayUrl={URL} showDiagnostics />);
    const socket = await startSession();
    act(() => {
      FakeAudioWorkletNode.instances[0]?.emitFrame([1, 0, 255, 255]);
      socket.receive({ type: "input_transcript", text: "ණය", languageCode: "si-LK" });
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    const value = (name: string) => screen.getByTestId(`diagnostic-${name}`).textContent;
    expect(value("Input sample rate (AudioContext)")).toBe("48000 Hz");
    expect(value("Microphone track sample rate")).toBe("48000 Hz");
    expect(value("Microphone channels")).toBe("1");
    expect(value("Output to gateway")).toBe("16000 Hz, mono, 16-bit PCM");
    expect(value("Chunk size")).toBe("640 samples, 1280 bytes (40 ms)");
    expect(value("Chunks sent")).toBe("1");
    expect(value("Bytes sent")).toBe("4");
    expect(value("Detected input language")).toBe("si-LK");
    expect(value("Echo cancellation")).toBe("on");
  });

  it("shows a notice instead of waiting forever when an answer stalls, and keeps the session", async () => {
    renderConsole();
    const socket = await startSession();
    act(() => {
      socket.receive({ type: "output_transcript", text: "Your regular" });
      socket.receive({ type: "turn_stalled" });
    });

    expect(screen.getByTestId("notice").textContent).toBe(STALL_NOTICE);
    expect(screen.getByTestId("connection-state").textContent).toBe("Connected, listening");
    expect(socket.closeCalls).toHaveLength(0);

    act(() => {
      socket.receive({ type: "input_transcript", text: "Let me ask again" });
    });
    expect(screen.queryByTestId("notice")).toBeNull();
  });

  it("summarizes received audio per answer in development", async () => {
    render(<VoiceConsole gatewayUrl={URL} showDiagnostics />);
    const socket = await startSession();
    act(() => {
      socket.receive({
        type: "audio",
        data: btoa("\0".repeat(4800)),
        mimeType: "audio/pcm;rate=24000",
      });
      socket.receive({ type: "turn_complete" });
    });

    expect(screen.getByTestId("audio-line").textContent).toMatch(
      /^Audio: received 0\.1s \/ 0\.0s wall time · delivery — · queue \d+ms · underruns 0$/,
    );
    expect(screen.getByTestId("diagnostic-Last answer").textContent).toMatch(
      /^complete: 100 ms audio/,
    );
  });

  it("runs the playback test on the synthetic signal without the microphone", () => {
    render(<VoiceConsole gatewayUrl={URL} showDiagnostics />);
    fireEvent.change(screen.getByRole("combobox", { name: "Synthetic signal pace" }), {
      target: { value: "0.8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test playback path" }));

    const socket = FakeWebSocket.latest;
    expect(socket.url).toBe("ws://gateway.test/voice/test-signal?pace=0.8&seconds=10&chunkMs=200");
    expect(media.getUserMedia).not.toHaveBeenCalled();
    act(() => {
      socket.open();
      socket.receive({ type: "audio", data: "AAAAAAAA", mimeType: "audio/pcm;rate=24000" });
    });
    expect(socket.sentMessages().filter((m) => m.type !== "ping")).toEqual([]);
    expect(FakeAudioContext.latest.sources).toHaveLength(1);
    expect(screen.getByTestId("diagnostic-Mode").textContent).toBe("playback-test");
  });

  it("hides the diagnostics unless enabled", () => {
    renderConsole();
    expect(screen.queryByTestId("diagnostics")).toBeNull();
  });

  it("reports a lost connection", async () => {
    renderConsole();
    const socket = await startSession();

    act(() => {
      socket.dropConnection();
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "The connection to the voice service was lost.",
    );
    expect(media.track.stop).toHaveBeenCalled();
  });

  it("plays speech and clears queued playback immediately on interruption", async () => {
    renderConsole();
    const socket = await startSession();
    const context = FakeAudioContext.latest;

    act(() => {
      socket.receive({ type: "audio", data: "AAAAAAAA", mimeType: "audio/pcm;rate=24000" });
      socket.receive({ type: "audio", data: "AAAAAAAA", mimeType: "audio/pcm;rate=24000" });
    });
    expect(context.buffers).toEqual([
      { channels: 1, length: 3, sampleRate: 24_000 },
      { channels: 1, length: 3, sampleRate: 24_000 },
    ]);
    const [first, second] = context.sources;
    expect(first?.start).toHaveBeenCalled();
    const firstStart = first?.start.mock.calls[0]?.[0] as number;
    expect(second?.start).toHaveBeenCalledWith(firstStart + 3 / 24_000);

    act(() => {
      socket.receive({ type: "interrupted" });
    });

    expect(first?.stop).toHaveBeenCalled();
    expect(second?.stop).toHaveBeenCalled();
  });

  it("stops the session when the page is left", async () => {
    const { unmount } = renderConsole();
    const socket = await startSession();

    unmount();

    expect(socket.sentMessages().at(-1)).toEqual({ type: "stop_session" });
    expect(media.track.stop).toHaveBeenCalled();
  });
});

describe("local barge-in", () => {
  /** 40 ms of loud 16 kHz PCM (about -10 dBFS), as bytes. */
  function loudFrame(): number[] {
    const view = new DataView(new ArrayBuffer(1280));
    for (let i = 0; i < 640; i++) {
      view.setInt16(i * 2, i % 2 === 0 ? 9830 : -9830, true);
    }
    return [...new Uint8Array(view.buffer)];
  }
  const QUIET_FRAME = Array.from({ length: 1280 }, () => 0);

  function mic(frames: number[][]) {
    act(() => {
      for (const frame of frames) {
        FakeAudioWorkletNode.instances[0]?.emitFrame(frame);
      }
    });
  }
  const speech = (count: number) => Array.from({ length: count }, loudFrame);
  const quiet = (count: number) => Array.from({ length: count }, () => QUIET_FRAME);
  const value = (name: string) => screen.getByTestId(`diagnostic-${name}`).textContent;
  const AUDIO = { type: "audio", data: "AAAAAAAA", mimeType: "audio/pcm;rate=24000" };

  async function playing() {
    render(<VoiceConsole gatewayUrl={URL} showDiagnostics />);
    const socket = await startSession();
    act(() => {
      socket.receive(AUDIO);
      socket.receive(AUDIO);
    });
    return socket;
  }

  it("stops playback the moment the user speaks over FinVoice, and keeps streaming the microphone", async () => {
    const socket = await playing();
    const [first, second] = FakeAudioContext.latest.sources;

    mic(speech(5));

    expect(first?.stop).toHaveBeenCalled();
    expect(second?.stop).toHaveBeenCalled();
    expect(socket.closeCalls).toEqual([]);
    expect(socket.sentMessages().filter((m) => m.type === "audio")).toHaveLength(5);
    expect(value("Local barge-ins (playback stopped)")).toBe("1");
    expect(value("Local barge-in → playback cleared")).toMatch(/^[\d.]+ ms$/);
    expect(screen.getByTestId("connection-state").textContent).toBe("Connected, listening");
  });

  it("drops the rest of the talked-over answer until Gemini confirms, then plays the new answer", async () => {
    const socket = await playing();
    mic(speech(5));
    const context = FakeAudioContext.latest;

    act(() => {
      socket.receive(AUDIO); // still the old answer
      socket.receive({ type: "output_transcript", text: " more old words" });
    });
    expect(context.sources).toHaveLength(2);

    act(() => {
      socket.receive({ type: "interrupted" });
      socket.receive(AUDIO); // the new answer
    });
    expect(context.sources).toHaveLength(3);
    expect(context.sources[2]?.start).toHaveBeenCalled();
    expect(value("Gemini interruptions")).toBe("1");
    expect(value("Speech detected → Gemini interrupted")).toMatch(/^\d+ ms$/);
    expect(screen.queryByText(/more old words/)).toBeNull();
  });

  it.each([
    ["a click", [loudFrame(), ...quiet(20)]],
    [
      "two quick taps",
      [loudFrame(), QUIET_FRAME, QUIET_FRAME, QUIET_FRAME, loudFrame(), ...quiet(10)],
    ],
    ["silence", quiet(30)],
  ])("does not stop playback for %s", async (_case, frames) => {
    await playing();
    mic(frames);

    expect(FakeAudioContext.latest.sources.every((s) => s.stop.mock.calls.length === 0)).toBe(true);
    expect(value("Local barge-ins (playback stopped)")).toBe("0");
  });

  it("does nothing to playback when FinVoice is not speaking", async () => {
    render(<VoiceConsole gatewayUrl={URL} showDiagnostics />);
    await startSession();
    mic(speech(5));

    expect(value("Local barge-ins (playback stopped)")).toBe("0");
  });

  it("handles repeated interruptions safely and the session stays usable", async () => {
    const socket = await playing();
    for (let round = 0; round < 2; round++) {
      mic([...speech(5), ...quiet(12)]);
      act(() => {
        socket.receive({ type: "interrupted" });
        socket.receive({ type: "interrupted" }); // a duplicate is harmless
        socket.receive(AUDIO);
      });
      await new Promise((resolve) => setTimeout(resolve, 750)); // detector cooldown
    }

    expect(value("Local barge-ins (playback stopped)")).toBe("2");
    expect(value("Gemini interruptions")).toBe("4");
    expect(socket.closeCalls).toEqual([]);
    expect(screen.getByTestId("connection-state").textContent).toBe("Connected, listening");
    const sources = FakeAudioContext.latest.sources;
    expect(sources.at(-1)?.start).toHaveBeenCalled();
    expect(sources.at(-1)?.stop).not.toHaveBeenCalled();
  });

  it("shows why an answer was ended", async () => {
    render(<VoiceConsole gatewayUrl={URL} showDiagnostics />);
    const socket = await startSession();
    act(() => {
      socket.receive({ type: "turn_stalled", reason: "no_response" });
    });

    expect(value("Last stall reason")).toBe("no_response");
    expect(screen.getByTestId("notice").textContent).toBe(STALL_NOTICE);
  });
});

describe("secrets stay on the server", () => {
  it("uses only the public gateway URL", () => {
    vi.stubEnv("GEMINI_API_KEY", "fake-key-that-must-not-render");
    vi.stubEnv("NEXT_PUBLIC_VOICE_GATEWAY_URL", "");

    const { container } = render(<VoicePage />);
    fireEvent.click(screen.getByRole("button", { name: "Start voice" }));

    expect(container.innerHTML).not.toContain("fake-key-that-must-not-render");
    return waitFor(() => {
      expect(FakeWebSocket.latest.url).toBe(DEFAULT_VOICE_GATEWAY_URL);
    });
  });

  it("reads only NEXT_PUBLIC_* variables and never the Gemini key or internal token", () => {
    const roots = ["app", "lib", "public"].map((dir) => join(import.meta.dirname, "..", dir));
    const files = roots.flatMap(listFiles);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const variables = [...text.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]);
      expect(
        variables.every((name) => name === "NODE_ENV" || name?.startsWith("NEXT_PUBLIC_")),
        file,
      ).toBe(true);
      expect(text, file).not.toMatch(/GEMINI_API_KEY/);
      // The server-only admin dashboard (Step 10) uses the internal token in server code; its
      // isolation from the browser is tested in admin-page.test.tsx. Nothing else may use it.
      if (!/[\\/](app|lib)[\\/]admin[\\/]/.test(file)) {
        expect(text, file).not.toMatch(/INTERNAL_API_TOKEN|x-finvoice-internal-token/);
      }
    }
  });
});

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}
