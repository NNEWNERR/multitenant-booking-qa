import { chromium, type FullConfig } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { seedEmulators, PASSWORD } from '../../scripts/seed'

export const STATE_DIR = '.auth'
export const STATE = {
  staff: `${STATE_DIR}/staff.json`,
  customer: `${STATE_DIR}/customer.json`,
}

/**
 * Runs once before the UI suite.
 *
 * Seeds the emulator, then signs each role in a single time and saves the
 * session. Seventeen tests that each replay the login form means seventeen
 * round-trips through Auth and seventeen fresh Firestore listeners against a
 * single-threaded emulator — which is slow, and which was making a different
 * test time out on roughly one run in three. Signing in once is both the
 * faster arrangement and the stable one; the login form still gets its own
 * tests, where it is the thing under test rather than setup.
 *
 * Firebase keeps its session in IndexedDB, so the saved state has to include
 * it — a cookie-only snapshot would restore nothing.
 */
export default async function globalSetup(config: FullConfig) {
  await seedEmulators()
  mkdirSync(STATE_DIR, { recursive: true })

  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://127.0.0.1:5173'
  const browser = await chromium.launch()

  try {
    await capture(browser, baseURL, 'staff@acme.test', STATE.staff)
    await capture(browser, baseURL, 'cust@acme.test', STATE.customer)
  } finally {
    await browser.close()
  }
}

async function capture(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  baseURL: string,
  email: string,
  path: string,
) {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()

  await page.goto('/')
  await page.getByTestId('email').fill(email)
  await page.getByTestId('password').fill(PASSWORD)
  await page.getByTestId('login-btn').click()
  // Wait for the data, not just the shell: the session is only worth saving
  // once the claims have landed and a query has actually succeeded.
  await page.getByTestId('booking-list').locator('li').first().waitFor({ timeout: 30_000 })

  await context.storageState({ path, indexedDB: true })
  await context.close()
}
