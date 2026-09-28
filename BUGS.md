# BUGS — AI-Ocean full-application QA audit

Companion to `QA_TEST_PLAN.md`. Every finding is reproduced live before being logged.
No git repo exists in this project, so the "files touched" line on each fix **is** the change log.

**Severity guide**
- **Critical** — data loss, security hole, money wrong, core flow completely broken
- **High** — a real user flow is broken or gives a wrong result
- **Medium** — works but wrong/confusing; degraded UX; missing guard
- **Low** — cosmetic, copy, or polish

**Status guide** — `✅ Verified` → `Fixed` → `Verified` · `Question` = needs the user's call, not fixed unilaterally

**Final state (2026-09-10): 39 found, 39 fixed, 39 verified live. Nothing open.**
BUG-034 was found *after* the closing report, while live-probing one of §8.2's
"concerns" instead of estimating it — which is the argument for working through the
rest of that list the same way.
The audit's closing report — cross-cutting concerns, the one open product question,
and what is worth a deeper look later — is §8 of `QA_TEST_PLAN.md`.

---

## Summary

| ID | Severity | Area | Title | Status |
|---|---|---|---|---|
| BUG-001 | Low | Marketing Site | Blog empty state looks off-centre — the empty sidebar still occupies its column | ✅ Verified |
| BUG-002 | Medium | Customer Center | Duplicate `id="terms"` on signup: clicking the "I agree" label does nothing | ✅ Verified |
| BUG-003 | Medium | Backend | Welcome notification says "My Platform" instead of the admin-configured brand name | ✅ Verified |
| BUG-004 | High | Customer Center | Deploy journey double-advances: answering then clicking Continue silently skips the next question | ✅ Verified |
| BUG-005 | High | Backend | Suspending a customer does not stop their existing token — only new logins are blocked | ✅ Verified |
| BUG-006 | Medium | Backend | 38 endpoints return raw internal error text (incl. absolute file paths and source excerpts) with HTTP 500 | ✅ Verified |
| BUG-007 | Medium | Backend | Customer top-up failure shows admin-only instructions and returns 500 | ✅ Verified |
| BUG-008 | Medium | Backend | Admin wallet adjust has no bounds: `1e308` crashes it, `-999999` silently creates a $1M debt | ✅ Verified |
| BUG-009 | High | Customer Center | Customer notifications are unreachable — the API is admin-only and the bell shows hardcoded fake data | ✅ Verified |
| BUG-010 | Medium | Backend | Every paginated list endpoint returns HTTP 500 on `page=0`, `page=-5`, `limit=abc`; `limit` has no upper bound | ✅ Verified |
| BUG-011 | Medium | Backend | Login reveals whether an email is registered (user enumeration) and leaks the remaining-attempt count | ✅ Verified |
| BUG-012 | Medium | Backend | Signup accepts undeliverable email addresses (`a@b`, `@b.com`, `a b@c.com`, trailing newline) | ✅ Verified |
| BUG-013 | Low | Backend | A NUL byte in any text field returns HTTP 500 instead of a validation error | ✅ Verified |
| BUG-014 | Low | Backend | Login with a non-string `email` (object or array) returns HTTP 500 instead of 400 | ✅ Verified |
| BUG-015 | Medium | Admin Center | Dashboard scrolls sideways at ordinary desktop widths (+80px at 1440, +152px at 768) | ✅ Verified |
| BUG-016 | Medium | Admin + Customer Center | Every data table pushes the whole page sideways at narrow widths instead of scrolling inside its own container | ✅ Verified |
| BUG-017 | High | Backend | Every seed script is broken — a fresh install cannot create its first admin (`npm run seed` → `Cannot find module 'mongoose'`) | ✅ Verified |
| BUG-018 | High | Marketing Site | During maintenance the public site shows a broken, unbranded "404 Page not found" instead of the maintenance page | ✅ Verified |
| BUG-019 | Medium | Customer Center | Turning on maintenance mode logs every customer out — they must sign in again afterwards | ✅ Verified |
| BUG-020 | Medium | Backend | Two cron jobs run a query-per-customer; `lowBalanceWarning` costs ~5 queries × every funded wallet, every run | ✅ Verified |
| BUG-021 | Medium | Backend | Activity-log cleanup loads every matching row into memory purely to count it | ✅ Verified |
| BUG-022 | Low | Backend | `sortBy` is unvalidated on the users CSV export — arbitrary column accepted, unknown column returns 500 | ✅ Verified |
| BUG-023 | Low | Admin Center | Badge and avatar text fails contrast (down to 1.71:1) in both themes | ✅ Verified |
| BUG-024 | Medium | Backend | Creating an admin with `role: 'custom'` but no `customRoleId` returns 201 and silently produces a permission-less admin | ✅ Verified |
| BUG-025 | Low | Backend | `POST /admin/roles` is the only create route that doesn't mint a `legacyMongoId`, breaking the app-wide `_id` invariant | ✅ Verified |
| BUG-026 | Low | Backend | The users list/detail dumps raw internal columns (`legacyMongoId`, `createdById`, `updatedById`) on the nested `customRole` | ✅ Verified |
| BUG-027 | Low | Backend | Revenue analytics access is hardcoded to role names, bypassing the permission system entirely | ✅ Verified |
| BUG-028 | Medium | Backend | `POST /admin/recommendation-policy` without `key` leaks a raw Prisma error instead of validating | ✅ Verified |
| BUG-029 | Medium | Backend | `GET /admin/roles/:id` returns HTTP 500 for any id that isn't a UUID — roles are the only resource not using the app's `_id` convention | ✅ Verified |
| BUG-030 | Low | Backend | Three endpoints return 200 for ids that don't exist, including path-traversal strings | ✅ Verified |
| BUG-031 | Low | Backend | `GET /admin/users/:id/activity/export` returns 500 for an absent id; the customers equivalent correctly 404s | ✅ Verified |
| BUG-032 | High | Admin + Customer Center | When the API fails, dashboards display confident zeros instead of an error — "0 customers", "0.00 credit balance" | ✅ Verified |
| BUG-033 | High | Backend | No admin account can ever be deleted — `DELETE /admin/users/:id` has no cascade and always returns 500 | ✅ Verified |
| BUG-034 | Medium | Backend | The `pagination` block is built from the raw query, so `?page=abc` returns correct rows next to `{"page":null,"pages":-7}` | ✅ Verified |
| BUG-035 | High | Backend | 95% of a customer's bill shows as "Other usage — not linked to a deployment": the id migration orphaned every historical ledger reference | ✅ Verified |
| BUG-036 | High | Customer Center | The spend table invents hours and rate — it reported "7.5h at USD 2.39/hr" for a machine that ran **zero** hours that month | ✅ Verified |
| BUG-037 | Medium | Customer Center | "Nothing is running right now" shown beside a live "USD 0.25/hr" run rate, with no mention that stopped deployments pay for storage | ✅ Verified |
| BUG-038 | High | Customer Center | 8 "Add credit" buttons across the dashboard and deployment pages opened the Overview tab, which has no top-up form on it | ✅ Verified |
| BUG-039 | High | Customer Center | "View invoices" and the "Billing & invoices" stat card opened the Profile page — the `?tab=billing` query param they passed does nothing there | ✅ Verified |

---

### BUG-001: Blog empty state looks off-centre — the empty sidebar still occupies its column
- **Area**: Marketing Site
- **Severity**: Low
- **Steps to reproduce**:
  1. Ensure no `BlogPost` has `status = 'published'` (the current state — all 6 seeded posts are `draft`).
  2. Open `http://localhost:3000/blog`.
- **Expected behavior**: With no posts and no sidebar content, the "No posts yet" empty state reads as centred on the page.
- **Actual behavior**: The empty state is centred at x≈544 on a 1440px viewport (page centre is 720). The page uses a `flex lg:flex-row` two-column layout — a `flex-1` main column plus a sidebar. With no categories and no popular posts, the sidebar renders as ~320px of blank space, pushing the content left so the page looks broken rather than empty.
- **Root cause**: Not yet traced. Layout lives in `frontend-marketing/src/pages/BlogListPage.js`; the sidebar column renders unconditionally regardless of whether it has content.
- **Status**: ✅ **Verified**

#### Fix
The blog sidebar column is now rendered only when it has something in it. Every panel inside it was already individually conditional, so with no published posts and no categories it collapsed to 320px of empty space that pushed the "No posts yet" message off-centre.

**Files touched** — `frontend-marketing/src/pages/BlogListPage.js`

#### Verification (live)
```
PASS  empty state is centred on the page     element 720 vs page 720
```
(1440px viewport — previously the element centred at 544 against a page centre of 720.)

---

### BUG-002: Duplicate `id="terms"` on signup — clicking the "I agree" label does nothing
- **Area**: Customer Center
- **Severity**: Medium
- **Steps to reproduce**:
  1. Open `http://localhost:3002/signup`.
  2. Click the text "I agree to the Terms and Privacy Policy" (the label, not the small square).
  3. Observe the checkbox state.
- **Expected behavior**: Clicking a checkbox's label toggles the checkbox — standard HTML `<label for>` behaviour, and the label is by far the largest click target.
- **Actual behavior**: The checkbox does not toggle. Verified live: `initial=false → afterClickingLabel=false → afterClickingBox=true`. The user must hit the ~13px square exactly, and otherwise gets "Please accept terms" with no idea why. This is on the main signup conversion path, and it is also a screen-reader failure (the label is not associated with any control).
- **Root cause**: `frontend-customer-center/src/pages/SignupPage.js:171-175`. The `<Form.Item name="terms">` makes antd stamp `id="terms"` onto its child (the wrapper `<div>`), while line 174 hand-writes `<input type="checkbox" id="terms">` inside that same wrapper. Two elements now share the id — confirmed live, the page reports `DUPLICATE IDs: [["terms", 2]]` — so `<label htmlFor="terms">` resolves to the first match, the `<div>`, and clicking it toggles nothing.
- **Status**: ✅ **Verified**

#### Fix
antd stamps a `Form.Item`'s `name` onto its child as an `id`, so the wrapping `<div>` was also getting `id="terms"` alongside the hand-written `<input id="terms">`. Two elements shared the id, `<label htmlFor="terms">` resolved to the div, and clicking the words did nothing.

The input now has its own `id="terms-accept"` (with the label pointing at it) and the Form.Item an explicit `id="terms-field"` — one element per id. The label also got `cursor: pointer` so it reads as clickable.

**Files touched** — `frontend-customer-center/src/pages/SignupPage.js`

#### Verification (live)
```
PASS  no duplicate DOM ids on the signup page       []
PASS  clicking the label toggles the checkbox       false -> true
PASS  REGRESSION: signup still completes via the label   → /dashboard
```

---

### BUG-003: Welcome notification says "My Platform" instead of the admin-configured brand name
- **Area**: Backend
- **Severity**: Medium
- **Steps to reproduce**:
  1. Sign up a new customer at `http://localhost:3002/signup`.
  2. Open the notification bell, or query `SELECT title FROM notifications WHERE recipient_id = <new user>`.
- **Expected behavior**: "Welcome to AI-Ocean!" — the brand the operator configured in Admin Center → Settings.
- **Actual behavior**: "Welcome to My Platform!" — confirmed live on a fresh signup. Meanwhile `AdminSettings.siteName`, `themeSettings.appName` and `themeSettings.companyName` are all set to `"AI-Ocean"`, and the marketing site, customer center and admin center all render "AI-Ocean" correctly. The very first thing a new customer sees is the wrong company name.
- **Root cause**: `backend/src/utils/helpers/brandingHelper.js` builds `brandingConfig.appName` from `process.env.APP_NAME` (`.env` still holds the pre-pivot value `My Platform`), and `getWelcomeNotification()` substitutes that into `{APP_NAME}`. `backend/src/routes/v1/auth/customer.routes.js:330` calls it. Every other customer-facing surface reads `AdminSettings` instead, so this one helper is the last place brand copy is sourced from an env var rather than the admin center — which also means the operator cannot fix it from the UI.
- **Blast radius checked**: only one customer-facing consumer (`customer.routes.js:330`); `getAppInfo()` is used solely by the dev-only `/` root endpoint in `app.js`.
- **Status**: ✅ **Verified**

#### Fix
`getWelcomeNotification()` now takes the AdminSettings record and resolves the brand from `themeSettings.companyName` → `themeSettings.appName` → `siteName`, falling back to the `.env` `APP_NAME` only for a fresh install that has never been through Settings. `customer.routes.js` passes the settings in at the call site.

This was the last customer-facing string still sourced from an environment variable rather than the Admin Center — which also meant the operator had no way to correct it from the UI.

**Files touched** — `backend/src/utils/helpers/brandingHelper.js`, `backend/src/routes/v1/auth/customer.routes.js`

#### Verification (live)
A fresh signup's welcome notification:
```
PASS  title uses the Admin Center brand      "Welcome to AI-Ocean!"
PASS  no trace of the .env APP_NAME
      message: "Thank you for joining AI-Ocean. Please verify your email to get started."
```
(Was "Welcome to My Platform!".)

---

### BUG-004: Deploy journey double-advances — answering then clicking Continue silently skips the next question
- **Area**: Customer Center
- **Severity**: High
- **Steps to reproduce**:
  1. Log in as a customer and open `http://localhost:3002/deploy`, click **Start**.
  2. On "How busy will it be?", click any answer card.
  3. Wait for the screen to move on by itself (~350ms), then click the **Continue** button that is still sitting there.
- **Expected behavior**: Clicking an answer records it and moves forward one step. Continue should not then skip a question the customer never saw.
- **Actual behavior**: Two advances happen for one intended action. Verified live:
  ```
  sees            -> STEP 4 OF 15 "How busy will it be?"
  clicks an answer
  now showing     -> STEP 5 OF 15 "How much does it need to read at once?"   <- advanced by itself
  clicks Continue -> STEP 6 OF 15 "How fast do replies need to come back?"   <- SKIPPED, never answered
  ```
  Required questions are protected (Continue shows "Please answer this before continuing"), so the damage is limited to **optional** questions — but those are exactly the ones that matter: of the 9 optional questions, four carry `affectsSizing = true` — `context_length`, `latency`, `fine_tuning`, `monthly_budget`. The customer is then given a hardware recommendation, and an hourly price, computed from inputs they were never actually asked for. In a full automated run this silently dropped 4 of 12 questions and the review screen listed only 7 answers.
- **Root cause**: `frontend-customer-center/src/pages/DeployJourney.js:464-474`. `handleAnswerAndMaybeAdvance` schedules `goNextRef.current()` on a 350ms timer for every single-select question (`select` / `radio` / `boolean`), but the **Continue button stays rendered and enabled the whole time** — so the auto-advance and the explicit button are two independent paths to `goNext()`, and using both (the natural thing to do, since the button is the obvious "next" affordance) advances twice. The same double-fire is reachable from the keyboard: clicking an option and then pressing Enter hits the `goNext()` at line 500.
- **Status**: ✅ **Verified**

