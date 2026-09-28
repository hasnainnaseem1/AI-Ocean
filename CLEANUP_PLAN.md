# Cleanup Plan — the six cross-cutting concerns + total Mongo removal

> Follows `QA_TEST_PLAN.md` §8.2. Those six items were **not** bugs — the app worked.
> They are places where the *next* change would create a bug. The user asked for all
> six, and for every trace of MongoDB to be gone — **deleted, not archived**.
>
> Companion docs: `QA_TEST_PLAN.md` (the audit), `BUGS.md` (34 bugs, all fixed).

## Safety

No git repository exists in this project, so nothing here is undoable by revert.
Before any schema change:

```
backups/platform_db_before_mongo_cleanup_20260909_184941.sql   3.6 MB · 34 tables · 34 COPY
```

Taken with `docker exec postgres-stable-18.6 pg_dump -U postgres -d platform_db --clean --if-exists`.
Restore with `docker exec -i postgres-stable-18.6 psql -U postgres -d platform_db < <file>`.

Schema changes go through a real Prisma migration file, never a hand-edited schema.

## Progress tracker

| Phase | Keyword | Content | Status |
|---|---|---|---|
| A | `SAAF-1` | Delete the dead `mongoose` scripts + the npm scripts pointing at them | ✅ |
| B | `SAAF-2` | De-duplicate the `ACCOUNT_ENDED` list (concern 4) | ✅ |
| C | `SAAF-3` | Guard against hand-rolled pagination returning (concern 1) | ✅ |
| D | `SAAF-4` | Transactions around multi-step writes (concern 3) | ✅ |
| E | `SAAF-5` | One validation layer at the boundary (concern 5) | ✅ |
| F | `SAAF-6` | `legacyMongoId` → real UUID `id`, everywhere (concern 2 + 6) | ✅ |
| G | `SAAF-7` | Wording pass — remove "Mongo"/"Mongoose" from comments and names | ✅ |

Every phase ends with the app actually run and re-verified before the next begins —
this project's standing practice, and the only safety net there is.

## What "Mongo residue" actually means here

Three separate things, deliberately kept apart because they carry very different risk:

| Kind | Count | Risk | Phase |
|---|---|---|---|
| Dead script files that `require('mongoose')` — cannot run, the package is uninstalled | 11 files + 9 npm scripts | none, they are already broken | A |
| The `legacyMongoId` column and the `_id` key the API builds from it | 38 schema columns · 45 backend files · 38 frontend files | high — schema change, both frontends, no git | F |
| The words "Mongo"/"Mongoose" in comments, helper names, and doc-strings | 38 files | none | G |

`.env`, `.env.example` and `package.json` dependencies were already clean before this
work started — verified, not assumed.

## Phase F — the plan for the risky one

Removing `legacyMongoId` cannot be a single edit: the backend builds `_id` from it and
both frontends read `_id`. Same strangler approach the Postgres migration itself used,
so the app is working and verifiable at every step.

1. **F1 — accept both.** ✅ Every `:id` route resolves a UUID *or* a legacy 24-hex id.
   Nothing breaks; both id shapes work. See "Phase F1 — done" below.
2. **F2 — move the frontends.** All three frontends read `id` instead of `_id`.
   Verified page by page in the browser.
3. **F3 — stop emitting `_id`.** Serializers drop the key; routes stop accepting the
   legacy shape. `newMongoId()` stops being called for new rows.
4. **F4 — drop the columns.** One Prisma migration removes all 38, and
   `utils/helpers/mongoId.js` is deleted.

Anything that turns out to genuinely need a stable public id separate from the primary
key gets a purpose-named column at that point — not a resurrected `legacyMongoId`.

---

## Phase A — done

**12** dead files, not 11. The twelfth was `backend/scripts/seedMarketingSite.js` — outside
`backend/src`, which is why the first scan missed it.

Deleted (all confirmed unreferenced by any live code first):

