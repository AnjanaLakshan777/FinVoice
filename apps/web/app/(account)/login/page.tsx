import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in | FinVoice",
  description: "Sign in to FinVoice with your mobile number.",
};

export default function LoginPage() {
  return (
    <>
      <h1>Sign in to FinVoice</h1>
      <LoginForm />
    </>
  );
}
