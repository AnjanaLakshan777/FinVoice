import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProtectedLayout from "../app/(account)/(protected)/layout";
import { Dashboard } from "../app/(account)/(protected)/dashboard/dashboard";
import { MESSAGES } from "../lib/account/messages";
import { AuthProvider, useAuth } from "../lib/auth/auth-context";
import { apiError, FakeApi, signedInApi, USER } from "./support/fake-api";
import { resetNavigation, router } from "./support/navigation";

vi.mock("next/navigation", async () => (await import("./support/navigation")).nextNavigationMock);

const GOAL = {
  id: "0190f0a0-0000-7000-8002-000000000001",
  userId: USER.id,
  type: "EMERGENCY_FUND",
  name: "Rainy day",
  targetAmount: "300000.00",
  currentAmount: "75000.50",
  currency: "LKR",
  targetDate: "2027-06-30",
  status: "ACTIVE",
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
};

function renderProtected(api: FakeApi, page: ReactNode = <p>Secret page</p>) {
  return render(
    <AuthProvider client={api.client()}>
      <ProtectedLayout>{page}</ProtectedLayout>
    </AuthProvider>,
  );
}

/** A signed-in API with the dashboard's data. */
function dashboardApi(): FakeApi {
  return signedInApi()
    .on("GET", "/me", { status: 200, body: USER })
    .on("GET", "/me/financial-profile", {
      status: 200,
      body: { userId: USER.id, monthlyIncome: "150000.00", monthlyExpenses: null, currency: "LKR" },
    })
    .on("GET", "/me/goals", { status: 200, body: { data: [GOAL], meta: { total: 1 } } });
}

beforeEach(() => {
  resetNavigation("/dashboard");
});

afterEach(() => {
  cleanup();
});

describe("protected pages", () => {
  it("redirect a visitor without a session to /login and never render the page", async () => {
    const api = new FakeApi().on(
      "POST",
      "/auth/refresh",
      apiError(401, "UNAUTHORIZED", "Invalid or expired refresh token"),
    );
    renderProtected(api);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith("/login");
    });
    expect(screen.queryByText("Secret page")).toBeNull();
  });

  it("show a loading state (not the page) while the session is being restored", () => {
    const api = new FakeApi().on("POST", "/auth/refresh", () => new Promise(() => undefined));
    renderProtected(api);

    expect(screen.getByRole("status").textContent).toBe("Loading…");
    expect(screen.queryByText("Secret page")).toBeNull();
  });

  it("render for a signed-in person after a reload (refresh cookie → new access token)", async () => {
    const api = signedInApi();
    renderProtected(api);

    expect(await screen.findByText("Secret page")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Account" })).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
    expect(api.callsTo("POST", "/auth/refresh")).toHaveLength(1);
  });

  it("log out through the API, forget the session and return to /login", async () => {
    const api = signedInApi().on("POST", "/auth/logout", { status: 204 });
    renderProtected(api);
    fireEvent.click(await screen.findByRole("button", { name: "Log out" }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith("/login");
    });
    expect(api.callsTo("POST", "/auth/logout")[0]?.headers.authorization).toBe(
      "Bearer access-token-1",
    );
    expect(screen.queryByText("Secret page")).toBeNull();
  });

  it("end the session and redirect when it expires during use", async () => {
    const api = signedInApi().on(
      "GET",
      "/me",
      apiError(401, "UNAUTHORIZED", "Missing or invalid access token"),
    );
    let notice: string | null = null;
    function NoticeProbe() {
      const { state } = useAuth();
      if (state.status === "unauthenticated") {
        notice = state.notice;
      }
      return null;
    }
    function LoadButton() {
      const { client } = useAuth();
      return (
        <button
          type="button"
          onClick={() => void client.request("GET", "/me").catch(() => undefined)}
        >
          Load
        </button>
      );
    }
    render(
      <AuthProvider client={api.client()}>
        <NoticeProbe />
        <ProtectedLayout>
          <LoadButton />
        </ProtectedLayout>
      </AuthProvider>,
    );
    // The refresh cookie is gone by now: the retry's refresh fails.
    api.on(
      "POST",
      "/auth/refresh",
      apiError(401, "UNAUTHORIZED", "Invalid or expired refresh token"),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Load" }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith("/login");
    });
    expect(notice).toBe(MESSAGES.sessionExpired);
  });
});

describe("/dashboard", () => {
  it("loads the person's own data through /me routes only", async () => {
    const api = dashboardApi();
    renderProtected(api, <Dashboard />);

    expect(await screen.findByRole("heading", { name: "Welcome, Kamal" })).toBeTruthy();
    expect(screen.getByText("LKR 150,000.00")).toBeTruthy();
    expect(screen.getByText("Not added yet")).toBeTruthy();
    expect(screen.getByText("LKR 75,000.50 of LKR 300,000.00 saved")).toBeTruthy();
    // The identity comes from the token: no call carries a user id.
    const paths = api.calls.map((call) => call.path);
    expect(paths.every((path) => !path.includes(USER.id))).toBe(true);
    expect(paths).toContain("/me/goals?status=ACTIVE&limit=5");
  });

  it("invites a new person to add their details when there is no profile yet", async () => {
    const api = dashboardApi()
      .on("GET", "/me/financial-profile", apiError(404, "NOT_FOUND", "Financial profile not found"))
      .on("GET", "/me/goals", { status: 200, body: { data: [], meta: { total: 0 } } });
    renderProtected(api, <Dashboard />);

    expect(await screen.findByRole("link", { name: "Add your details" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a simple message when the API is unavailable", async () => {
    const api = dashboardApi().on(
      "GET",
      "/me",
      apiError(503, "SERVICE_UNAVAILABLE", "The database is unavailable"),
    );
    renderProtected(api, <Dashboard />);

    expect((await screen.findByRole("alert")).textContent).toBe(MESSAGES.unavailable);
    expect(document.body.textContent).not.toContain("database");
  });
});
