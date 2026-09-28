import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProtectedLayout from "../app/(account)/(protected)/layout";
import { Onboarding } from "../app/(account)/(protected)/onboarding/onboarding";
import { MESSAGES } from "../lib/account/messages";
import { AuthProvider } from "../lib/auth/auth-context";
import { apiError, ME, signedInApi, USER, type FakeApi } from "./support/fake-api";
import { resetNavigation, router } from "./support/navigation";

vi.mock("next/navigation", async () => (await import("./support/navigation")).nextNavigationMock);

const PROFILE = {
  userId: USER.id,
  monthlyIncome: "150000.00",
  monthlyExpenses: "90000.50",
  currency: "LKR",
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
};

function onboardingApi(profile: unknown = PROFILE): FakeApi {
  return signedInApi()
    .on("GET", "/me", { status: 200, body: USER })
    .on(
      "GET",
      "/me/financial-profile",
      profile === null
        ? apiError(404, "NOT_FOUND", "Financial profile not found")
        : { status: 200, body: profile },
    )
    .on("PATCH", "/me", (call) => ({ status: 200, body: { ...USER, ...(call.body as object) } }))
    .on("PUT", "/me/financial-profile", (call) => ({
      status: 200,
      body: { ...PROFILE, ...(call.body as object) },
    }))
    .on("POST", "/me/goals", (call) => ({
      status: 201,
      body: { id: "goal-1", ...(call.body as object) },
    }));
}

function renderOnboarding(api: FakeApi) {
  return render(
    <AuthProvider client={api.client()}>
      <ProtectedLayout>
        <Onboarding />
      </ProtectedLayout>
    </AuthProvider>,
  );
}

const continueButton = () => screen.getByRole("button", { name: "Save and continue" });

/** Saves the first two steps unchanged and waits for the goal step. */
async function goToGoalStep() {
  fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
  await screen.findByRole("heading", { name: "Your monthly money" });
  fireEvent.click(continueButton());
  await screen.findByRole("heading", { name: "A first goal (optional)" });
}

beforeEach(() => {
  resetNavigation("/onboarding");
});

afterEach(() => {
  cleanup();
});

describe("/onboarding", () => {
  it("loads the stored name, language and monthly amounts", async () => {
    renderOnboarding(onboardingApi());

    expect(await screen.findByLabelText<HTMLInputElement>("Your name (optional)")).toMatchObject({
      value: "Kamal",
    });
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "සිංහල (Sinhala)" }).checked).toBe(
      true,
    );
    fireEvent.click(continueButton());
    expect(await screen.findByLabelText<HTMLInputElement>("Monthly income (LKR)")).toMatchObject({
      value: "150000.00",
    });
  });

  it("saves the name and language through PATCH /me and reloads the identity", async () => {
    const api = onboardingApi();
    renderOnboarding(api);
    fireEvent.change(await screen.findByLabelText("Your name (optional)"), {
      target: { value: "Kamala" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "தமிழ் (Tamil)" }));
    api.on("GET", "/auth/me", { status: 200, body: { ...ME, preferredLanguage: "TA" } });

    fireEvent.click(continueButton());

    expect(await screen.findByRole("heading", { name: "Your monthly money" })).toBeTruthy();
    expect(api.callsTo("PATCH", "/me")[0]?.body).toEqual({
      displayName: "Kamala",
      preferredLanguage: "TA",
    });
    // The identity (with the new language) is loaded again after the change.
    expect(api.callsTo("GET", "/auth/me").length).toBeGreaterThanOrEqual(2);
  });

  it("saves monthly amounts as decimal strings, tidying separators, keeping empty as null", async () => {
    const api = onboardingApi(null);
    renderOnboarding(api);
    fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
    fireEvent.change(await screen.findByLabelText("Monthly income (LKR)"), {
      target: { value: "85,000.50" },
    });

    fireEvent.click(continueButton());

    expect(await screen.findByRole("heading", { name: "A first goal (optional)" })).toBeTruthy();
    expect(api.callsTo("PUT", "/me/financial-profile")[0]?.body).toEqual({
      monthlyIncome: "85000.50",
      monthlyExpenses: null,
    });
  });

  it("shows the API's validation messages next to the fields and stays on the step", async () => {
    const api = onboardingApi().on(
      "PUT",
      "/me/financial-profile",
      apiError(400, "VALIDATION_ERROR", "Request validation failed", [
        { field: "monthlyIncome", message: "Must have at most 2 decimal places" },
      ]),
    );
    renderOnboarding(api);
    fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
    fireEvent.change(await screen.findByLabelText("Monthly income (LKR)"), {
      target: { value: "100.123" },
    });

    fireEvent.click(continueButton());

    expect((await screen.findByRole("alert")).textContent).toBe(MESSAGES.validation);
    expect(screen.getByText("Must have at most 2 decimal places")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your monthly money" })).toBeTruthy();
  });

  it("creates a first goal with a contract goal type, then goes to the dashboard", async () => {
    const api = onboardingApi();
    renderOnboarding(api);
    await goToGoalStep();
    fireEvent.change(screen.getByLabelText("What is the goal?"), {
      target: { value: "EMERGENCY_FUND" },
    });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rainy day" } });
    fireEvent.change(screen.getByLabelText("Target amount (LKR)"), {
      target: { value: "300,000" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save goal and finish" }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/dashboard");
    });
    expect(api.callsTo("POST", "/me/goals")[0]?.body).toEqual({
      type: "EMERGENCY_FUND",
      name: "Rainy day",
      targetAmount: "300000",
      targetDate: null,
    });
  });

  it("lets a person skip the goal", async () => {
    renderOnboarding(onboardingApi());
    await goToGoalStep();

    fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));

    expect(router.push).toHaveBeenCalledWith("/dashboard");
  });

  it("never sends a user id: the API takes the identity from the token", async () => {
    const api = onboardingApi();
    renderOnboarding(api);
    await goToGoalStep();

    for (const call of api.calls) {
      expect(call.path).not.toContain(USER.id);
      expect(JSON.stringify(call.body ?? {})).not.toContain("userId");
    }
  });
});
