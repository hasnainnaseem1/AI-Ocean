# QA Test Plan — AI-Ocean Platform

> Full-application functional + UI + data-integrity audit.
> Created 2026-09-07, immediately after the MongoDB → PostgreSQL migration (all 6 phases) completed.
> Working doc — updated continuously as testing progresses. Bugs go in `BUGS.md`.

---

## 0. Environment confirmation (done before any testing)

| Item | Value | Verified |
|---|---|---|
| Backend | `http://localhost:3001` (`npm run dev`, nodemon), PID listening on 3001 | ✅ `/api/health` → 200 |
| Marketing site | `http://localhost:3000` (CRA dev server) | ✅ 200 |
| Customer Center | `http://localhost:3002` (CRA dev server) | ✅ 200 |
| Admin Center | `http://localhost:3003` (CRA dev server) | ✅ 200 |
| Database | PostgreSQL 18.6, `localhost:5432/platform_db` | ✅ dev/local only — **not production** |
| `NODE_ENV` | `development` | ✅ |
| Git | **No git repository exists in this project.** Every change is permanent and unrecoverable. | ⚠️ |

**Consequence of no git:** the prompt's instruction to "commit fixes with individual commit messages referencing the bug number" cannot be followed literally. Substitute: each fix is recorded as its own numbered entry in `BUGS.md` with the exact files/lines touched, so the change log lives in the bug file instead of in git history. Flagged to the user rather than silently skipped.

**Current data volume** (baseline, so I can tell my test data apart from real data):

```
user 8 · customRole 7 · useCaseTag 10 · tierCategory 4 · resourceComponent 11
tier 8 · aIModel 9 · creditWallet 4 · creditTransaction 61 · paymentMethod 0
payment 0 · notification 226 · deployment 9 · deploymentUsage 50
activityLog 1031 · adminSettings 1 · blogPost 6 · cronJob 0 · customerNote 0
department 4 · deploymentJourney 2 · marketingPage 9 · questionTemplate 14
recommendationPolicy 1 · seoRedirect 0
```

---

## 1. Product understanding (confirm this is right before I proceed)

**What the product is:** a white-label **AI model hosting / GPU cloud platform**. A customer picks an AI model from a catalog, is guided through a questionnaire that recommends a machine size, deploys it, and is billed **hourly, pay-as-you-go, from a prepaid credit wallet**. The platform owner runs everything — catalog, pricing, marketing site content, billing policy — from the Admin Center; almost nothing is hardcoded.

**The four surfaces:**

1. **Marketing Site** (`:3000`, React + lucide-react) — public. Home, dynamic CMS pages (`/:slug`), blog list/detail, and login/signup entry points that hand off to the Customer Center. Content comes from `MarketingPage`/`BlogPost` DB records, not from source.
2. **Customer Center** (`:3002`, React + antd + Stripe.js) — the customer's dashboard: model catalog, the deploy journey, deployments list/detail, wallet + billing/invoices, profile/settings, and a support-ticket UI.
3. **Admin Center** (`:3003`, React + antd + @ant-design/charts) — operator panel: customers, users, roles/permissions, catalog (models / tiers / resource pricing / questionnaire / recommendation policy), deployment fulfilment queue, wallets + receivables, marketing/blog/SEO content, analytics, logs, cron jobs, integrations, settings.
4. **Backend** (`:3001`, Express + Prisma 7 w/ `@prisma/adapter-pg`) — one API serving all three, ~200 endpoints under `/api/v1`.

**Core entity flow:**

```
ResourceComponent (GPU/CPU/RAM/disk unit prices)
      └─► Tier ("machine": a bundle of components, with derived hourly pricing)
                  ▲
AIModel ──────────┘ (supportedTiers: which machines a model can run on, at what rate)
   │
   └─► QuestionTemplate ──► DeploymentJourney ──► RecommendationPolicy
                                    │              (scoring weights + reason copy, admin-tunable)
                                    ▼
                              Deployment (snapshot of model+tier at order time)
                                    │  status: pending_review → approved → provisioning
                                    │          → running ⇄ paused/stopped → terminated
                                    ▼
                    DeploymentUsage (hourly billing ticks)
                                    │
                                    ▼
                    CreditWallet ⇄ CreditTransaction (ledger, Decimal money)
```

**Auth model — two systems sharing one `User` table:**

- Both issue a JWT signed with the same `JWT_SECRET`, carrying `userId` = the row's `legacyMongoId` (a 24-hex Mongo-shaped string, kept deliberately post-migration as the public-facing `_id`).
- `middleware/auth/auth.js` (customer routes) — verifies token, loads user, attaches. **Does not check `accountType` or `status`.**
- `middleware/auth/adminAuth.js` (all `/admin/*` routes) — verifies token, then additionally requires `accountType === 'admin'` and `status === 'active'`, and logs unauthorized attempts to `ActivityLog`.
- Permissions layered on top via `middleware/security/rbac.js` + `CustomRole.permissions[]`.
- Both frontends store the token in `localStorage` and 401 → wipe + redirect to `/login`.

