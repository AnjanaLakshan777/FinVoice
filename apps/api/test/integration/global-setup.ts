import { readFileSync } from "node:fs";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

import { runPrisma } from "./prisma-cli.js";

declare module "vitest" {
  // Module augmentation works only through interface declaration merging.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

/**
 * Starts a disposable PostgreSQL container configured like docker-compose.yml (same image and
 * initdb arguments, read from that file so the two cannot drift apart), then applies every
 * migration with `prisma migrate deploy`, as a production deployment would.
 */
export async function setup(project: TestProject): Promise<void> {
  const compose = readFileSync(new URL("../../../../docker-compose.yml", import.meta.url), "utf8");
  const image = matchOrThrow(compose, /^\s*image:\s*(postgres:\S+)\s*$/m, "postgres image");
  const initdbArgs = matchOrThrow(compose, /^\s*POSTGRES_INITDB_ARGS:\s*(.+?)\s*$/m, "initdb args");

  container = await new PostgreSqlContainer(image)
    .withEnvironment({ POSTGRES_INITDB_ARGS: initdbArgs })
    .start();
  const databaseUrl = container.getConnectionUri();

  const migration = runPrisma(["migrate", "deploy"], databaseUrl);
  if (migration.exitCode !== 0) {
    throw new Error(`prisma migrate deploy failed:\n${migration.stdout}\n${migration.stderr}`);
  }

  project.provide("databaseUrl", databaseUrl);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}

function matchOrThrow(text: string, pattern: RegExp, what: string): string {
  const value = pattern.exec(text)?.[1];
  if (value === undefined) {
    throw new Error(`Could not read ${what} from docker-compose.yml`);
  }
  return value;
}
