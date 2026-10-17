import { randomUUID } from "node:crypto";

import type { ApiConfig, AuthConfig } from "@finvoice/config";
import type { AuthTokenResponse, StartGuestSessionRequest, UserRole } from "@finvoice/contracts";
import type { LoggerService } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { inject } from "vitest";

import { LANGUAGE_MODEL, type LanguageModel } from "../../src/ai/model/language-model.js";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/app.setup.js";
import { AccessTokenService } from "../../src/auth/access-token.service.js";
import { API_CONFIG } from "../../src/config/api-config.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { testAuthConfig } from "../support/auth.js";

export type ApiResponse<T = unknown> = { status: number; body: T; text: string; headers: Headers };

/** A completed guest sign-in. */
export type SignedIn = {
  accessToken: string;
  /** `finvoice_refresh=<token>`, ready for a Cookie header. */
  refreshCookie: string;
  body: AuthTokenResponse;
};

export type TestApi = {
  /** The application's own PrismaService, for arranging data and checking persistence. */
  prisma: PrismaService;
  /** Resolves a provider of the running application (for spying on services). */
  get<T>(token: abstract new (...args: never[]) => T): T;
  request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<ApiResponse<T>>;
  /** Sends `body` exactly as given (no JSON encoding), e.g. an HTML form submission. */
  requestRaw(
    method: string,
    path: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<ApiResponse>;
  close(): Promise<void>;
  /** The authentication settings the application runs with (ephemeral test secrets). */
  auth: AuthConfig;
  /**
   * `Authorization: Bearer` header with a validly signed access token for `userId`, as if the
   * user had signed in (the guard does not look the session up).
   */
  authHeaders(userId: string, role?: UserRole): Promise<Record<string, string>>;
  /** A guest sign-in through the HTTP API (a new account each time; default language EN). */
  signIn(request?: Partial<StartGuestSessionRequest>): Promise<SignedIn>;
};

export type TestApiOptions = {
  databaseUrl?: string;
  /** Replaces the Gemini-backed model, so tests never call Google. */
  languageModel?: LanguageModel;
  /** Gemini settings; by default no key is configured. */
  gemini?: ApiConfig["gemini"];
  /** Shared token for the internal voice endpoints; by default none (they answer 503). */
  internalToken?: string;
  /** Receives everything the application logs; by default logging is off. */
  logger?: LoggerService;
  /** Authentication settings; by default enabled with a fresh random secret. */
  auth?: AuthConfig;
};

/**
 * Boots the real application (all modules, production HTTP configuration) against the disposable
 * test database and talks to it over HTTP.
 */
export async function startTestApi(options: TestApiOptions | string = {}): Promise<TestApi> {
  const {
    databaseUrl = inject("databaseUrl"),
    languageModel,
    gemini,
    internalToken,
    logger,
    auth = testAuthConfig(),
  } = typeof options === "string" ? { databaseUrl: options } : options;
  const config: ApiConfig = {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    database: { url: databaseUrl },
    gemini: gemini ?? { apiKey: null, model: "gemini-test-model" },
    internal: { token: internalToken ?? null },
    analytics: { retentionDays: 90 },
    auth,
  };
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_CONFIG)
    .useValue(config);
  if (languageModel) {
    builder = builder.overrideProvider(LANGUAGE_MODEL).useValue(languageModel);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: logger ?? false });
  await configureApp(app);
  await app.listen(0, "127.0.0.1");
  const baseUrl = await app.getUrl();

  const api: TestApi = {
    prisma: app.get(PrismaService),
    get: (token) => app.get(token),
    auth,
    async authHeaders(userId, role = "USER") {
      const token = await app
        .get(AccessTokenService)
        .issue({ userId, role, sessionId: randomUUID() });
      return { authorization: `Bearer ${token}` };
    },
    async signIn(request = {}) {
      const verified = await api.request<AuthTokenResponse>("POST", "/api/v1/auth/guest", {
        preferredLanguage: "EN",
        ...request,
      });
      if (verified.status !== 201) {
        throw new Error(`guest sign-in answered ${String(verified.status)}`);
      }
      return {
        accessToken: verified.body.accessToken,
        refreshCookie: refreshCookieOf(verified.headers, auth.refreshCookie.name),
        body: verified.body,
      };
    },
    async request<T>(
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ): Promise<ApiResponse<T>> {
      const response = await fetch(new URL(path, baseUrl), {
        method,
        ...(body === undefined
          ? { headers }
          : {
              headers: { "content-type": "application/json", ...headers },
              body: JSON.stringify(body),
            }),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: (text ? JSON.parse(text) : undefined) as T,
        text,
        headers: response.headers,
      };
    },
    async requestRaw(method, path, body, headers) {
      const response = await fetch(new URL(path, baseUrl), { method, headers, body });
      const text = await response.text();
      return {
        status: response.status,
        body: (text ? JSON.parse(text) : undefined) as unknown,
        text,
        headers: response.headers,
      };
    },
    close: () => app.close(),
  };
  return api;
}

/** `name=value` of the refresh cookie set by a response (throws if there is none). */
export function refreshCookieOf(headers: Headers, name: string): string {
  const cookie = headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  const pair = cookie?.split(";")[0];
  if (pair === undefined || pair === `${name}=`) {
    throw new Error("No refresh cookie in the response");
  }
  return pair;
}