**⚠️ Asymmetry I already noticed in discovery and will test in Phase 3:** because customer `auth.js` skips the status check, a customer who is suspended/banned *after* logging in keeps a working token until it expires (7 days). Admin auth blocks this; customer auth does not. Will confirm live before logging it.

**Also noticed in discovery, to be confirmed as intended-or-bug (§5.4):** the Customer Center's Support Tickets feature (`/support`, `/support/:id`) is backed by `src/utils/ticketStore` — browser `localStorage`, no backend endpoint and no DB table. Tickets vanish per-browser and no admin can ever see them. This looks like a deliberate placeholder rather than a defect, so I will **ask before touching it**, not "fix" it.

---

## 2. Route map — pages to test

### 2.1 Marketing Site (`:3000`) — 6 routes
| Route | Notes |
|---|---|
| `/` | homepage — rendered from the `MarketingPage` row flagged `isHomePage` |
| `/:slug` | any published dynamic CMS page (9 pages exist) |
| `/blog` | blog index (6 posts) |
| `/blog/:slug` | blog detail; increments a view counter |
| `/login`, `/signup` | hand-off into Customer Center |
| — | maintenance mode interstitial (`MaintenancePage`) when the admin flag is on |

### 2.2 Customer Center (`:3002`) — 25 routes
| Route | Page component |
|---|---|
| `/login` · `/signup` · `/forgot-password` · `/reset-password/:token` | auth |
| `/verify-email-sent` · `/verify-email/:token` | email verification |
| `/dashboard` | `DashboardPage` |
| `/models` · `/models/:slug` | `ModelCatalogPage`, `ModelDetailPage` |
| `/deploy` · `/deploy/:slug` | `DeployJourney` (multi-step: question → model_match → recommendation → review → checkout) |
| `/deployments` · `/deployments/:id` | list + detail |
| `/wallet` | credits |
| `/billing` · `/billing/invoices/:id` · `/invoices` | billing tabs: Overview / Credits / Invoices / PaymentMethods |
| `/checkout/success` · `/checkout/cancel` | gateway returns |
| `/limits` | `UsageLimitsPage` |
| `/profile` · `/settings` | account |
| `/support` · `/support/:id` | localStorage-only (see §1) |
| `*` | catch-all |

### 2.3 Admin Center (`:3003`) — 39 routes
| Group | Routes |
|---|---|
| Auth | `/login`, `/forgot-password`, `/reset-password` |
| Overview | `/` (dashboard), `/analytics`, `/notifications`, `/profile` |
| People | `/customers`, `/customers/:id`, `/users`, `/users/:id`, `/roles`, `/departments` |
| Catalog | `/models`, `/models/new`, `/models/:id/edit`, `/tiers`, `/resource-pricing`, `/questionnaire`, `/recommendation-policy`, `/recommendation-policy/:id/edit` |
| Deployments | `/deployments`, `/deployments/:id` |
| Money | `/wallets`, `/receivables` |
| Content | `/blog/posts`, `/blog/posts/new`, `/blog/posts/:id/edit`, `/marketing/pages`, `/marketing/pages/new`, `/marketing/pages/:id/edit`, `/marketing/navigation`, `/marketing/branding` |
| SEO | `/seo/settings`, `/seo/redirects`, `/seo/debug` |
| Ops | `/jobs`, `/logs`, `/integrations`, `/settings` |
| — | `*` → `NotFoundPage` |

---

## 3. API endpoint matrix (~200 endpoints)

Full inventory extracted from every `*.routes.js`. Each gets the standard battery in §5.2 unless noted.

<details>
<summary><b>Public / unauthenticated (18)</b></summary>

- `GET /api/health`
- `GET /api/v1/public/marketing/site` · `/navigation` · `/pages` · `/pages/:slug` · `/home` (also aliased at `/api/v1/public/*`)
- `GET /api/v1/public/blog/posts` · `/popular` · `/categories` · `/posts/:slug`
- `GET /api/v1/public/catalog/models` · `/tiers` · `/use-cases` · `/models/:slug`
- `GET /api/v1/public/seo/sitemap.xml` · `/robots.txt` · `/settings` · `/check-redirect`
- `GET /api/v1/public/invoice/:paymentId` (signed-token auth in query param — **security test target**)
</details>

<details>
<summary><b>Auth (20)</b></summary>

