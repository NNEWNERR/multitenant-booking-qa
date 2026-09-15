/**
 * Legacy field naming — the defect this suite exists to prevent.
 *
 * A real system that has been migrated carries two generations of documents at
 * once: older ones spelling the owner field `tenant_id`, newer ones `tenantId`.
 * A rule that reads only the new spelling sees an empty owner on old documents,
 * and a document with no owner in the eyes of the rules is one the rules judge
 * wrongly — either locking out the tenant that owns it, or worse, matching it
 * against someone else's empty claim.
 *
 * This is invisible to UI testing, because the current UI always writes the new
 * spelling. It only appears if the fixture deliberately seeds the old shape.
 */
import { afterAll, beforeEach, describe, test } from 'vitest'
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import {
  getTestEnv, teardownTestEnv, seed, user, TENANT_A, TENANT_B,
} from './setup'

beforeEach(async () => {
  const env = await getTestEnv()
  await env.clearFirestore()
  // snake_case only — a document written before the migration.
  await seed(env, 'bookings/legacyA', { tenant_id: TENANT_A, status: 'pending', customerId: 'custA' })
  await seed(env, 'sites/legacySiteA', { tenant_id: TENANT_A, name: 'Legacy Site A' })
  // Both spellings present — camelCase must win, consistently.
  await seed(env, 'bookings/mixed', {
    tenantId: TENANT_A, tenant_id: TENANT_B, status: 'pending', customerId: 'custA',
  })
})

afterAll(teardownTestEnv)

describe('old documents stay reachable by the tenant that owns them', () => {
  test('staff reads a snake_case booking of their own tenant', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uA', TENANT_A, 'staff').firestore()
    await assertSucceeds(getDoc(doc(db, 'bookings/legacyA')))
  })

  test('staff reads a snake_case site of their own tenant', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uA', TENANT_A, 'staff').firestore()
    await assertSucceeds(getDoc(doc(db, 'sites/legacySiteA')))
  })

  test('staff updates a snake_case booking of their own tenant', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uA', TENANT_A, 'staff').firestore()
    await assertSucceeds(updateDoc(doc(db, 'bookings/legacyA'), { status: 'confirmed' }))
  })
})

describe('old documents are not a hole in the wall', () => {
  test('another tenant still cannot READ a snake_case booking', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uB', TENANT_B, 'staff').firestore()
    await assertFails(getDoc(doc(db, 'bookings/legacyA')))
  })

  test('another tenant still cannot UPDATE a snake_case booking', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uB', TENANT_B, 'staff').firestore()
    await assertFails(updateDoc(doc(db, 'bookings/legacyA'), { status: 'canceled' }))
  })

  test('another tenant admin still cannot DELETE a snake_case booking', async () => {
    const env = await getTestEnv()
    const db = user(env, 'aB', TENANT_B, 'admin').firestore()
    await assertFails(deleteDoc(doc(db, 'bookings/legacyA')))
  })

  test('role limits still apply on snake_case documents', async () => {
    // Same tenant, but staff may not delete — the legacy path must not become a
    // shortcut around the role check either.
    const env = await getTestEnv()
    const db = user(env, 'uA', TENANT_A, 'staff').firestore()
    await assertFails(deleteDoc(doc(db, 'bookings/legacyA')))
  })
})

describe('when both spellings are present', () => {
  test('camelCase wins — the tenant it names gets access', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uA', TENANT_A, 'staff').firestore()
    await assertSucceeds(getDoc(doc(db, 'bookings/mixed')))
  })

  test('camelCase wins — the tenant named only by snake_case does not', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uB', TENANT_B, 'staff').firestore()
    await assertFails(getDoc(doc(db, 'bookings/mixed')))
  })
})
