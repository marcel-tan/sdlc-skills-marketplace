import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["mcp-server/test/**/*.test.ts"],
  },
});
