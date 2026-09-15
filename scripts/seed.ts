/**
 * Seeds the emulators with the demo users and bookings the UI tests drive.
 *
 * Talks to the Auth emulator over its REST API rather than through the Admin
 * SDK. Two reasons: the Admin SDK drags in a dependency tree that Playwright's
 * module loader cannot resolve inside globalSetup, and the REST calls make it
 * obvious that tenant and role are *custom claims minted by a privileged
 * caller* — never something the browser can set for itself.
 *
 * Every endpoint below is emulator-only, so this script has no way to reach a
 * real project even by accident.
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const PROJECT_ID = 'demo-booking-qa'
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'
const AUTH = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1`
const ADMIN = `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}`

export const PASSWORD = 'demo1234'
export const TENANT_A = 'acme-air'
export const TENANT_B = 'globex-cooling'

const PEOPLE = [
  { email: 'admin@acme.test', tenantId: TENANT_A, role: 'admin' },
  { email: 'staff@acme.test', tenantId: TENANT_A, role: 'staff' },
  { email: 'cust@acme.test', tenantId: TENANT_A, role: 'customer' },
  { email: 'other@acme.test', tenantId: TENANT_A, role: 'customer' },
  { email: 'staff@globex.test', tenantId: TENANT_B, role: 'staff' },
]

async function post(url: string, body: unknown, auth = false) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: 'Bearer owner' } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${url} → ${res.status} ${await res.text()}`)
  return res.json() as Promise<Record<string, string>>
}

async function createUser(email: string, claims: Record<string, string>) {
  const { localId } = await post(`${AUTH}/accounts:signUp?key=demo-key`, {
    email,
    password: PASSWORD,
    returnSecureToken: true,
  })

  // customAttributes is how the emulator stores custom claims; they land in the
  // ID token the browser then sends with every Firestore request.
  await post(
    `${AUTH}/projects/${PROJECT_ID}/accounts:update`,
    { localId, customAttributes: JSON.stringify(claims) },
    true,
  )

  return localId
}

export async function seedEmulators() {
  // Wipe first. A seed that appends to whatever the last run left behind makes
  // tests pass for reasons nobody chose.
  await fetch(`${ADMIN}/accounts`, { method: 'DELETE' })

  const uid: Record<string, string> = {}
  for (const person of PEOPLE) {
    uid[person.email] = await createUser(person.email, {
      tenantId: person.tenantId,
      role: person.role,
    })
  }

  const customer = uid['cust@acme.test']
  const other = uid['other@acme.test']

  const bookings = [
    { id: 'bk-pending', tenantId: TENANT_A, status: 'pending', customerId: customer, title: 'Aircon service — Mon 09:00' },
    { id: 'bk-confirmed', tenantId: TENANT_A, status: 'confirmed', customerId: customer, title: 'Deep clean — Tue 13:00' },
    { id: 'bk-completed', tenantId: TENANT_A, status: 'completed', customerId: other, title: 'Filter change — last week' },
    { id: 'bk-other-customer', tenantId: TENANT_A, status: 'pending', customerId: other, title: 'Install survey — Thu 10:00' },
    { id: 'bk-globex', tenantId: TENANT_B, status: 'pending', customerId: 'someone-else', title: 'Globex — chiller check' },
    // Spelled the way documents were written before the multi-tenant migration.
    { id: 'bk-legacy', tenant_id: TENANT_A, status: 'pending', customerId: customer, title: 'Legacy record — Fri 15:00' },
  ]

  // Seeding runs with the rules switched off: a rules bug must not be able to
  // block the setup of the very test written to catch it.
  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(here, '../firestore.rules'), 'utf8') },
  })
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const { id, ...data } of bookings) {
      await setDoc(doc(ctx.firestore(), 'bookings', id), data)
    }
  })
  await env.cleanup()

  console.log(`seeded ${PEOPLE.length} users and ${bookings.length} bookings`)
  return { uid, customer, other }
}
