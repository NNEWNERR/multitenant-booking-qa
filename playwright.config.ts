import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  // One emulator holding one dataset, shared by every test: a second worker
  // means two browsers mutating the same bookings at once, and a suite that
  // fails on a different test each run. Same reason the rules suite sets
  // fileParallelism: false.
  workers: 1,
  forbidOnly: isCI,
  retries: 0, // the app and its data are local and deterministic; a flake here is a bug
  timeout: 60_000,
  // 20s, not the usual 10s: the first query after the emulator boots can take
  // several seconds on a loaded machine, and a wait that is too tight turns
  // "slow" into "failed". Slow is not broken — and the fix for a slow
  // dependency is an honest timeout, not a retry that hides it.
  expect: { timeout: 20_000 },
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],

  // Seeds users and bookings into the emulator before anything runs. The tests
  // therefore start from a known state instead of whatever the last run left.
  globalSetup: './tests/ui/global-setup.ts',

  use: {
    baseURL: 'http://127.0.0.1:5173',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
    actionTimeout: 10_000,
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: '**/mobile.spec.ts' },
    // Not a narrowed desktop window: a real mobile profile, because the bug
    // this guards against only appears once the layout switches.
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: '**/mobile.spec.ts' },
  ],

  // Playwright owns the dev server, so `npm run test:ui` is the whole command —
  // nobody has to remember to start the app in another terminal.
  webServer: {
    command: 'npm run app',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
})
