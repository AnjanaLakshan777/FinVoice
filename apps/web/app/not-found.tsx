import Link from "next/link";

export default function NotFound() {
  return (
    <main className="fv-page">
      <h1>Page not found</h1>
      <Link href="/" className="fv-button">
        Return home
      </Link>
    </main>
  );
}
