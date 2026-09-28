import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProtectedLayout from "../app/(account)/(protected)/layout";
import { GoalDetail } from "../app/(account)/(protected)/goals/[goalId]/goal-detail";
import { Goals } from "../app/(account)/(protected)/goals/goals";
import { MESSAGES } from "../lib/account/messages";
import { AuthProvider } from "../lib/auth/auth-context";
import { apiError, signedInApi, tokens, USER, type FakeApi } from "./support/fake-api";
import { resetNavigation, router } from "./support/navigation";

vi.mock("next/navigation", async () => (await import("./support/navigation")).nextNavigationMock);

const GOAL_ID = "0190f0a0-0000-7000-8002-000000000001";
const GOAL = {
  id: GOAL_ID,
  userId: USER.id,
  type: "SAVINGS",
  name: "Bicycle",
  targetAmount: "45000.00",
  currentAmount: "15000.00",
  currency: "LKR",
  targetDate: null,
  status: "ACTIVE",
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
};

function goalsApi(goals: unknown[] = [GOAL]): FakeApi {
  return signedInApi().on("GET", "/me/goals", {
    status: 200,
    body: { data: goals, meta: { page: 1, limit: 50, total: goals.length, totalPages: 1 } },
  });
}

function renderPage(api: FakeApi, page: ReactNode) {
  return render(
    <AuthProvider client={api.client()}>
      <ProtectedLayout>{page}</ProtectedLayout>
    </AuthProvider>,
  );
}

function fillGoal(name: string, target: string) {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Target amount (LKR)"), { target: { value: target } });
}

beforeEach(() => {
  resetNavigation("/goals");
});

afterEach(() => {
  cleanup();
});

describe("/goals", () => {
  it("shows a loading state, then the goals with progress from the API's amounts", async () => {
    const api = goalsApi();
    renderPage(api, <Goals />);

    expect(await screen.findByText("Loading your goals…")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Bicycle" })).toBeTruthy();
    expect(screen.getByText("LKR 15,000.00 of LKR 45,000.00 saved")).toBeTruthy();
    const progress = screen.getByRole("progressbar");
    expect(progress.getAttribute("value")).toBe("1500000");
    expect(progress.getAttribute("max")).toBe("4500000");
    expect(api.callsTo("GET", "/me/goals")[0]?.path).toBe("/me/goals?limit=50");
  });

  it("offers exactly the contract's goal types", async () => {
    renderPage(goalsApi(), <Goals />);

    const select = await screen.findByLabelText<HTMLSelectElement>("What is the goal?");
    expect([...select.options].map((option) => option.value)).toEqual([
      "SAVINGS",
      "EMERGENCY_FUND",
      "DEBT_REPAYMENT",
      "OTHER",
    ]);
  });

  it("creates a goal and reloads the list", async () => {
    const api = goalsApi([]).on("POST", "/me/goals", {
      status: 201,
      body: { ...GOAL, name: "School fees" },
    });
    renderPage(api, <Goals />);
    await screen.findByText("You have no goals yet. Add your first one below.");
    api.on("GET", "/me/goals", {
      status: 200,
      body: { data: [{ ...GOAL, name: "School fees" }], meta: { total: 1 } },
    });
    fillGoal("School fees", "120,000");

    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));

    expect((await screen.findByText(/added\./u)).textContent).toBe("Goal “School fees” added.");
    expect(await screen.findByRole("link", { name: "School fees" })).toBeTruthy();
    expect(api.callsTo("POST", "/me/goals")[0]?.body).toEqual({
      type: "SAVINGS",
      name: "School fees",
      targetAmount: "120000",
      targetDate: null,
    });
  });

  it("shows the API's validation errors for a goal", async () => {
    const api = goalsApi([]).on(
      "POST",
      "/me/goals",
      apiError(400, "VALIDATION_ERROR", "Request validation failed", [
        { field: "currentAmount", message: "Must not exceed targetAmount" },
      ]),
    );
    renderPage(api, <Goals />);
    await screen.findByText("You have no goals yet. Add your first one below.");
    fillGoal("Bicycle", "100");
    fireEvent.change(screen.getByLabelText("Saved so far (LKR, optional)"), {
      target: { value: "500" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));

    expect((await screen.findByRole("alert")).textContent).toBe(MESSAGES.validation);
    expect(screen.getByText("Must not exceed targetAmount")).toBeTruthy();
  });

  it("sends the person back to sign in when the session has expired", async () => {
    // The first refresh (page load) works; by the time the access token is refused, the refresh
    // session has ended too.
    let refreshes = 0;
    const api = goalsApi()
      .on("GET", "/me/goals", apiError(401, "UNAUTHORIZED", "Missing or invalid access token"))
      .on("POST", "/auth/refresh", () => {
        refreshes += 1;
        return refreshes === 1
          ? { status: 200, body: tokens("access-token-1") }
          : apiError(401, "UNAUTHORIZED", "Invalid or expired refresh token");
      });
    renderPage(api, <Goals />);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith("/login");
    });
  });
});

describe("/goals/:goalId", () => {
  it("shows one goal and updates it through PATCH /me/goals/:goalId", async () => {
    const api = signedInApi()
      .on("GET", `/me/goals/${GOAL_ID}`, { status: 200, body: GOAL })
      .on("PATCH", `/me/goals/${GOAL_ID}`, (call) => ({
        status: 200,
        // The API returns amounts normalised to 2 decimals.
        body: {
          ...GOAL,
          ...(call.body as object),
          currentAmount: "20000.00",
          updatedAt: "2026-09-29T00:00:00.000Z",
        },
      }));
    renderPage(api, <GoalDetail goalId={GOAL_ID} />);
    expect(await screen.findByRole("heading", { name: "Bicycle" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Saved so far (LKR, optional)"), {
      target: { value: "20000" },
    });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "COMPLETED" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Changes saved.")).toBeTruthy();
    expect(api.callsTo("PATCH", `/me/goals/${GOAL_ID}`)[0]?.body).toEqual({
      type: "SAVINGS",
      name: "Bicycle",
      targetAmount: "45000.00",
      currentAmount: "20000",
      targetDate: null,
      status: "COMPLETED",
    });
    expect(screen.getByText("LKR 20,000.00 of LKR 45,000.00 saved")).toBeTruthy();
  });

  it("answers another person's goal id as not found (the API decides)", async () => {
    const api = signedInApi().on(
      "GET",
      `/me/goals/${GOAL_ID}`,
      apiError(404, "NOT_FOUND", "Financial goal not found"),
    );
    renderPage(api, <GoalDetail goalId={GOAL_ID} />);

    expect((await screen.findByRole("alert")).textContent).toBe(MESSAGES.notFound);
  });
});