```
scripts/cleanup/deleteDepartments.js          scripts/migration/postgres/adminCopyToPostgres.js
scripts/migration/dropAnalysisFields.js       scripts/migration/postgres/adminSettingsCopyToPostgres.js
scripts/migration/migrateExistingCustomers.js scripts/migration/postgres/billingCopyToPostgres.js
scripts/migration/migrateGpuTiersToTiers.js   scripts/migration/postgres/catalogCopyToPostgres.js
scripts/migration/migrateSellersToCustomers.js scripts/migration/postgres/deploymentCopyToPostgres.js
                                              scripts/migration/postgres/userCopyToPostgres.js
```

…along with the now-empty `cleanup/`, `maintenance/`, `migration/` and `migration/postgres/`
directories, and the 9 npm scripts that pointed at them.

**The twelfth was ported, not deleted.** `seedMarketingSite.js` is 902 lines, of which ~850
are hand-written marketing copy for this product — the source of all 9 marketing pages in
the database, and the only way to reseed them. Only its three `require`s and its 40-line
runner touched Mongoose. Deleting it would have left a fresh install with an empty
marketing site, which is the same class of problem as BUG-017. It now lives at
`src/scripts/seed/seedMarketingSite.js`, writes through `marketingPageService` (which owns
the `blocks` child table and the single-homepage rule), honours `--force` and the
"a human edited this" marker like every other seed, and is wired to `npm run seed:marketing`.
Verified idempotent: re-running left 9 pages / 36 blocks / 1 homepage unchanged.

Also added the Prisma scripts that were missing entirely — `db:migrate`, `db:migrate:dev`,
`db:generate`, `db:studio` — plus `seed:blog` and `seed:policy` for two seed files that had
no npm script at all.

## Phase B — done

The `ACCOUNT_ENDED` list existed three times: the status checks in `middleware/auth/auth.js`,
and hand-copied arrays in the customer frontend's `api/axiosInstance.js` and
`context/AuthContext.js`, kept in step only by a comment.

Rather than move the array to one frontend file, the decision moved to the backend, which is
the authority on it: `middleware/auth/accountStatus.js` is now the single list, and every 403
it produces carries `endsSession: true`. The frontends no longer carry the list at all —
`auth/sessionPolicy.js` exports one `endsSession(status, body)` used by both transports.
Adding a new "account is over" status is now a backend-only change.

Verified against all five statuses (`active`, `pending_verification`, `suspended`, `banned`,
`inactive`) — 5/5 correct — and in the browser for the two behaviours that previously broke:
a suspended customer **is** signed out (BUG-005), and maintenance mode **does not** sign
anyone out (BUG-019).

Found while testing, not changed: `PUT /admin/customers/:id/status` only accepts
`active`, `suspended` and `pending_verification`, so `banned` and `inactive` cannot be set
from the Admin Center at all — they can only arrive from the database. The middleware handles
them correctly either way. Whether the admin UI should be able to ban someone is a product
question, not a defect, so it is recorded here rather than "fixed".

## Phase C — done

The backend had no linter at all (the three frontends each have one). Added ESLint 9 plus
`eslint.config.js`, deliberately **not** a style config — every rule encodes a bug that
actually happened here, with the bug number in the message:

| Rule | Bans | Because |
|---|---|---|
| `no-restricted-syntax` | `parseInt(req.query.page)` | BUG-010 |
| `no-restricted-syntax` | `pages: Math.ceil(...)` written by hand | BUG-034 |
| `no-restricted-syntax` | `error.message` echoed on a **500** | BUG-006 |
| `no-restricted-syntax` | `ACCOUNT_*` status literals outside `accountStatus.js` | Phase B |
| `no-restricted-syntax` | `require('mongoose')` | this plan |
| `no-undef` | undefined identifiers | the `safeLimit` class of codemod damage |

`npm run lint` · `npm run lint:fix`.

The first run reported **14 errors**, and the interesting part is that they were not all
what the rules were aimed at:

- **`TEMP_EMAIL_DOMAINS is not defined`** in `middleware/validation/emailValidator.js` — six
  references in four exported functions (`isTemporaryEmail`, `addTempEmailDomain`,
  `removeTempEmailDomain`, `getBlockedDomains`) to an array that no longer exists. Every one
  of them would have thrown a `ReferenceError` the instant it was called; nothing called
  them, which is the only reason this never surfaced. They are leftovers from an in-memory
  blocklist that was correctly replaced by admin-controlled settings
  (`AdminSettings.customerSettings.blockedTemporaryEmailDomains`, which the live path already
  reads). Deleted rather than rewritten — a second in-memory copy of that list is what caused
  the problem.
