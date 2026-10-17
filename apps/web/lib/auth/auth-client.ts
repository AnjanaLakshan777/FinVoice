import type {
  ApiErrorDetail,
  ApiErrorResponse,
  AuthMeResponse,
  AuthTokenResponse,
  AuthUser,
  StartGuestSessionRequest,
} from "@finvoice/contracts";

/**
 * The browser's single authentication client: every call to the FinVoice API from the web app
 * goes through it. See docs/architecture/web-authentication.md.
 *
 * - **Access token in memory only.** It lives in a private field of this object: never in
 *   localStorage, sessionStorage, IndexedDB, a cookie or a URL, and it is never logged. A page
 *   reload loses it, and `restoreSession()` gets a new one.
 * - **Refresh token never visible.** It is the API's HttpOnly cookie on the web origin (requests go
 *   to the same-origin proxy at /api/v1). The browser attaches it to /api/v1/auth/refresh by
 *   itself; this code cannot read it and never tries to.
 * - **One refresh at a time.** Concurrent 401s share a single in-flight refresh, and a Web Lock
 *   (where available) also serialises refreshes across tabs, so the rotating refresh token is
 *   never presented twice at once (the API treats that as token theft).
 */

export const API_BASE_PATH = "/api/v1";
const REFRESH_LOCK = "finvoice-auth-refresh";

/** A controlled API error: the API's error body, or a network failure (status 0). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: readonly ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The session could not be renewed: the user must sign in again. */
export class SessionExpiredError extends Error {
  constructor() {
    super("The session has ended");
    this.name = "SessionExpiredError";
  }
}

/** Why the signed-in session ended: the user logged out, or it could not be renewed. */
export type SessionEndReason = "logout" | "expired";

type LockRunner = <T>(name: string, task: () => Promise<T>) => Promise<T>;

export type AuthClientOptions = {
  fetch?: typeof fetch;
  basePath?: string;
  /** Cross-tab serialisation of refreshes; defaults to the Web Locks API when present. */
  withLock?: LockRunner | null;
};

function defaultLock(): LockRunner | null {
  if (typeof navigator === "undefined" || !("locks" in navigator)) {
    return null;
  }
  const { locks } = navigator;
  return (name, task) => locks.request(name, task);
}

export class AuthClient {
  #accessToken: string | null = null;
  #refreshing: Promise<boolean> | null = null;
  readonly #listeners = new Set<(reason: SessionEndReason) => void>();
  readonly #fetch: typeof fetch;
  readonly #basePath: string;
  readonly #withLock: LockRunner | null;

  constructor(options: AuthClientOptions = {}) {
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#basePath = options.basePath ?? API_BASE_PATH;
    this.#withLock = options.withLock === undefined ? defaultLock() : options.withLock;
  }

  /** Whether an access token is currently held (in memory). */
  get hasAccessToken(): boolean {
    return this.#accessToken !== null;
  }

