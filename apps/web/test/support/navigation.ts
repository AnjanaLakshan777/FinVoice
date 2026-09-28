import { vi } from "vitest";

/** A stand-in for next/navigation's router, shared by the page tests (see vi.mock in each file). */
export const router = {
  replace: vi.fn<(href: string) => void>(),
  push: vi.fn<(href: string) => void>(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

export const navigation = { pathname: "/dashboard" };

export function resetNavigation(pathname = "/dashboard"): void {
  navigation.pathname = pathname;
  for (const fn of Object.values(router)) {
    fn.mockReset();
  }
}

export const nextNavigationMock = {
  useRouter: () => router,
  usePathname: () => navigation.pathname,
};
