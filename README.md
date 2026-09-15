# Multi-tenant Booking — Security Rules Test Suite

[![Security Rules Tests](https://github.com/NNEWNERR/multitenant-booking-qa/actions/workflows/rules.yml/badge.svg)](https://github.com/NNEWNERR/multitenant-booking-qa/actions/workflows/rules.yml)

**52 tests** proving that one tenant cannot reach another tenant's data, that roles
mean what they claim, and that a booking cannot move through a state it has no
business being in — all executed against the real Firestore emulator, not mocks.

```bash
npm ci
npm test        # boots the emulator, runs 52 tests, shuts it down — ~20s
```

No credentials, no cloud project, nothing to configure. The only prerequisite
beyond Node is a **JDK 11+**, because the Firestore emulator is a Java program.

---

## Why this repo exists

Most test portfolios demonstrate clicking through a UI. This one demonstrates the
layer underneath: the rules that stand between one customer's data and another's
when several organisations share a single database.

It is a clean-room rebuild of patterns I worked through on a production booking
platform — same problems, generic domain, no client code or data. The bugs the
suite is designed to catch are ones I have actually seen escape to production;
[the case studies](https://github.com/NNEWNERR/new.supakorn/tree/main/case-studies)
tell those stories.

## The system under test

Several organisations (tenants) share one Firestore database. Every document
carries the id of the tenant that owns it. Identity arrives as custom claims:

```
token.tenantId   which organisation the user belongs to
token.role       admin | staff | customer | platform_admin
```

`firestore.rules` is the whole system under test — 150 lines that every test
below drives through the emulator.

## What each suite proves

| Suite | Tests | What it proves |
| --- | --- | --- |
| `tenant-isolation.test.ts` | 14 | A tenant reads and writes its own data, and **nothing** of anyone else's — read, create, update and delete each refused separately |
| `role-permissions.test.ts` | 13 | Each role can do exactly what it should: a customer sees only their own booking, staff operate but do not administer, admins administer but still cannot break invariants |
| `booking-state.test.ts` | 16 | Every allowed transition works and every forbidden one is refused, including the backwards ones into terminal states |
| `legacy-field-compat.test.ts` | 9 | Documents written before the migration (`tenant_id`) stay reachable by their owner without becoming a hole for anyone else |

### The deny cases are the point

A suite made only of success cases cannot prove that data does not leak — rules
that deny everything would pass it perfectly. So most of these tests assert
**refusal**, and the success cases exist to prove the rules did not simply lock
everyone out:

```ts
test('tenant B staff cannot READ a tenant A booking', async () => {
  const db = user(env, 'uB', TENANT_B, 'staff').firestore()
  await assertFails(getDoc(doc(db, 'bookings/bkA')))
})
```

### The legacy-field case

A migrated system carries two generations of documents at once — older ones
spelling the owner field `tenant_id`, newer ones `tenantId`. A rule that knows
only the new spelling sees **no owner at all** on the old ones, and a document
with no owner in the eyes of the rules is one the rules will judge wrongly.

This is invisible to UI testing, because the current UI always writes the new
spelling. It only appears if the fixture deliberately seeds the old shape — which
is exactly what `legacy-field-compat.test.ts` does.

### The state machine

```
pending ──► confirmed ──► completed   (terminal)
   │            │
   └────────────┴───────► canceled    (terminal)
```

Terminal means terminal. A completed booking that can slide back to pending is
how a time slot ends up held by work nobody is doing — a leak that stays
invisible until a customer is told a free slot is full.

The rules hold this as a **transition table**, the same shape as the test that
drives it, so the two can be read against each other.

## Design notes

**Tests run against the deployed rules file.** `tests/setup.ts` reads
`../firestore.rules` — the artifact that would ship. A second copy for testing
is a copy that drifts.

**Fixtures are seeded with the rules switched off.** Seeding through the rules
would mean a rules bug could block the setup of the very test meant to catch it.

**Files run sequentially.** The emulator holds one project's state, so parallel
files would clear each other's seed data — `fileParallelism: false` in
`vitest.config.ts`, deliberately, not by default.

**CI boots its own emulator.** `firebase emulators:exec` starts it, runs the
suite, and shuts it down, so a crashed run cannot leave a process holding the
port and nobody has to remember to start anything first.

## Known quirk

Two of the deny cases surface in the emulator log as *evaluation errors* rather
than clean `false` results — Firestore raises one when a rule reads a field off
a document that does not exist. The request is still refused, and the tests
assert the refusal, but the log line names the wrong reason.

I narrowed it from ten occurrences to two (replacing `in`-list membership with a
transition table did most of the work). It is recorded here rather than quietly
left in the log, because a denial for the right outcome and the wrong reason is
still something the next person will have to understand.

## Layout

```
firestore.rules              the system under test
tests/setup.ts               test environment, seeding, role helpers
tests/*.test.ts              four suites, 52 tests
.github/workflows/rules.yml  JDK + Node + emulator, on every push
```
