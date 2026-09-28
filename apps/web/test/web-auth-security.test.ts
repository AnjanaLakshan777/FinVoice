import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const WEB_ROOT = join(import.meta.dirname, "..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|tsx)$/u.test(entry) ? [path] : [];
  });
}

const APP_SOURCES = [...sourceFiles(join(WEB_ROOT, "app")), ...sourceFiles(join(WEB_ROOT, "lib"))];
/** Code only: comments that document a rule ("never in localStorage") do not break it. */
const read = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");
const name = (path: string) => relative(WEB_ROOT, path);

describe("web authentication security (static checks)", () => {
  it("never uses browser storage or JavaScript cookies (tokens stay in memory)", () => {
    for (const file of APP_SOURCES) {
      const source = read(file);
      for (const forbidden of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
        expect(source, `${name(file)} uses ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("never logs from the authentication or account code", () => {
    const authFiles = APP_SOURCES.filter((file) =>
      /[\\/](auth|account|server)[\\/]|\(account\)/u.test(file),
    );
    expect(authFiles.length).toBeGreaterThan(10);
    for (const file of authFiles) {
      expect(read(file), name(file)).not.toMatch(/console\.(log|info|debug|warn|error)/u);
    }
  });

  it("exposes no server secret through NEXT_PUBLIC_* variables", () => {
    const publicVariables = new Set(
      APP_SOURCES.flatMap((file) =>
        [...read(file).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/gu)].map((m) => m[0]),
      ),
    );
    expect([...publicVariables]).toEqual(["NEXT_PUBLIC_VOICE_GATEWAY_URL"]);
  });

  it("never reads the internal service token in the proxy or the account code", () => {
    const users = APP_SOURCES.filter((file) => read(file).includes("INTERNAL_API_TOKEN")).map(name);
    for (const file of users) {
      expect(file).toMatch(/^lib[\\/]admin[\\/]/u);
    }
  });

  it("has no browser route that could reveal a one-time code", () => {
    const routes = sourceFiles(join(WEB_ROOT, "app")).filter((file) => file.endsWith("route.ts"));
    expect(routes.map(name)).toEqual([join("app", "api", "v1", "[...path]", "route.ts")]);
    for (const file of APP_SOURCES) {
      expect(read(file), name(file)).not.toMatch(/AUTH_OTP_DEV_CODE|otpPepper|AUTH_JWT_SECRET/u);
    }
  });

  it("sends the refresh cookie only to the same origin", () => {
    const client = read(join(WEB_ROOT, "lib", "auth", "auth-client.ts"));
    expect(client).toContain('credentials: "same-origin"');
    expect(client).not.toContain('credentials: "include"');
  });
});