#### Fix
Answering a single-select question schedules an auto-advance, but the Continue button stays live — so the two are independent routes to `goNext()` and using both advances twice. Guarded both orderings:

- A new `advance()` wrapper is what every *explicit* forward gesture now calls (Continue, Skip, Enter). It cancels a scheduled auto-advance, so a click that beats the timer isn't doubled by it.
- `autoAdvancedAt` records when the timer actually moved the journey on; `advance()` ignores a call landing within `autoAdvanceDelay + 400ms` of that. This absorbs the opposite ordering — the click that arrives just *after* the screen already moved.

`goNext()` itself stays unguarded for the internal callers that mean exactly one step and know it (the timer, and returning from an answer edit). Only auto-advances arm the guard, so deliberate rapid navigation — holding Enter through already-answered steps — is unaffected.

**Files touched** — `frontend-customer-center/src/pages/deploy/DeployJourney.js`

#### Verification (live)
The original repro, three questions in a row:
```
"What are you building?"  -> answer -> "Who is going to use it?"              -> Continue -> "Who is going to use it?"
"Who is going to use it?" -> answer -> "How busy will it be?"                 -> Continue -> "How busy will it be?"
"How busy will it be?"    -> answer -> "How much does it need to read at once?" -> Continue -> "How much does it need to read at once?"

PASS  Continue after an answer no longer skips a question   each pair matches
PASS  REGRESSION: Continue alone still advances
PASS  REGRESSION: answering alone still auto-advances
PASS  no console errors during the journey
```
And the outcome that actually matters — walking the whole journey as a careful user, **every** question is now asked (13 distinct steps, up from 7 questions before), including the four that were being silently dropped and that feed the hardware sizing:
```
• What are you building?                      • Do you need to train it on your own data?
• Who is going to use it?                     • Tell us about the training data
• How busy will it be?                        • When do you need this running?
• How much does it need to read at once?  ←   • A couple of practical details            ←
• How fast do replies need to come back?  ←   • These look like the best fit
• When does it need to be running?            • Here is what we recommend
• What are you comfortable spending?      ←
```
(← marks the ones a customer never saw before. `fine_tuning` was the fourth sizing input at risk; it is asked in both cases but its answer is now recorded reliably.)

---

### BUG-005: Suspending a customer does not stop their existing token — only new logins are blocked
- **Area**: Backend (`middleware/auth/auth.js`)
- **Severity**: High
- **Steps to reproduce**:
  1. Log in as a customer and keep the JWT.
  2. As an admin, `PUT /admin/customers/:id/status` with `{ status: 'suspended' }`.
  3. Re-use the customer's original token against the customer API.
- **Expected behavior**: Suspension cuts off access immediately, the way it does for admins.
- **Actual behavior**: Verified live — logging in again is correctly refused (`403 "Your account has been suspended"`), but the **already-issued token keeps working**:
  ```
  A tries to LOG IN while suspended            403  ✔ blocked
  suspended A, old token -> GET /customer/wallet          200  ✘ still works
  suspended A, old token -> GET /customer/deployments     200  ✘ still works
  suspended A, old token -> GET /customer/catalog/models  200  ✘ still works
  ```
  Writes happen to fail for unrelated reasons (top-up hits BUG-007, deploy hit an out-of-stock tier) — they are *not* blocked by the suspension. A suspended or banned account therefore keeps reading its data for the remaining life of the token, which is 7 days.
- **Root cause**: `backend/src/middleware/auth/auth.js` verifies the JWT and loads the user, but never checks `user.status` or `user.accountType`. Its admin counterpart `middleware/auth/adminAuth.js:35-77` checks both (`accountType === 'admin'`, and explicit `suspended` / `banned` / non-`active` branches). The customer middleware was never given the same treatment, so "suspend" is enforced only at the login route.
- **Note**: the same gap means an **admin's** token is accepted on customer routes, since `accountType` is not checked either.
- **Status**: ✅ **Verified**

#### Fix
`backend/src/middleware/auth/auth.js` now re-checks `user.status` on every request, mirroring what `adminAuth.js` has always done — `suspended` and `banned` each get their own 403, and anything other than `active`/`pending_verification` is refused. `pending_verification` is deliberately allowed through: it is a real signup state when email verification is enabled (`customer.routes.js:287`), and blocking it would lock every new customer out before they could even resend their verification email.

Each refusal carries a machine-readable `code` (`ACCOUNT_SUSPENDED` / `ACCOUNT_BANNED` / `ACCOUNT_INACTIVE`), and `frontend-customer-center/src/api/axiosInstance.js` now signs the customer out on exactly those codes. It deliberately does **not** treat 403 in general as a sign-out — the app relies on ordinary 403s for disabled features and missing permissions, and logging someone out for those would be a worse bug than the one being fixed.

**Files touched**
- `backend/src/middleware/auth/auth.js` — status checks added
- `frontend-customer-center/src/api/axiosInstance.js` — sign out on account-ended codes only

#### Verification (live)
```
PASS  baseline: active customer can use their token
PASS  suspended: the SAME token is now refused everywhere
      /customer/wallet=403/ACCOUNT_SUSPENDED   /customer/deployments=403/ACCOUNT_SUSPENDED
      /customer/catalog/models=403/ACCOUNT_SUSPENDED   /auth/customer/me=403/ACCOUNT_SUSPENDED
PASS  suspended: login still refused                        403
PASS  reactivated: the same token works again               200
PASS  REGRESSION: a feature-gate 403 carries no account code  403 code=none
PASS  REGRESSION: admin auth still works                    200
PASS  a freshly signed-up customer is not locked out        200
```

---

### BUG-006: 38 endpoints return raw internal error text (including absolute file paths and source excerpts) with HTTP 500
- **Area**: Backend (systemic — 38 call sites across 15 route/controller files)
- **Severity**: Medium
- **Steps to reproduce**:
  1. `POST /api/v1/admin/wallets/<userId>/adjust` with `{ "amount": 1e308, "reason": "x" }`.
  2. Read the response body.
- **Expected behavior**: A 400 rejecting an out-of-range amount, with a message written for a human operator.
- **Actual behavior**: HTTP 500 whose body is the raw Prisma exception, including the **absolute server path and a source excerpt**:
  ```json
  {"success":false,"message":"\nInvalid `prisma.creditWallet.update()` invocation in\nE:\\Startup\\Claude_AI\\AI-Ocean\\backend\\src\\services\\billing\\creditService.js:168:25\n\n  165 const legacyMongoId = newMongoId();\n  166 \n  167 const [updatedWallet, transaction] = await prisma.$transaction([…"}
  ```
- **Root cause**: the house pattern `res.status(500).json({ success: false, message: error.message })` — 38 occurrences across 15 files under `backend/src/routes` and `backend/src/controllers` (e.g. `routes/v1/admin/wallets.routes.js:314`, `controllers/customer/walletController.js:118`). Because each route catches its own error and responds directly, the global error handler in `app.js:88-100` — which *does* mask messages when `NODE_ENV === 'production'` — is bypassed entirely. So this leaks in production too, not just in dev.
- **Status**: ✅ **Verified**

#### Fix
New `backend/src/utils/helpers/apiError.js` with a `failure(res, err, fallback)` helper. It logs the real error server-side, and only echoes the error's own message when that message was written deliberately for a caller — i.e. the error carries a `status` we set ourselves (4xx, or 503 for "configured wrong / unavailable") **and** the text doesn't look internal. Anything else gets the handler's own fallback wording and a 500.

"Looks internal" is a positive test rather than a blocklist: multi-line text, or anything containing a file path, a `.js:NN` reference, or the word `prisma`/`invocation`. Prisma's exceptions hit every one of those.

Applied to **44 call sites across 20 files** by codemod, in two passes for the two shapes in use (`res.status(500).json({ message: error.message })` and `res.status(err.status || 500).json({ message: err.message || 'Fallback' })`), preserving each handler's existing fallback text and folding the duplicate `console.error` into the helper.

**7 sites were deliberately left alone** — they are code-guarded 4xx/409 responses for errors the app throws itself with a known `code` (`SETUP_INCOMPLETE`, `LAST_CARD`, `CHARGE_FAILED`, tier-in-use), whose messages are written for the user and gated on an explicit `error.code` check. Those are not the leak pattern.

**Files touched** — `backend/src/utils/helpers/apiError.js` (new); 20 files under `backend/src/routes/v1/` and `backend/src/controllers/`

#### Verification (live)
```
PASS  wallet adjust 1e308: no Prisma/file-path leak
      400 "A single adjustment cannot exceed USD 10000. Raise the limit in Settings → Billing…"
PASS  policy without key: no leak            400 "A policy key is required"
```
And the whole Phase-2 hostile-input sweep re-run end to end:
```
before:  6 responses were HTTP 500
after:   0 responses were HTTP 500
```

---

### BUG-007: Customer top-up failure shows admin-only instructions and returns 500
- **Area**: Backend / Customer Center
- **Severity**: Medium
- **Steps to reproduce**:
  1. With `activePaymentGateway = 'lemonsqueezy'` and no top-up variants configured (the current state — `lemonSqueezySettings.topUpVariants` is `{}`), log in as a customer.
  2. Go to `/billing?tab=credits`, pick a preset and click **Add USD 50**.
- **Expected behavior**: A short message aimed at the customer — something like "Card payments are temporarily unavailable, please contact support" — and a non-500 status, since nothing is actually broken on the server; the platform is just not configured to take that amount.
- **Actual behavior**: HTTP 500, and the customer is shown the operator's own runbook in a toast. Captured from the live browser:
  > "No LemonSqueezy top-up variant configured for USD 50. Add one in Admin Center → Integrations → LemonSqueezy → Top-up variants, or switch the active gateway to Stripe which supports any amount."
  
  The customer is told to go into an Admin Center they cannot reach, and cannot pay. This is the platform's revenue path.
- **Root cause**: `backend/src/services/lemonsqueezy/lemonSqueezyService.js:128-134` throws an operator-facing message; `backend/src/controllers/customer/walletController.js:116-118` catches it and returns it verbatim with a 500 (an instance of BUG-006). `frontend-customer-center/src/pages/billing/tabs/CreditsTab.js:77` renders `err.response?.data?.message` straight into `message.error(...)`.
- **Note**: the toast also appeared twice in the capture — worth a look when fixing, though it may just be React StrictMode double-invoking in dev.
- **Status**: ✅ **Verified**

#### Fix
`lemonSqueezyService.js` was throwing a bare `Error` carrying the operator's runbook. It now logs that runbook server-side and throws a customer-facing error instead — `status: 503`, `code: 'TOPUP_AMOUNT_UNAVAILABLE'`, and a message a customer can act on. 503 rather than 500 because nothing is broken: the platform simply isn't configured to take that amount.

`apiError.js`'s `failure()` treats 503 as a deliberate status, so the message passes through to the client while any *undeliberate* error still gets the generic fallback.

**Files touched** — `backend/src/services/lemonsqueezy/lemonSqueezyService.js`, `backend/src/utils/helpers/apiError.js`

#### Verification (live)
```
status 503
message: "USD 50 is not available as a top-up amount right now. Please try one of the suggested amounts, or contact support."
PASS  no admin instructions reach the customer
PASS  not a bare 500 any more                503
PASS  the message is written for a customer
```
Top-up validation unchanged — `0`, `-50`, `"abc"`, below-min and above-max all still return their own clear 400s.

---

### BUG-008: Admin wallet adjust has no bounds — `1e308` crashes it, `-999999` silently creates a $1M debt
- **Area**: Backend (`routes/v1/admin/wallets.routes.js`)
- **Severity**: Medium
- **Steps to reproduce**:
  1. `POST /admin/wallets/:userId/adjust` with `{ "amount": 1e308 }` → HTTP 500 (see BUG-006 for the leaked body).
  2. `POST /admin/wallets/:userId/adjust` with `{ "amount": -999999 }` → HTTP 200.
- **Expected behavior**: Both rejected. An adjustment far outside any plausible range is far more likely to be a typo than an intention, and the second one puts a customer $999,489 in debt in one click.
- **Actual behavior**: Verified live — `-999999` succeeded and left the wallet at `-999489` (reconciliation confirmed `ledgerTotal === walletBalance`, so the ledger faithfully recorded the mistake). This is 1000× the configured `payg.creditLimit` of 1000, and no confirmation step or upper bound exists. `1e308` produces a 500 rather than a clean rejection.
- **Root cause**: `backend/src/routes/v1/admin/wallets.routes.js:251-256` validates only `!value || Number.isNaN(value)` — enough to reject `0`, `"abc"` and a missing field, but there is no `Number.isFinite` check and no magnitude bound in either direction. Notably the **customer**-facing top-up endpoint does this correctly (min/max enforced from `AdminSettings.billingSettings`, `1e308` → clean 400 "The maximum top-up is USD 5000"), so the admin path is the inconsistent one.
- **Suggested fix direction**: reuse the same admin-configured bounds the customer top-up already reads, rather than hardcoding a limit — consistent with this project's "everything tunable from the Admin Center" rule.
- **Status**: ✅ **Verified**

#### Fix
Two changes to `POST /admin/wallets/:userId/adjust`:
- `!value || Number.isNaN(value)` became `!value || !Number.isFinite(value)`, which rejects `Infinity` and `1e308` overflow as well as `NaN`.
- A magnitude bound in **both** directions, read from a new `billingSettings.maxManualAdjustment` (default 10000) rather than hardcoded — consistent with how every other billing limit on this platform is tunable, and exposed through `PUT /admin/settings/billing` so an operator can raise it when they genuinely mean to.

The refusal names the limit and says where to change it.

**Files touched** — `backend/src/routes/v1/admin/wallets.routes.js`, `backend/src/services/billing/billingModeService.js`, `backend/src/routes/v1/admin/settings.routes.js`

#### Verification (live)
```
PASS  1e308 rejected with 400 (was a 500)     400
PASS  -999999 rejected                        400 "A single adjustment cannot exceed USD 10000. Raise the limit in Settings → Billing…"
PASS  a normal adjustment still works         200
```

---

### BUG-009: Customer notifications are unreachable — the API is admin-only and the bell shows hardcoded fake data
- **Area**: Backend + Customer Center
- **Severity**: High
- **Steps to reproduce**:
  1. Log in as a customer and call `GET /api/v1/notifications` (or `/unread-count`) with the customer's token.
  2. Separately, open the Customer Center and click the notification bell in the header.
- **Expected behavior**: The customer sees their own notifications — the ones the backend really does create for them.
- **Actual behavior**: Two independent failures that combine badly.
  1. **The API is admin-gated.** Every route in `backend/src/routes/v1/notification/index.js` is mounted with `adminAuth`, so a customer token gets:
     `403 {"success":false,"message":"Access denied. Admin privileges required."}` — on `/notifications`, `/notifications/unread-count`, and the mark-read / delete routes too. Each route's own doc comment says `@access Private`, so the `adminAuth` looks unintentional.
  2. **The bell is fake.** `frontend-customer-center/src/components/AppLayout.js:27-53` renders a hardcoded `NOTIFICATIONS` array of four invented items, complete with an unread dot.
  
  So a customer is shown fabricated notifications about deployments that do not exist — including *'Deployment "kimi-research" was rejected'* and *'Deployment "mistral-prod" is now running'* — while their real notifications sit in Postgres and cannot be reached.
