import { expect, type Page } from '@playwright/test'

export const PASSWORD = 'demo1234'

export const PEOPLE = {
  admin: 'admin@acme.test',
  staff: 'staff@acme.test',
  customer: 'cust@acme.test',
  otherTenantStaff: 'staff@globex.test',
} as const

/** Session files written once by globalSetup — see tests/ui/global-setup.ts. */
export const STATE = {
  staff: '.auth/staff.json',
  customer: '.auth/customer.json',
}

/**
 * Opens the app with the stored session, and waits for real data.
 *
 * Restoring a Firebase session means restoring IndexedDB, and that occasionally
 * does not take — the page comes up showing the login form instead. Rather than
 * letting that surface as a mystery timeout in whichever test drew the short
 * straw, detect it and sign in through the form. The fallback is visible in the
 * report (the run takes the slow path) and never silently skips a check.
 */
export async function open(page: Page, who: keyof typeof PEOPLE = 'staff', path = '/') {
  await page.goto(path)

  // Wait for the app to decide, rather than reading a screen that has not
  // settled: the login form is present on first paint whether or not a session
  // is about to restore.
  // Generous on purpose: this is a readiness wait, not an assertion about the
  // product. Restoring a session goes through the Auth emulator, which is
  // single-threaded and can be busy right after the rules suite has hammered
  // it. waitForSelector keeps its own 10s default regardless of expect.timeout.
  await page.waitForSelector('body[data-auth]', { timeout: 30_000 })
  if ((await page.locator('body').getAttribute('data-auth')) === 'out') {
    await signInThroughForm(page, PEOPLE[who])
  }

  await expect(page.getByTestId('booking-list').locator('li').first()).toBeVisible()
}

/** Signs in through the form — for the tests where the form is the subject. */
export async function signInThroughForm(page: Page, email: string, password = PASSWORD) {
  await page.goto('/')
  await page.getByTestId('email').fill(email)
  await page.getByTestId('password').fill(password)
  await page.getByTestId('login-btn').click()
}
