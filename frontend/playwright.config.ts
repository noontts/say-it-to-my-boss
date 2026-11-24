import { defineConfig, devices } from '@playwright/test'

const backendPort = 48080
const frontendPort = 45173
const backendURL = `http://127.0.0.1:${backendPort}`
const frontendURL = `http://127.0.0.1:${frontendPort}`

export default defineConfig({
  testDir: './e2e',
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL: frontendURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] }, testMatch: '**/office.spec.ts' },
    { name: 'mobile-chromium', testIgnore: '**/office.spec.ts', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', testIgnore: '**/office.spec.ts', use: { ...devices['iPhone 13'] } },
  ],
  webServer: [
    {
      name: 'Go backend',
      command: 'go run ./cmd/server',
      cwd: '../backend',
      url: `${backendURL}/health`,
      env: {
        PORT: String(backendPort), SCENARIOS_DIR: '../scenarios',
        OPENROUTER_API_KEY: '', OPENROUTER_MODEL: '', MOCK_OPENROUTER: 'false',
        LM_STUDIO_MODEL: '',
        TTS_BACKEND_URL: process.env.TTS_BACKEND_URL ?? 'http://127.0.0.1:8091',
      },
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      name: 'Vite',
      command: `npm run dev -- --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      url: frontendURL,
      env: { VITE_API_TARGET: backendURL },
      reuseExistingServer: false,
    },
  ],
})
