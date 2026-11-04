import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', workers: 1, timeout: 45000,
  use: { baseURL: 'http://localhost:4310', channel: 'msedge', headless: true, trace: 'retain-on-failure' } });