- **Why this matters**: the backend genuinely produces the notifications that matter. On my test account it correctly wrote `deployment_ready` ("Your model is live"), `deployment_suspended` ("Deployment paused — out of credit") and a pay-as-you-go offer. "Your deployment stopped because you ran out of credit" is precisely the message a paying customer must see, and today they cannot.
- **Root cause**: `routes/v1/notification/index.js:3` imports `adminAuth` and applies it to all five routes; the customer frontend was never wired to the endpoint and still carries its placeholder array.
- **Note / needs a decision**: fixing the `adminAuth` gate is unambiguous. Replacing the mocked bell with the real feed is a small feature, not just a bug fix — flag for the user before building it.
- **Status**: ✅ **Verified**

#### Fix
**Backend** — `routes/v1/notification/index.js` was mounted behind `adminAuth`; it now uses the generic `auth` middleware. This is safe without any other change because every handler already scopes to `req.userId`, and the two mutating routes already return 403 when the notification belongs to someone else. Verified rather than assumed (see below).

**Frontend** — added `frontend-customer-center/src/api/notificationsApi.js` and rewired the bell in `AppLayout.js` to the real feed: the 26-line hardcoded `NOTIFICATIONS` array is deleted, the badge shows the true unread count, unread rows are tinted, clicking one opens its real message and marks it read (optimistically, then on the server), there is a "Mark all read" action, and real loading/empty states replace the "Coming soon" placeholder. Notifications carry an open vocabulary of ~20 `type` values and no styling, so icon/tone/section are derived from the type with a neutral fallback — an unrecognised type still renders rather than being dropped.

**Files touched**
- `backend/src/routes/v1/notification/index.js`
- `frontend-customer-center/src/api/notificationsApi.js` — new
- `frontend-customer-center/src/components/AppLayout.js`

#### Verification (live)
API, including the scoping this fix depends on:
```
PASS  customer can read their own notifications             200 — 17 items, 17 unread
        • [account_activated] Account Status Updated
        • [deployment_suspended] Deployment paused — out of credit
PASS  customer can read their unread count                  200
PASS  REGRESSION: admin still reads their own notifications 200 — 20 items
PASS  each customer sees only their own                     A=17 B=1 overlap=0
PASS  customer B cannot mark A's notification read          403
PASS  customer B cannot delete A's notification             403
PASS  no token still refused                                401
PASS  customer can mark their own notification read         200
```
Browser:
```
PASS  bell shows the customer's REAL notifications
PASS  the fabricated mock notifications are gone
PASS  no console/network errors
PASS  clicking a notification opens its real detail
      "Credit added to your account · Wallet · just now — +1 USD. New balance: -16.24 USD."
PASS  opening it marked it read on the server               unread 1 -> 0
PASS  "Mark all read" clears them server-side               unread=0
```

---

### BUG-010: Every paginated list endpoint returns HTTP 500 on `page=0`, `page=-5`, `limit=abc`; `limit` has no upper bound
- **Area**: Backend (systemic — 13 `skip` computations across 8 service files)
- **Severity**: Medium
- **Steps to reproduce**: `GET /api/v1/admin/customers?page=0` (and the same on any other list).
- **Expected behavior**: Clamp to sane values, or reject with 400. `page=0` in particular is a completely ordinary thing for a 0-indexed API client to send.
- **Actual behavior**: HTTP 500. Verified across 10 endpoints — **40 of 66** malformed-pagination requests returned 500:
  ```
  /admin/customers          page=0→500  page=-5→500  limit=abc→500  page=abc→500  limit=1000000→200
  /admin/users              page=0→500  page=-5→500  limit=abc→500  page=abc→500  limit=1000000→200
  /admin/logs               page=0→500  …
  /admin/blog/posts         page=0→500  …
  /admin/seo/redirects      page=0→500  …
  /admin/deployments        page=0→500  …
  /admin/wallets            page=0→500  …
  /customer/deployments     page=0→500  …
  /customer/wallet/transactions   page=0→500  …
  /customer/billing/payments      page=0→500  …
  ```
  Separately, `limit=1000000` is accepted with no ceiling — an unauthenticated-feeling foot-gun on tables like `activity_logs` (1031 rows today, unbounded in production).
- **Root cause**: the shared idiom `const skip = (Number(page) - 1) * Number(limit)` with no validation, at:
  `services/user/userService.js:212`, `services/admin/activityLogService.js:190,222`, `services/admin/blogPostService.js:90,258`, `services/admin/seoRedirectService.js:40`, `services/billing/creditService.js:461,558`, `services/billing/paymentService.js:89,106`, `services/notification/notificationService.js:130`, `services/deployment/deploymentService.js:413,533` (the last two use `parseInt`), plus `routes/v1/admin/users.routes.js:64`. `page=0` yields a negative `skip` and `limit=abc` yields `NaN`; Prisma rejects both.
- **Suggested fix direction**: one shared `paginate({ page, limit })` helper that clamps `page` to ≥1, `limit` to 1..maxLimit and coerces non-numerics to the default — used by all 13 sites rather than patching each.
- **Status**: ✅ **Verified**

#### Fix
New `backend/src/utils/helpers/pagination.js` exporting `paginate({ page, limit })`, which clamps `page` to ≥1, `limit` to 1..200, coerces non-numerics to the default, and returns `{ page, limit, skip, take }`. Clamping rather than rejecting is deliberate — `page=0` is an ordinary thing for a 0-indexed client to send, and the first page is a friendlier answer than a 400.

Applied at all 13 service call sites (`userService`, `activityLogService` ×2, `blogPostService` ×2, `seoRedirectService`, `creditService` ×2, `paymentService` ×2, `notificationService`, `deploymentService` ×2) plus the one route-level site in `users.routes.js`, and to the 16 matching `take:` expressions. The routes' pagination *response* blocks were also echoing the raw query values back (`?limit=abc` returned `itemsPerPage: null` and `totalPages: NaN`), so those now report the clamped values too.

**Two mistakes my own codemod introduced, caught before finishing** — worth recording because a syntax check does not find them:
- `notificationService.listForUser` and `activityLogService.listLogins` / `listLoginHistory` take `limit`/`skip` directly rather than `page`/`limit`, so they had no `paginate` call to define `take` — the blind `take: Number(limit)` → `take,` rewrite left `take` undefined, turning `GET /notifications` and both login-history endpoints into 500s.
- Three route handlers that destructure only `limit` got a `safeLimit` *reference* without a definition.

Both were found by writing two small scanners (`check-safelimit.js`, `check-take.js`) that look for a use with no definition in the same block, then fixed and re-verified.

**Files touched** — `backend/src/utils/helpers/pagination.js` (new); services: `user/userService.js`, `admin/activityLogService.js`, `admin/blogPostService.js`, `admin/seoRedirectService.js`, `billing/creditService.js`, `billing/paymentService.js`, `notification/notificationService.js`, `deployment/deploymentService.js`; routes: `admin/{analytics,blog,customers,deployments,logs,seo,users,wallets}.routes.js`, `notification/index.js`, `public/blog.routes.js`

#### Verification (live)
The original probe — 11 endpoints × 6 malformed shapes — re-run:
```
before:  40 of 66 malformed-pagination requests returned HTTP 500
after:    0 of 66 malformed-pagination requests returned HTTP 500
```
And the clamping behaves sensibly rather than merely not crashing:
```
PASS  page=0 clamps to page 1                     identical rows to page=1
PASS  limit=abc falls back to the default         {"currentPage":1,"totalPages":1,"totalItems":12,"itemsPerPage":20}
PASS  limit is capped at 200                      200 rows returned for ?limit=1000000
```
Every endpoint the codemod touched re-checked end to end — customer/user login-history, customer activity, notifications, analytics top-customers and recent-activities, users list and CSV export, logs, blog, deployments, wallets, public blog: **all 200**.

---

### BUG-011: Login reveals whether an email is registered (user enumeration) and leaks the remaining-attempt count
- **Area**: Backend (`routes/v1/auth/customer.routes.js`)
- **Severity**: Medium
- **Steps to reproduce**:
  1. `POST /api/v1/auth/customer/login` with an email that does not exist.
  2. `POST /api/v1/auth/customer/login` with a real email and a wrong password.
- **Expected behavior**: Both return the same generic message and the same status, so an attacker learns nothing about which addresses have accounts.
- **Actual behavior**: They differ in both status and text:
  - unknown email → **404** "No account found with this email. Please sign up first."
  - real email, wrong password → **401** "Incorrect password. 3 attempts remaining."
  
  Anyone can test an email list against the endpoint and learn exactly which addresses are customers. The second message additionally discloses the lockout counter, which tells an attacker precisely how many guesses remain before they should rotate to another address.
- **Status**: ✅ **Verified**

#### Fix
Both failure branches of the customer login now return the same status and the same text — a single `INVALID_CREDENTIALS_MESSAGE = 'Incorrect email or password.'` constant, used for "no such account" (previously 404 with a distinct message) and "wrong password" (previously 401 naming the remaining attempts).

The attempt counter is still tracked and still locks the account; it simply isn't narrated back to the caller, because it told an attacker exactly how many guesses were left on an address before they should move to the next one.

**Files touched** — `backend/src/routes/v1/auth/customer.routes.js`

#### Verification (live)
```
PASS  identical status and message
      unknown-email  401 "Incorrect email or password."
      wrong-password 401 "Incorrect email or password."
PASS  attempt count no longer disclosed
PASS  REGRESSION: a correct login still works    200
```

---

### BUG-012: Signup accepts undeliverable email addresses
- **Area**: Backend (`routes/v1/auth/customer.routes.js`)
- **Severity**: Medium
- **Steps to reproduce**: `POST /api/v1/auth/customer/signup` with each of the addresses below.
- **Expected behavior**: Rejected with 400 — none of these can receive mail, so the account can never verify, reset a password, or be contacted.
- **Actual behavior**: All accepted with **201**:

  | Address | Problem |
  |---|---|
  | `@b.com` | no local part |
  | `a@b` | no TLD |
  | `a b@c.com` | contains a space |
  | `a@b.com\n` | trailing newline — also a classic mail-header-injection vector |
  | `xxx…300 chars…@b.com` | local part far over the 64-char RFC limit |

  `notanemail`, `a@` and `""` *are* correctly rejected, so a check exists — it is just too loose.
- **Status**: ✅ **Verified**

#### Fix
`middleware/validation/emailValidator.js` only ever checked "is there something after the @". It now runs a shape check first: no leading/trailing whitespace, no whitespace or control character anywhere (which also closes the mail-header-injection vector), ≤254 characters overall, ≤64 in the local part (RFC 5321), and a conservative pattern requiring a non-empty local part, a dotted domain and a ≥2-letter TLD.

**A mistake caught before finishing:** my first pattern was `^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[A-Za-z]{2,}$`, whose greedy middle group swallowed the TLD — it rejected `admin@ssh.com`, which would have locked the platform's own super admin out at signup/validation time. Found by unit-testing the pattern against real addresses before wiring it up, then corrected to `^[^\s@]+@(?:[^\s@.]+\.)+[A-Za-z]{2,}$`.

**Files touched** — `backend/src/middleware/validation/emailValidator.js`

#### Verification
20 shape cases run against the pattern as it ships in the file (extracted from the source, not retyped) — all correct. Then live:
```
PASS  "@b.com" rejected                    400 "Please enter a valid email address"
PASS  "a@b" rejected                       400
PASS  "a b@c.com" rejected                 400
PASS  "a@b.com\n" rejected                 400
PASS  300-char local part rejected          400
PASS  REGRESSION: a real address still signs up   201
```
Real addresses confirmed still accepted: `admin@ssh.com`, `hasnainn37@gmail.com`, `deployer@aiocean-test.com`, `first.last+tag@sub.example.co.uk`, `user_name@example.io`, `O'Brien@example.com`.

---

### BUG-013: A NUL byte in any text field returns HTTP 500 instead of a validation error
- **Area**: Backend (all text inputs)
- **Severity**: Low
- **Steps to reproduce**: Send a value containing a NUL byte (U+0000) as `name` on signup, or as a department name, or a blog post title.
- **Expected behavior**: 400 — reject or strip the byte.
- **Actual behavior**: HTTP 500 in all three places. PostgreSQL cannot store NUL in a `text` column, so Prisma throws and the raw error is returned (compounding BUG-006 — the department and blog responses included the absolute server path and a source excerpt).
- **Note**: every other hostile value I tried was handled correctly — SQL-injection strings, `<script>` tags, emoji/RTL/accented unicode, a 100,000-character string and `__proto__` were all stored and returned as literal text with no error and no injection. NUL is the only one that breaks.
- **Status**: ✅ **Verified**

#### Fix
New `backend/src/middleware/validation/sanitizeInput.js`, mounted in `app.js` right after the body parsers, which walks the parsed body and query and strips U+0000 from every string.

Stripping rather than rejecting is deliberate: a NUL in a name or a title is never meaningful content — it is a mistake or a probe — and the rest of the value is still usable. The walker is depth-limited and skips non-plain objects (Date, Buffer) so it can't mangle anything structured.

**Files touched** — `backend/src/middleware/validation/sanitizeInput.js` (new), `backend/src/app.js`

#### Verification (live)
```
PASS  signup with a NUL in the name succeeds (was 500)   201
PASS  the NUL is stripped, the rest is kept              "QANul"
PASS  department with a NUL succeeds                     201
```

---

### BUG-014: Login with a non-string `email` returns HTTP 500 instead of 400
- **Area**: Backend (`routes/v1/auth/customer.routes.js`)
- **Severity**: Low
- **Steps to reproduce**: `POST /api/v1/auth/customer/login` with `{"email": {"$ne": null}, "password": {"$ne": null}}`, or with `{"email": ["a@b.com"], "password": "x"}`.
- **Expected behavior**: 400 — the field is not a string.
- **Actual behavior**: HTTP 500 "Error logging in. Please try again later."
- **Note**: this is *not* exploitable as NoSQL injection — the backend is on Prisma/Postgres now, and the query simply fails. It is a missing type check, and worth fixing so the endpoint stops 500-ing on trivially malformed input. Worth confirming the same shape is rejected cleanly on the admin login route too.
- **Status**: ✅ **Verified**

#### Fix
The customer login now requires `email` and `password` to be strings, rejecting an object or array with a 400 before the value reaches the query layer.

**Files touched** — `backend/src/routes/v1/auth/customer.routes.js`

#### Verification (live)
```
PASS  object email  → 400 (was 500)
PASS  array email   → 400 (was 500)
PASS  number email  → 400 (was 500)
```

---