- Customer: `POST /auth/customer/signup` · `/login` · `/google` · `/logout` · `/resend-verification` · `/forgot-password` · `/reset-password/:token`; `GET /verify-email/:token` · `/me`; `PUT /me` · `/me/password`
- Admin: `POST /auth/admin/login` · `/logout` · `/change-password` · `/forgot-password` · `/reset-password` · `/reset-password-for-user` · `/request-password-reset`; `GET /me`; `PUT /profile`
</details>

<details>
<summary><b>Customer API — requires <code>auth</code> (24)</b></summary>

- Catalog: `GET /customer/catalog/models` · `/tiers` · `/models/:slug`
- Deployments: `GET /` · `/questionnaire` · `/journey` · `/checkout-options` · `/:id` · `/:id/usage` · `/:id/api-key`; `POST /recommend` · `/` · `/:id/pause` · `/:id/resume` · `/:id/stop` · `/:id/terminate` · `/:id/billing-method`
- Wallet: `GET /` · `/transactions`; `POST /topup` · `/topup/instant`; `PUT /auto-topup`
- Billing: `GET /payments` · `/invoice/:paymentId`; `POST /verify-session`
- Payment methods: `GET /`; `POST /setup-intent` · `/`; `PUT /:id/default`; `DELETE /:id`
- Notifications: `GET /notifications` · `/unread-count`; `PUT /mark-all-read` · `/:id/read`; `DELETE /:id`
</details>

<details>
<summary><b>Admin API — requires <code>adminAuth</code> (~130)</b></summary>

| Router | Endpoints |
|---|---|
| `/admin/analytics` | overview, users-growth, deployments-trend, top-customers, recent-activities, revenue-stats, login-analytics, revenue-advanced (8) |
| `/admin/customers` | list, export/csv, `:id`, `:id/activity`, `:id/login-history`, `:id/activity/export`, `:id/payments`, `:id/deployments`, `:id/payment-methods`, `:id/notifications`, `:id/notes` (GET/POST/DELETE), `:id/verify-email`, `:id/status`, DELETE `:id`, bulk-delete (17) |
| `/admin/users` | list, export/csv, `:id`, `:id/login-history`, `:id/activity/export`, create, update, delete, suspend, activate, bulk-delete (11) |
| `/admin/roles` | list, `:id`, create, update, delete, permissions/available, bulk-delete (7) |
| `/admin/models` | list, `:id`, create, update, toggle, order/bulk, delete (7) |
| `/admin/tiers` | list, price-preview, `:id`, create, update, toggle, delete (7) |
| `/admin/resource-components` | categories CRUD (4) + components list/create/update/toggle/delete (5) = 9 |
| `/admin/deployments` | list, `:id`, `:id/status`, `:id/endpoint`, `:id/notes`, + one POST (6) |
| `/admin/questions` | list, create, update, order/bulk, delete (5) |
| `/admin/recommendation-policy` | defaults, list, `:id`, create, update, activate, duplicate, preview, delete (9) |
| `/admin/wallets` | debt, list, `:userId`, `:userId/collect`, `:userId/write-off`, `:userId/adjust` (6) |
| `/admin/logs` | list, `:id`, `user/:userId`, delete old, delete range, export/csv, stats/summary (7) |
| `/admin/settings` | 26 endpoints (general, email + test, customer, security, notification, maintenance, features, billing, theme, email-blocking ×4, google-sso, stripe, lemonsqueezy, payment-gateway, integrations toggle, email-templates ×4) |
| `/admin/blog` | posts CRUD, stats, categories, status, bulk-delete (9) |
| `/admin/marketing` | pages CRUD, status, clone, reorder, navigation, bulk-delete (10) |
| `/admin/seo` | settings GET/PUT, redirects CRUD + toggle (7) |
| `/admin/departments` | list, active, `:id`, create, update, delete, seed/default (7) |
| `/admin/cron` | list, create, update, delete, toggle, trigger (6) |
| `/admin/upload` | upload, delete (2) |
| `/admin/dev-utils` | verify-customer, create-test-customer (2) — **must be dev-gated; security test target** |
</details>

<details>
<summary><b>Webhooks (2)</b></summary>

- `POST /webhooks/stripe` — raw body, HMAC signature verified
- `POST /webhooks/lemonsqueezy` — raw body, HMAC signature verified
</details>

---

## 4. Database schema map

33 tables, 34 enums (`backend/prisma/schema.prisma`). Grouped by domain:

