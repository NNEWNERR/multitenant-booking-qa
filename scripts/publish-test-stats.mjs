// Publishes one CI test run's totals to the portfolio's Firestore
// (projects/supakorn-portfolio, collection `suites`), which
// https://nnewnerr.github.io reads live.
//
// Canonical copy lives in NNEWNERR.github.io/ci/; each test repo vendors it
// as scripts/publish-test-stats.mjs. No dependencies — Node 22 fetch + the
// Firestore REST API, authorised by an access token that
// google-github-actions/auth mints through Workload Identity Federation.
//
// usage: node publish-test-stats.mjs --suite <id> --repo <name> --label <text>
//                                    --kind playwright|vitest --file <report.json>
//                                    [--inventory <list.json>]
//
// --inventory takes the json output of `playwright test --list` and records
// how many tests the repo *defines* — including ones CI filters out (e.g.
// win32-only @visual). The site's headline sums this; the per-repo line shows
// what CI actually ran. Without it, inventory = tests run.
// env:   FIRESTORE_TOKEN (required), GITHUB_SHA / GITHUB_SERVER_URL /
//        GITHUB_REPOSITORY / GITHUB_RUN_ID (set by Actions)

import { readFileSync } from 'node:fs'

const PROJECT = 'supakorn-portfolio'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, v, i, all) => (i % 2 ? pairs : [...pairs, [v.replace(/^--/, ''), all[i + 1]]]), []),
)
for (const key of ['suite', 'repo', 'label', 'kind', 'file']) {
  if (!args[key]) throw new Error(`missing --${key}`)
}
const token = process.env.FIRESTORE_TOKEN
if (!token) throw new Error('FIRESTORE_TOKEN is not set')

const report = JSON.parse(readFileSync(args.file, 'utf8'))

function count(kind, r) {
  if (kind === 'playwright') {
    const { expected = 0, unexpected = 0, flaky = 0, skipped = 0 } = r.stats ?? {}
    return { passed: expected, failed: unexpected, flaky, skipped }
  }
  if (kind === 'vitest') {
    return {
      passed: r.numPassedTests ?? 0,
      failed: r.numFailedTests ?? 0,
      flaky: 0,
      skipped: (r.numPendingTests ?? 0) + (r.numTodoTests ?? 0),
    }
  }
  throw new Error(`unknown --kind ${kind}`)
}

const c = count(args.kind, report)
const total = c.passed + c.failed + c.flaky + c.skipped
if (total === 0) throw new Error(`${args.file} reports 0 tests — refusing to publish an empty run`)

function listed(file) {
  let n = 0
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) n += spec.tests.length
    for (const child of suite.suites ?? []) walk(child)
  }
  JSON.parse(readFileSync(file, 'utf8')).suites.forEach(walk)
  return n
}
const inventory = args.inventory ? listed(args.inventory) : total
if (inventory < total) throw new Error(`inventory ${inventory} < tests run ${total} — wrong --inventory file?`)

const env = process.env
const runUrl = env.GITHUB_RUN_ID
  ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
  : null

const int = (n) => ({ integerValue: String(n) })
const str = (s) => (s == null ? { nullValue: null } : { stringValue: String(s) })
const fields = {
  repo: str(args.repo),
  label: str(args.label),
  total: int(total),
  inventory: int(inventory),
  passed: int(c.passed),
  failed: int(c.failed),
  flaky: int(c.flaky),
  skipped: int(c.skipped),
  status: str(c.failed > 0 ? 'failed' : 'passed'),
  commit: str(env.GITHUB_SHA?.slice(0, 7) ?? null),
  runUrl: str(runUrl),
  source: str(runUrl ? 'ci' : 'local'),
  updatedAt: { timestampValue: new Date().toISOString() },
}

const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/suites/${encodeURIComponent(args.suite)}`
const res = await fetch(url, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields }),
})
if (!res.ok) throw new Error(`Firestore ${res.status}: ${await res.text()}`)
console.log(`published suites/${args.suite}: ${total} tests run (${inventory} defined) — ${c.passed} passed, ${c.failed} failed, ${c.flaky} flaky, ${c.skipped} skipped`)