### BUG-015: Admin dashboard scrolls sideways at ordinary desktop widths
- **Area**: Admin Center
- **Severity**: Medium
- **Steps to reproduce**: Log into the Admin Center at a 1440×900 viewport and look at `/` (the dashboard).
- **Expected behavior**: No horizontal page scroll at a standard laptop width.
- **Actual behavior**: The page body scrolls sideways. Measured across widths:
  ```
  1920px : no overflow
  1440px : +80px      <- ordinary laptop
  1280px : +160px
  1024px : +288px
   768px : +152px
   375px : +545px
  ```
  The culprit at every width is the **Recent Activity** table (`<TABLE>` … "Activity Status Time"), whose intrinsic width exceeds the half-width `Col` it sits in and pushes the whole document out rather than scrolling within its card.
- **Root cause**: `frontend-admin-center/src/pages/DashboardPage.js:245` and `:267` — both `<Table>` elements are rendered without a `scroll` prop. antd only constrains a table's width when told to (`scroll={{ x: 'max-content' }}` or `x: true`); without it the table forces its minimum content width onto the parent. Both sit in `<Col xs={24} lg={12}>`, so from `lg` down the available width halves and the table no longer fits.
- **Also noticed in the same block** (not the cause, worth fixing while there): both tables use `rowKey={(r) => r.customer?.email || Math.random()}` / `r._id || Math.random()`. A random key changes on every render, so React discards and remounts every row each time the component re-renders.
- **Status**: ✅ **Verified**

#### Fix
Both dashboard tables were rendered without a `scroll` prop; without one antd forces the table's intrinsic width onto its parent, so a table wider than its half-width `Col` pushed the whole document sideways. Both now use `scroll={{ x: 'max-content' }}`.

The `rowKey={(r) => … || Math.random()}` fallbacks flagged alongside this are fixed too — a random key changes on every render, so React discarded and rebuilt every row each time. They fall back to the row index now.

Fixed together with BUG-016, which covers the same defect across the rest of both apps.

**Files touched** — `frontend-admin-center/src/pages/DashboardPage.js`

#### Verification (live)
```
before:  1440px +80px · 1280px +160px · 1024px +288px · 768px +152px · 375px +545px
after:   1440px ok    · 768px ok     · 375px ok
```

---

### BUG-016: Data tables push the whole page sideways at narrow widths instead of scrolling inside their own container
- **Area**: Admin Center + Customer Center (13 tables)
- **Severity**: Medium
- **Steps to reproduce**: Open any list page in either app at a 375px-wide viewport (a phone) and try to scroll.
- **Expected behavior**: Wide content scrolls horizontally *inside its own container*; the page body never scrolls sideways.
- **Actual behavior**: Measured across 1440 / 768 / 375px — **every** admin page and **every** customer page tested overflows the body at 375px, and several already do at 768px:

  | Surface | 1440px | 768px | 375px |
  |---|---|---|---|
  | Admin `/` | **+80px** | +152px | +545px |
  | Admin `/resource-pricing` | ok | **+415px** | +808px |
  | Admin `/marketing/pages` | ok | **+229px** | +622px |
  | Admin `/analytics`, `/logs`, `/customers`, `/users`, `/deployments`, `/wallets`, `/receivables`, `/tiers`, `/models`, `/blog/posts`, `/settings`, `/jobs` | ok | ok | +111 … +316px |
  | Customer `/billing` | ok | **+78px** | +471px |
  | Customer `/dashboard`, `/models`, `/deployments`, `/limits`, `/settings`, `/support`, `/deploy` | ok | ok | +49 … +210px |

  The **Marketing Site is clean at all three widths on all 7 pages** — so this is specific to the two antd apps.
- **Root cause**: 13 `<Table>` elements are rendered without a `scroll` prop (11 of the 24 tables across both apps already have one, so the pattern exists — it was just not applied consistently):
  - admin: `components/common/DataTable.js:234`, `pages/AnalyticsPage.js:256,291,521,564`, `pages/catalog/ResourcePricingPage.js:345,463`, `pages/DashboardPage.js:245,267`
  - customer: `pages/billing/tabs/OverviewTab.js:441,444,445,446`
  
  A handful of non-table elements also overflow at 375px only (admin `/settings` "Save Customer Settings" button, admin `/jobs` help text, customer `/dashboard` currency span, `/limits` and `/settings` tags).
- **Decision (from the user, 2026-09-07)**: **the Admin Center must work on a phone.** So this is a confirmed defect on both apps at every width listed above, not an open product question.
- **Status**: ✅ **Verified**

#### Fix
**Decision recorded: the Admin Center must work on a phone** (user, 2026-09-07), so this was fixed properly rather than scoped to desktop.

Four separate causes, found by measuring rather than guessing:

1. **13 tables had no `scroll` prop** — added `scroll={{ x: 'max-content' }}` to all of them (admin `DataTable`, `AnalyticsPage` ×4, `ResourcePricingPage` ×2, `DashboardPage` ×2; customer `OverviewTab`). All 24 tables across both apps now have one.
2. **The table wrappers could not shrink.** A flex/grid child defaults to `min-width: auto`, so the container never became narrower than the table and the table's own scrollbar never engaged. `.ant-table-wrapper { min-width: 0 }` (plus `.ant-card`, `.ant-col`, `.ant-tabs-tabpane`) in both apps' `index.css`.
3. **The admin sidebar never collapsed on a phone.** `collapsedWidth: 0` only applies while the sider is *collapsed*, and nothing was collapsing it — so it kept its full ~240px and left barely 130px for the page. Added an effect keyed on the breakpoint, using the raw setter so the forced collapse isn't persisted to localStorage and followed back to the operator's desktop. The customer center had the same effect but keyed only on `location.pathname`, so it never fired when the viewport itself crossed the breakpoint — `broken` added to its dependencies.
4. **Horizontal control rows didn't wrap** — a toolbar (`Space`), the segmented tab switcher and a 200px "Save Customer Settings" button. A `max-width: 575px` block wraps toolbars, lets the segmented control scroll, and caps button width.

Also, at phone width **pinned columns are unpinned**: `rowActions` marks the actions column `fixed: 'right'`, which antd renders as a sticky cell floating above the scrolling table — on a 375px screen it sat on top of the columns underneath, rendering the customers table's "Actions" header overlapping "Status". There is no room to pin anything at that width. (The selectors cover both antd's current `-fix-start/-fix-end` names and the older `-fix-left/-fix-right`.)

**Files touched** — `frontend-admin-center/src/{index.css, components/layout/AppLayout.js, components/common/DataTable.js, pages/AnalyticsPage.js, pages/DashboardPage.js, pages/catalog/ResourcePricingPage.js}`, `frontend-customer-center/src/{index.css, components/AppLayout.js, pages/billing/tabs/OverviewTab.js}`

#### Verification (live)
Every page measured at 1440 / 768 / 375px:
```
before:  admin     0/15 pages clean at 375px  (and / already broken at 1440)
         customer  0/8  pages clean at 375px
after:   admin    15/15 clean at all three widths
         customer  8/8  clean at all three widths
         marketing 7/7  clean (unchanged — it was always fine)
```
Confirmed by screenshot that the result is genuinely usable, not merely free of overflow: at 375px the sidebar is collapsed behind a header control, stat cards stack, filters wrap, and the customers table scrolls inside its card with Name / Email / Status readable and no overlapping headers.

---

### BUG-017: Every seed script is broken — a fresh install cannot create its first admin
- **Area**: Backend (`src/scripts/seed/*`)
- **Severity**: High
- **Steps to reproduce**: In `backend/`, run `npm run seed`.
- **Expected behavior**: The super-admin account is created from `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` — this is the documented bootstrap for a new deployment.
- **Actual behavior**: Immediate crash. Verified live, every seed script fails the same way:
  ```
  npm run seed              Error: Cannot find module 'mongoose'
  npm run seed:usecases     Error: Cannot find module 'mongoose'
  npm run seed:components   Error: Cannot find module 'mongoose'
  npm run seed:catalog      Error: Cannot find module 'mongoose'
  npm run seed:questionnaire  Error: Cannot find module 'mongoose'
  npm run seed:journey      Error: Cannot find module 'mongoose'
  ```
  `npm run seed:deploy` chains four of these, so it fails too. For a product meant to be deployed white-label, a fresh install currently cannot be bootstrapped at all — there is no way to create the first admin account or seed the catalog.
- **Root cause**: leftover from the MongoDB → PostgreSQL cutover. `mongoose` was uninstalled and `src/models/**` deleted, but the 8 seed scripts still `require('mongoose')` and `require('../models/...')`. Affected: `seedSuperAdmin.js`, `seedUseCaseTags.js`, `seedResourceComponents.js`, `seedCatalog.js`, `seedQuestionnaire.js`, `seedDeploymentJourney.js`, `seedBlogPosts.js`, `seedRecommendationPolicy.js`.
- **Scope note**: 11 further scripts under `src/scripts/migration/` and `src/scripts/cleanup/` also require `mongoose`. Those are historical one-time Mongo→Postgres copy scripts and are *expected* to need it — they are not part of a fresh install and can reasonably stay broken (or be deleted), but `migrate:pg:*` is still wired into `package.json`. The seed scripts are the ones that must work.
- **Status**: ✅ **Verified**

#### Fix
All 8 seed scripts ported off Mongoose. The seed **data** in each file is untouched — only the persistence layer changed.

Wherever a value is *derived* rather than stored, the seed now goes through the same domain service the Admin Center uses, instead of writing to Prisma directly. Writing directly would have quietly produced broken data:
- `ResourceComponent.pricePerUnitPerHour` is derived from price + pricing period — a direct write leaves it `0`, which would price every tier at nothing.
- `Tier.pricePerHour`/`stoppedPricePerHour` and the flat spec columns are rolled up from the component lines (what the old Mongoose pre-save hook did).
- `QuestionTemplate.affectsSizing` is derived from options and signal rules.
- `BlogPost.readTime`/`slug`/`publishedAt` are derived on create.

Two nested shapes needed remapping to the post-migration schema: `DeploymentJourney.settings{}` is now ten flat `settings*` columns, and a step's `dependsOn{}` is two columns; steps moved from an embedded array to a child table, so a re-seed replaces the step rows inside one transaction.

A new `backend/src/scripts/seed/seedHelpers.js` holds the connect/upsert/finish plumbing every seed shares — including the existing "never overwrite something a human edited in the Admin Center unless `--force`" rule, which now keys off `updatedById`.

**Files touched**
- `backend/src/scripts/seed/seedHelpers.js` — new (shared plumbing)
- `backend/src/scripts/seed/seedSuperAdmin.js`, `seedUseCaseTags.js`, `seedResourceComponents.js`, `seedCatalog.js`, `seedQuestionnaire.js`, `seedDeploymentJourney.js`, `seedRecommendationPolicy.js`, `seedBlogPosts.js` — ported

#### Verification (live)
Built a throwaway `qa_freshinstall` database and ran a complete install into it — `prisma migrate deploy`, then `npm run seed`, then `npm run seed:deploy`:
```
All migrations have been successfully applied.
✅ Super Admin created successfully!
Use case tags seeded: 10 created, 0 updated, 0 skipped
Seeded 4 categories and 11 resource components.
Catalog seeded: 8 tiers, 9 models
Questionnaire seeded: 14 created, 0 updated, 0 skipped
Deployment journeys seeded: 2 created, 0 updated, 0 skipped
```
The resulting database matches the seeded shape of the real one exactly:
```
user 1 · useCaseTag 10 · tierCategory 4 · resourceComponent 11 · tier 8
tierComponent 38 · aIModel 9 · aIModelSupportedTier 18 · questionTemplate 14
deploymentJourney 2 · deploymentJourneyStep 31 · adminSettings 1
superAdminEmail  admin@ssh.com
passwordVerifies true      (bcrypt compare against SUPER_ADMIN_PASSWORD)
adminHasLegacyId true
tierPricing      H100 80GB x2 — 7.746/hr running, 0.492/hr stopped, 5 component lines, 2 GPUs (derived, not zero)
```
Scratch database dropped afterwards. **Regression check on the real database** — all catalog surfaces unchanged and pricing intact:
```
PASS admin tiers 8 · admin models 9 · resource components 11 · customer catalog 9
PASS customer tiers 8 · deploy journey 16 steps · questionnaire 14 · public catalog 9
PASS real-DB tier pricing intact: H100 80GB x2 $8.5206/hr  (unchanged)
```

---

### BUG-018: During maintenance the public site shows a broken, unbranded "404 Page not found"
- **Area**: Marketing Site
- **Severity**: High
- **Steps to reproduce**:
  1. Admin Center → Settings → enable maintenance mode with a message.
  2. Wait ~6s for the settings cache to expire, then open `http://localhost:3000/`.
- **Expected behavior**: The maintenance page, with the operator's message — `frontend-marketing/src/pages/MaintenancePage.js` exists for exactly this.
- **Actual behavior**: A visitor gets a 404. Captured live:
  > "? Sign in Get started **404 Page not found** The page you're looking for doesn't exist or has been removed. Go home ? Product Get Started Legal © 2026 . All rights reserved."
  
  Note the logo renders as "?" and the footer reads "© 2026 . All rights reserved." with an empty company name — the site config never loaded either, so the page is unbranded as well as wrong. Anyone visiting the public site during a maintenance window is told the company's homepage does not exist.
- **Root cause**: `backend/src/middleware/security/maintenanceMode.js:22-28` bypasses `/api/v1/public/site` and `/api/v1/public/navigation`, but the marketing site actually calls `/api/v1/public/marketing/site` and `/api/v1/public/marketing/pages/:slug` (the `/public/site` form is only an alias mounted in `routes/v1/public/index.js`). Those real paths are blocked with 503, and the page component treats any failed page fetch as "not found".
- **Contrast**: the Customer Center handles this correctly — it renders "Under Maintenance" with the admin's exact message.
- **Status**: ✅ **Verified**

#### Fix
One line of the bypass list. `maintenanceMode.js` exempted `/api/v1/public/site` and `/api/v1/public/navigation`, but those are only the *alias* paths mounted in `routes/v1/public/index.js`. The marketing site actually calls `/api/v1/public/marketing/site`, which was being blocked with 503 — so the site could never learn that maintenance was on, and every page fell through to its not-found state with no branding. Added both real paths to `BYPASS_PATHS`.

The frontend needed no change: `frontend-marketing/src/App.js:47` already renders `<MaintenancePage>` from `site.maintenance.enabled`, and the endpoint already returns that flag. Only the data was unreachable.

**Files touched** — `backend/src/middleware/security/maintenanceMode.js`

#### Verification (live)
```
PASS  site config reachable during maintenance          200
PASS  navigation reachable during maintenance           200
PASS  config reports maintenance is on                  {"enabled":true,"message":"Scheduled upgrade — back at 3pm."}
PASS  other public endpoints still blocked              pages=503 catalog=503
PASS  marketing home shows the maintenance page         "Under Maintenance Scheduled upgrade — back at 3pm. — AI-Ocean"
PASS  marketing pricing shows the maintenance page      "Under Maintenance Scheduled upgrade — back at 3pm. — AI-Ocean"
PASS  marketing blog shows the maintenance page         "Under Maintenance Scheduled upgrade — back at 3pm. — AI-Ocean"
PASS  REGRESSION: admin still works during maintenance  200
PASS  REGRESSION: site restored after maintenance off
```

