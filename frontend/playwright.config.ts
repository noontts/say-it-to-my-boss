import { defineConfig } from '@playwright/test'

const backendPort = 48080
const frontendPort = 45173
const backendURL = `http://127.0.0.1:${backendPort}`
const frontendURL = `http://127.0.0.1:${frontendPort}`

export default defineConfig({
  testDir: './e2e',
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL: frontendURL,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      name: 'Go backend',
      command: 'go run ./cmd/server',
      cwd: '../backend',
      url: `${backendURL}/health`,
      env: {
        PORT: String(backendPort), SCENARIOS_DIR: '../scenarios',
        OPENROUTER_API_KEY: '', OPENROUTER_MODEL: '', MOCK_OPENROUTER: 'false',
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
