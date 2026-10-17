import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "../app/(account)/login/page";
import { MESSAGES } from "../lib/account/messages";
import { AuthProvider } from "../lib/auth/auth-context";
import { apiError, FakeApi, ME, tokens } from "./support/fake-api";
import { resetNavigation, router } from "./support/navigation";

vi.mock("next/navigation", async () => (await import("./support/navigation")).nextNavigationMock);

/** An API without a session (refresh 401), where starting a guest session succeeds. */
function signedOutApi(): FakeApi {
  return new FakeApi()
    .on("POST", "/auth/refresh", apiError(401, "UNAUTHORIZED", "Invalid or expired refresh token"))
    .on("POST", "/auth/guest", { status: 201, body: tokens("access-1") })
    .on("GET", "/auth/me", { status: 200, body: ME });
}

function renderLogin(api: FakeApi) {
  return render(
    <AuthProvider client={api.client()}>
      <LoginPage />
    </AuthProvider>,
  );
}

async function start() {
  fireEvent.click(await screen.findByRole("button", { name: "Start" }));
}

beforeEach(() => {
  resetNavigation("/login");
});

afterEach(() => {
  cleanup();
});

describe("/login", () => {
  it("asks only for the language and an optional name, without treating it as an error", async () => {
    renderLogin(signedOutApi());

    expect(await screen.findByLabelText("Preferred language")).toBeTruthy();
    expect(screen.getByLabelText("Your name (optional)")).toBeTruthy();
    expect(screen.queryByLabelText(/mobile|phone/iu)).toBeNull();
    expect(screen.queryByLabelText(/code/iu)).toBeNull();
    expect(screen.getByText(/No phone number or password is needed/u)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("starts a guest session in Sinhala by default and goes to onboarding", async () => {
    const api = signedOutApi();
    renderLogin(api);

    await start();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith("/onboarding");
    });
    expect(api.callsTo("POST", "/auth/guest")[0]?.body).toEqual({ preferredLanguage: "SI" });
    expect(api.callsTo("GET", "/auth/me")[0]?.headers.authorization).toBe("Bearer access-1");
  });

  it("sends the chosen language and the trimmed name", async () => {
    const api = signedOutApi();
    renderLogin(api);
    fireEvent.change(await screen.findByLabelText("Preferred language"), {
      target: { value: "TA" },
    });
    fireEvent.change(screen.getByLabelText("Your name (optional)"), {
      target: { value: "  Kamal  " },
    });

    await start();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith("/onboarding");
    });
    expect(api.callsTo("POST", "/auth/guest")[0]?.body).toEqual({
      preferredLanguage: "TA",
      displayName: "Kamal",
    });
  });

  it("explains when FinVoice is busy (rate limit)", async () => {
    const api = signedOutApi().on(
      "POST",
      "/auth/guest",
      apiError(429, "TOO_MANY_REQUESTS", "FinVoice is busy. Try again in a minute."),
    );
    renderLogin(api);

    await start();

    expect((await screen.findByRole("alert")).textContent).toBe(MESSAGES.tooManyRequests);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows the API's message for an invalid name", async () => {
    const api = signedOutApi().on("POST", "/auth/guest", {
      status: 400,
      body: {
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [{ field: "displayName", message: "Must be at most 100 characters" }],
      },
    });
    renderLogin(api);

    await start();

    expect(await screen.findByText("Must be at most 100 characters")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(MESSAGES.validation);
  });

  it("explains when the service is unavailable", async () => {
    const api = signedOutApi().on(
      "POST",
      "/auth/guest",
      apiError(503, "SERVICE_UNAVAILABLE", "Authentication is not configured"),
    );
    renderLogin(api);

    await start();

    expect((await screen.findByRole("alert")).textContent).toBe(MESSAGES.unavailable);
  });

  it("goes straight to the dashboard when a session already exists (reload)", async () => {
    const api = new FakeApi()
      .on("POST", "/auth/refresh", { status: 200, body: tokens("access-1") })
      .on("GET", "/auth/me", { status: 200, body: ME });
    renderLogin(api);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith("/dashboard");
    });
    expect(api.callsTo("POST", "/auth/guest")).toHaveLength(0);
  });
});
