import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { randomBytes, randomInt } from "node:crypto";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real browser end-to-end test of guest sign-in, onboarding, goals and logout.
 *
 * It starts the BUILT applications, as in production:
 * - the API (apps/api/dist/main.js) against the local development database from the root .env
 *   (localhost:5433). The JWT secret is generated here and exists only in that child process's
 *   environment; .env is not read or changed for it;
 * - the web app (`next start`), whose same-origin proxy forwards /api/v1 to that API.
 *
 * Guest accounts have no phone number or code: the test starts with a language and a unique name.
 * Logging out deletes each account; anything left by a failed run is deleted afterwards by name.
 *
 * Prerequisites: `pnpm db:up && pnpm db:migrate`, `pnpm build`, and Google Chrome or Microsoft
 * Edge installed (E2E_BROWSER_CHANNEL=chrome|msedge, default chrome). Run with `pnpm test:e2e`.
 */

const WEB_DIR = join(import.meta.dirname, "..");
const API_DIR = join(WEB_DIR, "..", "api");
const REPO_DIR = join(WEB_DIR, "..", "..");

const SECRET = randomBytes(32).toString("base64url");
const NAME = `E2E ${String(randomInt(1000, 9999))}`;

type Server = { child: ChildProcess; output: () => string; url: string };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

async function start(
  command: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  url: string,
  readyPath: string,
): Promise<Server> {
  let output = "";
  const child = spawn(process.execPath, command, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url}${readyPath}`)).ok) {
        return { child, output: () => output, url };
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  child.kill();
  throw new Error(`${command.join(" ")} did not start (${readyPath}):\n${output.slice(-2000)}`);
}

/** Deletes any test account left by a failed run from the local docker compose database. */
function deleteTestAccount(): void {
  const run = (sql: string) =>
    spawnSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "postgres",
        "sh",
        "-c",
        'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qAt',
      ],
      { cwd: REPO_DIR, input: sql, encoding: "utf8" },
    );
  run(`DELETE FROM users WHERE display_name = '${NAME}';`);
}

let api: Server;
let web: Server;
let browser: Browser;
let context: BrowserContext;
let page: Page;
const requestUrls: string[] = [];
const consoleLines: string[] = [];
/** Whatever was started, for cleanup even when setup fails part-way. */
const started: { api?: Server; web?: Server; browser?: Browser } = {};

beforeAll(async () => {
  for (const [path, build] of [
    [join(API_DIR, "dist", "main.js"), "pnpm --filter @finvoice/api build"],
    [join(WEB_DIR, ".next", "BUILD_ID"), "pnpm --filter @finvoice/web build"],
  ] as const) {
    if (!existsSync(path)) {
      throw new Error(`Build first: ${build}`);
    }
  }
  const [apiPort, webPort] = await Promise.all([freePort(), freePort()]);
  api = started.api = await start(
    ["--env-file-if-exists=../../.env", "dist/main.js"],
    API_DIR,
    {
      ...process.env,
      NODE_ENV: "development",
      API_HOST: "127.0.0.1",
      API_PORT: String(apiPort),
      AUTH_JWT_SECRET: SECRET,
      AUTH_REFRESH_COOKIE_SECURE: "false",
    },
    `http://127.0.0.1:${String(apiPort)}`,
    "/health/ready",
  );
  web = started.web = await start(
    [
      join("node_modules", "next", "dist", "bin", "next"),
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      String(webPort),
    ],
    WEB_DIR,
    { ...process.env, NODE_ENV: "production", INTERNAL_API_URL: api.url },
    `http://127.0.0.1:${String(webPort)}`,
    "/login",
  );
  browser = started.browser = await chromium.launch({
    channel: process.env.E2E_BROWSER_CHANNEL ?? "chrome",
    headless: true,
  });
  context = await browser.newContext({ baseURL: web.url });
  page = await context.newPage();
  page.on("request", (request) => requestUrls.push(request.url()));
  page.on("console", (message) => consoleLines.push(message.text()));
}, 180_000);

afterAll(async () => {
  await started.browser?.close();
  started.web?.child.kill();
  started.api?.child.kill();
  deleteTestAccount();
});

async function refreshCookie() {
  return (await context.cookies()).find((cookie) => cookie.name === "finvoice_refresh");
}