- **Three more pagination blocks** still assembled by hand (`admin/deployments`,
  `admin/wallets` ×2) — correct, but only by accident; moved onto `meta()`.
- **Five `error.message` echoes** that turned out to be *right*: guarded 4xx branches for
  errors the code threw itself, carrying fields the client needs (`balance`, `required`,
  `tiers`, `forceUnfundedAvailable`). The rule was too broad, so it was narrowed to 500s
  only — which is what BUG-006 actually was. Fixing the rule rather than the code.

Then a dead-code pass on the 31 warnings, most of which were **Mongo residue**: four
`findMany`s that existed only to collect `legacyMongoId`s so mirror rows could be deleted
(they ran on every customer delete and were read by nothing), and three
`toXxxDoc` mirror builders left behind.

**The linter immediately caught three mistakes of mine while I was doing this**, which is
the clearest argument for it existing: I removed `checkFeatureEnabled` from an import when
the warning was actually about `superAdminOnly` (7 routes broken), and stripped
`const updated =` from three statements whose result *was* used. A fourth mistake — narrowing
a `select` that a following line read as `t.legacyMongoId` — the linter could **not** catch,
because that is a runtime property access; that one was caught by reading the diff.
Both classes were fixed and then verified live: `toggleTier` flips and restores,
`markExpired`/`markExpiryWarned` return a wrapped card (exercised against a real row, then
removed), and the roles/settings/users/departments routes all still answer.

Ends at **0 errors, 5 warnings** — the remainder being deliberate (an `opts` default that
documents the API, two stale `eslint-disable` comments).

## Phase D — done

A scan for functions doing two or more Prisma writes without a transaction found eight
candidates. Four were false positives — `incLoginAttempts`, `chargeOffSession` and
`attachFromSetupIntent` write on mutually exclusive branches (only one ever runs), and
`withUserIdAlias` was an artefact of how the scanner splits files. `syncFromGateway` was
left alone deliberately: it loops over a list fetched from Stripe, and a partial sync is
self-correcting on the next run.

That left four real ones.

**The delete cascade — the one flagged in §8.2.** `deleteUsersCompletely` ran eight
independent writes across seven services: each atomic in itself, none atomic together. A
failure at, say, the activity-log step left a customer whose deployments, wallet, ledger and
cards were already gone but whose account still existed and could still be logged into.
Half-deleted is worse than either outcome, and it could not be retried cleanly.

All seven `deleteAllForUsers` functions and `userService.deleteUser` now take the Prisma
client as an optional second argument, and none opens a transaction of its own (Prisma does
not nest them). The orchestrator wraps all eight steps in one `$transaction`, with the
timeout raised to 30s — a superadmin deleting an account that owns thousands of usage and
ledger rows is exactly the case where the 5s default would time out halfway, which is the
failure this exists to prevent.

Verified by breaking it on purpose: with step 5 forced to throw, the account and all four
child-row counts were still intact afterwards (`user:1, wallets:1, ledger:1, logs:1,
notifs:1`), the error reached the caller, and a normal delete immediately afterwards still
removed everything. Bulk delete of two users in one transaction verified too.

**Three narrower ones**, each a pair of writes that is really one change:

| Function | Split apart, a failure leaves |
|---|---|
| `catalogService.deleteTier` | models that stopped offering a machine which still exists and is still bookable |
| `catalogService.deleteTierCategory` | every tier uncategorised while the category still exists |
| `paymentMethodService.remove` | active cards but **no default** — and the off-session charge path reads the default, so the account looks unfunded despite having a usable card |

The Stripe detach in `remove` deliberately stays **outside** the transaction: it is a network
call that cannot be rolled back, and holding a row lock across a third party's latency is its
own problem.

Verified live: category delete orphans its tiers rather than deleting them; tier delete
removes the model links with it (`ai_model_supported_tiers.tier_id` is `onDelete: Restrict`,
so the order genuinely matters); card removal promotes the next card to default; the
last-card guard still refuses. Fixtures removed and all baseline counts restored — 8 users,
8 tiers, 4 categories, 9 models, 18 supported-tier links, 9 deployments, 4/4 wallets
reconciling, 0 leftovers.

