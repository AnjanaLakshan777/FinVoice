import { vi } from "vitest";

/** A fake browser WebSocket: records sent messages and lets tests act as the gateway. */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  closeCalls: { code?: number; reason?: string }[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  static get latest(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) {
      throw new Error("No WebSocket was opened");
    }
    return socket;
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({
      ...(code === undefined ? {} : { code }),
      ...(reason ? { reason } : {}),
    });
    this.readyState = FakeWebSocket.CLOSED;
  }

  /** Test helpers acting as the gateway. */
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  dropConnection(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }

  sentMessages(): { type: string; [key: string]: unknown }[] {
    return this.sent.map((text) => JSON.parse(text) as { type: string });
  }
}

export class FakeBufferSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  readonly start = vi.fn();
  readonly stop = vi.fn();
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}

export class FakeAudioWorkletNode {
  static instances: FakeAudioWorkletNode[] = [];
  readonly port = {
    onmessage: null as ((event: { data: ArrayBuffer }) => void) | null,
    close: vi.fn(),
  };
  readonly disconnect = vi.fn();

  constructor(
    readonly context: unknown,
    readonly name: string,
  ) {
    FakeAudioWorkletNode.instances.push(this);
  }

  /** Emits one microphone frame, as the capture worklet would. */
  emitFrame(bytes: number[]): void {
    this.port.onmessage?.({ data: new Uint8Array(bytes).buffer });
  }
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: "running" | "closed" = "running";
  currentTime = 0;
  readonly sampleRate = 48_000;
  readonly destination = {};
  readonly sources: FakeBufferSource[] = [];
  readonly buffers: { channels: number; length: number; sampleRate: number }[] = [];
  readonly audioWorklet = { addModule: vi.fn(() => Promise.resolve()) };
  readonly mediaSource = { connect: vi.fn(), disconnect: vi.fn() };
  readonly close = vi.fn(() => {
    this.state = "closed";
    return Promise.resolve();
  });
  readonly resume = vi.fn(() => Promise.resolve());

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  static get latest(): FakeAudioContext {
    const context = FakeAudioContext.instances.at(-1);
    if (!context) {
      throw new Error("No AudioContext was created");
    }
    return context;
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    this.buffers.push({ channels, length, sampleRate });
    return { duration: length / sampleRate, copyToChannel: vi.fn() };
  }

  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }

  createMediaStreamSource() {
    return this.mediaSource;
  }
}

export type FakeMedia = {
  getUserMedia: ReturnType<typeof vi.fn>;
  track: { stop: ReturnType<typeof vi.fn> };
};

/** Installs the fakes as browser globals. `permission` decides getUserMedia's outcome. */
/** Settings a Chrome microphone track typically reports. */
export const TRACK_SETTINGS = {
  sampleRate: 48_000,
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export function installBrowserFakes(
  permission: "granted" | "denied" | "missing" | "overconstrained" = "granted",
) {
  FakeWebSocket.instances = [];
  FakeAudioContext.instances = [];
  FakeAudioWorkletNode.instances = [];
  const track = { stop: vi.fn(), getSettings: () => TRACK_SETTINGS };
  let calls = 0;
  const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<unknown>>(() => {
    calls++;
    if (permission === "denied") {
      return Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    }
    if (permission === "missing") {
      return Promise.reject(new DOMException("Requested device not found", "NotFoundError"));
    }
    if (permission === "overconstrained" && calls === 1) {
      return Promise.reject(new DOMException("Cannot satisfy constraints", "OverconstrainedError"));
    }
    return Promise.resolve({ getTracks: () => [track], getAudioTracks: () => [track] });
  });
  const getSupportedConstraints = vi.fn(() => ({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: true,
    sampleRate: true,
  }));
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, getSupportedConstraints },
  });
  return { getUserMedia, track } satisfies FakeMedia;
}
