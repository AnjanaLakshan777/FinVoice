import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>FinVoice</h1>
      <p>
        <Link href="/voice">Talk to FinVoice</Link>
      </p>
      <p>
        <Link href="/login">Sign in</Link> · <Link href="/dashboard">My account</Link>
      </p>
    </main>
  );
}
