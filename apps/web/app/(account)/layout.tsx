import type { ReactNode } from "react";

import { AuthProvider } from "../../lib/auth/auth-context";
import styles from "./account.module.css";

/**
 * Sign-in and the signed-in account area (/login, /dashboard, /onboarding, /goals). The provider
 * restores the session from the HttpOnly refresh cookie once, and keeps it while the person moves
 * between these pages.
 */
export default function AccountLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AuthProvider>
      <main className={styles.page}>{children}</main>
    </AuthProvider>
  );
}
