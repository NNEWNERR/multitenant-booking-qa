/**
 * Mobile-only checks.
 *
 * Runs on a real phone profile rather than a narrowed desktop window, because
 * the failures this file is about only exist once the layout switches: a sticky
 * header that overlaps a dialog, and controls that shrink below a usable size.
 *
 * Every assertion here answers "can the user act on it", not "is it on screen".
 * An element can be perfectly visible and still be impossible to tap.
 */
import { test, expect } from '@playwright/test'
import { STATE, open } from './helpers'

test.describe('booking detail on a phone', () => {
  test.use({ storageState: STATE.staff })


  test('the back button receives the tap, rather than the sticky header', async ({ page }) => {
    await open(page)
    await page.getByTestId('open-bk-pending').click()

    const back = page.getByTestId('modal-back')
    await expect(page.getByTestId('detail-modal')).toBeVisible()
    await expect(back).toBeVisible()

    // toBeVisible() passes for an element that something else is covering, so
    // it cannot catch this class of bug. Ask the browser what is actually at
    // the point the finger lands.
    //
    // The measurement has to happen inside the page: boundingBox() reports
    // page coordinates, while elementFromPoint expects viewport coordinates.
    // Mixing the two only diverges once the page is scrolled — which is why
    // getting it wrong produces a test that fails sometimes rather than always.
    const hit = await page.evaluate(() => {
      const target = document.querySelector('[data-testid="modal-back"]')
      if (!target) return 'missing'
      const rect = target.getBoundingClientRect()
      const el = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return el?.closest('[data-testid]')?.getAttribute('data-testid') ?? null
    })

    expect(hit, 'something is covering the back button').toBe('modal-back')
  })

  test('tapping back actually closes the dialog', async ({ page }) => {
    // The behavioural half of the check above: even with the right element on
    // top, the tap has to do something.
    await open(page)
    await page.getByTestId('open-bk-pending').click()
    await page.getByTestId('modal-back').tap()

    await expect(page.getByTestId('detail-modal')).toBeHidden()
    await expect(page.getByTestId('booking-list')).toBeVisible()
  })

  test('every action control clears the 44px target-size floor', async ({ page }) => {
    // WCAG 2.2 target size, checked where it matters — a control that is 30px
    // tall on a phone is a control people miss.
    await open(page)
    await page.getByTestId('open-bk-pending').click()
    // boundingBox() is a raw measurement with no waiting of its own — opening
    // the dialog is asynchronous, so measure only after a web-first assertion
    // has settled, or the first control reads as null.
    await expect(page.getByTestId('detail-modal')).toBeVisible()

    for (const id of ['action-confirm', 'action-complete', 'action-cancel', 'modal-back']) {
      const box = await page.getByTestId(id).boundingBox()
      expect(box, `${id} should have a layout box`).not.toBeNull()
      expect(box!.height, `${id} is below the 44px target floor`).toBeGreaterThanOrEqual(44)
    }
  })

  test('the page does not scroll sideways', async ({ page }) => {
    // Horizontal scroll on a phone is almost always a layout escape, and it is
    // the kind of thing that never shows up on a desktop run.
    await open(page)
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(overflows, 'the layout overflows horizontally').toBe(false)
  })
})