## Phase E — done

`express-validator` was in `package.json` and used in **zero** files. Removed it and added
`zod`, then built the layer that was missing:

- `middleware/validation/validate.js` — a `validate(schema, source)` middleware plus the
  reusable field types (`email`, `password`, `personName`, `money`, `signedMoney`,
  `publicId`, `shortText`), so "what is a valid email here" has one answer everywhere.
- `middleware/validation/schemas.js` — the input shape per endpoint, in one file.

Every failure returns the same body: `{ success: false, action: 'retry', message, errors }`.
`action: 'retry'` is carried over from the hand-written 400s it replaces — the customer
frontend branches on `action` for other values and ignores this one, so the shape is
unchanged for anything already reading it.

**Applied to the boundaries where bad input is most likely and most costly** — everything
unauthenticated (signup, login, forgot-password, reset-password, resend-verification),
the password change, and the wallet money endpoints (adjust, write-off).

**Not applied to the other ~140 inline checks**, deliberately. They work, they are covered by
the QA pass, and rewriting all of them carries more risk than it removes — with no git, a
mechanical sweep across 140 handlers is exactly how a working app breaks. The concern in
§8.2 was that *no layer existed*, so each new endpoint started from zero; that is now false.
Old handlers can move across as they are next touched.

### The part that mattered most: not stealing settings the admin owns

Two limits were nearly hardcoded into the schemas, and both would have silently overridden
the operator:

- **Password strength.** The first draft had `min(8)`. But strength is
  `AdminSettings.securitySettings`, enforced by `validatePassword()`. A `min(8)` in the schema
  would have quietly capped whatever the operator configured. The schema now only asserts
  "a string of sane length", so a number or an object cannot reach the hashing code.
- **Maximum wallet adjustment.** The first draft capped money at `1_000_000`. The real cap is
  `AdminSettings.billingSettings.maxManualAdjustment`, which the admin can raise. The money
  types now check finite-and-non-zero only; the ceiling stays in the handler that reads the
  setting.

