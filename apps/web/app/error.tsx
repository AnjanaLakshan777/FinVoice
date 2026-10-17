"use client";

import { useEffect } from "react";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="fv-page">
      <h1>Something went wrong</h1>
      <button type="button" className="fv-button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
