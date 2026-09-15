/**
 * Role permissions — a decision table, one test per cell.
 *
 * Adding a role to a system is rarely a one-file change: every place that
 * decides something from a role is a place the new role can be forgotten, and
 * the failure is silent — the user simply cannot see or do something, with no
 * error raised anywhere. A table like this turns that gap into a failing test
 * instead of a support ticket.
 */
import { afterAll, beforeEach, describe, test } from 'vitest'
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { getTestEnv, teardownTestEnv, seed, user, TENANT_A } from './setup'

beforeEach(async () => {
  const env = await getTestEnv()
  await env.clearFirestore()
  await seed(env, 'bookings/mine', { tenantId: TENANT_A, status: 'pending', customerId: 'cust1' })
  await seed(env, 'bookings/theirs', { tenantId: TENANT_A, status: 'pending', customerId: 'cust2' })
  await seed(env, 'users/staff1', { tenantId: TENANT_A, role: 'staff' })
  await seed(env, 'sites/siteA', { tenantId: TENANT_A, name: 'Site A' })
})

afterAll(teardownTestEnv)

describe('customer — their own booking and nothing more', () => {
  test('reads their own booking', async () => {
    const env = await getTestEnv()
    const db = user(env, 'cust1', TENANT_A, 'customer').firestore()
    await assertSucceeds(getDoc(doc(db, 'bookings/mine')))
  })

  test('cannot read another customer booking in the same tenant', async () => {
    const env = await getTestEnv()
    const db = user(env, 'cust1', TENANT_A, 'customer').firestore()
    await assertFails(getDoc(doc(db, 'bookings/theirs')))
  })

  test('cannot change a booking status', async () => {
    const env = await getTestEnv()
    const db = user(env, 'cust1', TENANT_A, 'customer').firestore()
    await assertFails(updateDoc(doc(db, 'bookings/mine'), { status: 'confirmed' }))
  })

  test('cannot read the staff directory', async () => {
    const env = await getTestEnv()
    const db = user(env, 'cust1', TENANT_A, 'customer').firestore()
    await assertFails(getDoc(doc(db, 'users/staff1')))
  })
})

describe('staff — operates bookings, does not administer', () => {
  test('reads any booking in the tenant', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uA', TENANT_A, 'staff').firestore()
    await assertSucceeds(getDoc(doc(db, 'bookings/theirs')))
  })

  test('confirms a booking', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uA', TENANT_A, 'staff').firestore()
    await assertSucceeds(updateDoc(doc(db, 'bookings/mine'), { status: 'confirmed' }))
  })

  test('cannot delete a booking', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uA', TENANT_A, 'staff').firestore()
    await assertFails(deleteDoc(doc(db, 'bookings/mine')))
  })

  test('cannot delete a site', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uA', TENANT_A, 'staff').firestore()
    await assertFails(deleteDoc(doc(db, 'sites/siteA')))
  })

  test('cannot edit a user record', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uA', TENANT_A, 'staff').firestore()
    await assertFails(updateDoc(doc(db, 'users/staff1'), { role: 'admin' }))
  })
})

describe('admin — full control inside their own tenant', () => {
  test('deletes a booking', async () => {
    const env = await getTestEnv()
    const db = user(env, 'aA', TENANT_A, 'admin').firestore()
    await assertSucceeds(deleteDoc(doc(db, 'bookings/mine')))
  })

  test('edits a user record', async () => {
    const env = await getTestEnv()
    const db = user(env, 'aA', TENANT_A, 'admin').firestore()
    await assertSucceeds(updateDoc(doc(db, 'users/staff1'), { role: 'admin' }))
  })

  test('still cannot skip the state machine', async () => {
    // Authority over data is not permission to break an invariant.
    const env = await getTestEnv()
    const db = user(env, 'aA', TENANT_A, 'admin').firestore()
    await assertFails(updateDoc(doc(db, 'bookings/mine'), { status: 'completed' }))
  })
})

describe('an unrecognised role gets nothing', () => {
  test('a role nobody has granted cannot read bookings', async () => {
    // New roles must be named explicitly; an unknown claim is not a free pass
    // to whatever the rules forgot to mention.
    const env = await getTestEnv()
    const db = env.authenticatedContext('x', { tenantId: TENANT_A, role: 'auditor' }).firestore()
    await assertFails(getDoc(doc(db, 'bookings/mine')))
  })
})
