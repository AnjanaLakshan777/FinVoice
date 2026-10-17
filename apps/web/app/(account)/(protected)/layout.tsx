"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { useAuth } from "../../../lib/auth/auth-context";
import styles from "../account.module.css";

const LINKS = [
  { href: "/dashboard", label: "Home" },
  { href: "/onboarding", label: "My details" },
  { href: "/goals", label: "Goals" },
] as const;

/**
 * Pages for a signed-in person only. The pages are shells: all personal data comes from the API
 * through authenticated calls, and the API enforces who may see what. Without a session this
 * redirects to /login (the login page never redirects back here unless signed in, so there is no
 * loop).
 */
export default function ProtectedLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { state, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/login");
    }
  }, [state.status, router]);

  if (state.status !== "authenticated") {
    return <p role="status">Loading…</p>;
  }

  async function onSignOut(): Promise<void> {
    setSigningOut(true);
    await signOut();
    // The state change above redirects to /login.
  }

  return (
    <>
      <nav className={styles.nav} aria-label="Account">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={pathname === link.href ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
        <span className={styles.navEnd}>
          <button
            className={styles.secondary}
            type="button"
            disabled={signingOut || confirmingLogout}
            onClick={() => {
              setConfirmingLogout(true);
            }}
          >
            Log out
          </button>
        </span>
      </nav>
      {confirmingLogout && (
        <div className={styles.notice} role="alertdialog" aria-labelledby="logout-warning">
          <p id="logout-warning">
            Logging out deletes your details and goals from FinVoice. You cannot get them back.
          </p>
          <div className={styles.actions}>
            <button
              className={styles.primary}
              type="button"
              disabled={signingOut}
              onClick={() => void onSignOut()}
            >
              Delete my data and log out
            </button>
            <button
              className={styles.secondary}
              type="button"
              disabled={signingOut}
              onClick={() => {
                setConfirmingLogout(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {children}
    </>
  );
}
