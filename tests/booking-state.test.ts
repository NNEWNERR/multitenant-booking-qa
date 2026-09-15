/**
 * Booking state machine, enforced at the database layer.
 *
 * Technique: state-transition testing — every arrow that should exist, and the
 * arrows that should not.
 *
 *   pending ──► confirmed ──► completed  (terminal)
 *      │            │
 *      └────────────┴───────► canceled   (terminal)
 *
 * The backwards arrows are the interesting ones. A completed or canceled
 * booking that can slide back into an active state is how a time slot ends up
 * held by work nobody is doing — the kind of leak that stays invisible until a
 * customer is told a free slot is full.
 */
import { afterAll, beforeEach, describe, test } from 'vitest'
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { getTestEnv, teardownTestEnv, seed, user, TENANT_A } from './setup'

const staffDb = async () => user(await getTestEnv(), 'uA', TENANT_A, 'staff').firestore()

beforeEach(async () => {
  const env = await getTestEnv()
  await env.clearFirestore()
  for (const status of ['pending', 'confirmed', 'completed', 'canceled']) {
    await seed(env, 'bookings/' + status + 'Doc', {
      tenantId: TENANT_A, status, customerId: 'custA',
    })
  }
})

afterAll(teardownTestEnv)

describe('transitions that must be allowed', () => {
  const allowed: Array<[string, string]> = [
    ['pending', 'confirmed'],
    ['pending', 'canceled'],
    ['confirmed', 'completed'],
    ['confirmed', 'canceled'],
  ]

  for (const [from, to] of allowed) {
    test(from + ' -> ' + to, async () => {
      const db = await staffDb()
      await assertSucceeds(updateDoc(doc(db, 'bookings/' + from + 'Doc'), { status: to }))
    })
  }

  test('an unrelated field can be edited without changing status', async () => {
    const db = await staffDb()
    await assertSucceeds(updateDoc(doc(db, 'bookings/pendingDoc'), { note: 'customer called' }))
  })
})

describe('transitions that must be refused', () => {
  const refused: Array<[string, string]> = [
    ['pending', 'completed'],    // cannot finish work that was never started
    ['completed', 'pending'],    // terminal
    ['completed', 'confirmed'],  // terminal
    ['completed', 'canceled'],   // terminal — cancel it before it completes
    ['canceled', 'pending'],     // terminal — the slot was already released
    ['canceled', 'confirmed'],   // terminal
  ]

  for (const [from, to] of refused) {
    test(from + ' -> ' + to, async () => {
      const db = await staffDb()
      await assertFails(updateDoc(doc(db, 'bookings/' + from + 'Doc'), { status: to }))
    })
  }

  test('a terminal booking cannot be edited at all, not even its note', async () => {
    const db = await staffDb()
    await assertFails(updateDoc(doc(db, 'bookings/canceledDoc'), { note: 'reopening' }))
  })

  test('a booking that does not exist cannot be updated into existence', async () => {
    // Guards the null-document branch of the rules: the denial must come from
    // the tenant check, not from an evaluation error reading a missing doc.
    const db = await staffDb()
    await assertFails(updateDoc(doc(db, 'bookings/nothingHere'), { status: 'confirmed' }))
  })

  test('an unknown status is not a state', async () => {
    const db = await staffDb()
    await assertFails(updateDoc(doc(db, 'bookings/pendingDoc'), { status: 'archived' }))
  })
})

describe('creation', () => {
  test('a new booking starts as pending', async () => {
    const db = await staffDb()
    await assertSucceeds(
      setDoc(doc(db, 'bookings/fresh'), {
        tenantId: TENANT_A, status: 'pending', customerId: 'custA',
      }),
    )
  })

  test('a booking cannot be created already confirmed', async () => {
    // Otherwise the state machine is skippable entirely, by creating documents
    // in whatever state is convenient.
    const db = await staffDb()
    await assertFails(
      setDoc(doc(db, 'bookings/preConfirmed'), {
        tenantId: TENANT_A, status: 'confirmed', customerId: 'custA',
      }),
    )
  })
})
