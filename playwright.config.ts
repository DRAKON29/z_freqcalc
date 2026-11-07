/**
 * Playwright E2E: приложение должно быть уже запущено
 * (dev: NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000/api bun run dev + python-сервис :8000,
 *  CI: docker compose up перед прогоном — см. .github/workflows/ci.yml).
 */
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },
  // PLAYWRIGHT_CHANNEL (например msedge) — для машин без права скачать playwright-chromium
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) } }],
})
