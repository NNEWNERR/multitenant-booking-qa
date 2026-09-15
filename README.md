# Multi-tenant Booking — an app and the tests that hold it honest

[![Tests](https://github.com/NNEWNERR/multitenant-booking-qa/actions/workflows/rules.yml/badge.svg)](https://github.com/NNEWNERR/multitenant-booking-qa/actions/workflows/rules.yml)

**69 tests** across two layers of the same system: **52** security-rules tests that
prove one tenant cannot reach another's data, and **17** Playwright tests that
drive the screen a user actually meets. Both run against the Firebase emulator —
no mocks, no cloud project, no credentials.

```bash
npm ci
npx playwright install chromium
npm test          # rules, then UI — about 50s
```

The only prerequisite beyond Node is a **JDK 11+**, because the Firestore
emulator is a Java program.

| | |
| --- | --- |
| `npm run test:rules` | 52 rules tests (Vitest + `@firebase/rules-unit-testing`) |
| `npm run test:ui` | 17 UI tests (Playwright, desktop + Pixel 7) |
| `npm run app` | the app on its own, against the emulator |
| `npm run test:ui:headed` | watch the UI run in a browser |

---

## Why this repo exists

Most test portfolios show a suite clicking through somebody else's demo site.
This one owns the whole stack — a small booking app, its security rules, and
tests at both layers — so the tests can do things a suite pointed at a public
demo never can: seed a tenant, seed a document in a *legacy* shape, sign in as
four different roles, and assert on what each of them is refused.

It is a clean-room rebuild of problems I worked through on a production booking
platform: same shapes, generic domain, none of the client's code or data.
[The case studies](https://github.com/NNEWNERR/new.supakorn/tree/main/case-studies)
tell those stories; this repo is where the patterns are runnable.

## The system

Several organisations (tenants) share one Firestore database. Every document
carries the id of the tenant that owns it, and identity arrives as custom claims
minted by a privileged caller — never by the browser:

```
token.tenantId   which organisation the user belongs to
token.role       admin | staff | customer | platform_admin
```

```
app/                a Booking Desk: sign in, list, detail dialog, actions
firestore.rules     the rules both layers are written against
tests/*.test.ts     52 rules tests
tests/ui/*.spec.ts  17 UI tests
scripts/seed.ts     users with claims + bookings, via the emulator REST API
```

## Layer 1 — security rules (52 tests)

| Suite | Tests | What it proves |
| --- | --- | --- |
| `tenant-isolation` | 14 | Read, create, update and delete each refused across the tenant line — including creating a document stamped with someone else's tenant, and handing a document away by rewriting its owner |
| `role-permissions` | 13 | A decision table, one test per cell. An unrecognised role gets nothing |
| `booking-state` | 16 | Every allowed transition, and every forbidden one, against a table the rules hold in the same shape |
| `legacy-field-compat` | 9 | Documents written before the migration (`tenant_id`) stay reachable by their owner without becoming a hole for anyone else |

**The deny cases are the point.** A suite made only of success cases cannot prove
data does not leak — rules that deny everything would pass it perfectly. So most
tests assert refusal, and the success cases exist to prove the rules did not
simply lock everyone out.

## Layer 2 — the UI (17 tests)

Rules tests prove what the database permits. Users meet those rules through a
screen, and a screen can get it wrong in ways the database never sees: showing a
refusal as nothing at all, dropping a session on reload, or putting a control
somewhere a finger cannot reach.

- **What each role sees** — staff see the tenant, a customer sees only their own booking, another tenant's bookings are simply not there
- **Sign-in** — a wrong password is refused with one message that does not say which half was wrong; a deep link without a session lands on the form, not a crash
- **Acting on a booking** — a confirm succeeds; a refused transition surfaces *as an error* rather than a silent no-op, with the disallowed buttons deliberately left in place so the refusal stays observable
- **Session** — reloading on a deep link keeps the session and reopens the booking, the case manual testing misses because nobody reloads halfway through a click-through
- **On a phone** (real Pixel 7 profile, not a narrowed window) — the back button actually receives the tap, every control clears the 44px target-size floor, and the page does not scroll sideways

### Two findings the UI layer produced

**A legacy document is invisible to the list, yet reachable by link.** The rules
accept either spelling of the owner field; a *query* cannot — it filters on one
field name, and the legacy document spells it the other way. So a document the
rules would happily return never appears on screen. No rules test can see this.
Both halves are now pinned by tests.

**The dialog was trapped under the header for 200ms.** A running animation on
`opacity` makes its element a stacking context *for as long as it runs* — so
while the view faded in, the dialog inside it could not paint above the sticky
header outside it, and the back button was unreachable. It reproduced on roughly
one run in three, which is exactly what a timing-dependent bug looks like from
the outside. The fix moved the dialog out of the animated element; the mobile
hit-test fails again if it goes back in.

That second one is also a lesson in reading a flaky test: the failure was real,
and every attempt to stabilise the *test* was wasted work until the *product*
bug was found.

## Design notes

**Tests run against the rules file that would deploy.** `tests/setup.ts` reads
`../firestore.rules`. A second copy for testing is a copy that drifts.

**Fixtures seed with the rules switched off.** Seeding through the rules would
mean a rules bug could block the setup of the very test written to catch it.

**Roles sign in once.** `tests/ui/global-setup.ts` captures a session per role —
including IndexedDB, where Firebase keeps it. Seventeen tests replaying a login
form means seventeen round-trips through a single-threaded emulator. The login
form still has its own tests, where it is the subject rather than setup.

**Each suite gets its own emulator process.** Sharing one across both suites
meant the UI run started against an emulator the rules suite had just saturated,
and its auth calls occasionally stalled — a failure that said nothing about the
code. CI runs them as two jobs for the same reason.

**No retries.** The app and its data are local and deterministic, so a failure
here is a bug in the app or the test, and retrying would only hide which.

## Known quirk

Two rules denials surface in the emulator log as *evaluation errors* rather than
clean `false` results — Firestore raises one when a rule reads a field off a
document that does not exist. The request is still refused and the tests assert
the refusal, but the log line names the wrong reason. Narrowed from ten
occurrences to two (replacing `in`-list membership with a transition table did
most of the work), and recorded here rather than left for the next person to
rediscover.
