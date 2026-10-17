"use client";

import type { AuthMeResponse } from "@finvoice/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { MESSAGES } from "../account/messages";
import { AuthClient } from "./auth-client";

/**
 * The web app's authentication state. It holds only what pages need to render: the signed-in
 * user's minimal identity from /api/v1/auth/me (id, language, time zone, role, status). No token,
 * cookie or secret is ever put in React state.
 */
export type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated"; notice: string | null }
  | { status: "authenticated"; user: AuthMeResponse };

export type AuthContextValue = {
  state: AuthState;
  /** The shared API client: authenticated calls go through `client.request`. */
  client: AuthClient;
  /** After a guest session was started: loads the signed-in user. */
  completeSignIn: () => Promise<AuthMeResponse>;
  /** Reloads the signed-in user (for example after the language changed). */
  refreshUser: () => Promise<void>;
  /** Logs out through the API (which deletes the guest account) and clears the session. */
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** One client per browser tab (module scope): the access token lives only in its memory. */
let browserClient: AuthClient | undefined;
function sharedClient(): AuthClient {
  browserClient ??= new AuthClient();
  return browserClient;
}

export function AuthProvider({
  children,
  client: providedClient,
}: {
  children: ReactNode;
  /** For tests. */
  client?: AuthClient;
}) {
  const client = providedClient ?? sharedClient();
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const stop = client.onSessionEnd((reason) => {
      if (active) {
        setState({
          status: "unauthenticated",
          notice: reason === "expired" ? MESSAGES.sessionExpired : null,
        });
      }
    });
    // On start (and after every reload): the in-memory token is gone, so renew the session from
    // the HttpOnly refresh cookie. No session is a normal state, not an error.
    client
      .restoreSession()
      .then((user) => {
        if (active) {
          setState(
            user === null
              ? { status: "unauthenticated", notice: null }
              : { status: "authenticated", user },
          );
        }
      })
      .catch(() => {
        if (active) {
          setState((current) =>
            current.status === "loading"
              ? { status: "unauthenticated", notice: MESSAGES.unavailable }
              : current,
          );
        }
      });
    return () => {
      active = false;
      stop();
    };
  }, [client]);

  const completeSignIn = useCallback(async () => {
    const user = await client.request<AuthMeResponse>("GET", "/auth/me");
    setState({ status: "authenticated", user });
    return user;
  }, [client]);

  const refreshUser = useCallback(async () => {
    const user = await client.request<AuthMeResponse>("GET", "/auth/me");
    setState({ status: "authenticated", user });
  }, [client]);

  const signOut = useCallback(async () => {
    await client.logout();
    setState({ status: "unauthenticated", notice: null });
  }, [client]);

  const value = useMemo(
    () => ({ state, client, completeSignIn, refreshUser, signOut }),
    [state, client, completeSignIn, refreshUser, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return value;
}

/** For tests: forget the tab's shared client. */
export function resetSharedAuthClientForTests(): void {
  browserClient = undefined;
}
