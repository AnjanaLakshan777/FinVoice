import type { ApiConfig } from "@finvoice/config";
import type { LoggerService } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { inject } from "vitest";

import { LANGUAGE_MODEL, type LanguageModel } from "../../src/ai/model/language-model.js";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/app.setup.js";
import { API_CONFIG } from "../../src/config/api-config.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";

export type ApiResponse<T = unknown> = { status: number; body: T; text: string };

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
  close(): Promise<void>;
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
  } = typeof options === "string" ? { databaseUrl: options } : options;
  const config: ApiConfig = {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    database: { url: databaseUrl },
    gemini: gemini ?? { apiKey: null, model: "gemini-test-model" },
    internal: { token: internalToken ?? null },
  };
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_CONFIG)
    .useValue(config);
  if (languageModel) {
    builder = builder.overrideProvider(LANGUAGE_MODEL).useValue(languageModel);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: logger ?? false });
  configureApp(app);
  await app.listen(0, "127.0.0.1");
  const baseUrl = await app.getUrl();

  return {
    prisma: app.get(PrismaService),
    get: (token) => app.get(token),
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
      return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T, text };
    },
    close: () => app.close(),
  };
}