| Domain | Tables |
|---|---|
| User | `User`, `CustomRole` |
| Catalog | `UseCaseTag`, `TierCategory`, `ResourceComponent`, `Tier`, `TierComponent`, `AIModel`, `AIModelSupportedTier`, `AIModelUseCase` |
| Billing | `CreditWallet`, `CreditTransaction`, `PaymentMethod`, `Payment` |
| Deployment | `Deployment`, `DeploymentStatusHistory`, `DeploymentBillingMethodHistory`, `DeploymentRequirement`, `DeploymentUsage` |
| Admin/content | `ActivityLog`, `AdminSettings`, `BlogPost`, `CronJob`, `CustomerNote`, `Department`, `DeploymentJourney`, `DeploymentJourneyStep`, `MarketingPage`, `MarketingPageBlock`, `QuestionTemplate`, `RecommendationPolicy`, `SeoRedirect` |
| Notification | `Notification` |

**DB-specific checks to run (§5.5):**
- Every table's `legacyMongoId` is unique and non-null where the app depends on it (it *is* the public `_id`; a NULL would surface as `_id: null` in JSON).
- `onDelete: Restrict` FKs (`CreditTransaction.userId`/`walletId`, `ActivityLog.userId`) — confirm the customer-delete cascade still clears them in the right order and no FK violation is reachable.
- `onDelete: SetNull` convenience FKs on `Deployment.model`/`tier` — deleting a catalog row must not orphan or crash a deployment.
- Partial unique indexes: one `RecommendationPolicy` active at a time; `AdminSettings.isSingleton`; `Deployment (userId, idempotencyKey)`.
- Orphan sweep: child rows whose parent is gone (`TierComponent`, `AIModelSupportedTier`, `DeploymentStatusHistory`, `MarketingPageBlock`, `DeploymentJourneyStep`, `CreditTransaction`).
- Money columns are `Decimal`/`numeric`, never float — and the app is not silently mixing `Prisma.Decimal` with JS `Number` arithmetic (23 files were flagged for this during the migration and never fully re-audited).
- Index coverage on every column the app filters/sorts by at scale (`ActivityLog.createdAt`, `Deployment.status`, `Notification.userId`, `CreditTransaction.walletId`).
- Row counts before/after each destructive test, to catch leftovers.

---

## 5. Test matrix

### 5.1 Per-page checks (applies to all 70 frontend routes in §2)

For **every** page:
1. Loads without a white screen; no JS console error; no unhandled promise rejection.
2. No failed network request (4xx/5xx) in the Network panel on load.
3. Loading state renders (not a flash of "no data" while fetching).
4. Empty state renders sensibly when there's genuinely no data.
5. Error state renders when the API fails (test by hitting a page while forcing a 500).
6. Every button/link actually does something and goes where it claims.
7. Every form: submit with valid data, submit empty, submit invalid — client and server validation agree, and the error message shown is human-readable.
8. Layout holds at 1440px, 768px, 375px — no horizontal body scroll, no overlap, no clipped text.
9. Light **and** dark mode both legible (both frontends have a theme toggle).
10. Data on screen matches what's actually in Postgres.

### 5.2 Per-endpoint checks (applies to all ~200 endpoints in §3)

| Check | Expected |
|---|---|
| Happy path | 2xx, correct shape |
| No `Authorization` header | 401 (not 500, not 200) |
| Malformed / expired / foreign-signed JWT | 401 |
| Customer token on an `/admin/*` route | 403 |
| Admin-permission-gated route with a role lacking that permission | 403 |
| **IDOR**: customer A's token requesting customer B's `:id` | 403/404 — **never** B's data |
| Non-existent `:id` | 404, not 500 |
| Malformed `:id` (`abc`, `../`, very long) | 400/404, not 500 |
| Empty string / null / missing required field | 400 with a useful message |
| Huge input (100 KB string) | rejected cleanly, not a hang |
| Unicode + emoji + RTL text | stored and returned intact |
| SQL-injection-style string (`'; DROP TABLE users;--`) | stored as literal text, no error (Prisma parameterizes — but the `$queryRaw` sites in `analyticsService.js` and `paymentService.getMonthlyTrend` get extra scrutiny) |
| Negative / zero / huge numbers on money & quantity fields | rejected or handled, never a negative balance by accident |
| Pagination `page=0`, `page=99999`, `limit=0`, `limit=100000` | sane clamping, no crash, no unbounded query |

### 5.3 End-to-end scenarios (Phase 2 of the audit)

**Scenario A — happy-path customer (the main lifecycle).**
Marketing site → click Get Started → signup → email verification → login → dashboard → browse `/models` → open a model detail → start the deploy journey → answer every question → see the recommendation → review → attempt checkout → top up wallet → deploy. Then, in the Admin Center as super-admin: find the new customer in `/customers`, open their detail, confirm every panel (activity, deployments, wallet, payment methods, notifications, notes) shows correct data; find the deployment in `/deployments`, approve it, set an endpoint, move it to `running`. Back in Customer Center: confirm the deployment shows as running, the API key is revealable, usage appears. Trigger `hourlyBilling` manually; confirm a `DeploymentUsage` row + `CreditTransaction` + wallet debit all appear and agree. Pause → resume → stop → terminate. Verify every state in Postgres directly at each step.

