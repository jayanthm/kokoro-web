import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 20000,
  retries: 1,
  reporter: "list",
  // No global browser setup — each test file uses chromium.launchPersistentContext
  // directly so the extension is properly loaded (standard browser fixture doesn't
  // support extensions in the same way).
});
