# ATL B3 Commander League — Project Plan

## 1. Purpose

This repo runs the web presence for the ATL B3 Commander League — an in-person Magic: The Gathering Commander (EDH) league that meets Mondays at Dice City. It serves five jobs now:

- **`index.html`** — the public landing page. Spectators and players use it to check standings, read the scoring rules, browse bonus goals, check commander win rates, and find the FAQ.
- **`formsubmission.html`** — the score-entry tool players use on their phone after a match to log placement and bonus points for up to three games in a night, signed in via Clerk.
- **`printsheet.html`** — a printable blank paper scoresheet for the table, generated live from the same scoring data the digital form uses, not Google Sheets.
- **`commanders.html`** — the Commander Dashboard, showing games-played/win-rate per commander (and partner pairing), computed live from submitted results.
- **`admin.html`** — the admin center: review/delete submissions, manage the Points Deck and scoring rules, view an audit trail of admin actions, and (super-admin only) manage who has admin access.

The site is public and browsable by anyone; signing in (via Clerk) is only required to submit scores or reach the admin center.

## 2. Current Functionality

### 2.1 Public site (`index.html`)

- Shared sticky nav (see §2.6) with Standings / Scoring / Points Sheet / Points Deck / Commanders / FAQ links, plus the Submit Scores CTA.
- Hero with CTAs to the submission form and the underlying Google Sheets that still back Standings.
- **Standings** — live table (name, rank, points, entries) with search, tie handling (`T-4` style shared ranks), and a highlighted top-12 cut line. Still Google-Sheets-backed — see §2.8.
- **How Scoring Works** — a static three-step explainer (play → mark points → claim deck goals).
- **Points Sheet** — renders the scoring categories (Standard / Rotating / Bad Guy) with color-coded point badges, parsed from a Google Sheet. Still Sheets-backed (issue #3) — this is a different thing from the *printable* Points Sheet (§2.4), which is D1-backed.
- **Points Deck** — a searchable, filterable grid of claimable bonus goals (by point value and card-set theme, e.g. "Hobbit"). **Now D1-backed** (`GET /api/deck`), not Google Sheets — migrated so it could become admin-editable (§2.5).
- **FAQ** — static accordion.
- Standings/Points Sheet still pull live from Google Sheets via a JSONP shim against the `gviz` endpoint (Google doesn't send CORS headers, so a script-tag injection is used instead of `fetch`), with a hardcoded fallback snapshot if Sheets is unreachable. **This part of the architecture is unchanged** — see §2.8.

### 2.2 Score submission (`formsubmission.html`)

- Gated behind Clerk sign-in: the form and footer stay hidden behind a sign-in prompt until a session exists; the nav always shows either a "Sign In" button or the signed-in user's profile popover.
- Player name, date, and commander/partner fields, with live Scryfall autocomplete (commander-legal cards only, ranked by EDHREC popularity) and card-image previews.
  - Two bugs fixed here recently: a failed Scryfall image load used to render the browser's raw broken-image glyph overflowing the card (now hides gracefully instead); and a CSS specificity conflict between the shared `.hidden` utility and this page's own `.cmdr-card` rule meant the preview cards were never actually hidden at all, regardless of whether anything had been picked (same category of bug as issue #7, now fixed for this pair of selectors too).
- Three game tabs, each with a placement selector and checkboxes for every scoring item plus DQ flags. **The scoring items themselves are now fetched live from `GET /api/scoring`** (D1), not a hardcoded constant — see §2.7. Placement stays a fixed structural concept, not D1-backed (see §5).
- Running per-game and match-total scoring computed client-side for immediate feedback, but **the server recomputes and is authoritative** — see §2.7.
- On submit, the client sends which scoring item IDs were checked (never a point value) and POSTs to `/api/submissions`, which resolves and validates everything server-side against the live `scoring_items` table.
- Links to `printsheet.html` ("Print a blank paper copy") for players who want a physical sheet at the table.
- One commander/partner is recorded for the whole night's submission, not per game — see issue #9 for the gap this creates against what the paper sheet now supports.

### 2.3 Commander Dashboard (`commanders.html`)

- Public, no sign-in required (consistent with the rest of the site's browse-vs-submit split).
- Fetches `/api/commanders`, which aggregates every submitted game in D1 by commander (or partner pairing, normalized so "A + B" and "B + A" merge into one identity regardless of which was recorded as primary).
- "Won" is defined as 1st-place placement, excluding DQ'd games — still a hardcoded assumption in the Worker, unconnected to any config (issue #6).
- Search box and a min-games chip filter (All / 3+ / 5+ / 10+) to cut down noise from small sample sizes.
- Commander names link out to an exact-name Scryfall search rather than showing card-image thumbnails.

### 2.4 Printable Points Sheet (`printsheet.html`)

New page: a blank paper scoresheet for players who want to mark points by hand at the table instead of (or in addition to) using the phone form, without needing Google Sheets at all.

- Renders the same placement + Standard/Rotating/Bad Guy categories as the digital form, fetched from the same `GET /api/scoring` — so the paper copy and the digital form can never drift apart, and both stay current automatically whenever an admin edits the rules (§2.5).
- **Auto-fits to one printed page.** Scoring items are admin-editable now, so the item count isn't fixed; the page measures its own real rendered height after the scoring data loads and shrinks font-size/padding/checkbox-size (via a `--fit` CSS custom property) until it fits one Letter page, down to a readable floor. If it still doesn't fit even at that floor, a visible warning says so rather than silently printing a surprise second page.
- The on-screen preview matches print pixel-for-pixel — its content width is fixed to exactly the printed page's actual content area (Letter width minus `@page` margins), so the height the auto-fit logic measures on screen is the real print height, not an approximation.
- A "Commander played (+ partner/background)" section with one row split into equal G1/G2/G3 thirds, each a full-width write-in line — since players can legitimately switch commanders between games, which the digital form doesn't yet support recording (issue #9).
- No sign-in required.

### 2.5 Admin Center (`admin.html`)

New page: gated behind Clerk sign-in and `publicMetadata.role === "admin"` (or `"super_admin"`, which is a strict superset). Five tabs:

- **Submissions** — lists every submitted game, with search and a delete action (with confirm) for cleaning up test/junk rows.
- **Points Deck** — add, inline-edit, and delete claimable bonus-goal cards. Replaces hand-editing the Google Sheet.
- **Scoring** — add, edit, and delete scoring categories and individual scoring items (point value, description, DQ flag). This is the same data `GET /api/scoring` serves to the digital form and the paper sheet — editing here is what makes the league's actual rules admin-editable without a code deploy, closing the gap issue #4 used to track.
- **Audit Log** — every admin mutation (submission delete; Points Deck/Scoring category/item create/update/delete; user role change) is logged with who, when, what action, and a JSON snapshot of the affected data (before/after for edits) — so a mistaken change is at least recoverable by hand even though the underlying row is gone.
- **Users** — **super-admin only**, hidden from regular admins (the tab itself is conditionally shown client-side, and the backing routes reject non-super-admins server-side regardless of what the client shows). Lists every Clerk user account and lets a super admin promote/demote roles (User / Admin / Super Admin). A super admin can't demote their own account, so there's no way to lock everyone out short of going into the Clerk dashboard by hand.

Admin and super-admin status live entirely in Clerk's `publicMetadata.role` (set via the Clerk dashboard or Backend API) — there's no local `users` table, and adding/removing an admin needs no code change or deploy.

### 2.6 Shared infrastructure across all pages

Design and behavior are consolidated into shared files so the pages can't drift apart, rather than each page duplicating its own copy:

- **`theme.css`** — design tokens (colors, fonts, radius), and shared components: buttons, badges, the nav (including collapse/hamburger behavior's CSS), the WUBRG brand pips, search-toolbar/filter-chip/data-table/status/hidden utility styles.
- **`nav.js`** — the nav's scroll-collapse and hamburger-dropdown behavior.
- **`auth.js`** — loads Clerk, keeps the nav's user-button slot in sync with sign-in state (shows a "Sign In" button when signed out, the profile popover when signed in), dynamically injects an "Admin" nav link for admin/super-admin users, and exposes an `initClerk(onRender)` hook that other pages use to additionally gate their own content.
- **`scoring-data.js`** — now holds only `PLACEMENTS` and `GAMES` (the fixed structural constants); the actual scoring categories/items are D1-backed (§2.7), not in this file anymore.
- The nav's brand mark (pips + "ATL B3") links back to `/` on every page.

### 2.7 Backend: Cloudflare Worker + D1

- **Cloudflare D1** (`atlb3-league` database) tables:
  - `point_submissions` — one row per game played: submitter's authenticated email, commander/partner, placement, `game_total`/`dq`. Its original ~24 per-scoring-item columns (one column per point, each with a `CHECK` constraint) are **left frozen** as a historical record of everything submitted before the scoring-in-D1 migration — new rows don't write to them, and nothing downstream ever read them individually (only the aggregate `game_total`/`dq`), so nothing broke by leaving them in place rather than migrating or dropping them.
  - `submission_points` — replaces those frozen columns going forward: one row per point (or DQ) a player actually earned in a game, referencing the `scoring_items` row it came from and snapshotting that item's description at submit time, so editing or deleting a scoring item later never rewrites history.
  - `scoring_categories` / `scoring_items` — the admin-editable scoring rules (§2.5), replacing the old hardcoded `POINT_VALUES`/`DQ_FLAGS` JS constants.
  - `points_deck` — the admin-editable Points Deck cards, replacing the Google Sheet.
  - `admin_audit_log` — every admin mutation, as described in §2.5.
- **The Worker** (`src/index.js`, Cloudflare script `black-frost-89f6`) serves the static site via its `ASSETS` binding and handles these API routes:
  - `POST /api/submissions` — requires a valid Clerk session; validates each submitted scoring-item ID against the live `scoring_items` table (never trusting a client-claimed point value) and **recomputes `game_total`/`dq` itself**.
  - `GET /api/commanders`, `GET /api/scoring`, `GET /api/deck` — public, no auth.
  - `GET/DELETE /api/admin/submissions`, `GET /api/admin/audit-log`, `POST/PUT/DELETE /api/admin/deck`, `POST/PUT/DELETE /api/admin/scoring/categories`, `POST/PUT/DELETE /api/admin/scoring/items` — require a valid Clerk session with `publicMetadata.role` of `admin` or `super_admin`.
  - `GET /api/admin/users`, `PUT /api/admin/users/:id/role` — require `super_admin` specifically; talk directly to Clerk's Backend API (there's no local users table).
  - Scoring items being admin-editable means D1 can no longer statically `CHECK` each one's exact value the way the old fixed columns did — the Worker (validated against the live `scoring_items` table at request time) is the authority for scoring now, with `submission_points`' `CHECK` as a coarser sanity bound rather than an exact-value constraint.
- **Identity**: Clerk (`pk_live_.../sk_live_...`, custom domain `clerk.redirectlightning.com`) handles sign-in. The Worker never trusts a client-asserted identity — it verifies the session token cryptographically and looks up the user's real email/role via Clerk's API.
- **Hosting**: Cloudflare Workers Builds, git-connected to this repo — pushes to `main` deploy to production; pushes to other branches build a preview (`*.workers.dev`) without touching production. Custom domain `redirectlightning.com` is attached directly to the Worker.

### 2.8 Data architecture — the still-unresolved gap

**Standings and score submissions are still two separate systems:**

- Standings and the home page's rules-explanation Points Sheet on `index.html` are read from Google Sheets, maintained by hand.
- Submissions from `formsubmission.html` land in D1, which the Commander Dashboard and admin center read from, but the public Standings table does not.

In practice this still means an admin is manually transcribing results into the Google Sheet for standings to update. The scoring-*rules* migration (§2.5/§2.7) proves the same pattern (move hardcoded/Sheets-sourced data into D1, backed by a real admin UI) works well in this codebase — computing standings directly from D1 is now a well-precedented next step, not just a theoretical one, though it's a different question (aggregating actual results vs. serving rule configuration) — see §4.1.

## 3. Tracked Issues

Current state as of this rewrite. Ordered by priority within open/closed.

### Open

- **[#3](https://github.com/0F6klCgw/ATLB3League/issues/3) — Placement badge parsing relies on a fragile regex against sheet text.** `index.html`'s `badgeFor()` infers the placement badge by regex-matching Google Sheet prose; unaffected by anything since, still applies.
- **[#5](https://github.com/0F6klCgw/ATLB3League/issues/5) — Test/seed data is polluting the live Commander Dashboard.** Migrated Supabase test rows plus ad hoc rows created while verifying earlier migrations show up as if they were real league results.
- **[#6](https://github.com/0F6klCgw/ATLB3League/issues/6) — Commander Dashboard's win definition is hardcoded and disconnected from the scoring config.** Scoring *points* moved into D1 and are admin-editable now (closing #4), but placement — what defines a "win" — deliberately stayed a hardcoded constant, structurally tied to `point_submissions.placement`. `handleCommanders()`'s `placement === 4` check is now the one remaining hardcoded scoring assumption in the Worker.
- **[#7](https://github.com/0F6klCgw/ATLB3League/issues/7) — Page-specific style overrides can silently lose to `theme.css`'s shared base rules (CSS specificity).** Hit this exact pattern a second time: `formsubmission.html`'s `.cmdr-card` was silently beating the shared `.hidden` utility, keeping the commander/partner preview cards visible no matter what. Fixed the same way as the original occurrence (raise the override's specificity), but now confirmed as a recurring footgun worth actively watching for.
- **[#8](https://github.com/0F6klCgw/ATLB3League/issues/8) — No rate limiting on any public API route.** Scope has grown: `GET /api/scoring` and `GET /api/deck` are now also public, unauthenticated, unrate-limited routes alongside the original `/api/submissions`/`/api/commanders`. Still low risk at current traffic.
- **[#9](https://github.com/0F6klCgw/ATLB3League/issues/9) — `formsubmission.html` can't record a different commander per game.** New: surfaced while building the printable sheet's per-game commander lines. Players can legitimately switch decks between games (per the site's own FAQ), and the paper sheet now supports noting that, but the digital form (and therefore the Commander Dashboard's aggregated stats) only tracks one commander per whole-night submission.

### Closed

- **[#2](https://github.com/0F6klCgw/ATLB3League/issues/2) — Supabase `point_submissions` INSERT policy was fully unrestricted.** Closed as superseded — the entire Supabase write path was replaced by Clerk + D1, which closes the gap for real (server-side validation) rather than patching the old RLS policy.
- **[#4](https://github.com/0F6klCgw/ATLB3League/issues/4) — Scoring config was coupled across three files with no drift protection.** Closed — scoring categories/items now live in D1 as the single source of truth (`GET /api/scoring`), admin-editable from `admin.html`'s Scoring tab. `POINT_VALUES`/`DQ_FLAGS` and the static `SECTIONS` constant are gone from the codebase entirely.

## 4. Future Possible Additions

Refreshed from the previous list — some items are now done, folded into what's built; the rest are still open menu items, not committed work.

### 4.1 Unify the scoring pipeline

- Decide the intended source of truth: keep Google Sheets as the standings source (status quo), or compute standings directly from `point_submissions`/`submission_points` via a new `/api/standings` Worker route, removing the Google Sheets `gviz` JSONP workaround for that section entirely.
- Either way, [#5](https://github.com/0F6klCgw/ATLB3League/issues/5)'s test-data cleanup should happen before D1 numbers are trusted for anything player-facing beyond the Commander Dashboard.

### 4.2 Trust & moderation

- ~~Light identity check~~ — **done**: Clerk sign-in ties every submission to a real, verified email.
- ~~Admin view to list/moderate submissions~~ — **done**: `admin.html`'s Submissions tab.
- ~~Audit trail of admin actions~~ — **done**: `admin_audit_log`, surfaced on the Audit Log tab.
- ~~Admin role management~~ — **done**: super-admin can promote/demote admins from the Users tab, no code deploy needed.
- Still open: an edit/void window letting a player correct their own recent submission (as opposed to only an admin being able to delete it).

### 4.3 Player experience

- ~~"Most played commander" leaderboard~~ — **done**: the Commander Dashboard (§2.3).
- ~~Printable paper scoresheet~~ — **done**: `printsheet.html` (§2.4).
- Still open: per-player history page (past submissions, commanders played, week-over-week trend).
- Still open: submission confirmation beyond the toast; PWA/offline-tolerant submission queue for unreliable venue wifi.
- Still open: per-game commander tracking in the digital form, matching what the paper sheet now supports ([#9](https://github.com/0F6klCgw/ATLB3League/issues/9)).

### 4.4 League management

- ~~Points Deck management~~ — **done**: `admin.html`'s Points Deck tab, D1-backed instead of a Google Sheet.
- ~~Scoring rules management~~ — **done**: `admin.html`'s Scoring tab.
- Still open: multi-season support (today "Season 5" is just a heading label, not a data dimension), prize tracking, rules history (nothing records what the rules *were* on a given date — editing a scoring item's value today doesn't retroactively affect past submissions, since points are snapshotted at submit time, but there's no browsable "here's what changed and when" view either).

### 4.5 Analytics

- Partially done: commander-level win-rate stats now exist (§2.3).
- Still open: season-over-season / week-over-week standings charts; fun side leaderboards (most Bad Guy points, most DQs, most draws) from data already tracked but not surfaced.

### 4.6 Technical foundation

- ~~Document the actual hosting/deploy path~~ — **done**: §2.7 above.
- Still open: no automated tests on any page despite meaningful parsing/validation logic (`parsePoints`, `parseStandings`, `validateRow`, the commander-aggregation logic).
- Partially done: the Worker logs write failures server-side instead of leaking raw D1 errors to the client; still no structured telemetry/alerting beyond Cloudflare's own observability logs.

## 5. Open Questions

- Is `point_submissions`/`submission_points` (D1) meant to become the real source of truth for standings, or stay Commander-Dashboard-only indefinitely? (§4.1)
- Should `PLACEMENTS` also move into D1 for full admin-editability, matching what happened to scoring points? It's a smaller, more structurally sensitive change (tied to `point_submissions.placement`'s `CHECK` constraint and `game_total` math) — worth scoping deliberately rather than folding in casually.
- Should the digital form support per-game commander/partner tracking, matching what the paper sheet now offers ([#9](https://github.com/0F6klCgw/ATLB3League/issues/9))?
- Who currently transcribes results into the Google Sheets, and how often?
- When should [#5](https://github.com/0F6klCgw/ATLB3League/issues/5)'s test data actually get cleaned out of production D1?

## 6. Related documents

If this app is ever offered to other leagues as a platform rather than a single-tenant tool, see [`MULTI_TENANCY_SCOPE.md`](MULTI_TENANCY_SCOPE.md) — a distinct, much larger initiative from the incremental items in §4 above. The scoring-in-D1 migration (§2.5/§2.7) directly informs that document's §4 and §6, both updated alongside this rewrite.