**Scenario B — out-of-order / awkward user.**
Sign up but never verify → try to deploy. Deploy with a zero balance. Start the journey, jump backwards, refresh mid-journey, open two tabs. Try to resume a terminated deployment. Try to top up a negative amount. Change email to one already taken. Log in on two browsers, log out of one. Suspend the customer from Admin while they hold a live token (the §1 asymmetry). Delete the customer while they have an active deployment + ledger rows.

**Scenario C — hostile / edge-case input.**
Every text field: emoji, 10k characters, `<script>alert(1)</script>`, `'; DROP TABLE users;--`, leading/trailing whitespace, unicode homoglyph emails. Every numeric field: `-1`, `0`, `1e308`, `NaN`, `0.001`. Every id param: another user's id, a deleted id, a malformed id. Direct API calls bypassing the UI entirely for anything the UI disables client-side (a disabled button is not authorization).

### 5.4 Cross-cutting sweeps

| Sweep | Method |
|---|---|
| Console/network error sweep | Playwright over all 70 routes, collecting `console.error` + `pageerror` + failed responses |
| Responsive sweep | same routes at 1440 / 768 / 375 px, screenshot diff by eye |
| Dark-mode sweep | both app frontends, every page, toggle on |
| Dead-link sweep | crawl every `<a href>` / `navigate()` target and confirm it resolves to a real route |
| Secret-leak sweep | grep the built frontend bundles for `JWT_SECRET`, `STRIPE_SECRET_KEY`, `DATABASE_URL`, admin password |
| Auth-matrix sweep | scripted: every admin endpoint × {no token, customer token, suspended-admin token} |
| IDOR sweep | scripted: every `:id`-bearing customer endpoint with a second customer's id |
| Cron sweep | trigger all 5 jobs (`hourlyBilling`, `lowBalanceWarning`, `debtCollection`, `notificationCleanup`, custom cron actions) and check for errors + correct side effects |
| Feature-flag sweep | toggle each `AdminSettings.features` flag and confirm the gate actually hides/blocks the feature on both sides |
| Maintenance-mode sweep | turn it on; confirm all three frontends show the interstitial and the API blocks non-admins |
| Post-migration residue sweep | grep for any remaining `mongoose`, `models/`, `Mirror` references; confirm `_id` is populated everywhere the frontends read it |

### 5.5 Database checks
As listed in §4, run as direct Prisma/SQL queries — before testing (baseline), after each destructive scenario, and once at the end.

---

## 6. Order of work

| Phase | Content | Status |
|---|---|---|
| 1 | Discovery + this plan | ✅ done |
| 2 | Scenarios A, B, C end-to-end + DB verification after each | ✅ done — 16 bugs logged |
| 3 | Cross-cutting sweeps (§5.4) incl. the auth/IDOR/security matrix | ✅ done — all 12 sweeps complete, 7 more bugs logged (BUG-017 … BUG-023) |
| 4 | Per-page (§5.1) and per-endpoint (§5.2) systematic passes | ✅ done — 10 more bugs logged (BUG-024 … BUG-033) |
| 5 | Fix bugs one at a time, severity-ordered, re-testing each + a regression check | ✅ done — **34/34 fixed and verified live**, environment restored, test data removed |
| 6 | Final summary report | ✅ done — see §8 |

### Phase 2 — what was actually exercised

**Scenario A (happy path), end to end, all live:** marketing site → signup through the real UI → auto-login → dashboard → catalog browse → the full 16-step deploy journey → checkout (correctly blocked by the card gate) → admin credits the wallet → admin turns the gate off → deployment created → admin queue → approved → provisioning → endpoint set → running → customer sees it and can reveal the API key → hourly billing charged → pause → resume → stop → terminate → invalid transitions refused. Postgres inspected directly after every step.

**Scenario B (out of order / awkward):** suspend a customer holding a live token; log in while suspended; act on another customer's deployments; reach admin routes with a customer token; forged/absent/garbage tokens; deploy against an out-of-stock tier; wallet reconciliation after direct DB tampering.

**Scenario C (hostile input):** SQL-injection strings, `<script>` tags, unicode/emoji/RTL, 100,000-character strings, `__proto__`, NUL bytes, whitespace padding — through signup, department create and blog create; 8 malformed email shapes; 5 password shapes; NoSQL-style object and array injection on login; 8 malformed `:id` params including path traversal; and 6 pagination shapes against 11 list endpoints.

