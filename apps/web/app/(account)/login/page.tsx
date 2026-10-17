import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Get started | FinVoice",
  description: "Start using FinVoice: choose your language. No phone number or password needed.",
};

export default function LoginPage() {
  return (
    <>
      <h1>Get started with FinVoice</h1>
      <LoginForm />
    </>
  );
}