  /** Called when the session ends (logout, or a refresh that failed). Returns an unsubscribe. */
  onSessionEnd(listener: (reason: SessionEndReason) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Starts a guest session: the API creates a new account from the preferred language (and an
   * optional name) and sets the refresh cookie; the access token stays in memory. No phone number,
   * code or password.
   */
  async startGuestSession(input: StartGuestSessionRequest): Promise<AuthUser> {
    const response = await this.#send<AuthTokenResponse>("POST", "/auth/guest", { body: input });
    this.#accessToken = response.accessToken;
    return response.user;
  }

  /**
   * Gets a new access token with the refresh cookie. Resolves false when there is no valid session
   * (not an error); rejects only when the API cannot be reached. Concurrent calls share one
   * request.
   */
  refresh(): Promise<boolean> {
    this.#refreshing ??= this.#refreshOnce().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  /**
   * On application start (or reload): renews the session from the refresh cookie and loads the
   * signed-in user. Null when there is no session.
   */
  async restoreSession(): Promise<AuthMeResponse | null> {
    if (!(await this.refresh())) {
      return null;
    }
    return this.request<AuthMeResponse>("GET", "/auth/me");
  }

  /**
   * An authenticated API call. On 401 it refreshes once (shared with any concurrent caller) and
   * retries once; if the session cannot be renewed it ends the session and throws
   * SessionExpiredError. Other failures throw ApiError.
   */
  request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.#authorized<T>(method, path, body, true);
  }

  /**
   * Logs out: the API deletes the guest account with all of its data and clears the cookie. The
   * in-memory token is dropped even if the API cannot be reached (the account is then deleted later
   * by the server's cleanup, because nobody can sign in to it any more). JavaScript never touches
   * the cookie.
   */
  async logout(): Promise<void> {
    try {
      if (this.#accessToken !== null) {
        await this.#authorized<undefined>("POST", "/auth/logout", undefined, false);
      }
    } catch {
      // Signing out locally must always succeed.
    } finally {
      this.#accessToken = null;
      this.#notify("logout");
    }
  }

  async #authorized<T>(
    method: string,
    path: string,
    body: unknown,
    endSessionOnFailure: boolean,
  ): Promise<T> {
    const expire = (): never => {
      this.#accessToken = null;
      if (endSessionOnFailure) {
        this.#notify("expired");
      }
      throw new SessionExpiredError();
    };

    if (this.#accessToken === null && !(await this.refresh())) {
      return expire();
    }
    const tokenUsed = this.#accessToken;
    let response = await this.#call(method, path, body, tokenUsed);
    if (response.status === 401) {
      await response.body?.cancel();
      // Another request may already have refreshed while this one was in flight.
      const renewed =
        this.#accessToken !== null && this.#accessToken !== tokenUsed ? true : await this.refresh();
      if (!renewed) {
        return expire();
      }
      response = await this.#call(method, path, body, this.#accessToken);
      if (response.status === 401) {
        await response.body?.cancel();
        return expire();
      }
    }
    return parse<T>(response);
  }

  async #refreshOnce(): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      // keepalive: if the page is reloaded or closed while this request is in flight, the browser
      // still completes it and stores the rotated refresh cookie from the response. Without it an
      // aborted refresh could leave the browser with the previous (already rotated) cookie, which
      // the API would treat as token reuse and revoke the whole sign-in.
      const response = await this.#call("POST", "/auth/refresh", undefined, null, {
        keepalive: true,
      });
      if (response.ok) {
        const tokens = (await response.json()) as AuthTokenResponse;
        this.#accessToken = tokens.accessToken;
        return true;
      }
      if (response.status === 401) {
        await response.body?.cancel();
        this.#accessToken = null;
        return false;
      }
      return parse<never>(response);
    };
    return this.#withLock === null ? run() : this.#withLock(REFRESH_LOCK, run);
  }

  #send<T>(method: string, path: string, options: { body?: unknown } = {}): Promise<T> {
    return this.#call(method, path, options.body, null).then((response) => parse<T>(response));
  }

  async #call(
    method: string,
    path: string,
    body: unknown,
    accessToken: string | null,
    extra: Pick<RequestInit, "keepalive"> = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (accessToken !== null) {
      headers.authorization = `Bearer ${accessToken}`;
    }
    try {
      return await this.#fetch(`${this.#basePath}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // Same-origin only: the refresh cookie is never sent anywhere else.
        credentials: "same-origin",
        cache: "no-store",
        ...extra,
      });
    } catch {
      throw new ApiError(0, "NETWORK_ERROR", "The FinVoice service could not be reached");
    }
  }

  #notify(reason: SessionEndReason): void {
    for (const listener of this.#listeners) {
      listener(reason);
    }
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = text === "" ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (response.ok) {
    return body as T;
  }
  const error = body as Partial<ApiErrorResponse> | undefined;
  throw new ApiError(
    response.status,
    typeof error?.code === "string" ? error.code : "UNKNOWN_ERROR",
    typeof error?.message === "string" ? error.message : "Request failed",
    Array.isArray(error?.details) ? error.details : [],
  );
}