**Money path verified to the cent:** a 3.004h tick at $8.5206/hr charged $25.60 and the ledger sum matched the wallet balance exactly; a credit-exhaustion run with $5.00 against a 10-hour backlog billed exactly $5.00, stopped at the exhaustion instant, paused the deployment, cut the endpoint and notified both the customer and 4 admins.

**Test data:** created under `qa-*@aiocean-test.com`; the 6 hostile-sweep accounts and 6 junk blog posts were removed through the real admin endpoints (which also exercised the delete cascade). Two QA customers and their deployments remain for the fix-verification phase and will be removed at the end.

**One environment change still in place, to be reverted:** `AdminSettings.billingSettings.cardGate.requireVerifiedCard` was set to `false` so the deploy flow could be walked. It was `true` originally. Reverting is part of the Phase 5/6 wrap-up.

### Phase 3 — the 12 cross-cutting sweeps

| # | Sweep | Result |
|---|---|---|
| 1 | Auth matrix — 50 admin endpoints × {no token, customer token, admin token} | ✅ 50/50 correct |
| 2 | Public-endpoint exposure — 13 endpoints anonymous + private-field scan | ✅ all reachable, nothing leaked |
| 3 | IDOR — customer B against customer A's resources | ✅ all refused (done in Phase 2) |
| 4 | Secret-leak — 125 built bundle files vs. the real `.env` values | ✅ clean (2 false positives) |
| 5 | Feature flags — all 7 toggled off and restored | ✅ all enforced (23 gate sites) |
| 6 | Maintenance mode — API + all three frontends | ⚠️ API correct; **BUG-018**, **BUG-019** |
| 7 | Cron — all 4 jobs triggered | ✅ clean; **BUG-020** (scalability) |
| 8 | Dark mode — contrast measured on every text node, 16 pages | ⚠️ customer clean; **BUG-023** (admin badges) |
| 9 | Responsive — 30 pages × 1440/768/375px | ⚠️ **BUG-015**, **BUG-016**; marketing clean |
| 10 | Dead links — all three frontends | ✅ no dead links |
| 11 | Post-migration residue | ⚠️ live app clean; **BUG-017** (seed scripts) |
| 12 | Performance — latency, indexes, N+1, unbounded queries | ⚠️ fast + well-indexed; **BUG-020**, **BUG-021**, **BUG-022** |

**Product decision recorded (user, 2026-09-07): the Admin Center must work on a phone.** BUG-016 is therefore a confirmed defect, not an open question.

### Phase 4 — the systematic passes

A definitive endpoint inventory was generated from the route files themselves (`p4-enumerate.js`): **242 endpoints** — 102 GET, 67 POST, 48 PUT, 22 DELETE, 3 PATCH — of which 160 carry a `checkPermission()` gate and 17 a feature gate.

| Pass | Coverage | Result |
|---|---|---|
| 4A — write-endpoint auth | 128 write endpoints × {no token, customer token} | ✅ 128/128 correct |
| 4B — RBAC | a real least-privilege admin × all 63 gated GETs + 7 escalation attempts | ✅ 61/63, **0 wrongly allowed**, all escalation blocked |
| 4C — CRUD lifecycles | 9 admin resources, create→read→update→verify→delete→verify | ⚠️ 9/9 work; **BUG-028** |
| 4D — `:id` handling | 28 parameterised endpoints × 8 hostile id shapes | ⚠️ 201/224 clean; **BUG-029/030/031** |
| 4E — dead buttons | 17 pages, every non-destructive button | ✅ zero dead buttons |
| 4F — error / loading / empty states | 15 pages × {HTTP 500, dead network} | ⚠️ no crashes; **BUG-032** |
| 4G — data correctness | admin dashboard vs Postgres, field by field | ✅ exact match |

Two bugs (**BUG-024**, **BUG-033**) were found not by a planned probe but while setting up and cleaning up other tests — the RBAC fixture creation and the test-data teardown respectively.

**Test data:** all Phase 4 fixtures removed (5 QA admin accounts, all `qa_*` roles, and the junk departments/posts/redirects). Deleting the admin accounts required a direct database cleanup because of BUG-033. Four `@aiocean-test.com` accounts remain deliberately — the two QA customers still needed for fix verification, plus two pre-existing dev accounts.

## 7. Ground rules I'm holding myself to

- Everything gets **actually run** — real HTTP calls, real browser automation, real SQL. No "looks correct by reading the code" findings without a live reproduction.
- Test data is created with an obvious marker (`qa-<timestamp>@aiocean-test.com`) and cleaned up, so the 8 real users / 9 real deployments stay untouched.
- Ambiguous behaviour is **asked about, not silently "fixed"** — logged in `BUGS.md` with status `Question` (e.g. the support-ticket localStorage feature in §1).
- No git means every fix is permanent: read the target before overwriting, and record file+line in `BUGS.md`.
- Anything that would need a schema change goes through a proper Prisma migration file, never a hand-edit.

