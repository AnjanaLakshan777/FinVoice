import { defineConfig } from "vitest/config";

// Browser APIs (WebSocket, getUserMedia, Web Audio) are replaced with fakes in each test; jsdom
// provides the DOM for rendering components.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
