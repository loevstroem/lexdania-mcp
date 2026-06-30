import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Core tests (domain + adapters) run in plain Node — no Workers runtime, no network.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