---

### BUG-019: Turning on maintenance mode logs every customer out
- **Area**: Customer Center
- **Severity**: Medium
- **Steps to reproduce**:
  1. Log in as a customer; confirm a token is in `localStorage`.
  2. Turn maintenance mode on, wait ~6s, reload the Customer Center.
  3. Turn maintenance mode off, wait ~6s, reload again.
- **Expected behavior**: The customer sees the maintenance page, and once maintenance ends they are back on their dashboard, still signed in. A maintenance window is not a sign-out event.
- **Actual behavior**: Verified live —
  ```
  logged in           /dashboard   token in localStorage: true
  during maintenance  /dashboard   token still there: false   <- wiped
  after maintenance   /login       token still there: false   <- must log in again
  ```
  Every signed-in customer is silently logged out by an operator toggling maintenance.
- **Root cause**: `frontend-customer-center/src/context/AuthContext.js:13-32`. `fetchMe` calls `/auth/customer/me`, which during maintenance returns **503** with a JSON body `{ success: false, maintenance: true, message }`. The handler only distinguishes two cases — `if (data.success) … else logout()` — so a maintenance response is treated as a failed authentication and the token is destroyed. The `catch` branch already gets this right ("network failure — keep existing user from localStorage"); a 503 with a JSON body simply never reaches it.
- **Status**: ✅ **Verified**

#### Fix
`AuthContext.fetchMe` treated *any* unsuccessful `/auth/customer/me` response as a failed login. It now only discards the session for the two reasons that actually warrant it — a 401, or a 403 carrying one of the account-ended codes introduced by the BUG-005 fix. Maintenance (503), server errors and feature gates leave the stored session alone, matching what the `catch` branch already did for network failures.

The account-ended list is deliberately duplicated in `axiosInstance.js` and `AuthContext.js` because they are two separate transports (axios vs. a raw `fetch`); both are commented to stay in step.

**Files touched** — `frontend-customer-center/src/context/AuthContext.js`

#### Verification (live)
```
PASS  logged in, token stored                                 /dashboard
PASS  during maintenance: session SURVIVES                    token=true
PASS  during maintenance: maintenance page shown              "Under Maintenance Scheduled upgrade — back at 3pm."
PASS  after maintenance: still signed in, back on dashboard   /dashboard token=true
PASS  dashboard renders real data again
PASS  REGRESSION: a suspended customer IS still signed out    /login token=false
```
The last line matters: it confirms the BUG-005 fix still works after loosening this check.

---

### BUG-020: Two cron jobs run a query-per-customer and will not scale
- **Area**: Backend (`jobs/lowBalanceWarning.js`, `jobs/debtCollection.js`)
- **Severity**: Medium (no user-visible symptom today — this is a scalability defect)
- **Steps to reproduce**: Read `jobs/lowBalanceWarning.js:36-58`; the job runs on a schedule against every wallet holding a balance.
- **Expected behavior**: A per-customer background job should batch its reads, and should not re-read platform settings once per customer.
- **Actual behavior**: `lowBalanceWarning` does `const wallets = await creditService.listWithBalance()` and then, **inside the loop**, calls `creditService.getWalletSummary(wallet.userId)` — which itself fires three queries in parallel (`getOrCreateWallet`, `getBurnRate` → a deployments query, and `billingModeService.getBillingSettings()`), followed by `userService.findByLegacyId(wallet.userId)`. That is roughly **5 queries per funded customer, per run**, and the platform-wide billing settings are re-fetched once per customer even though they are identical every time. `jobs/debtCollection.js:171-173` has the same shape: `for (const deployment of deployments) { await creditService.getOrCreateWallet(deployment.userId) }`.
- **Why it matters**: with 5 wallets today this is invisible (the whole job runs in milliseconds). At 10,000 funded customers it is ~50,000 queries per scheduled run. The fix is cheap — hoist `getBillingSettings()` out of the loop, and batch the wallet/user/burn-rate reads with `in:` queries the way the rest of the codebase already does.
- **Status**: ✅ **Verified**

#### Fix
Three bulk helpers, and both jobs rewritten to fetch everything up front instead of per customer:
- `deploymentService.getBurnRatesFor(userIds)` — one deployments query returning a `Map` of legacy user id → $/hour, replacing a per-customer `getBurnRate`.
- `userService.findManyByLegacyIds(ids)` — one users query replacing a per-customer `findByLegacyId`.
- `creditService.findWalletsFor(ids)` — one wallets query replacing a per-deployment `getOrCreateWallet` (a customer with several stopped deployments was looked up once for each).

`lowBalanceWarning` also stops re-reading the platform-wide billing settings inside the loop; it already had them.

**Files touched** — `backend/src/jobs/lowBalanceWarning.js`, `backend/src/jobs/debtCollection.js`, `backend/src/services/deployment/deploymentService.js`, `backend/src/services/user/userService.js`, `backend/src/services/billing/creditService.js`

#### Verification (live)
Database calls counted per run by instrumenting the Prisma delegates:
```
lowBalanceWarning: 4 database calls
     1×  adminSettings.findFirst
     1×  creditWallet.findMany
     1×  deployment.findMany
     1×  user.findMany

debtCollection: 6 database calls
     2×  creditWallet.findMany   2×  deployment.findMany
     1×  adminSettings.findFirst 1×  paymentMethod.findMany
```
Both are now a **fixed** number of queries rather than one proportional to the customer count — previously ~5 per funded customer, per run. All four cron jobs still complete cleanly.

---

### BUG-021: Activity-log cleanup loads every matching row into memory purely to count it
- **Area**: Backend (`services/admin/activityLogService.js`)
- **Severity**: Medium
- **Steps to reproduce**: Read `activityLogService.js:114-120`, reachable via the admin "database cleanup" cron action targeting `activityLogs`.
- **Expected behavior**: Delete the old rows and report how many were removed, without materialising them.
- **Actual behavior**:
  ```js
  const rows = await prisma.activityLog.findMany({ where: { createdAt: { lt: cutoff } }, select: { legacyMongoId: true } });
  if (!rows.length) return 0;
  await prisma.activityLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return rows.length;
  ```
  Every row older than the cutoff is fetched into Node just so `rows.length` can be returned — then the same predicate is run again to delete. `deleteMany` already returns `{ count }`, so the first query is pure waste. `activity_logs` is by far the fastest-growing table (1250 rows in this near-empty dev database); on a real deployment a cleanup could pull millions of rows into memory and exhaust the process — a cleanup job that crashes the server is worse than one that never runs.
- **Status**: ✅ **Verified**

#### Fix
`deleteOlderThan` and `deleteByDateRange` now take their count from `deleteMany`'s own `{ count }` result instead of fetching every matching row first just to call `.length` on the array — and then running the same predicate a second time to delete.

**Files touched** — `backend/src/services/admin/activityLogService.js`

#### Verification (live)
```
PASS  deleteOlderThan still reports a count      200 deletedCount=0
PASS  nothing purged with a 10-year cutoff       deletedCount=0 totalDelta=1
```
(The `totalDelta=1` is the DELETE request writing its own activity-log row — the count itself is correctly 0.)

---

### BUG-022: `sortBy` is unvalidated on the users CSV export
- **Area**: Backend (`routes/v1/admin/users.routes.js`)
- **Severity**: Low
- **Steps to reproduce**:
  - `GET /admin/users/export/csv?sortBy=password` → **200** (the query really does order by the bcrypt hash column)
  - `GET /admin/users/export/csv?sortBy=nosuchcolumn` → **500** "Error exporting users"
- **Expected behavior**: An unrecognised sort field falls back to the default, as it already does elsewhere.
- **Actual behavior**: `users.routes.js:122-124` passes the raw query value straight through: `orderBy: { [sortBy]: order === 'desc' ? 'desc' : 'asc' }`. No hash values reach the CSV, so this is not a data leak — but an arbitrary client string is being used as a column name, and an unknown one 500s.
- **Note**: the equivalent customers list gets this right — `userService.js:210-211` whitelists `['createdAt','name','email','status','lastLogin']` and falls back to `createdAt`. Verified live: `/admin/customers?sortBy=password` and `?sortBy=nosuchcolumn` both return 200. The export route just never got the same treatment.
- **Also on this route**: the export is an unbounded `findMany` with no cap, so exporting a very large user table would build the whole CSV in memory. Acceptable for a deliberate export action, but worth a ceiling.
- **Status**: ✅ **Verified**

#### Fix
Added a `SORT_FIELDS` whitelist to `routes/v1/admin/users.routes.js` (`createdAt`, `name`, `email`, `status`, `lastLogin`, `role`, `accountType`) with a `sortField()` helper that falls back to `createdAt` — the same treatment `userService.listCustomersAdmin` already gave the customers list. Applied to both the users list and the CSV export.

The export's unbounded `findMany` also got a ceiling (`EXPORT_MAX_ROWS = 50000`), since the whole CSV is assembled in memory before it is sent.

**Files touched** — `backend/src/routes/v1/admin/users.routes.js`

#### Verification (live)
```
PASS  sortBy is whitelisted on the export    ?sortBy=password=200  ?sortBy=nosuchcolumn=200
```
Both previously misbehaved: `password` really did order by the bcrypt hash column, and `nosuchcolumn` returned a 500.

---

### BUG-023: Badge and avatar text fails contrast in both themes
- **Area**: Admin Center
- **Severity**: Low
- **Steps to reproduce**: Open the Admin Center dashboard or `/analytics` and look at the numeric rank badges, notification-count badges and avatar initials.
- **Expected behavior**: At least 3:1 contrast (WCAG minimum for large/non-text-critical UI); 4.5:1 for body text.
- **Actual behavior**: Measured programmatically across 9 admin pages in dark mode — 26 elements below 3:1. The colours are fixed pastels, so the same failures occur in light mode:
  ```
  1.71:1   white on rgb(245,188,102)  amber rank badges  ("1", "2", "3")
  2.33:1   white on rgb(183,156,240)  avatar initials    ("T", "Q")
  2.56:1   white on rgb(161,161,170)  grey rank badge    ("4")
  2.81:1   white on rgb(244,113,116)  red count badges   ("2", "3")
  ```
- **Note**: the **Customer Center has zero contrast failures in dark mode** across all 7 pages tested, and the Admin Center's dark ground is correctly `rgb(10,10,10)` pure black as specified. This finding is limited to small badge/avatar chips, not page text.
- **Status**: ✅ **Verified**

#### Fix
These chips carry white text but were being filled with the palette's *foreground* colours, which are tuned to sit on a surface rather than behind white — `#F5BC66` amber is 1.71:1 against white.

Added a `solidBg` map to the admin theme holding the darker end of each pair, all of which clear 3:1 with white (amber 3.24, red 4.38, grey 4.83, indigo 4.51, green 3.79). Because the text on these is always white, the fill deliberately does *not* flip with the theme the way a foreground colour does. Applied to the rank badges and avatars on the dashboard and analytics pages, and to the header notification count in `NotificationsDropdown.js` (which set its colour inline, so a theme token could not reach it).

`STATUS_COLORS.error.dark` etc. are unchanged — everywhere else they are foregrounds and the lighter value is correct there.

**Files touched** — `frontend-admin-center/src/theme/colors.js`, `pages/DashboardPage.js`, `pages/AnalyticsPage.js`, `components/common/NotificationsDropdown.js`

#### Verification (live)
Contrast measured on every visible text node across 9 admin and 7 customer pages in dark mode:
```
before:  admin 26 elements below 3:1, customer 0
after:   admin  0 elements below 3:1, customer 0
```

---

### BUG-024: Creating an admin with `role: 'custom'` but no `customRoleId` silently produces a permission-less admin
- **Area**: Backend (`routes/v1/admin/users.routes.js`)
- **Severity**: Medium
- **Steps to reproduce**: `POST /admin/users` with `{ name, email, password, accountType: 'admin', role: 'custom' }` — and no `customRoleId`.
- **Expected behavior**: 400, the same way a *wrong* role id is rejected.
- **Actual behavior**: Verified live —
  ```
  role='custom', no customRoleId        -> 201 "Admin user created successfully"
    they CAN log in                     -> 200
    their permissions                   -> []
    GET /admin/customers                -> 403 "You do not have permission to perform this action"

  role='custom', non-existent id        -> 400 "Custom role not found"   ✔ correctly rejected
  ```
  So the operator gets a success message and a working login for an admin who is blocked from every single page, with nothing anywhere explaining why. The `customRoleId: null` is stored silently.
- **Root cause**: `users.routes.js:428` guards with `if (role === 'custom' && customRoleId)` — the `&& customRoleId` short-circuits the whole validation away precisely when the field is missing. It needs to be "if role is custom, a valid customRoleId is required".
- **Status**: ✅ **Verified**

#### Fix
`if (role === 'custom' && customRoleId)` became a proper two-step check: if the role is `custom`, a `customRoleId` is required, and it must resolve to a real role. The `&& customRoleId` was short-circuiting the entire validation away exactly when the field was missing.

**Files touched** — `backend/src/routes/v1/admin/users.routes.js`

#### Verification (live)
```
PASS  rejected with 400 (was 201 + a broken admin)   400 "Please choose a custom role for this user"
PASS  REGRESSION: a bogus role id still rejected     400
PASS  REGRESSION: a valid custom-role admin created  201
```

---

### BUG-025: `POST /admin/roles` is the only create route that doesn't mint a `legacyMongoId`
- **Area**: Backend (`routes/v1/admin/roles.routes.js`)
- **Severity**: Low
- **Steps to reproduce**: Create a custom role through the admin API, then `SELECT legacy_mongo_id FROM custom_roles WHERE name = '<new role>'`.
- **Expected behavior**: A fresh Mongo-shaped id, as `newMongoId()` provides everywhere else. This project deliberately kept `legacyMongoId` as *the* public-facing `_id` after the Postgres migration, so every row is supposed to have one.
- **Actual behavior**: `NULL`. Verified by creating one row through each admin create route and then counting NULLs:
  ```
  departments    0 NULL of 11
  blog_posts     0 NULL of 7
  seo_redirects  0 NULL of 1
  custom_roles   2 NULL of 9      <- exactly the 2 created through the API
  ```
  The 7 roles that came across in the migration all have one; only API-created roles don't. It is visible in responses too — `customRole.legacyMongoId: null` comes back on the users list.
- **Impact today**: none functionally, because the roles routes address roles by their Postgres `id` (UUID) rather than `_id`. But it silently breaks the invariant the rest of the codebase relies on, and my Phase 2 database sweep — which passed "every row has a non-NULL `legacy_mongo_id`" — would now fail because of this route.
- **Status**: ✅ **Verified**

#### Fix
New `backend/src/services/user/customRoleService.js` with a `create()` that mints a `legacyMongoId` the way every other entity's create path does, and `POST /admin/roles` now goes through it. All three role responses (list, detail, create) expose `_id` alongside the Postgres `id`.

