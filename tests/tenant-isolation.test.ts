/**
 * Tenant isolation — the property the whole platform rests on.
 *
 * Technique: negative testing over a decision table.
 *   actor (tenant A staff / tenant B staff / platform admin / guest)
 *     × document owner (tenant A / tenant B)
 *       × operation (read / create / update / delete)
 *
 * A suite made only of success cases cannot prove data does not leak, so the
 * deny cases below are the point — the allow cases exist to prove the rules did
 * not simply lock everyone out, which would pass a deny-only suite perfectly.
 */
import { afterAll, beforeEach, describe, test } from 'vitest'
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import {
  getTestEnv, teardownTestEnv, seed, user, platformAdmin, guest,
  TENANT_A, TENANT_B,
} from './setup'

beforeEach(async () => {
  const env = await getTestEnv()
  await env.clearFirestore()
  await seed(env, 'bookings/bkA', { tenantId: TENANT_A, status: 'pending', customerId: 'custA' })
  await seed(env, 'bookings/bkB', { tenantId: TENANT_B, status: 'pending', customerId: 'custB' })
  await seed(env, 'sites/siteA', { tenantId: TENANT_A, name: 'Site A' })
  await seed(env, 'sites/siteB', { tenantId: TENANT_B, name: 'Site B' })
})

afterAll(teardownTestEnv)

describe('own tenant — the happy path must stay open', () => {
  test('staff reads a booking in their own tenant', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uA', TENANT_A, 'staff').firestore()
    await assertSucceeds(getDoc(doc(db, 'bookings/bkA')))
  })

  test('staff updates a booking in their own tenant', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uA', TENANT_A, 'staff').firestore()
    await assertSucceeds(updateDoc(doc(db, 'bookings/bkA'), { status: 'confirmed' }))
  })

  test('admin deletes a booking in their own tenant', async () => {
    const env = await getTestEnv()
    const db = user(env, 'aA', TENANT_A, 'admin').firestore()
    await assertSucceeds(deleteDoc(doc(db, 'bookings/bkA')))
  })

  test('staff reads a site in their own tenant', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uA', TENANT_A, 'staff').firestore()
    await assertSucceeds(getDoc(doc(db, 'sites/siteA')))
  })
})

describe('across tenants — every operation must be refused', () => {
  test('tenant B staff cannot READ a tenant A booking', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uB', TENANT_B, 'staff').firestore()
    await assertFails(getDoc(doc(db, 'bookings/bkA')))
  })

  test('tenant B staff cannot UPDATE a tenant A booking', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uB', TENANT_B, 'staff').firestore()
    await assertFails(updateDoc(doc(db, 'bookings/bkA'), { status: 'canceled' }))
  })

  test('tenant B admin cannot DELETE a tenant A booking', async () => {
    const env = await getTestEnv()
    const db = user(env, 'aB', TENANT_B, 'admin').firestore()
    await assertFails(deleteDoc(doc(db, 'bookings/bkA')))
  })

  test('tenant B staff cannot READ a tenant A site', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uB', TENANT_B, 'staff').firestore()
    await assertFails(getDoc(doc(db, 'sites/siteA')))
  })

  test('a user cannot create a booking stamped with someone else tenant', async () => {
    const env = await getTestEnv()
    const db = user(env, 'uA', TENANT_A, 'staff').firestore()
    await assertFails(
      setDoc(doc(db, 'bookings/planted'), {
        tenantId: TENANT_B, status: 'pending', customerId: 'custA',
      }),
    )
  })

  test('a booking cannot be handed to another tenant by rewriting its owner', async () => {
    const env = await getTestEnv()
    const db = user(env, 'aA', TENANT_A, 'admin').firestore()
    await assertFails(updateDoc(doc(db, 'bookings/bkA'), { tenantId: TENANT_B }))
  })
})

describe('no tenant claim at all', () => {
  test('a guest cannot read anything', async () => {
    const env = await getTestEnv()
    const db = guest(env).firestore()
    await assertFails(getDoc(doc(db, 'bookings/bkA')))
  })

  test('a signed-in user with an empty tenant claim cannot read', async () => {
    // Regression guard: an empty claim must not match documents whose owner
    // field is missing — "nobody" is not a tenant.
    const env = await getTestEnv()
    await seed(env, 'bookings/orphan', { status: 'pending' })
    const db = env.authenticatedContext('drifter', { role: 'staff' }).firestore()
    await assertFails(getDoc(doc(db, 'bookings/orphan')))
  })
})

describe('platform admin — deliberately above the tenant line', () => {
  test('reads across tenants', async () => {
    const env = await getTestEnv()
    const db = platformAdmin(env).firestore()
    await assertSucceeds(getDoc(doc(db, 'bookings/bkA')))
    await assertSucceeds(getDoc(doc(db, 'bookings/bkB')))
  })

  test('still cannot write tenant data', async () => {
    // Read-everything is for support; write-everything is not.
    const env = await getTestEnv()
    const db = platformAdmin(env).firestore()
    await assertFails(updateDoc(doc(db, 'bookings/bkA'), { status: 'canceled' }))
  })
})