describe("web authentication in a real browser (production builds)", () => {
  it("protects the account pages before sign-in", async () => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login");
    await expect(
      page.getByRole("heading", { name: "Get started with FinVoice" }).isVisible(),
    ).resolves.toBe(true);
  });

  it("starts a guest session with only a language and a name", async () => {
    expect(await page.getByLabel(/mobile|phone|code/iu).count()).toBe(0);
    await page.getByLabel("Preferred language").selectOption("SI");
    await page.getByLabel("Your name (optional)").fill(NAME);
    await page.getByRole("button", { name: "Start" }).click();

    // A new account starts with onboarding.
    await page.waitForURL("**/onboarding");
    const cookie = await refreshCookie();
    expect(cookie).toMatchObject({ httpOnly: true, path: "/api/v1/auth", sameSite: "Lax" });
    expect(new URL(web.url).hostname).toBe(cookie?.domain);
    // Invisible to JavaScript; nothing in browser storage.
    const browserState = await page.evaluate(() => ({
      cookie: document.cookie,
      local: localStorage.length,
      session: sessionStorage.length,
    }));
    expect(browserState).toEqual({ cookie: "", local: 0, session: 0 });
  });

  it("completes onboarding: name, language, monthly money and a first goal", async () => {
    await page.getByLabel("Your name (optional)").fill(NAME);
    await page.getByRole("radio", { name: "தமிழ் (Tamil)" }).check();
    await page.getByRole("button", { name: "Save and continue" }).click();

    await page.getByLabel("Monthly income (LKR)").fill("85,000");
    await page.getByLabel("Monthly expenses (LKR)").fill("60000.50");
    await page.getByRole("button", { name: "Save and continue" }).click();

    await page.getByLabel("What is the goal?").selectOption("EMERGENCY_FUND");
    await page.getByLabel("Name").fill("Rainy day");
    await page.getByLabel("Target amount (LKR)").fill("300000");
    await page.getByRole("button", { name: "Save goal and finish" }).click();

    await page.waitForURL("**/dashboard");
    await page.getByRole("heading", { name: `Welcome, ${NAME}` }).waitFor();
    expect(await page.getByText("LKR 85,000.00").isVisible()).toBe(true);
    expect(await page.getByText("LKR 60,000.50").isVisible()).toBe(true);
    expect(await page.getByRole("link", { name: "Rainy day" }).isVisible()).toBe(true);
  });

  it("creates and updates goals, with the API's validation", async () => {
    await page.getByRole("link", { name: "Goals", exact: true }).click();
    await page.waitForURL("**/goals");
    await page.getByLabel("Name").fill("School fees");
    await page.getByLabel("Target amount (LKR)").fill("100");
    await page.getByLabel("Saved so far (LKR, optional)").fill("500");
    await page.getByRole("button", { name: "Add goal" }).click();
    // The API refuses current > target; the page shows its field message.
    await page.getByText("Must not exceed targetAmount").waitFor();

    await page.getByLabel("Target amount (LKR)").fill("120000");
    await page.getByRole("button", { name: "Add goal" }).click();
    await page.getByRole("link", { name: "School fees" }).waitFor();

    await page.getByRole("link", { name: "School fees" }).click();
    await page.getByRole("heading", { name: "School fees" }).waitFor();
    await page.getByLabel("Saved so far (LKR, optional)").fill("20000");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByText("LKR 20,000.00 of LKR 120,000.00 saved").first().waitFor();
  });

  it("stays signed in after a full page reload (refresh cookie → new access token)", async () => {
    const refreshesBefore = requestUrls.filter((url) =>
      url.endsWith("/api/v1/auth/refresh"),
    ).length;
    const cookieBefore = await refreshCookie();

    await page.goto("/dashboard");
    // Reload a settled page, several times over, as a person would. (Reloads while the page's own
    // refresh is in flight are covered by the reload-race tests below.)
    for (let reload = 0; reload < 3; reload += 1) {
      await page.getByRole("heading", { name: `Welcome, ${NAME}` }).waitFor();
      await page.reload();
    }

    await page.getByRole("heading", { name: `Welcome, ${NAME}` }).waitFor();
    const refreshes = requestUrls.filter((url) => url.endsWith("/api/v1/auth/refresh")).length;
    expect(refreshes).toBeGreaterThanOrEqual(refreshesBefore + 4);
    // The refresh token was rotated.
    expect((await refreshCookie())?.value).not.toBe(cookieBefore?.value);
    // The language chosen in onboarding came back from the API.
    await page.getByRole("link", { name: "My details" }).click();
    await page.getByRole("heading", { name: "My details" }).waitFor();
    expect(await page.getByRole("radio", { name: "தமிழ் (Tamil)" }).isChecked()).toBe(true);
  });

  it("logs out (deleting the account) and requires a new sign-in for protected pages", async () => {
    await page.getByRole("button", { name: "Log out" }).click();
    await page.getByRole("button", { name: "Delete my data and log out" }).click();
    await page.waitForURL("**/login");
    expect(await refreshCookie()).toBeUndefined();

    for (const path of ["/dashboard", "/onboarding", "/goals"]) {
      await page.goto(path);
      await page.waitForURL("**/login");
    }
  });

  it("starts a new guest session for the reload-race tests (the old account is gone)", async () => {
    await page.goto("/login");
    await page.getByLabel("Your name (optional)").fill(NAME);
    await page.getByRole("button", { name: "Start" }).click();
    await page.waitForURL("**/onboarding");
    await page.goto("/dashboard");
    await page.getByRole("heading", { name: `Welcome, ${NAME}` }).waitFor();
  });

  it("survives a reload while the page's refresh is in flight (deterministic, repeated)", async () => {
    const graceReuses = () => (api.output().match(/Refresh grace reuse/gu) ?? []).length;
    for (let round = 1; round <= 3; round += 1) {
      const before = graceReuses();
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let markInFlight: () => void = () => undefined;
      const inFlight = new Promise<void>((resolve) => {
        markInFlight = resolve;
      });
      let first = true;
      await page.route("**/api/v1/auth/refresh", async (route) => {
        if (!first) {
          await route.continue();
          return;
        }
        first = false;
        // 1. The page's refresh reaches the server, which rotates the token (A → B)...
        const cookieA = await refreshCookie();
        const response = await route.fetch();
        // 2. ...but its response is lost to the reload, so the browser still holds A. (route.fetch
        // stores B in the browser's cookie jar; put A back, exactly as a lost response leaves it.)
        if (cookieA !== undefined) {
          await context.addCookies([cookieA]);
        }
        markInFlight();
        await released;
        // 3. The old response arrives late (or not at all, if the page is gone).
        await route.fulfill({ response }).catch(() => undefined);
      });

      await page.goto("/dashboard", { waitUntil: "commit" });
      await inFlight;
      // 4. Reload while the first refresh is unfinished: the new page sends A again.
      await page.reload({ waitUntil: "commit" });
      await page.getByRole("heading", { name: `Welcome, ${NAME}` }).waitFor();
      release();
      await page.unroute("**/api/v1/auth/refresh");

      // 5. Still signed in, through exactly one controlled grace reuse, and no reuse detection.
      expect(graceReuses(), `round ${String(round)}`).toBe(before + 1);
      expect(api.output()).not.toMatch(/reuse detected/u);

      // 6. Whichever cookie the browser kept keeps working: navigate, then reload again.
      await page.getByRole("link", { name: "Goals", exact: true }).click();
      await page.waitForURL("**/goals");
      await page.getByRole("link", { name: "Home" }).click();
      await page.getByRole("heading", { name: `Welcome, ${NAME}` }).waitFor();
      await page.reload();
      await page.getByRole("heading", { name: `Welcome, ${NAME}` }).waitFor();
    }
  });

  it("survives immediate reloads with natural browser timing, repeatedly", async () => {
    for (let round = 1; round <= 5; round += 1) {
      await page.goto("/dashboard");
      await page.reload();
      await page.getByRole("heading", { name: `Welcome, ${NAME}` }).waitFor();
    }
    expect(api.output()).not.toMatch(/reuse detected/u);
  });

  it("still logs out completely after the races", async () => {
    await page.getByRole("button", { name: "Log out" }).click();
    await page.getByRole("button", { name: "Delete my data and log out" }).click();
    await page.waitForURL("**/login");
    expect(await refreshCookie()).toBeUndefined();
    for (const path of ["/dashboard", "/goals"]) {
      await page.goto(path);
      await page.waitForURL("**/login");
    }
  });

  it("never exposed tokens, the name or the API's own address", () => {
    // Every request went to the web origin (same-origin proxy), never straight to the API.
    expect(requestUrls.every((url) => url.startsWith(web.url))).toBe(true);
    expect(requestUrls.some((url) => url.includes(encodeURIComponent(NAME)))).toBe(false);
    expect(consoleLines.join("\n")).not.toContain(NAME);
    // The servers never logged the secret or the name.
    for (const output of [api.output(), web.output()]) {
      for (const value of [SECRET, NAME]) {
        expect(output).not.toContain(value);
      }
    }
  });
});
