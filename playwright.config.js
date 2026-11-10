// Screen tests: Chromium at phone size, against the repository served locally.
// channel 'chromium' runs Playwright's full Chromium build headless, so the separate
// headless shell isn't needed: install with `npx playwright install chromium --no-shell`.
// Reduced motion is asked for by default, so screens hold still while they are measured;
// the tests of the motion itself ask for it again.
import { defineConfig } from '@playwright/test';

const PORT = 4370;

export default defineConfig({
  testDir: './tests/screen',
  outputDir: './test-results',
  reporter: 'list',
  forbidOnly: true,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: 'chromium',
    channel: 'chromium',
    viewport: { width: 360, height: 800 },
    reducedMotion: 'reduce',
  },
  webServer: {
    command: `node tests/server.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 15000,
  },
});