Verified explicitly, not assumed: `?amount=1e308` now comes back with **the admin-setting
message** ("A single adjustment cannot exceed USD 10000. Raise the limit in Settings →
Billing"), not a schema message, and a weak password is refused by `validatePassword()`'s
own text rather than a hardcoded minimum.

27/27 checks pass, including every hostile shape that used to 500 (object/array/null email,
object password, empty body, malformed address), BUG-011 still intact (the same
"Incorrect email or password." for both failure branches), and the new normalisation —
`  DEPLOYER@AIOCEAN-TEST.COM  ` signs in, because the schema trims and lowercases. A full
signup → login → me → delete cycle with a padded, uppercased email works end to end, and the
login and signup forms were re-checked in the browser with zero console errors.

## Phase F1 — done

The survey first, because the shape of the problem was not what §8.2 assumed. The API does
not have *one* id convention with an exception — it has **four**:

| Resource | What the API returns today |
|---|---|
| customers, users | `id` = the 24-hex public id (no `_id`) |
| tiers, models, deployments, blog posts | `_id` = the 24-hex public id (no `id`) |
| custom roles | `id` = the **UUID**, `_id` = the 24-hex — the odd one out, and exactly BUG-029 |
| departments | both keys, both the 24-hex |

Scale: 386 `legacyMongoId` uses across 40 backend files (103 of them lookups, 44
serialisers, 35 `newMongoId()` calls), 105 `._id` reads across the three frontends, and
28 of 33 Prisma models carrying the column.

**Checked before touching anything:** `ActivityLog.targetId` and
`CreditTransaction.referenceId` are polymorphic id strings with no foreign key, so dropping
the column could have orphaned them. They are never resolved back to a row anywhere in the
backend, and the single frontend use groups transactions by `referenceId` as an opaque key.
They are informational strings, so the migration does not break them — worth recording,
because it was not obvious and it would have been an ugly surprise later.

**What F1 changed:** a new `utils/helpers/publicId.js` with `byPublicId(value)`,
`byPublicIds(values)` and `isPublicId(value)`, and a codemod routing all 100 mechanical
lookup sites through it. Five multi-key clauses (a `NOT`, a nested relation filter, two
`findFirst`s with extra conditions, one list filter) were reported by the codemod rather
than guessed at, and done by hand.

`byPublicIds` deliberately returns `{ id: { in: [] } }` for an empty list rather than `{}` —
an empty `where` matches *everything*, and on the `deleteMany` in the delete cascade that is
the difference between removing one customer and emptying the table.

The `isValidId` guard on three admin user routes only accepted 24-hex, so it rejected the
app's own UUIDs with a 400. Replaced with `isPublicId`, which accepts both;
`customRoleService.findByIdentifier` collapsed from two near-identical branches to one.

Verified: 8 resource types × {24-hex, UUID} = 16 lookups all 200, and four junk ids
(`not-an-id`, a path-traversal string, a valid-shaped but absent id of each kind) all still
return a clean 404 rather than a 500. Full regression green — 23 endpoints, 33 pages, 4 cron
jobs.

Nothing about the API's output changed in this step, which is the point: F1 is pure
scaffolding so that the later steps cannot lock anyone out mid-way.

## Phase F2–F4 — done

**F2 — the API emits the UUID.** Every serialiser now returns `id` = the row's real
primary key, alongside `_id` for the moment. Two codemods plus hand fixes:

- 38 serialisers changed from `_id: row.legacyMongoId` to `id: row.id, _id: row.legacyMongoId`.
- **53 Prisma `select` blocks asked for `legacyMongoId` but not `id`** — which would have
  handed those serialisers `undefined`, silently. Found with a scanner rather than by
  reading, and one block was missed by it because it nests two levels deep
  (`lastEditedBy: { select: { name: true } }`); the API probe caught that one.
- 25 more sites built `id` *from* `_id` (`id: user._id`), which is why customers and users
  were returning the 24-hex id under the name `id` in the first place.

**Nested references had to move at the same time.** A tier response carries `categoryId` and
`components[].componentId`, and the frontend joins those against the ids in its own
categories/components lists. If the list ids became UUIDs while the references stayed 24-hex,
the join would silently produce nothing — a tier that quietly loses its components and its
price. 48 nested references converted, and two lookup maps (`tierPricing`'s component
resolution, `catalogService`'s supported-tier resolution) rebuilt with `mapByPublicId`, which
indexes both shapes.

**F3 — the frontends.** 129 sites across 34 files moved from `._id` to `.id`, including
`rowKey="_id"` table keys and the payload-stripper destructures (`const { _id, id, ... }`,
so a server-owned id is not posted back as if it were editable). 188/188 files still parse.

**Two real bugs, both mine, both caught by testing rather than by reading:**

1. The nested-reference codemod rewrote `row.user.legacyMongoId` to `row.user.id` inside
   `findOwned`'s **ownership check**, which then compared a UUID against the 24-hex id from
   the JWT. It fails closed — a 404 on your own record rather than a leak — but it locked
   every customer out of their own deployment detail and usage pages. Invisible to a
   page-load regression, because the deployments *list* still worked. Found by walking every
   round trip instead. Both ownership checks now use `isSameRow`, which does not care which
   shape it is given.
2. Analytics' raw SQL still selected `u."legacy_mongo_id"` after the column was dropped —
   a live 500 on the admin analytics page. Found by the browser regression.

**F4 — the column is gone.** Tokens now carry the UUID; the compatibility layer was removed
(178 edits), every `._id` read became `.id` (248 across 56 files), and one hand-written
migration dropped `legacy_mongo_id` from all **28** tables:

```
backend/prisma/migrations/20260909215643_drop_legacy_mongo_ids/
```

`prisma migrate dev` refuses to run non-interactively when it detects data loss, so the SQL
was written by hand — which is what the brief asked for anyway — and applied with
`migrate deploy`. `utils/helpers/mongoId.js` is deleted along with 22 dead imports.

`publicId.js` survives the column, deliberately. Handing Postgres a non-UUID string where a
`uuid` column is expected is a **type error**, not a miss: the caller would get a 500
carrying a database exception instead of a clean 404. So a malformed id now resolves to a
clause that matches nothing, and the route's own not-found branch handles it — which covers
path-traversal strings, a bookmarked URL holding an old id, and a seven-day-old JWT.

**Verified against a genuinely fresh install**, twice: a blank database, `migrate deploy`,
`npm run seed`, `npm run seed:deploy` — 1 super admin, and 10 tags / 4 categories /
11 components / 8 tiers / 9 models / 14 questions / 2 journeys / 31 steps / 9 marketing
pages / 36 blocks / 1 policy, matching the real database exactly, with zero
`legacy_mongo_id` columns. `seed:policy` and `seed:marketing` were folded into `seed:deploy`
in the process — without them a fresh install had no recommendation policy and an empty
marketing site.

## Phase G — done

Identifiers first: 395 renames, because `findByLegacyId` taking a UUID is worse than no name
at all. `findByLegacyId` → `findById`, `findManyByLegacyIds` → `findManyByIds`,
`legacyUserId` → `userId`, and so on. That produced four `Identifier 'userId' has already
been declared` parse errors where a parameter and a local collided — every one of them a
redundant `const userId = String(userId)` or a destructured field that simply echoed the
argument back. Removed rather than renamed around.

Then the prose: 34 + 31 + 21 + 18 phrase rewrites plus five file headers rewritten by hand.
The headers mattered most because they were **actively false** — `deploymentService.js` still
claimed "every write here is mirrored back into MongoDB", and that mirror was deleted during
the migration itself. They now describe what the code does.

Two live findings fell out of the wording pass:

- `seedBlogPosts.js` carried a dead `MONGO_URI` constant **with a hardcoded password in it**.
- `validate.js`'s `publicId` field type still validated a 24-hex string, so it would have
  rejected every real id the moment anything used it.

**Result: zero occurrences of "mongo" (any case) in `backend/src`, in the Prisma schema, in
`.env`, or in `package.json`.** The only match left anywhere in the project is the timezone
entry for Ulaanbaatar, Mongolia.

## Final state

| Check | Result |
|---|---|
| API endpoints | 23/23 healthy |
| Pages, all three apps | 33/33 clean, zero console errors |
| Cron jobs | 4/4 clean |
| Lint | 0 errors, 5 deliberate warnings |
| Frontend files parse | 188/188 |
| Fresh install from a blank database | works, matches production data exactly |
| Delete cascade | atomic — verified by forcing a mid-cascade failure |
| Wallets reconcile against their ledgers | 4/4 |
| QA leftovers in the database | 0 |
| `legacy_mongo_id` columns | 0 of 28 remain |

Backups taken before the schema change:

```
backups/platform_db_before_mongo_cleanup_20260909_184941.sql      3.6 MB
backups/platform_db_before_dropping_legacy_ids_20260909_213637.sql 3.7 MB
```

## Cleanup pass — unused files

Done by walking the real `require`/`import` graph from each app's entry points, not by
guessing from filenames.

**Backend: 1 unreachable file, and it turned out not to be junk.**
`src/scripts/testSuite.js` — 506 lines, no npm script, unreferenced. Running it showed why:
every single test failed with a 401, because the super-admin password was **hardcoded** in
the file and no longer matched the seeded one. It printed a full-looking test run while
testing nothing. Credentials now come from `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` in
`.env`, one test pointed at an endpoint from the product this codebase used to be
(`/analytics/analyses-trend`) was repointed at `deployments-trend`, and it is wired to
`npm run test:api`.

**48/48 passing** — auth, users, customers, roles, catalog, blog, settings, SEO, activity
logs, and a real RBAC check that a restricted admin *can* list users and *cannot* reach
analytics, create users, or open settings. That is the automated smoke suite §8.4 asked for,
recovered rather than written.

**Deleted — 6 files, all Create React App boilerplate that was never wired in:**

```
frontend-admin-center/src/App.test.js       ┐ all three assert a "learn react" link
frontend-customer-center/src/App.test.js    ├ that no longer exists — they FAIL if run
frontend-marketing/src/App.test.js          ┘
frontend-customer-center/src/App.css        ┐ CRA's default spinning-logo styles,
frontend-marketing/src/App.css              ┘ imported by nothing
frontend-marketing/src/reportWebVitals.js     never called by that app's index.js
```

**Kept deliberately:**

- `setupTests.js` × 3 — six lines of test scaffolding, needed the moment a real test is
  written. It is infrastructure, not dead code.
- `@testing-library/*` and `web-vitals` — now unreferenced (they were only used by the
  boilerplate just deleted), but removing them would make adding the tests §8.4 recommends
  harder, and they are tree-shaken out of a build either way.
- **`Sparkline.js` and `StatusBadge.js`** (admin center) — unused, but not junk: both are
  finished, documented components, and `theme/chartTheme.js` describes Sparkline as a
  deliberate part of the design system ("Sparkline lives inside stat cards,
  `@ant-design/charts` lives in dedicated chart cards"). This is "built, not yet wired in",
  which is a product decision rather than a cleanup one — **left for the user to call**.

**Not touched: 44 exports that nothing else references.** Most are a module's deliberate
public surface or exported for testability (`profileBuilder`'s seven, `provisioningDriver`'s
three). Churning 44 call sites for no functional gain is the same mechanical-sweep risk that
was declined in Phase E. Listed here as a finding, not acted on.

---

## Receivables validation + billing clarity (2026-09-10)

### Receivables works

An empty receivables list proves nothing, so a real debtor was created and the admin side
walked end to end: **20/20**. The debtor appears, the count and total move by the right
amount, the ageing verdict computes `debtDays` from `debtSince`, the single-wallet view
agrees, collection without a card refuses with a clean `402` rather than a 500, a partial
top-up settles debt *before* anything becomes spendable (USD 5 against USD 12.50 left
`outstanding 7.50, balance 0`), write-off clears the rest and resets the debt clock, the
debtor drops out of the list, and every step is on the ledger. Fixture removed afterwards.

**A distinction worth writing down, because it caused the original question:** the account
that prompted this — `deployer@aiocean-test.com` — is *not* in receivables and should not be.
It is not in debt; it is spending prepaid credit. Receivables is the list of people who owe
money (pay-as-you-go debt). "A bill is accruing" and "this customer owes us" are different
things and this platform tracks them separately.

### Three bugs the screenshot exposed

Logged in full as **BUG-035/036/037**. In short:

1. **95% of the bill read "Other usage — not linked to a deployment"**, and the same
   deployment appeared twice. Ledger `referenceId` is a foreign-key-less string, so the id
   migration left historical rows pointing at ids that no longer resolve. Fixed by a data
   migration built from the mapping recovered out of the pre-drop backup: 80 → 4 affected
   ledger rows, 396 → 254 activity logs. This one was **caused by the id migration**, whose
   notes wrongly concluded nothing resolved those references.
2. **The spend table invented its numbers.** It divided cost by the *running* rate to get
   hours, so a machine that had run for zero hours that month was reported as "7.5 hours at
   USD 2.39/hr". It had really accrued 72.3 hours of storage at USD 0.246. Only the total was
   right.
3. **"Nothing is running right now" sat directly beside "0.25 USD/hr".** Both true; together,
   nonsense. The word "storage" appeared nowhere, while storage was costing USD 5.90/day.

### What billing shows now

`GET /customer/billing/usage` returns the month per deployment, split by what the charge was
for, straight from the `DeploymentUsage` rows the billing job writes — so the client infers
nothing and cannot drift from the server's answer.

- Each row states its charges in full: `Storage while stopped · 72.3h at USD 0.246/hr = USD 17.81`.
- Each row expands to a **day-by-day** breakdown.
- An explainer says what stopped deployments cost and how to stop paying for them.

One more thing surfaced while building the daily view: bucketing usage by the day a charge
*landed* put a 20-hour catch-up tick entirely on its end date, so one machine showed **29.0
hours in a single day**. Impossible on its face, and it reads as a billing error even though
the money is right. Ticks are now split across the days they actually cover, pro rata by
elapsed time — no day can exceed 24 hours, and every day still sums exactly to the
deployment total.

### Also fixed

`npm run test:api` left an `rbac_test_*@test.com` **admin account** behind on every run —
four had accumulated. Removed, and the suite now deletes its own RBAC fixtures (50/50).

**Verification:** 23/23 endpoints · 33/33 pages · 50/50 API tests · receivables 20/20 ·
184/184 files parse · lint 0 errors · wallets 4/4 reconcile · 8 users, 0 leftovers. Database
backed up before the data migration.