## 8. Final report (Phase 6)

### 8.1 What was found

**34 bugs, all fixed and verified live. Nothing left open.**

BUG-034 was found *after* this report was written, while live-probing concern §8.2 (1)
rather than estimating it — see the note there.

By severity:

| Severity | Count | Fixed |
|---|---|---|
| High | 7 | 7 |
| Medium | 17 | 17 |
| Low | 10 | 10 |

By area:

| Area | Count | Notable |
|---|---|---|
| Backend | 24 | BUG-005 (suspension not enforced), BUG-017 (fresh install impossible), BUG-033 (admins undeletable) |
| Customer Center | 4 | BUG-004 (deploy journey skipped a question), BUG-009 (notification bell was fake data) |
| Admin + Customer Center | 2 | BUG-016 (tables broke every page at narrow widths), BUG-032 (dashboards showed zeros on API failure) |
| Marketing Site | 2 | BUG-018 (maintenance mode showed a raw 404) |
| Admin Center | 2 | BUG-015 (dashboard scrolled sideways), BUG-023 (contrast failures) |

The seven High-severity bugs are worth reading as a group, because five of them are
things that would have been hit in the first week of real use rather than edge cases:

- **BUG-017** — no fresh install was possible at all. Every seed script still
  required `mongoose`, which the Postgres migration uninstalled, so `npm run seed`
  crashed and a new environment could never create its first admin account.
- **BUG-033** — no admin account could ever be deleted. `DELETE /admin/users/:id`
  had no cascade, so the foreign keys from `custom_roles.created_by_id` and
  `customer_notes.author_id` made every attempt a 500.
- **BUG-005** — suspending or banning a customer only blocked *new* logins. Anyone
  already holding a token kept full access until it expired.
- **BUG-004** — the deployment questionnaire double-advanced, so a customer
  answering normally silently skipped a question and got a recommendation based on
  incomplete answers.
- **BUG-009** — the customer notification bell rendered a hardcoded array of fake
  notifications; the real API was admin-only, so customers never saw a single real
  message the platform sent them.
- **BUG-018** — turning maintenance mode on took the public marketing site to an
  unbranded "404 Page not found" instead of the maintenance page.
- **BUG-032** — when the API failed, dashboards rendered confident zeros: "0
  customers", "$0.00 credit balance". Indistinguishable from a real empty state.

### 8.2 Cross-cutting concerns beyond the individual bugs

These are patterns, not single defects. None of them is broken today; each is a
place where the next change is likely to reintroduce a bug.

> **All six were subsequently addressed** — see `CLEANUP_PLAN.md`, phases A–G. Three of them
> turned out not to be hypothetical at all: probing concern (1) surfaced **BUG-034**, the
> linter added for it immediately caught four broken exported functions in
> `emailValidator.js` that would have thrown on any call, and the wording pass in concern (6)
> turned up a dead constant holding a hardcoded database password. The text below is left as
> it was written, because what each concern predicted is the point.

**1. Systemic bugs came from copy-paste, not from bad logic.** The largest fixes in
this pass were all one root cause repeated: pagination parsing duplicated across 66
list endpoints (BUG-010), the error-response shape duplicated across 38 handlers
(BUG-006), and the delete cascade hand-written twice and missing at two more call
sites (BUG-033). Each was fixed by extracting one shared helper — `paginate()`,
`failure()`, `deleteUsersCompletely()` — rather than 66/38/4 individual edits. The
concern is that nothing prevents the *next* list endpoint from hand-rolling its own
`Number(req.query.page)` again. A lint rule or a route factory would.

  **This one stopped being hypothetical the moment it was probed.** Checking how many
  sites still hand-rolled pagination turned up **BUG-034**: the `paginate()` fix reached
  every *query*, but six sites still assembled the `pagination` block they send back to
  the client out of the caller's raw input, so `?page=abc&limit=-1` returned correct rows
  beside `{"page":null,"limit":-1,"pages":-7}` — a 200, which is why the Phase 3 sweep
  (which counted 500s) missed it. Fixed with a `meta()` helper derived from the same
  `paginate()` call. Treat the remaining five concerns below the same way: each is worth a
  live probe, not an estimate.

