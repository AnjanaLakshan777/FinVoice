import type { VoiceServerMessage, VoiceServerMessageType } from "@finvoice/contracts";
import { WebSocket } from "ws";

export const ALLOWED_ORIGIN = "http://localhost:3000";

type Waiter = {
  type: VoiceServerMessageType;
  resolve: (message: VoiceServerMessage) => void;
  reject: (error: Error) => void;
};

/** A test browser: a ws client that records every server message. */
export class TestVoiceClient {
  readonly messages: VoiceServerMessage[] = [];
  closeCode: number | null = null;
  private readonly waiters: Waiter[] = [];
  private readonly closed: Promise<number>;

  private constructor(readonly socket: WebSocket) {
    socket.on("message", (data: Buffer) => {
      const message = JSON.parse(data.toString("utf8")) as VoiceServerMessage;
      this.messages.push(message);
      const index = this.waiters.findIndex((waiter) => waiter.type === message.type);
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1);
        waiter?.resolve(message);
      }
    });
    this.closed = new Promise((resolve) => {
      socket.on("close", (code: number) => {
        this.closeCode = code;
        for (const waiter of this.waiters.splice(0)) {
          waiter.reject(new Error(`Socket closed (${String(code)}) before ${waiter.type}`));
        }
        resolve(code);
      });
    });
  }

  static open(url: string, origin: string | null = ALLOWED_ORIGIN): Promise<TestVoiceClient> {
    const socket = new WebSocket(url, origin === null ? {} : { origin });
    return new Promise((resolve, reject) => {
      socket.once("open", () => {
        resolve(new TestVoiceClient(socket));
      });
      socket.once("unexpected-response", (_request, response) => {
        reject(new Error(`HTTP ${String(response.statusCode)}`));
      });
      socket.once("error", reject);
    });
  }

  send(message: unknown): void {
    this.socket.send(typeof message === "string" ? message : JSON.stringify(message));
  }

  /** Resolves with the first `type` message already received or arriving next. */
  next<T extends VoiceServerMessageType>(
    type: T,
  ): Promise<Extract<VoiceServerMessage, { type: T }>> {
    const seen = this.messages.find((message) => message.type === type);
    if (seen) {
      return Promise.resolve(seen as Extract<VoiceServerMessage, { type: T }>);
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({
        type,
        resolve: (message) => {
          resolve(message as Extract<VoiceServerMessage, { type: T }>);
        },
        reject,
      });
    });
  }

  ofType<T extends VoiceServerMessageType>(type: T): Extract<VoiceServerMessage, { type: T }>[] {
    return this.messages.filter(
      (message): message is Extract<VoiceServerMessage, { type: T }> => message.type === type,
    );
  }

  async start(language: "EN" | "SI" | "TA" = "EN"): Promise<void> {
    this.send({ type: "start_session", language });
    await this.next("session_started");
  }

  waitForClose(): Promise<number> {
    return this.closed;
  }

  close(): void {
    this.socket.close();
  }
}
