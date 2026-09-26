import type { ApiConfig } from "@finvoice/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { inject } from "vitest";

import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/app.setup.js";
import { API_CONFIG } from "../../src/config/api-config.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";

export type ApiResponse<T = unknown> = { status: number; body: T; text: string };

export type TestApi = {
  /** The application's own PrismaService, for arranging data and checking persistence. */
  prisma: PrismaService;
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>>;
  close(): Promise<void>;
};

/**
 * Boots the real application (all modules, production HTTP configuration) against the disposable
 * test database and talks to it over HTTP.
 */
export async function startTestApi(databaseUrl: string = inject("databaseUrl")): Promise<TestApi> {
  const config: ApiConfig = {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    database: { url: databaseUrl },
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_CONFIG)
    .useValue(config)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, "127.0.0.1");
  const baseUrl = await app.getUrl();

  return {
    prisma: app.get(PrismaService),
    async request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
      const response = await fetch(new URL(path, baseUrl), {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T, text };
    },
    close: () => app.close(),
  };
}