Fixed together with BUG-029 — both stem from CustomRole being the one resource that didn't follow the app's id convention.

**Files touched** — `backend/src/services/user/customRoleService.js` (new), `backend/src/routes/v1/admin/roles.routes.js`

#### Verification (live)
```
PASS  the create response carries an _id
      {"_id":"6aa13fce5d721b1d1630930a","id":"034ebc60-87fc-419a-8256-af86833906d9"}
PASS  addressable by BOTH _id and UUID     200/200
```

---

### BUG-026: The users list/detail dumps raw internal columns on the nested `customRole`
- **Area**: Backend (`routes/v1/admin/users.routes.js`)
- **Severity**: Low
- **Steps to reproduce**: `GET /admin/users` (or `/admin/users/:id`) for a user who has a custom role.
- **Expected behavior**: The same shaping the rest of the API applies — a public `_id`, no raw foreign-key columns.
- **Actual behavior**: The nested role is the raw Prisma row:
  ```json
  "customRole": {
    "id": "8328f81e-…", "legacyMongoId": null, "name": "qa_limited_9920658",
    "description": "…", "permissions": ["customers.view","analytics.view"],
    "isActive": true,
    "createdById": "b8eb6efd-a8d1-4dc0-843c-670e18374c5d",
    "updatedById": null, "createdAt": "…", "updatedAt": "…"
  }
  ```
  `createdById`/`updatedById` are internal Postgres UUIDs that no other endpoint exposes, and `legacyMongoId` is leaked as a field name rather than mapped to `_id`. No secret is disclosed — the route does correctly strip password hashes — but it is inconsistent with the codebase's own convention and exposes internal identifiers.
- **Root cause**: `users.routes.js:119-124` does `include: { customRole: true, assignedBy: true }` and returns the relation unshaped, where sibling routes run relations through `withUserIdAlias(...)` / `sanitizeUserRef(...)`.
- **Status**: ✅ **Verified**

#### Fix
The nested `customRole` relation is now shaped before it leaves the API, in both places it is returned — `withIdAlias` in `users.routes.js` and `formatUserResponse` in `userFormatter.js`. Only `_id`, `id`, `name`, `description`, `permissions`, `isActive` (and timestamps on the detail path) go out; the internal `createdById`/`updatedById` UUIDs and the raw `legacyMongoId` field name do not.

**Files touched** — `backend/src/routes/v1/admin/users.routes.js`, `backend/src/utils/helpers/userFormatter.js`

#### Verification (live)
```
PASS  nested customRole exposes no internal columns
      ["_id","id","name","description","permissions","isActive"]
```

---

### BUG-027: Revenue analytics access is hardcoded to role names, bypassing the permission system
- **Area**: Backend (`routes/v1/admin/analytics.routes.js`)
- **Severity**: Low (design/architecture, not a defect in behaviour)
- **Steps to reproduce**: Give a custom role `analytics.view`, assign it to an admin, then call `GET /admin/analytics/revenue-stats`.
- **Expected behavior**: On a platform where the operator configures everything from the Admin Center, revenue visibility should be its own permission (e.g. `analytics.revenue`) that can be granted to a custom role.
- **Actual behavior**: 403 "Revenue data is restricted", no matter what permissions the role holds. `analytics.routes.js:204-207` and `:297-300` both do:
  ```js
  const userRole = req.user?.role;
  if (userRole !== 'admin' && userRole !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'Revenue data is restricted' });
  }
  ```
  A custom role can therefore *never* see revenue, and the operator has no way to change that from the Admin Center — the policy lives in two route handlers.
- **Note**: this is the only place in the 160 permission-gated endpoints where a second, hardcoded rule sits on top of the permission check. Flagging it as a design inconsistency rather than a defect — the current behaviour may well be intended, but it is not configurable, which is at odds with how the rest of the platform works. Worth a decision rather than a unilateral change.
- **Status**: ✅ **Verified**

#### Fix
Revenue is now a real, grantable permission — `analytics.revenue` — instead of two hardcoded role-name checks.

- `services/user/customRolePermissions.js` — added `analytics.revenue` to the vocabulary a role can be built from, so it appears in Admin Center → Roles.
- `routes/v1/admin/analytics.routes.js` — both revenue routes are guarded by `checkPermission('analytics.revenue')` and the two inline `role !== 'admin' && role !== 'super_admin'` blocks are gone. The overview endpoint, which carries revenue inline rather than on its own route, now includes that block based on `req.user.hasPermission('analytics.revenue')`.
- `services/user/userHelpers.js` — the built-in roles carry the new permission exactly as the old check decided: **admin yes, moderator and viewer no**, and `super_admin` gets it via its `*` wildcard. So no existing account's access changes.
- `frontend-admin-center/src/pages/DashboardPage.js` / `AnalyticsPage.js` — `canSeeRevenue` now comes from `usePermission()` rather than reading a role name out of `localStorage`.

#### Verification (live)
```
PASS  analytics.revenue is offered when building a role
PASS  without the permission: general analytics still work      200
PASS  without the permission: revenue endpoints refused         403/403
PASS  without the permission: overview omits the revenue block
PASS  WITH the permission: a custom role CAN see revenue        200/200
PASS  WITH the permission: overview includes revenue            {"monthly":0,"topUpsInPeriod":0,"usageChargesInPeriod":192.16,…}
PASS  REGRESSION: super admin still sees revenue                200
```
The fifth line is the point: before this change a custom role could never see revenue no matter what the operator granted it.

---

### BUG-028: `POST /admin/recommendation-policy` without `key` leaks a raw Prisma error instead of validating
- **Area**: Backend (`services/admin/recommendationPolicyService.js`)
- **Severity**: Medium
- **Steps to reproduce**: `POST /admin/recommendation-policy` with `{ "name": "My Policy", "description": "…" }` — no `key`.
- **Expected behavior**: 400 "A policy key is required".
- **Actual behavior**: 400, but the body is the raw Prisma exception with the absolute server path and a source excerpt:
  ```
  Invalid `prisma.recommendationPolicy.findUnique()` invocation in
  E:\Startup\Claude_AI\AI-Ocean\backend\src\services\admin\recommendationPolicyService.js:85:54
    82   key, name, description, isActive, cacheTtlSeconds, updatedBy,
    83 } = fields;
  → 85 const existing = await prisma.recommendationPolicy.findUnique({ where: { key: undefined } …
  ```
  The whole `where` clause with every available field is dumped to the client.
- **Root cause**: `recommendationPolicyService.js:85` calls `findUnique({ where: { key } })` without first checking `key` is present; Prisma rejects `undefined` in a unique lookup. An instance of BUG-006's error-leak pattern, but with a distinct fix — validate the required field up front.
- **Confirmed**: supplying a `key` makes the full create → update → delete lifecycle work correctly (201 / 200 / 200).
- **Status**: ✅ **Verified**

#### Fix
`recommendationPolicyService.create` now checks `key` is a non-empty string **before** the `findUnique({ where: { key } })` that Prisma rejects when it's `undefined`.

**Files touched** — `backend/src/services/admin/recommendationPolicyService.js`

#### Verification (live)
```
PASS  policy without key: no leak              400
PASS  gives a real validation message          "A policy key is required"
```
Creating a policy *with* a key still works end to end (create → update → delete, 201/200/200).

---

### BUG-029: `GET /admin/roles/:id` returns HTTP 500 for any id that isn't a UUID
- **Area**: Backend (`routes/v1/admin/roles.routes.js`)
- **Severity**: Medium
- **Steps to reproduce**: `GET /admin/roles/abc`, or `GET /admin/roles/ffffffffffffffffffffffff`.
- **Expected behavior**: 404 "Role not found", the way every other resource behaves.
- **Actual behavior**: Verified live —
  ```
  /admin/roles/00000000-0000-0000-0000-000000000000   404 "Role not found"      ✔
  /admin/roles/ffffffffffffffffffffffff               500 "Error fetching role" ✘
  /admin/roles/abc                                    500 "Error fetching role" ✘
  /admin/roles/<real UUID>                            200                        ✔

  for contrast — departments, which use the Mongo-shaped id:
  /admin/departments/00000000-0000-0000-0000-000000000000  404 ✔
  /admin/departments/ffffffffffffffffffffffff              404 ✔
  /admin/departments/abc                                   404 ✔
  ```
  Postgres rejects a malformed UUID, Prisma throws, and the route's catch turns it into a 500. Every malformed-id shape I tried (plain word, path traversal, SQL-ish, 400 chars, "null", whitespace) produced a 500.
- **Underlying cause**: `CustomRole` is the **only** resource addressed by its raw Postgres UUID rather than the app-wide Mongo-shaped `_id`. That divergence is also why BUG-025 happens (no `legacyMongoId` is minted for roles). Fixing both together — give roles a `legacyMongoId` like every other entity, or at minimum validate the UUID format before querying — is likely one change, not two.
- **Status**: ✅ **Verified**

#### Fix
`customRoleService.findByIdentifier()` accepts either a Postgres UUID or the app's Mongo-shaped `_id`, and returns `null` for anything it can't resolve — so a malformed id produces a clean 404 instead of Postgres rejecting the value and the route turning that into a 500. All three role lookups (`GET /:id`, `PUT /:id`, `DELETE /:id`) and the custom-role check in `users.routes.js` go through it.

**Files touched** — `backend/src/services/user/customRoleService.js` (new), `backend/src/routes/v1/admin/roles.routes.js`, `backend/src/routes/v1/admin/users.routes.js`

#### Verification (live)
```
PASS  24-hex (Mongo shape) → 404      (was 500)
PASS  plain word → 404                (was 500)
PASS  path traversal → 404            (was 500)
PASS  very long → 404                 (was 500)
PASS  valid UUID, absent → 404
```

---

### BUG-030: Three endpoints return 200 for ids that don't exist
- **Area**: Backend
- **Severity**: Low
- **Steps to reproduce**: Call any of these with a nonsense id:
  - `GET /admin/customers/<anything>/notes`
  - `GET /admin/logs/user/<anything>`
  - `GET /admin/users/<absent id>/login-history`
- **Expected behavior**: 404 when the parent record does not exist.
- **Actual behavior**: 200 with an empty list — for every id shape tested, including `..%2f..%2fetc%2fpasswd`, `1' OR '1'='1`, a 400-character string and the literal `null`. The endpoints query child rows by the id without ever checking the parent exists.
- **Impact**: no data leak and no crash — the response is simply empty. But an API client cannot distinguish "this customer has no notes" from "this customer does not exist", and a UI built on it will render an empty panel for a deleted customer rather than a not-found state.
- **Note**: the other 25 parameterised endpoints handle this correctly. Overall 201 of 224 bad-id requests were handled cleanly.
- **Status**: ✅ **Verified**

#### Fix
The three endpoints now look their parent record up and return 404 when it doesn't exist, rather than querying child rows by an id nothing owns and returning an empty list with 200.

**Files touched** — `backend/src/routes/v1/admin/customers.routes.js` (`:id/notes`), `backend/src/routes/v1/admin/logs.routes.js` (`user/:userId`), `backend/src/routes/v1/admin/users.routes.js` (`:id/login-history`)

#### Verification (live)
```
PASS  customers/:id/notes → 404
PASS  customers/:id/notes with a path-traversal id → 404
PASS  logs/user/:userId → 404
PASS  users/:id/login-history → 404
PASS  REGRESSION: real ids still return 200     200/200/200
```

---

### BUG-031: `GET /admin/users/:id/activity/export` returns 500 for an absent id
- **Area**: Backend (`routes/v1/admin/users.routes.js`)
- **Severity**: Low
- **Steps to reproduce**: `GET /admin/users/ffffffffffffffffffffffff/activity/export`.
- **Expected behavior**: 404 — which is exactly what the equivalent customers route does.
- **Actual behavior**: `500 {"success":false,"message":"Error exporting activity logs"}`. `GET /admin/customers/ffffffffffffffffffffffff/activity/export` correctly returns 404 for the same input, so the two sibling routes disagree.
- **Status**: ✅ **Verified**

#### Fix
`GET /admin/users/:id/activity/export` now looks the user up and returns 404 before querying their logs — the same order its customers-side sibling already used. Previously an absent id fell through to the log query and surfaced as a 500.

**Files touched** — `backend/src/routes/v1/admin/users.routes.js`

#### Verification (live)
```
PASS  absent id → 404 (was 500)        404 "User not found"
PASS  REGRESSION: a real id still exports   200
```

---

### BUG-032: When the API fails, dashboards display confident zeros instead of an error
- **Area**: Admin Center + Customer Center
- **Severity**: High
- **Steps to reproduce**: Log in, then make every `/api/v1/*` call fail (stop the backend, or intercept and return 500) and load `/` in the Admin Center or `/dashboard` in the Customer Center.
- **Expected behavior**: The page says it could not load the data — the way `/customers`, `/deployments`, `/wallets`, `/logs`, `/settings`, `/models` and `/billing` all correctly do.
- **Actual behavior**: The dashboards render as though the platform is genuinely empty. Captured side by side against the same page with a healthy API:

  | | API healthy | API returning 500 |
  |---|---|---|
  | Admin `TOTAL USERS` | **19** | **0** |
  | Admin `ACTIVE CUSTOMERS` | **10** | **0** |
  | Admin charts | real data | "No data available" |
  | Admin `Top Customers` | Test Deployer, 120.6 hrs, $81.35 | "No customer data" |
  | Customer `CREDIT BALANCE` | real balance | **0.00 USD** |
  | Customer `RUNNING DEPLOYMENTS` | real count | **0** · "No deployments yet" |

  Nothing on the page indicates a failure — no toast, no banner, no retry. During an outage an operator sees "0 customers, $0 revenue" and a customer sees "your credit balance is 0.00 and you have no deployments". Both are false, both invite action (a customer may top up again; an operator may think the platform has lost its data).
- **Affected pages**: Admin `/` and `/analytics`; Customer `/dashboard` and `/limits`. Verified under both HTTP 500 and a dead network — identical behaviour.
- **Root cause**: these pages initialise their state to zeros/empty arrays and their `.catch()` leaves that initial state in place without setting an error flag. The pages that behave correctly set an error state and render it.
- **Also seen while testing this**: with the API down, the Customer Center header falls back to the hardcoded string **"AppCenter"** instead of the configured brand "AI-Ocean" — related to BUG-003 (brand copy not sourced from Admin Settings).
- **Note**: no page white-screened, no page hung on a spinner and no JavaScript crashed under either failure mode — the failure handling is present, it just draws the wrong conclusion on these four pages.
- **Status**: ✅ **Verified**

#### Fix
The four affected pages all load their panels with `Promise.allSettled` (or individual `.catch(() => {})`), which **never rejects** — so the `catch` blocks that were supposed to report a failure were dead code, and every panel silently kept its initial zero/empty state. Rejections are now counted explicitly and surfaced as an error banner with a Retry action, while partial successes still render what did load.

The wording distinguishes the two cases: if the headline figures failed, "the figures below are not current"; if only a secondary panel failed, "what is shown may be incomplete".

