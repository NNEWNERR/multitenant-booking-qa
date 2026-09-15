/**
 * UI tests for the Booking Desk.
 *
 * The point of testing this app through a browser, when the rules already have
 * 52 unit tests, is that a user meets the rules through a screen: what the list
 * shows them, whether a refusal surfaces or is swallowed, and whether the
 * session survives the things users actually do — like reloading the page.
 */
import { test, expect } from '@playwright/test'
import { PEOPLE, STATE, open, signInThroughForm } from './helpers'

test.describe('what each role sees', () => {
  test.use({ storageState: STATE.staff })


  test('staff sees every booking in their own tenant', async ({ page }) => {
    await open(page)
    await expect(page.getByTestId('booking-bk-pending')).toBeVisible()
    await expect(page.getByTestId('booking-bk-other-customer')).toBeVisible()
  })

  test('staff never sees another tenant booking', async ({ page }) => {
    // The deny that matters most, seen from the screen: the rules refuse it,
    // and the UI simply has nothing to render.
    await open(page)
    await expect(page.getByTestId('booking-bk-globex')).toHaveCount(0)
  })


  test('the header names who is signed in and where', async ({ page }) => {
    await open(page)
    await expect(page.getByTestId('who')).toContainText('staff')
    await expect(page.getByTestId('who')).toContainText('acme-air')
  })
})

test.describe('as a customer', () => {
  test.use({ storageState: STATE.customer })

  test('a customer sees only their own booking', async ({ page }) => {
    await open(page, 'customer')
    await expect(page.getByTestId('booking-bk-pending')).toBeVisible()
    await expect(page.getByTestId('booking-bk-other-customer')).toHaveCount(0)
  })

  test('a customer cannot change their own booking', async ({ page }) => {
    await open(page, 'customer')
    await page.getByTestId('open-bk-confirmed').click()
    await page.getByTestId('action-complete').click()

    await expect(page.getByTestId('action-error')).toBeVisible()
    await expect(page.getByTestId('modal-status')).toHaveText('confirmed')
  })
})

test.describe('sign-in', () => {
  // No stored session here on purpose: these tests are about the form itself.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('a wrong password is refused with one unhelpful message', async ({ page }) => {
    await signInThroughForm(page, PEOPLE.staff, 'not-the-password')

    await expect(page.getByTestId('login-error')).toBeVisible()
    // Same wording as an unknown account on purpose — the message must not tell
    // an attacker which half they got right.
    await expect(page.getByTestId('login-error')).toContainText('Check the email and password')
    await expect(page.getByTestId('booking-list')).toBeHidden()
  })

  test('a deep link opened without a session lands on the form, not a crash', async ({ page }) => {
    await page.goto('/?booking=bk-pending')
    await expect(page.getByTestId('login-btn')).toBeVisible()
    await expect(page.getByTestId('detail-modal')).toBeHidden()
  })

  test('signing out returns to the form and clears the list', async ({ page }) => {
    await signInThroughForm(page, PEOPLE.staff)
    await expect(page.getByTestId('booking-list').locator('li').first()).toBeVisible()
    await page.getByTestId('logout-btn').click()
    await expect(page.getByTestId('login-btn')).toBeVisible()
    await expect(page.getByTestId('booking-list')).toBeHidden()
  })
})

test.describe('acting on a booking', () => {
  test.use({ storageState: STATE.staff })


  test('staff confirms a pending booking', async ({ page }) => {
    await open(page)
    await page.getByTestId('open-bk-pending').click()
    await expect(page.getByTestId('modal-status')).toHaveText('pending')

    await page.getByTestId('action-confirm').click()
    await expect(page.getByTestId('modal-status')).toHaveText('confirmed')
    await expect(page.getByTestId('action-error')).toBeHidden()
  })

  test('a refused transition surfaces as an error instead of a silent no-op', async ({ page }) => {
    // The completed booking is terminal. The button is deliberately still
    // there: an action that is refused by the database must be visible as a
    // refusal, not hidden so nobody can test it.
    await open(page)
    await page.getByTestId('open-bk-completed').click()
    await page.getByTestId('action-cancel').click()

    await expect(page.getByTestId('action-error')).toBeVisible()
    await expect(page.getByTestId('modal-status')).toHaveText('completed')
  })

  test('a booking written before the migration is missing from the list', async ({ page }) => {
    // Found by writing this test, and worth keeping as documentation of a real
    // migration gap: the *rules* accept either spelling of the owner field, but
    // a *query* cannot — it filters on one field name, and the legacy document
    // spells it the other way. So a document the rules would happily return is
    // still invisible on screen. Rules tests alone cannot see this; only
    // driving the screen does.
    await open(page)
    await expect(page.getByTestId('booking-bk-legacy')).toHaveCount(0)
  })

  test('…but it is still reachable, and editable, by direct link', async ({ page }) => {
    // The other half of the finding: fetching the document by id goes through
    // the rules, which do understand both spellings.
    await open(page)
    await page.goto('/?booking=bk-legacy')
    await expect(page.getByTestId('modal-title')).toContainText('Legacy record')

    await page.getByTestId('action-confirm').click()
    await expect(page.getByTestId('modal-status')).toHaveText('confirmed')
    await expect(page.getByTestId('action-error')).toBeHidden()
  })
})

test.describe('the session survives what users actually do', () => {
  test.use({ storageState: STATE.staff })


  test('reloading on a deep link keeps the session and reopens the booking', async ({ page }) => {
    // The case manual testing misses, because nobody reloads halfway through a
    // click-through — and the case users hit every day with a bookmark.
    await open(page)
    await page.getByTestId('open-bk-pending').click()
    await expect(page).toHaveURL(/booking=bk-pending/)

    await page.reload()

    await expect(page.getByTestId('booking-list')).toBeVisible()
    await expect(page.getByTestId('detail-modal')).toBeVisible()
    await expect(page.getByTestId('modal-title')).toContainText('Aircon service')
  })
})
