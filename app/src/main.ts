/**
 * Booking Desk — a deliberately small front end over the same Firestore rules
 * the unit tests drive.
 *
 * It exists so the UI tests have something real to click: a sign-in, a list
 * that shows different things to different roles, a detail dialog, and actions
 * that can be refused by the rules rather than by the UI. Every refusal a user
 * sees here comes from the database saying no.
 */
import { initializeApp } from 'firebase/app'
import {
  getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, type User,
} from 'firebase/auth'
import {
  getFirestore, connectFirestoreEmulator, collection, query, where,
  onSnapshot, doc, getDoc, updateDoc, type DocumentData,
} from 'firebase/firestore'

const PROJECT_ID = 'demo-booking-qa'

const app = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-key', appId: 'demo-app' })
const auth = getAuth(app)
const db = getFirestore(app)

// Emulator-only by design: this app never points at a real project, so a demo
// can never touch real data.
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T

const loginView = $('#login-view')
const listView = $('#list-view')
const modal = $('#modal')
const list = $<HTMLUListElement>('#bookings')
const loginError = $('#login-error')
const actionError = $('#action-error')
const empty = $('#empty')

type Claims = { tenantId?: string; role?: string }
let claims: Claims = {}
let openBookingId: string | null = null
let unsubscribe: (() => void) | null = null

// ── sign in ────────────────────────────────────────────────────────────────

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  loginError.hidden = true
  const email = $<HTMLInputElement>('#email').value.trim()
  const password = $<HTMLInputElement>('#password').value
  try {
    await signInWithEmailAndPassword(auth, email, password)
  } catch {
    // One message for every failure mode on purpose — telling an attacker
    // which half was wrong is a gift.
    loginError.textContent = 'Sign-in failed. Check the email and password.'
    loginError.hidden = false
  }
})

// The form is live only now that it has a handler — see index.html.
$<HTMLButtonElement>('[data-testid="login-btn"]').disabled = false

$('[data-testid="logout-btn"]').addEventListener('click', async () => {
  await signOut(auth)
  setUrl(null)
})

// ── session ────────────────────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  // Publish the resolved auth state. Until this attribute exists, the login
  // form is on screen only because nothing has decided yet — a caller that
  // reads the screen before then (a test, or any other automation) sees a
  // signed-in user as signed out.
  document.body.dataset.auth = user ? 'in' : 'out'

  if (!user) return showLogin()

  // Show the signed-in shell straight away, with what is already known. The
  // claims arrive on a second step; blocking the whole screen on that means a
  // slow or stuck token read leaves the user staring at an empty page with no
  // way to tell whether anything is happening.
  showShell(user)

  // Custom claims can be missing from a token that was minted around the time
  // they were granted. One forced refresh is the documented remedy; without it
  // the app would issue a query with an undefined tenant, which Firestore
  // rejects outright, and the screen would sit empty with nothing explaining
  // why.
  try {
    let token = await user.getIdTokenResult()
    if (!token.claims.tenantId) token = await user.getIdTokenResult(true)
    claims = token.claims as Claims
  } catch {
    claims = {}
  }

  renderIdentity(user)

  if (!claims.tenantId) {
    // Fail loudly rather than render an empty list that looks like "no data".
    empty.textContent = 'This account has no tenant assigned.'
    empty.hidden = false
    return
  }

  subscribe(user)

  // A deep link must survive a reload: restore whatever the URL points at
  // once the session is back, rather than dropping the user on the list.
  const wanted = new URLSearchParams(location.search).get('booking')
  if (wanted) void openBooking(wanted)
})

function showLogin() {
  claims = {}
  unsubscribe?.()
  unsubscribe = null
  closeModal()
  listView.hidden = true
  $('#topbar').hidden = true
  loginView.hidden = false
}

function showShell(user: User) {
  loginView.hidden = true
  listView.hidden = false
  $('#topbar').hidden = false
  renderIdentity(user)
}

function renderIdentity(user: User) {
  const known = [user.email, claims.role, claims.tenantId].filter(Boolean)
  $('[data-testid="who"]').textContent = known.join(' · ')
}

// ── the list ───────────────────────────────────────────────────────────────

function subscribe(user: User) {
  unsubscribe?.()

  // The query has to be shaped so the rules can prove it is allowed. A staff
  // query is scoped to the tenant; a customer query is scoped to the tenant AND
  // to themselves. Widen either one and Firestore rejects the whole query
  // rather than quietly returning less.
  const base = collection(db, 'bookings')
  const q = claims.role === 'customer'
    ? query(base, where('tenantId', '==', claims.tenantId), where('customerId', '==', user.uid))
    : query(base, where('tenantId', '==', claims.tenantId))

  unsubscribe = onSnapshot(q, (snap) => {
    list.replaceChildren()
    empty.hidden = snap.size > 0
    snap.forEach((docSnap) => list.append(row(docSnap.id, docSnap.data())))
  })
}

function row(id: string, data: DocumentData): HTMLLIElement {
  const li = document.createElement('li')
  li.dataset.testid = `booking-${id}`

  const label = document.createElement('div')
  label.innerHTML = `<div>${data.title ?? id}</div>`
  const badge = document.createElement('span')
  badge.className = 'badge'
  badge.dataset.testid = `status-${id}`
  badge.textContent = data.status
  label.append(badge)

  const open = document.createElement('button')
  open.type = 'button'
  open.dataset.testid = `open-${id}`
  open.textContent = 'Details'
  open.addEventListener('click', () => void openBooking(id))

  li.append(label, open)
  return li
}

// ── the detail dialog ──────────────────────────────────────────────────────

async function openBooking(id: string) {
  const snap = await getDoc(doc(db, 'bookings', id))
  if (!snap.exists()) return
  const data = snap.data()

  openBookingId = id
  $('[data-testid="modal-title"]').textContent = data.title ?? id
  $('[data-testid="modal-status"]').textContent = data.status
  $('[data-testid="modal-customer"]').textContent = `Customer: ${data.customerId}`
  actionError.hidden = true
  modal.hidden = false
  setUrl(id)
}

$('[data-testid="modal-back"]').addEventListener('click', closeModal)

function closeModal() {
  modal.hidden = true
  openBookingId = null
  setUrl(null)
}

for (const button of document.querySelectorAll<HTMLButtonElement>('.actions button')) {
  button.addEventListener('click', async () => {
    if (!openBookingId) return
    actionError.hidden = true
    try {
      await updateDoc(doc(db, 'bookings', openBookingId), { status: button.dataset.next })
      $('[data-testid="modal-status"]').textContent = button.dataset.next ?? ''
    } catch {
      // The rules refused. Surfacing it as-is keeps the UI honest: it does not
      // pretend an action succeeded, and it does not hide the disallowed
      // buttons either, so the refusal stays observable and testable.
      actionError.textContent = 'That change is not allowed.'
      actionError.hidden = false
    }
  })
}

/** Keeps the open booking in the URL so a reload lands back on it. */
function setUrl(bookingId: string | null) {
  const url = new URL(location.href)
  if (bookingId) url.searchParams.set('booking', bookingId)
  else url.searchParams.delete('booking')
  history.replaceState(null, '', url)
}