**2. The API is inconsistent about `id` vs `_id`.** Most responses carry `_id`
(the `legacyMongoId` kept from the Mongo era), but some carry `id` (the real UUID),
and a few carry both. BUG-029 was exactly this: `GET /admin/roles/:id` was the only
resource that accepted *only* a UUID, so passing the `_id` the frontend actually
holds returned a 500. It is fixed for roles, but the underlying inconsistency is
still there across the codebase, and every new resource has to remember the
convention. Deciding on one — and having the wrap functions enforce it — would close
the whole class.

**3. Multi-step writes still lack transactions in places.** The billing paths were
wrapped in `prisma.$transaction` during the Postgres migration (wallet debit + ledger
row are now atomic), but the newer cascades are not. `deleteUsersCompletely()` runs
eight sequential deletes; a failure at step six leaves a partially-deleted user.
Nothing observed this in testing, but it is a real window.

**4. Two auth transports keep the same list in step by comment.** The customer
center ends a session on 401 plus one of the `ACCOUNT_ENDED` codes. That list exists
twice — once in `axiosInstance.js`, once in `AuthContext.js` (fetch) — kept
synchronised only by a comment saying so. BUG-019 was caused by the previous version
of this logic being too broad; the fix was correct but the duplication that made it
possible remains.

**5. Validation lives at the route, not at the boundary.** Email shape (BUG-012),
type checks (BUG-014), NUL bytes (BUG-013) and numeric bounds (BUG-008) were each
fixed at the specific route that was probed. `sanitizeInput` is now global, but shape
validation still is not — there is no schema layer (Zod/Joi) between the request and
the handler, so the next endpoint starts from zero again.

**6. The historical migration scripts are dead code that still looks live.** Eleven
files under `backend/src/scripts/migration/` still `require('mongoose')`, which is no
longer installed. They cannot run. They were left alone deliberately — they are the
record of how the Mongo data was moved — but they sit next to the seed scripts that
*are* live, and BUG-017 happened precisely because that distinction wasn't obvious.
Moving them to an `archive/` folder would make it obvious.

### 8.3 The one open question for you

**Support Tickets in the Customer Center are not real.** `/support` and
`/support/:id` are backed by `src/utils/ticketStore`, which writes to the browser's
`localStorage`. There is no backend endpoint, no database table, and no admin-side
view. A customer can open a ticket, see it listed, and reply to it — and nobody at
the platform will ever receive it. Clearing browser data deletes it.

I did not touch this, because it reads as a deliberate placeholder rather than a
defect, and the brief says to ask rather than silently "fix" intended behaviour. It
needs one of three decisions: build the backend for it, hide the feature until the
backend exists, or leave it as a demo and label it as such in the UI.

### 8.4 Worth a deeper look later

Not defects — things a focused session would pay off on.

- **Concurrency.** Everything was tested sequentially. The interesting races are
  untested: two simultaneous top-ups on one wallet, the hourly billing job running
  while a customer terminates a deployment, two admins editing the same tier.
- **The `$transaction` gap in §8.2 (3)** — worth an audit of every multi-write path,
  not just the cascade found here.
- **Load.** BUG-020 fixed the per-customer query loops in two cron jobs, but the
  whole system has only ever run against 4 customers and 9 deployments. The queries
  are indexed and fast; that is not the same as knowing they hold at 10,000 rows.
- **Email delivery.** Everything the platform sends was verified as far as the
  notification record in Postgres. Whether SMTP actually delivers, and what the
  emails look like, was never exercised.
- **The payment gateways.** Stripe and LemonSqueezy webhooks were verified by
  invoking the handlers directly. No real gateway call, no real card, no signature
  verification against a live secret.
- **An automated test suite.** This pass was entirely manual/scripted and leaves
  nothing behind that runs on demand. The scenario scripts written here would convert
  cheaply into a smoke suite — the auth matrix (50 endpoints × 3 identities) and the
  pagination sweep (66 endpoints × 6 shapes) in particular caught real bugs and would
  keep catching regressions.

### 8.5 Final state

- 34/34 bugs fixed, each re-tested live and recorded in `BUGS.md` with its
  reproduction, root cause, files touched and verification output.
- **23/23 API endpoints** healthy across admin, customer and public surfaces.
- **33 pages** load clean with zero console errors — 17 admin, 9 customer, 7
  marketing.
- **All 4 cron jobs** run without error.
- **30/30 pages** free of horizontal overflow at 1440 / 768 / 375 px.
- **187/187** frontend files parse.
- Database integrity check clean: 0 orphans, all 4 wallets reconcile against their
  ledgers, no null `legacyMongoId`, 0 QA rows remaining.
- The one environment change made during testing (`cardGate.requireVerifiedCard`,
  set to `false` in Phase 2) is **restored to `true`**.
- One schema change was needed and went through a proper migration file:
  `20260908100344_allow_deleting_admins_who_authored_roles_and_notes`.