**Files touched**
- `frontend-admin-center/src/pages/DashboardPage.js`
- `frontend-admin-center/src/pages/AnalyticsPage.js`
- `frontend-customer-center/src/pages/DashboardPage.js`
- `frontend-customer-center/src/pages/UsageLimitsPage.js`

(Both admin pages also dropped their now-unused `message` import in favour of the inline `Alert`, so a failure is visible on the page rather than in a toast that disappears.)

#### Verification (live)
```
── admin, API healthy (regression check)
PASS  admin-dashboard-healthy: healthy API shows NO error banner
PASS  admin-analytics-healthy: healthy API shows NO error banner
── admin, API returning 500
PASS  admin-dashboard-broken: failed API shows an honest error
PASS  admin-analytics-broken: failed API shows an honest error
── customer, API healthy (regression check)
PASS  customer-dashboard-healthy: healthy API shows NO error banner
PASS  customer-limits-healthy: healthy API shows NO error banner
── customer, API returning 500
PASS  customer-dashboard-broken: failed API shows an honest error
PASS  customer-limits-broken: failed API shows an honest error
```
Screenshot confirmed: the admin dashboard now leads with a red *"Could not load dashboard data. The figures below are not current."* banner and a Retry button, above the zeros — so an operator can no longer read an outage as data.

---

### BUG-033: No admin account can ever be deleted
- **Area**: Backend (`routes/v1/admin/users.routes.js`)
- **Severity**: High
- **Steps to reproduce**:
  1. `POST /admin/users` to create any admin account.
  2. Immediately `DELETE /admin/users/:id`.
- **Expected behavior**: The account is removed, the way `DELETE /admin/customers/:id` removes a customer.
- **Actual behavior**: `500 {"success":false,"message":"Error deleting user"}` — **always**, from the moment the account exists. Verified with a clean experiment:
  ```
  A) admin created, never logged in   -> DELETE 500 "Error deleting user"
  B) admin created, then logged in    -> DELETE 500 "Error deleting user"
  ```
  Reproduced at the database level, the underlying error is:
  ```
  Foreign key constraint violated on the constraint: `notifications_recipient_id_fkey`
  ```
  Creating an admin immediately sends them a welcome notification, so **every admin is undeletable from the moment of creation**. Once they log in, activity-log rows (`ActivityLog.userId` is `onDelete: Restrict`) block it a second way. There is no route through the API to remove a staff account — the exact thing needed when someone leaves the company.
- **Root cause**: the customer-delete endpoint runs a full 7-step cascade before removing the row (`customers.routes.js`):
  ```js
  await deploymentService.deleteAllForUsers([customer._id]);
  await creditService.deleteAllForUsers([customer._id]);
  await paymentMethodService.deleteAllForUsers([customer._id]);
  await paymentService.deleteAllForUsers([customer._id]);
  await activityLogService.deleteAllForUsers([customer._id]);
  await customerNoteService.deleteAllForUsers([customer._id]);
  await notificationService.deleteAllForUsers([customer._id]);
  await userService.deleteUser(customer);
  ```
  The admin-user endpoint (`users.routes.js:638`) calls `userService.deleteUser(user)` with **no cascade at all**. `POST /admin/users/bulk-delete` has the same gap — `toDelete.map(u => userService.deleteUser(u))`.
- **History**: the cascade was added to the customer path during the MongoDB→PostgreSQL migration (when `ActivityLog`/`CreditTransaction` gained real `Restrict` foreign keys). The admin-user path was never given the same treatment.
- **Note**: the 500's message is also opaque — an operator gets "Error deleting user" with no indication of why (see BUG-006).
- **Status**: ✅ **Verified**

#### Fix
Two parts, because the cascade alone was not enough.

**1. Schema — two foreign keys were blocking deletion that shouldn't have been.** Of the 11 `Restrict` foreign keys into `users`, the existing customer cascade covered 9. The other two only ever bite *staff* accounts, which is why they had never surfaced:
- `custom_roles.created_by_id` — an admin who created a role
- `customer_notes.author_id` — an admin who wrote a note on a customer

Both were `NOT NULL` with no `onDelete`, i.e. `RESTRICT`. Every other authorship column in the schema (~30 of them, including `custom_roles.updated_by_id` on the very same table) is already nullable + `SetNull`, so these two were inconsistent rather than deliberate. Made them match, via a proper migration — `prisma/migrations/20260908100344_allow_deleting_admins_who_authored_roles_and_notes/`:
```sql
ALTER TABLE "custom_roles"   ALTER COLUMN "created_by_id" DROP NOT NULL;
ALTER TABLE "customer_notes" ALTER COLUMN "author_id"     DROP NOT NULL;
-- both FKs re-added with ON DELETE SET NULL
```
Both consumers were already null-safe (`customerNoteService.js:30` reads `row.author?.legacyMongoId || null`; `roles.routes.js` wraps in `withUserIdAlias`, which passes null through), and `customer_notes.author_name` is denormalised, so a note stays fully readable after its author is gone.

**2. Code — one shared cascade instead of four copies.** The 8-step sequence was already duplicated between the customer single-delete and bulk-delete routes; adding it to the two admin-user routes would have made four copies of a sequence whose ordering matters. Extracted it to a new `backend/src/services/user/userDeletionService.js` (`deleteUsersCompletely(users)`) and pointed all four call sites at it — so the customer and admin paths cannot drift apart again.

**Files touched**
- `backend/prisma/schema.prisma` — `CustomRole.createdById` and `CustomerNote.authorId` → nullable + `onDelete: SetNull`
- `backend/prisma/migrations/20260908100344_allow_deleting_admins_who_authored_roles_and_notes/migration.sql` — new
- `backend/src/services/user/userDeletionService.js` — new
- `backend/src/routes/v1/admin/users.routes.js` — import added; `:id` delete and `bulk-delete` now use the shared cascade (was `userService.deleteUser` with no cascade)
- `backend/src/routes/v1/admin/customers.routes.js` — import added; single and bulk delete now use the shared cascade (removes 17 lines of duplication)

#### Verification (live)
```
PASS  fresh admin (has a welcome notification) can be deleted    200 User deleted successfully
PASS  admin with login history, a role and a note can be deleted 200 User deleted successfully
PASS  the role they created still exists                         createdBy=null
PASS  the note they wrote still exists and is readable           authorName="QA Fix B" authorId=null
PASS  REGRESSION: customer with a wallet + ledger still deletes   200 Customer deleted successfully
PASS  REGRESSION: bulk-delete of two admins                       200 2 user(s) deleted successfully
PASS  guard: cannot delete your own account                       400 You cannot delete your own account
PASS  super admin can still log in                                200
```

---

### BUG-034: The `pagination` block sent to the client is built from the raw query, so a malformed `?page=` returns correct rows next to `{"page":null,"limit":-1,"pages":-7}`

- **Area:** Backend (Admin + Customer + Public)
- **Severity:** Medium
- **Found:** 2026-09-09, while grounding the §8.2 "copy-paste" concern with a live probe rather than an estimate. Not found by the Phase 3 sweep because that sweep counted HTTP 500s, and this returns 200.

#### Steps to reproduce
1. `GET /api/v1/customer/wallet/transactions?page=0&limit=abc` as a logged-in customer.
2. `GET /api/v1/customer/deployments?page=abc&limit=-1`.

#### Expected
The response's `pagination` block describes the page that was actually returned.

#### Actual
The rows were correct — the *query* goes through `paginate()`, which BUG-010 fixed — but the block echoed back to the client was assembled separately from the caller's raw input:

```
200  /customer/wallet/transactions?page=0&limit=abc   {"page":0,"limit":null,"total":69,"pages":null}
200  /customer/deployments?page=abc&limit=-1          {"page":null,"limit":-1,"total":7,"pages":-7}
```

The frontend pager reads this block, so it renders a broken control (`null` of `null`, or a negative page count) over data that is itself correct.

#### Root cause
BUG-010's fix clamped every list endpoint's *query*. Six response sites build their `pagination` object independently:

- three controllers re-parsed the raw query — `pagination: { page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }` — and `parseInt('abc')` is `NaN`, which `JSON.stringify` renders as `null`;
- three routes had `paginate()`'s clamped values in scope and used `safePage` for `page` but still divided by the **raw** `limit` for `pages`.

This is the §8.2 concern exactly: the fix was applied at 66 call sites, and the sites it didn't reach silently kept the old behaviour. The response shape was never the thing being clamped.

#### Fix
Added `meta(query, total, opts)` to `utils/helpers/pagination.js`. It calls the same `paginate()` and derives the whole block from that one result, so the numbers reported can no longer disagree with the numbers queried. All six sites now return `meta({ page, limit }, total)` — the three route files' now-unused `safePage`/`safeLimit` lines were removed with it.

**Files touched**
- `backend/src/utils/helpers/pagination.js` — new `meta()` export
- `backend/src/controllers/customer/walletController.js`
- `backend/src/controllers/customer/billingController.js`
- `backend/src/controllers/customer/deploymentController.js`
- `backend/src/routes/v1/public/blog.routes.js`
- `backend/src/routes/v1/admin/blog.routes.js`
- `backend/src/routes/v1/admin/seo.routes.js`

#### Verification (live)
```
ok  200 /customer/wallet/transactions?page=0&limit=abc    {"page":1,"limit":20,"total":70,"pages":4}
ok  200 /customer/wallet/transactions?page=2&limit=5      {"page":2,"limit":5,"total":70,"pages":14}
ok  200 /customer/billing/payments?page=-5&limit=99999    {"page":1,"limit":200,"total":0,"pages":0}
ok  200 /customer/deployments?page=abc&limit=-1           {"page":1,"limit":1,"total":7,"pages":7}
ok  200 /customer/deployments?page=1&limit=3              {"page":1,"limit":3,"total":7,"pages":3}
ok  200 /admin/blog/posts?page=0&limit=abc                {"page":1,"limit":20,"total":6,"pages":1}
ok  200 /admin/seo/redirects?page=-2&limit=0              {"page":1,"limit":1,"total":0,"pages":0}
ok  200 /public/blog/posts?page=abc&limit=-1              {"page":1,"limit":1,"total":0,"pages":0}

PASS  8/8 pagination blocks sane
```
`limit` is clamped to the 1..200 band, `page` never below 1, `pages` never negative or `null`, and a valid request is unchanged (`page=2&limit=5` → page 2 of 14). The `total: 0` on the public blog is pre-existing and correct — all 6 posts are `draft` (see the first entry under "NOT bugs").

---

## Checked and found NOT to be bugs

Recording these so they don't get re-investigated later.

- **Marketing `/blog` shows no posts** — correct. All 6 seeded `BlogPost` rows are `status = 'draft'`; the public endpoint filters to published. (The seed data does set `publishedAt` on drafts, which is odd, but nothing reads it while unpublished.)
- **Checkout refuses to deploy without a card** — correct. `AdminSettings.billingSettings.cardGate.requireVerifiedCard` is `true` in this environment, so "A verified card is required before you can deploy" is the configured behaviour, not a failure.
- **Deploy journey skips `fine_tuning_detail`** — *not* a bug in the conditional logic. Traced to BUG-004's double-advance in my own test driver. Verified separately: answering **Yes** to "Do you need to train it on your own data?" does correctly reveal "Tell us about the training data".
- **Step counter total changes mid-journey (15 → 16)** — correct by design. `steps` is filtered to currently-visible steps, so answering `fine_tuning = Yes` genuinely adds a step. Numerator and denominator are computed on the same basis (`DeployJourney.js:634`, `162-164`).
- **New customer signs up already email-verified** — correct for this environment's admin settings; `isEmailVerified` is set at signup because verification is not currently required.
- **Admin customer-detail Activity / Login History looked empty** — they are not. My first probe read the wrong JSON keys; the endpoints return `activityLogs` / `loginHistory` and both are correctly populated (10 rows for the test customer, matching Postgres exactly).
- **`wallet.cardGate.verified` is `true` for a customer with no card** — deliberate. `creditService.js:416-418` short-circuits `verified` to `true` when the gate is not required, and every consumer (`OverviewTab.js:174`, `DashboardPage.js:104`, admin `CustomerDetailPage.js:646`) guards on `cardGate.required` first, so the misleading value is never rendered.
- **Deployment POST returning 409 `TIER_UNAVAILABLE`** — correct. The tier had 2 units and my two test deployments consumed both; the capacity guard is working.
- **`?sortBy=password` / `?sortBy=__proto__` on the customers list** — safe. `userService.js:210-211` whitelists sort fields (`createdAt`, `name`, `email`, `status`, `lastLogin`) and silently falls back to `createdAt`, so an arbitrary column can never be used to order or infer data.
- **SQL injection, XSS strings, unicode/emoji, 100KB strings, `__proto__`** — all handled correctly. Stored and returned as literal text through signup, department create and blog-post create, with no error, no injection and no prototype pollution. (Prisma parameterises everything, including the two hand-written `$queryRaw` sites.)
- **Customer top-up input validation** — correct and thorough. `0`, `-50`, `"abc"`, missing, below-min, above-max and `1e308` all return clean 400s with useful messages. (Cited as the counter-example in BUG-008.)

## Security checks that PASSED (verified live, worth recording)

- **IDOR** — customer B was refused on every one of customer A's deployment endpoints (`GET /:id`, `/usage`, `/api-key`, `POST /pause`, `/terminate`, `/billing-method`): all 404, no data leaked.
- **Privilege escalation** — a customer token got 403 on `/admin/customers`, `/admin/users`, `/admin/settings`, `/admin/analytics/overview`, `/admin/wallets`, `/admin/logs`, and on `POST /admin/wallets/<self>/adjust` (i.e. a customer cannot credit their own wallet).
- **Token handling** — missing token, garbage token, and a well-formed JWT signed with the wrong secret all return 401 on both the customer and admin APIs.
- **Card gate is enforced server-side, not just in the UI** — with `requireVerifiedCard = true`, a direct `POST /customer/deployments` (bypassing the UI entirely) is refused with `402 CARD_REQUIRED`.
- **Money math is exact** — a 3.004h billing tick at $8.5206/hr charged $25.60; wallet went 510.00 → 484.40, and the ledger sum equalled the wallet balance to the cent.
- **Credit-exhaustion auto-suspend is correct** — with $5.00 left against a 10-hour unbilled period at $8.5206/hr, the job billed exactly $5.00 (0.5868h), moved the watermark to the exhaustion instant, paused the deployment, set `autoSuspendedForCredit`, deactivated the endpoint with a reason, notified the customer twice (paused + PAYG offer) and notified 4 admins. Nothing was overdrawn and nothing threw.
- **Wallet reconciliation detects tampering** — after a deliberate direct-to-DB balance write, `GET /admin/wallets/:id` correctly reported `matches: false` with the true ledger total.
- **Invalid deployment transitions are refused** — `pause` / `resume` / `stop` on a terminated deployment all return 400 with a clear message; status history recorded all 8 transitions in order.
- **Customer-delete cascade** — deleting 6 test customers through the real `DELETE /admin/customers/:id` endpoint returned 200 for every one, including accounts holding a wallet, signup-credit ledger rows, activity logs and notifications. No foreign-key violations.
- **Database integrity** — a full sweep found **zero orphaned rows** across all 14 parent/child relationships (tier components, model supported-tiers and use-cases, deployment status-history / usage / requirements, credit transactions → users and wallets, wallets → users, deployments → users, activity logs, notifications, marketing page blocks, journey steps). Every row in every table has a non-NULL `legacy_mongo_id` (the public `_id`). Singleton invariants hold: exactly 1 `admin_settings` row, 1 active `recommendation_policy`, 1 homepage. No money column is stored as a float — every price/amount/balance/rate/cost column is `numeric`.
- **Admin Center console health** — all 31 admin pages loaded with zero console errors, zero failed network requests and zero duplicate DOM ids (only the known pre-existing antd deprecation warnings).
- **Marketing Site responsiveness** — all 7 pages clean at 1440 / 768 / 375px, no horizontal overflow anywhere.

