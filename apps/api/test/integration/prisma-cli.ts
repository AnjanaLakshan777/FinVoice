import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const apiRoot = fileURLToPath(new URL("../../", import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");

export type CliResult = { exitCode: number | null; stdout: string; stderr: string };

/** Runs the Prisma CLI against the given database, exactly as a developer or deploy job would. */
export function runPrisma(args: readonly string[], databaseUrl: string): CliResult {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    encoding: "utf8",
  });
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}
