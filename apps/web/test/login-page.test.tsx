import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "../app/(account)/login/page";
import { MESSAGES } from "../lib/account/messages";
import { AuthProvider } from "../lib/auth/auth-context";
import { apiError, FakeApi, ME, tokens } from "./support/fake-api";
import { resetNavigation, router } from "./support/navigation";

vi.mock("next/navigation", async () => (await import("./support/navigation")).nextNavigationMock);

const CHALLENGE = {
  challengeId: "5d3c2f0e-8f7a-4b1e-9c6d-2a1b0c9d8e7f",
  expiresIn: 300,
  message: "If this number can be authenticated, a verification code has been requested.",
};
const INVALID_CODE = apiError(
  401,
  "UNAUTHORIZED",
  "The verification code is invalid or has expired",
);

/** An API without a session (refresh 401), where request-otp succeeds. */
function signedOutApi(): FakeApi {
  return new FakeApi()
    .on("POST", "/auth/refresh", apiError(401, "UNAUTHORIZED", "Invalid or expired refresh token"))
    .on("POST", "/auth/request-otp", { status: 202, body: CHALLENGE });
}

function renderLogin(api: FakeApi) {
  return render(
    <AuthProvider client={api.client()}>
      <LoginPage />
    </AuthProvider>,
  );
}

async function requestCode(phone = "+94771234567") {
  fireEvent.change(await screen.findByLabelText("Mobile number"), { target: { value: phone } });
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
}

function enterCode(code: string) {
  fireEvent.change(screen.getByLabelText("8-digit code"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
}

beforeEach(() => {
  resetNavigation("/login");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("/login", () => {
  it("shows the phone step for a signed-out visitor, without treating it as an error", async () => {
    renderLogin(signedOutApi());

    expect(await screen.findByLabelText("Mobile number")).toBeTruthy();
    expect(screen.getByText(/0771234567 becomes \+94771234567/u)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("requests a code and moves to the code step", async () => {
    const api = signedOutApi();
    renderLogin(api);

    await requestCode(" +94771234567 ");

    expect(await screen.findByLabelText("8-digit code")).toBeTruthy();
    expect(api.callsTo("POST", "/auth/request-otp")[0]?.body).toEqual({
      phoneNumber: "+94771234567",
    });
    expect(screen.getByRole("timer").textContent).toBe("The code expires in 5:00.");
  });

  it("shows a simple message for an invalid phone number (the API decides)", async () => {
    const api = signedOutApi().on(
      "POST",
      "/auth/request-otp",
      apiError(400, "VALIDATION_ERROR", "Request validation failed", [
        { field: "phoneNumber", message: "Must be an E.164 phone number" },
      ]),
    );
    renderLogin(api);

    await requestCode("0771234567");

    expect((await screen.findByRole("alert")).textContent).toBe(MESSAGES.invalidPhone);
  });

  it("explains the per-number request limit", async () => {
    const api = signedOutApi().on(
      "POST",
      "/auth/request-otp",
      apiError(429, "TOO_MANY_REQUESTS", "Too many verification code requests. Try again later."),
    );
    renderLogin(api);

    await requestCode();

    expect((await screen.findByRole("alert")).textContent).toBe(MESSAGES.tooManyRequests);
  });

  it("verifies the code, signs in and starts onboarding for a new account", async () => {
    const api = signedOutApi()
      .on("POST", "/auth/verify-otp", { status: 200, body: tokens("access-1") })
      .on("GET", "/auth/me", { status: 200, body: ME })
      .on(
        "GET",
        "/me/financial-profile",
        apiError(404, "NOT_FOUND", "Financial profile not found"),
      );
    renderLogin(api);
    await requestCode();
    fireEvent.change(await screen.findByLabelText("8-digit code"), {
      target: { value: "12345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith("/onboarding");
    });
    expect(api.callsTo("POST", "/auth/verify-otp")[0]?.body).toEqual({
      challengeId: CHALLENGE.challengeId,
      code: "12345678",
      preferredLanguage: "EN",
    });
    expect(api.callsTo("GET", "/auth/me")[0]?.headers.authorization).toBe("Bearer access-1");
    expect(router.replace).not.toHaveBeenCalledWith("/dashboard");
    // The code is never kept on screen.
    expect(document.body.textContent).not.toContain("12345678");
  });

  it("sends a returning user with a profile to the dashboard", async () => {
    const api = signedOutApi()
      .on("POST", "/auth/verify-otp", { status: 200, body: tokens("access-1") })
      .on("GET", "/auth/me", { status: 200, body: ME })
      .on("GET", "/me/financial-profile", { status: 200, body: { monthlyIncome: null } });
    renderLogin(api);
    await requestCode();
    await screen.findByLabelText("8-digit code");

    enterCode("12345678");

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("shows an invalid code clearly and lets the person try again", async () => {
    const api = signedOutApi().on("POST", "/auth/verify-otp", INVALID_CODE);
    renderLogin(api);
    await requestCode();
    await screen.findByLabelText("8-digit code");

    enterCode("00000000");

    expect((await screen.findByRole("alert")).textContent).toBe(MESSAGES.codeIncorrect);
    expect(screen.getByLabelText<HTMLInputElement>("8-digit code").value).toBe("");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("explains the attempt limit after repeated wrong codes", async () => {
    const api = signedOutApi().on("POST", "/auth/verify-otp", INVALID_CODE);
    renderLogin(api);
    await requestCode();
    await screen.findByLabelText("8-digit code");

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      enterCode("00000000");
      await waitFor(() => {
        expect(api.callsTo("POST", "/auth/verify-otp")).toHaveLength(attempt);
      });
    }

    expect((await screen.findByRole("alert")).textContent).toBe(MESSAGES.tooManyAttempts);
  });

  it("tells an inactive account it cannot sign in", async () => {
    const api = signedOutApi().on(
      "POST",
      "/auth/verify-otp",
      apiError(401, "UNAUTHORIZED", "Authentication failed"),
    );
    renderLogin(api);
    await requestCode();
    await screen.findByLabelText("8-digit code");

    enterCode("12345678");

    expect((await screen.findByRole("alert")).textContent).toBe(MESSAGES.accountInactive);
  });

  it("counts down to the code's expiry and then asks for a new code", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = signedOutApi().on("POST", "/auth/request-otp", {
      status: 202,
      body: { ...CHALLENGE, expiresIn: 60 },
    });
    renderLogin(api);
    await requestCode();
    await screen.findByLabelText("8-digit code");
    const resend = screen.getByRole<HTMLButtonElement>("button", { name: /Send a new code/u });
    expect(resend.disabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });

    expect(screen.getByRole("timer").textContent).toBe("The code has expired. Send a new code.");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Verify" }).disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Send a new code" }).disabled,
    ).toBe(false);
  });

  it("sends a new code for the same number", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = signedOutApi();
    renderLogin(api);
    await requestCode();
    await screen.findByLabelText("8-digit code");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));

    await waitFor(() => {
      expect(api.callsTo("POST", "/auth/request-otp")).toHaveLength(2);
    });
  });

  it("goes straight to the dashboard when a session already exists (reload)", async () => {
    const api = new FakeApi()
      .on("POST", "/auth/refresh", { status: 200, body: tokens("access-1") })
      .on("GET", "/auth/me", { status: 200, body: ME });
    renderLogin(api);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith("/dashboard");
    });
  });
});
