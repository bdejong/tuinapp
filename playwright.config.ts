import { defineConfig } from '@playwright/test';
export default defineConfig({
  projects: [{name: 'chromium', use: {browserName:'chromium'}}, {name: 'firefox', use: {browserName:'firefox'}}, ...(process.env.TUINAPP_TEST_WEBKIT ? [{name: 'webkit', use: {browserName:'webkit' as const}}] : [])],
  testDir: './tests/browser', fullyParallel: false, workers: 1,
  timeout: 30000, use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/e2e-server.mjs', url: 'http://127.0.0.1:4173/health', reuseExistingServer: false, timeout: 120000 },
});
