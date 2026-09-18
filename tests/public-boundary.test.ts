/**
 * The public boundary — what a visitor with no tenant may touch.
 *
 * A booking page has to serve people who are not signed in to any organisation:
 * a guest, an anonymous session the app opened so `request.auth != null` holds,
 * or someone who has authenticated but has not been assigned a tenant yet.
 *
 * All three are the same thing to the rules — **a session carrying no tenant** —
 * and that is what this suite pins. They may read the service catalogue, which
 * a booking form needs to render. Everything else is closed: bookings carry
 * customer names, phone numbers and addresses; users and tenants are the
 * organisation's own records.
 *
 * Why spell it "no tenant claim" rather than "signed out": rules that only
 * check `request.auth == null` hand a live session more than a signed-out one,
 * and an attacker can always obtain a live session — sign-up flows hand them
 * out by design. The claim is the boundary; the sign-in state is not.
 *
 * Each case runs for all three session shapes, so a grant added for one of them
 * cannot quietly widen the others.
 */
import { afterAll, beforeEach, describe, test } from 'vitest'
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, setDoc, updateDoc } from 'firebase/firestore'
import type { RulesTestContext, RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  getTestEnv,
  teardownTestEnv,
  seed,
  guest,
  anonymous,
  claimless,
  TENANT_A,
  TENANT_B,
} from './setup'

const SESSIONS: Array<[string, (e: RulesTestEnvironment) => RulesTestContext]> = [
  ['guest (signed out)', guest],
  ['anonymous session', anonymous],
  ['signed in, no tenant yet', claimless],
]

beforeEach(async () => {
  const env = await getTestEnv()
  await env.clearFirestore()

  await seed(env, 'catalog/wash-a', { tenantId: TENANT_A, name: 'Aircon wash', price: 800 })
  await seed(env, 'catalog/wash-b', { tenantId: TENANT_B, name: 'Deep clean', price: 1200 })

  // A booking holds exactly what a leak would hand over: who, where, when.
  await seed(env, 'bookings/bk-a', {
    tenantId: TENANT_A, customerName: 'Somchai', phone: '0812345678',
    address: '12 Sukhumvit', status: 'pending',
  })
  await seed(env, 'users/staff-a', { tenantId: TENANT_A, role: 'staff', phone: '0899999999' })
  await seed(env, 'sites/site-a', { tenantId: TENANT_A, name: 'Branch A' })
  await seed(env, 'tenants/acme-air', { name: 'Acme Air' })
})

afterAll(async () => {
  await teardownTestEnv()
})

describe.each(SESSIONS)('%s — may read the catalogue', (_name, session) => {
  test('reads a catalogue item', async () => {
    const db = session(await getTestEnv()).firestore()
    await assertSucceeds(getDoc(doc(db, 'catalog/wash-a')))
  })

  test('lists the catalogue (the booking form needs the whole list)', async () => {
    const db = session(await getTestEnv()).firestore()
    await assertSucceeds(getDocs(collection(db, 'catalog')))
  })

  test('cannot write to the catalogue', async () => {
    const db = session(await getTestEnv()).firestore()
    await assertFails(setDoc(doc(db, 'catalog/injected'), { tenantId: TENANT_A, name: 'free' }))
    await assertFails(updateDoc(doc(db, 'catalog/wash-a'), { price: 0 }))
  })
})

describe.each(SESSIONS)('%s — everything else is closed', (_name, session) => {
  test('cannot read a booking (customer name, phone, address)', async () => {
    const db = session(await getTestEnv()).firestore()
    await assertFails(getDoc(doc(db, 'bookings/bk-a')))
  })

  test('cannot list bookings', async () => {
    const db = session(await getTestEnv()).firestore()
    await assertFails(getDocs(collection(db, 'bookings')))
  })

  test('cannot create a booking directly — that path belongs to the server', async () => {
    const db = session(await getTestEnv()).firestore()
    await assertFails(setDoc(doc(db, 'bookings/forged'), {
      tenantId: TENANT_A, customerName: 'Walk-in', status: 'confirmed',
    }))
  })

  test('cannot read staff records', async () => {
    const db = session(await getTestEnv()).firestore()
    await assertFails(getDoc(doc(db, 'users/staff-a')))
  })

  test('cannot read sites or the tenant record', async () => {
    const db = session(await getTestEnv()).firestore()
    await assertFails(getDoc(doc(db, 'sites/site-a')))
    await assertFails(getDoc(doc(db, 'tenants/acme-air')))
  })
})