### Phase 3 sweeps that passed

- **Full auth matrix** — all **50 admin endpoints** hit three ways (no token / customer token / admin token) behaved correctly: 401, 403, 2xx. All **13 public endpoints** reachable anonymously. Only the 2 notification endpoints deviate (BUG-009).
- **Public endpoints leak nothing** — `/public/catalog/models`, `/public/marketing/site` and `/public/blog/posts` contain no `password`, `apiKey`, `secretKey`, `stripeSecret`, `smtpPass` or encrypted field.
- **No secrets in the built frontend bundles** — scanned 125 built files across all three apps for the real `JWT_SECRET`, `SUPER_ADMIN_PASSWORD`, `DATABASE_URL`, `postgresql://`, `sk_live`, `sk_test`. The only hits were false positives: a role-name constant `SUPER_ADMIN: "super_admin"` and the literal helper text *"Starts with sk_test_ or sk_live_"* in the Stripe settings form.
- **Feature flags are genuinely enforced** — all 7 (`enableLogin`, `enableCustomerSignup`, `enableModelCatalog`, `enableDeployments`, `enableCustomRoles`, `enableActivityLogs`, `enablePlayground`) were toggled off one at a time and each correctly produced a 403 with `featureDisabled`, then restored cleanly. `checkFeatureEnabled` is applied at 23 route sites via the `middleware/security` barrel.
- **Maintenance mode is enforced correctly at the API** — with it on, public and customer endpoints return 503 while admin endpoints and `/api/health` stay reachable; the Customer Center renders the operator's own message. (The Marketing Site does not — BUG-018 — and it logs customers out — BUG-019.)
- **All 4 cron jobs run clean** — `hourlyBilling`, `lowBalanceWarning`, `debtCollection`, `notificationCleanup` all completed with no errors.
- **Dark mode** — Customer Center: **zero** low-contrast elements across 7 pages. Admin Center's dark ground is `rgb(10,10,10)` (pure black, as specified) and the Customer Center's is `rgb(14,17,32)`; only small badges fail (BUG-023).
- **No dead links** — every internal link on the Marketing Site resolves (10/10); external targets are `mailto:` and social URLs, all admin-configurable via `socialLinks` rather than hardcoded. The two app frontends navigate programmatically rather than via `<a href>`, and all 31 admin + 11 customer routes were already confirmed loading in the page sweeps.
- **Post-migration residue in the running app: none** — `mongoose` is absent from `package.json` and `node_modules`, `src/models/**` is gone, there are no `*Mirror.js` files, and no file in the live request path requires either. (All 19 remaining `require('mongoose')` calls are in `src/scripts/` — see BUG-017.)
- **Performance** — best-of-3 latency across 24 endpoints: slowest is `GET /admin/logs?limit=500` at 80ms; everything else is ≤32ms. Index coverage is thorough, including composite indexes on the hot paths (`activity_logs` has `user_id_created_at`, `action_created_at`, `action_type_created_at`, `status_created_at`; `credit_transactions` has `user_id_created_at`, `wallet_id`).

### Phase 4 checks that passed

- **Write-endpoint auth** — all **128 write endpoints** (POST/PUT/PATCH/DELETE, excluding the 12 deliberately public auth/webhook routes) correctly reject an unauthenticated caller with 401 and a customer token with 403. Phase 3 had only covered GETs, so this closes the other half of the surface.
- **RBAC** — an admin holding exactly `['customers.view', 'analytics.view']` was tested against all 63 gated GET endpoints: **61/63 correct, zero wrongly allowed**. (The 2 exceptions are BUG-027's deliberate revenue restriction.) All 7 privilege-escalation attempts were blocked: granting itself `['*']`, creating a super-admin, self-promotion, changing platform settings, crediting a wallet, deleting a customer, reading activity logs.
- **CRUD lifecycles** — create → list → read → update → verify-persisted → delete → verify-gone passed for all 9 admin resources: departments, blog posts, marketing pages, SEO redirects, question templates, recommendation policies, cron jobs, custom roles, resource-component categories.
- **`:id` handling** — **201 of 224** bad-id requests across 28 parameterised endpoints were handled cleanly (4xx, no leak), against 8 hostile id shapes including path traversal, SQL-ish strings and 400-character values. The exceptions are BUG-029, BUG-030 and BUG-031.
- **No dead buttons** — every non-destructive button on 7 customer pages and 10 admin pages produced an observable effect (navigation, modal, network call, DOM change or toast). The one initial flag (`/jobs` "ON OFF") was a false positive: verified separately that the antd Switch really does toggle the job, persist, and restore.
- **Failure handling doesn't crash anything** — under both HTTP 500 and a dead network, no page white-screened, hung on a spinner, or threw an unhandled JavaScript error. 11 of 15 pages showed a proper error state (BUG-032 covers the 4 that don't).
- **Data on screen matches the database** — admin dashboard verified field by field against Postgres: `TOTAL USERS 19` = 19, `ACTIVE CUSTOMERS 10` = 10, top customer `120.6 GPU hrs` = 120.6449, `$81.35` = 81.35.
- **Cron jobs are addressed by `key`, not id** — the CRUD run initially looked like a failure here; it is by design (built-in jobs have no database row), and create/list/update/delete all work when addressed by `key`.

---

### BUG-035: 95% of a customer's bill shows as "Other usage — not linked to a deployment"

- **Area:** Backend (data)
- **Severity:** High
- **Found:** 2026-09-10, from a screenshot of a real account's billing page.

#### Steps to reproduce
1. Sign in as `deployer@aiocean-test.com` and open **Billing → Overview**.
2. Read "Spend by deployment".

#### Expected
Every charge attributed to the deployment that caused it.

#### Actual
`USD 13.42` of a `USD 14.14` month — 95% — sat under **"Other usage · Not linked to a
deployment"**, and "Other usage" appeared **twice** as two separate rows. A third row
showed `llama-3-3-70b-1` at `USD 0.70`. All three were in fact the same two deployments.

#### Root cause
`CreditTransaction.referenceId` is a polymorphic string with no foreign key. When every
table's public id changed from a 24-hex string to its UUID primary key, nothing forced those
strings to be updated — so ledger rows written before the change still pointed at the old id,
and rows written after pointed at the new one. `OverviewTab.js` resolves that reference with
`deployments.find((d) => String(d.id) === id)`, which only ever matches the new shape.

The same deployment therefore appeared twice: once named (rows written after the migration)
and once as "Other usage" (rows written before).

**This was introduced by the id migration itself.** Its notes recorded that
`activity_logs.target_id` and `credit_transactions.reference_id` hold historical ids and that
"nothing in the codebase resolves them back to a row" — that check looked at the backend and
found no lookups, and dismissed the single frontend use as an opaque grouping key. It is not
opaque: it is joined to the deployment list to get a name.

#### Fix
A data migration rewriting the historical references, with the old→new mapping recovered from
the pre-drop backup (the column it came from no longer exists, so the mapping is baked into
the migration as literal values and the file is self-contained).

**Files touched**
- `backend/prisma/migrations/20260910095320_repair_pre_uuid_references/migration.sql`

#### Verification (live)
```
credit_transactions holding a pre-migration reference:  80 → 4
activity_logs      holding a pre-migration reference: 396 → 254

Spend by deployment, same account, after:
   llama-3-3-70b-1   USD 17.81   100%
   mistral-prod      USD  0.02     0%
   Total             USD 17.83            ← no "Other usage" at all
```
The 4 ledger rows that remain reference `__billing-verify__`, a throwaway deployment deleted
long ago and absent from the backup too. They correctly stay unattributed — the deployment
genuinely no longer exists.

---

### BUG-036: The spend table invents hours and a rate — "7.5h at USD 2.39/hr" for a machine that ran zero hours

- **Area:** Customer Center
- **Severity:** High

#### Steps to reproduce
1. Have a deployment that is **stopped** (so it accrues storage, not compute).
2. Open **Billing → Overview** and read its row in "Spend by deployment".

#### Expected
The hours and rate the customer was actually charged at.

#### Actual
| | Truth | What the page said |
|---|---|---|
| Ran | **0.03 h**, USD 0.02 | "7.5 HOURS" |
| Storage while stopped | **72.28 h**, USD 17.81 | not mentioned at all |
| Rate applied | USD 0.246/hr (storage) | "USD 2.39/hr" |

Only the total was right.

#### Root cause
`OverviewTab.js` derived hours as `cost / deployment.effectiveRate` — cost divided by the
**running** rate. That is only correct if every charge was compute. A stopped deployment
still pays for the disk it holds, at a much lower rate, so dividing storage cost by the
compute rate produces a number that means nothing. The comment on that line —
"Derived from cost so it stays consistent with what was actually billed" — was the reasoning
that made it look safe.

`DeploymentUsage` has recorded `kind` (`compute` / `storage`), `hours`, `rate` and `amount`
per tick all along. The truth only needed reading rather than inferring.

#### Fix
`deploymentUsageService.summariseForUser()` sums real usage rows per deployment and per kind;
`GET /api/v1/customer/billing/usage` exposes it; the table renders it. The two columns that
guessed are replaced by one that states each charge in full:

```
Storage while stopped · 72.3h at USD 0.246/hr = USD 17.81
Running               ·  0.0h at USD 0.690/hr = USD 0.02
```

Computed on the server rather than the client so there is one answer to "what did this cost
me" and the client cannot drift from it.

**Files touched**
- `backend/src/services/deployment/deploymentUsageService.js` — `summariseForUser`
- `backend/src/controllers/customer/billingController.js` — `getUsageSummary`
- `backend/src/routes/v1/customer/billing.routes.js` — `GET /usage`
- `frontend-customer-center/src/api/billingApi.js` — `getUsage`
- `frontend-customer-center/src/pages/billing/tabs/OverviewTab.js`

---

### BUG-037: "Nothing is running right now" printed beside a live hourly charge

- **Area:** Customer Center
- **Severity:** Medium

#### Actual
The **Current run rate** card showed `0.25 USD/hr` with the subtitle *"Nothing is running
right now"*, and the month-to-date card said *"Growing by USD 0.25 every hour"*. Both
statements were true and together they read as a contradiction: the customer is told nothing
is running and that they are being charged every hour, with nothing anywhere explaining why.

The answer — stopped deployments are charged for storage — appeared nowhere on the page. On
this account it was **USD 5.90/day, USD 177/month**, for two machines the customer had
already stopped.

#### Fix
When nothing is running but the rate is still above zero, the card now says what the money is
for:

> Nothing is running — this is storage for stopped deployments, USD 5.90/day

**Files touched**
- `frontend-customer-center/src/pages/billing/tabs/OverviewTab.js`

---

### BUG-038: "Add credit" opens Overview, which has no top-up form

- **Area:** Customer Center
- **Severity:** High
- **Found:** 2026-09-11, from a screenshot of the dashboard with the button circled.

#### Steps to reproduce
1. From the dashboard, click any **"Add credit"** button — Quick Actions, the low-balance
   alert, the out-of-credit alert, the Credit balance stat card, or any of the three on a
   deployment's detail page.

#### Expected
The top-up form: amount presets, custom amount, "Add USD ___" button.

#### Actual
Every one of them opened `/billing?tab=overview` — a page about what has already been spent,
with no way to add credit anywhere on it.

#### Root cause
All eight buttons navigated to `/wallet`, a legacy route kept for old links, which redirects
to `Billing → Overview`. The actual top-up form lives on the **Credit balance** tab
(`?tab=credits`). The redirect target was simply the wrong tab for what these buttons are for
— `/wallet` is still correct for the two generic "Back to Wallet" / "View wallet" buttons on
the checkout result pages, which were left unchanged.

The file already had the right pattern next to the wrong one: the "Add a card" button on the
same page correctly deep-links to `?tab=cards`.

#### Fix
All eight now navigate directly to `/billing?tab=credits`.

**Files touched**
- `frontend-customer-center/src/pages/DashboardPage.js` — Quick Actions, both balance alerts,
  the Credit balance stat card
- `frontend-customer-center/src/pages/deployments/DeploymentDetailPage.js` — the
  `INSUFFICIENT_CREDIT` redirect and three "Add credit" buttons
- `frontend-customer-center/src/pages/deployments/DeploymentsListPage.js` — the
  `INSUFFICIENT_CREDIT` redirect

#### Verification (live)
```
ok  Add credit -> Credit balance tab              http://localhost:3002/billing?tab=credits
ok  the top-up form is actually visible
ok  Credit balance stat card -> Credit balance tab http://localhost:3002/billing?tab=credits
```
Confirmed the Credit balance tab actually renders the form (amount presets, custom amount
field, "Add USD 50" button) rather than just checking the URL.

---

### BUG-039: "View invoices" opens the Profile page

- **Area:** Customer Center
- **Severity:** High

#### Steps to reproduce
1. From the dashboard, click **"View invoices"** (Quick Actions) or the **"Billing &
   invoices"** stat card (caption: "Lifetime spend — open invoice history").

#### Expected
The Invoices tab, listing past invoices.

#### Actual
Both opened `/settings?tab=billing`, which routes to **`ProfilePage`** — Edit Profile, change
password, a "Billing address" form for invoice details (name, company, VAT id). No invoice
list anywhere. `ProfilePage` never reads a `tab` query param at all, so `?tab=billing` did
nothing; the destination page would have been wrong regardless of the param.

#### Fix
Both now navigate to `/billing?tab=invoices` — the Invoices tab that already exists and
already works (it's what `InvoiceDetailPage`'s own "Back to invoices" button correctly used).

**Files touched**
- `frontend-customer-center/src/pages/DashboardPage.js` — Quick Actions "View invoices", the
  "Billing & invoices" stat card

#### Verification (live)
```
ok  View invoices -> Invoices tab                  http://localhost:3002/billing?tab=invoices
ok  did NOT land on the profile page
ok  Billing & invoices stat card -> Invoices tab   http://localhost:3002/billing?tab=invoices
```
Full regression re-run afterwards: 23/23 endpoints, 33/33 pages clean, no console errors.
