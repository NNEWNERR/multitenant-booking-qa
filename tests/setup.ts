import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// Tests run against the same rules file that gets deployed — no second copy to
// drift out of sync.
const RULES_PATH = resolve(here, '../firestore.rules')

export const PROJECT_ID = 'demo-booking-qa'

export const TENANT_A = 'acme-air'
export const TENANT_B = 'globex-cooling'

let env: RulesTestEnvironment | null = null

export async function getTestEnv(): Promise<RulesTestEnvironment> {
  if (env) return env

  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
  const [hostname, port] = host.split(':')

  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host: hostname,
      port: Number(port),
    },
  })
  return env
}

export async function teardownTestEnv(): Promise<void> {
  await env?.cleanup()
  env = null
}

/** A signed-in user carrying tenant + role claims, the way the app issues them. */
export function user(
  env: RulesTestEnvironment,
  uid: string,
  tenantId: string,
  role: 'admin' | 'staff' | 'customer',
): RulesTestContext {
  return env.authenticatedContext(uid, { tenantId, role })
}

export function platformAdmin(env: RulesTestEnvironment, uid = 'root'): RulesTestContext {
  return env.authenticatedContext(uid, { role: 'platform_admin' })
}

export function guest(env: RulesTestEnvironment): RulesTestContext {
  return env.unauthenticatedContext()
}

/**
 * Writes seed data with the rules switched off.
 *
 * Seeding through the rules would mean a rules bug could block the setup of the
 * very test meant to catch it — the fixture has to be independent of the thing
 * under test.
 */
export async function seed(
  env: RulesTestEnvironment,
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const [collection, id] = path.split('/')
    const { doc, setDoc } = await import('firebase/firestore')
    await setDoc(doc(ctx.firestore(), collection, id), data)
  })
}
