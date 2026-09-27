import type { NextConfig } from "next";

// The admin dashboard's server-only settings (INTERNAL_API_URL, INTERNAL_API_TOKEN, …) are read at
// request time by lib/admin/config.ts, never here: values set during `next build` could end up in
// build output or caches, and the `env` option below would inline them into browser bundles.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `next dev` would otherwise write AGENTS.md and CLAUDE.md into apps/web when it detects an AI
  // coding agent. They are tooling files, not part of the application.
  agentRules: false,
};

export default nextConfig;
