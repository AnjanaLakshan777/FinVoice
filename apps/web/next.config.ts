import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `next dev` would otherwise write AGENTS.md and CLAUDE.md into apps/web when it detects an AI
  // coding agent. They are tooling files, not part of the application.
  agentRules: false,
};

export default nextConfig;
