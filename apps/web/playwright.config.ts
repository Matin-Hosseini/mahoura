import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
});
