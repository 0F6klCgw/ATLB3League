# ATL B3 Commander League — Project Plan

## 1. Purpose

This repo runs the web presence for the ATL B3 Commander League — an in-person Magic: The Gathering Commander (EDH) league that meets Mondays at Dice City. It serves three jobs now:

- **`index.html`** — the public landing page. Spectators and players use it to check standings, read the scoring rules, browse bonus goals, check commander win rates, and find the FAQ.
- **`formsubmission.html`** — the score-entry tool players use on their phone after a match to log placement and bonus points for up to three games in a night, signed in via Clerk.
- **`commanders.html`** — the Commander Dashboard, showing games-played/win-rate per commander (and partner pairing), computed live from submitted results.

The site is public and browsable by anyone; signing in (via Clerk) is only required to submit scores, which ties each submission to a real verified email rather than an honor-system name field.

## 2. Current Functionality

### 2.1 Public site (`index.html`)

- Shared sticky nav (see §2.4) with Standings / Scoring / Points Sheet / Points Deck / Commanders / FAQ links, plus the Submit Scores CTA.
- Hero with CTAs to the submission form and the three underlying Google Sheets.
- **Standings** — live table (name, rank, points, entries) with search, tie handling (`T-4` style shared ranks), and a highlighted top-12 cut line.
- **How Scoring Works** — a static three-step explainer (play → mark points → claim deck goals).
- **Points Sheet** — renders the scoring categories (Standard / Rotating / Bad Guy) with color-coded point badges, parsed from a Google Sheet.
- **Points Deck** — a searchable, filterable grid of claimable bonus goals (by point value and card-set theme, e.g. "Hobbit"), also parsed from a Google Sheet.
- **FAQ** — static accordion.
- Standings/Points Sheet/Points Deck still pull live from Google Sheets via a JSONP shim against the `gviz` endpoint (Google doesn't send CORS headers, so a script-tag injection is used instead of `fetch`). Each has a hardcoded fallback snapshot so the page still renders if Sheets is unreachable. **This part of the architecture is unchanged from before the D1/Clerk migration** — see §2.5.

### 2.2 Score submission (`formsubmission.html`)

- Gated behind Clerk sign-in: the form and footer stay hidden behind a sign-in prompt until a session exists; the nav always shows either a "Sign In" button or the signed-in user's profile popover.
- Player name, date, and commander/partner fields, with live Scryfall autocomplete (commander-legal cards only, ranked by EDHREC popularity) and card-image previews.
- Three game tabs, each with a placement selector and checkboxes for every scoring item (mirrors the Points Sheet categories) plus DQ flags.
- Running per-game and match-total scoring computed client-side for immediate feedback, but **the server recomputes and is authoritative** — see §2.5.
- On submit, the client attaches a Clerk session token and POSTs to `/api/submissions` (a Cloudflare Worker route), not to a database directly.

### 2.3 Commander Dashboard (`commanders.html`)

- Public, no sign-in required (consistent with the rest of the site's browse-vs-submit split).
- Fetches `/api/commanders`, which aggregates every submitted game in D1 by commander (or partner pairing, normalized so "A + B" and "B + A" merge into one identity regardless of which was recorded as primary).
- "Won" is defined as 1st-place placement, excluding DQ'd games.
- Search box and a min-games chip filter (All / 3+ / 5+ / 10+) to cut down noise from small sample sizes.
- Commander names link out to an exact-name Scryfall search rather than showing card-image thumbnails.

### 2.4 Shared infrastructure across all three pages

Design and behavior are consolidated into shared files so the three pages can't drift apart, rather than each page duplicating its own copy:

- **`theme.css`** — design tokens (colors, fonts, radius), and shared components: buttons, badges, the nav (including collapse/hamburger behavior's CSS), the WUBRG brand pips, search-toolbar/filter-chip/data-table styles.
- **`nav.js`** — the nav's scroll-collapse and hamburger-dropdown behavior.
- **`auth.js`** — loads Clerk, keeps the nav's user-button slot in sync with sign-in state (shows a "Sign In" button when signed out, the profile popover when signed in), and exposes an `initClerk(onRender)` hook that `formsubmission.html` uses to additionally gate its form content.
- The nav's brand mark (pips + "ATL B3") links back to `/` on every page.

### 2.5 Backend: Cloudflare Worker + D1

Score submissions moved off Supabase entirely onto Cloudflare's own stack:

- **Cloudflare D1** (`atlb3-league` database) holds `point_submissions` — one row per game played, including the authenticated submitter's email, commander/partner info, and every scoring flag. Schema (`schema.sql` + `migrations/`) enforces the same bounds as the Worker via `CHECK` constraints, as a second independent layer.
- **The Worker** (`src/index.js`, Cloudflare script `black-frost-89f6`) serves the static site via its `ASSETS` binding and handles two API routes:
  - `POST /api/submissions` — requires a valid Clerk session token (verified server-side via `@clerk/backend`, not trusted from a header); validates every field against the known scoring table (`POINT_VALUES`/`DQ_FLAGS`/`PLACEMENTS`) and **recomputes `game_total`/`dq` itself** rather than trusting the client.
  - `GET /api/commanders` — public, aggregates commander win/played stats (§2.3).
- **Identity**: Clerk (`pk_live_.../sk_live_...`, custom domain `clerk.redirectlightning.com`) handles sign-in. The Worker never trusts a client-asserted identity — it verifies the session token cryptographically and looks up the user's real email via Clerk's API before writing a submission.
- **Hosting**: Cloudflare Workers Builds, git-connected to this repo — pushes to `main` deploy to production; pushes to other branches build a preview (`*.workers.dev`) without touching production. Custom domain `redirectlightning.com` is attached directly to the Worker.

### 2.6 Data architecture — the still-unresolved gap

**Standings and score submissions are still two separate systems**, exactly as before the D1/Clerk migration — only the submission side changed (Supabase → D1 + Clerk), not the underlying disconnect:

- Standings/Points Sheet/Points Deck on `index.html` are read from Google Sheets, maintained by hand.
- Submissions from `formsubmission.html` land in D1's `point_submissions` table, which nothing on the public site reads from *except* the Commander Dashboard.

In practice this still means an admin is manually transcribing results (from D1, or paper, or memory) into the Google Sheet for standings to update. Now that submissions live in a real queryable database instead of a write-only intake table, computing standings directly from D1 is a much more natural next step than it used to be — see §4.1.

## 3. Tracked Issues

Current state as of this rewrite. Ordered by priority within open/closed.

### Open

- **[#3](https://github.com/0F6klCgw/ATLB3League/issues/3) — Placement badge parsing relies on a fragile regex against sheet text.** `index.html`'s `badgeFor()` infers the placement badge by regex-matching Google Sheet prose; unaffected by anything since, still applies.
- **[#4](https://github.com/0F6klCgw/ATLB3League/issues/4) — Scoring config is coupled across three files with no drift protection.** Originally a two-way coupling (client `SECTIONS` ↔ Supabase columns); now three-way: `formsubmission.html`'s `SECTIONS`, `src/index.js`'s `POINT_VALUES`/`DQ_FLAGS`, and `schema.sql`'s columns/`CHECK` constraints all have to agree.
- **[#5](https://github.com/0F6klCgw/ATLB3League/issues/5) — Test/seed data is polluting the live Commander Dashboard.** Migrated Supabase test rows plus ad hoc rows created while verifying the D1/Clerk migration show up as if they were real league results.
- **[#6](https://github.com/0F6klCgw/ATLB3League/issues/6) — Commander Dashboard's win definition is hardcoded and disconnected from the scoring config.** `placement === 4` is a second, independent hardcoding of the placement scale alongside #4's coupling.
- **[#7](https://github.com/0F6klCgw/ATLB3League/issues/7) — Page-specific style overrides can silently lose to `theme.css`'s shared base rules.** A CSS specificity gotcha that caused a real (fixed) bug — names/rank numbers were actually right-aligned in both the standings and commander tables despite page-specific `text-align` overrides, because the shared base rule had higher specificity. Flagged as a pattern worth double-checking elsewhere.
- **[#8](https://github.com/0F6klCgw/ATLB3League/issues/8) — No rate limiting on `/api/submissions` or `/api/commanders`.** Found during a pre-public-repo security audit; low risk at current traffic, tracked so it isn't forgotten once the repo is public.

### Closed

- **[#2](https://github.com/0F6klCgw/ATLB3League/issues/2) — Supabase `point_submissions` INSERT policy was fully unrestricted.** Closed as superseded — the entire Supabase write path was replaced by Clerk + D1 (§2.5), which closes the gap for real (server-side validation) rather than patching the old RLS policy.

## 4. Future Possible Additions

Refreshed from the original list — some items are now done, folded into what's built; the rest are still open menu items, not committed work.

### 4.1 Unify the scoring pipeline

**Now more tractable than before**: submissions live in a real queryable database (D1), not a write-only intake table.
- Decide the intended source of truth: keep Google Sheets as the standings source (status quo), or compute standings directly from `point_submissions` via a new `/api/standings` Worker route, removing the Google Sheets `gviz` JSONP workaround for that section entirely.
- Either way, [#5](https://github.com/0F6klCgw/ATLB3League/issues/5)'s test-data cleanup should happen before D1 numbers are trusted for anything player-facing beyond the Commander Dashboard.

### 4.2 Trust & moderation

- ~~Light identity check~~ — **done**: Clerk sign-in ties every submission to a real, verified email (`submitted_by_email`), closing the "anyone can submit under any name" gap.
- Still open: a lightweight admin view to list recent submissions, flag suspicious ones, approve/void — nothing like this exists yet; moderation currently means manually querying D1.
- Still open: an edit/void window letting a player correct their own recent submission.

### 4.3 Player experience

- ~~"Most played commander" leaderboard~~ — **done**: the Commander Dashboard (§2.3).
- Still open: per-player history page (past submissions, commanders played, week-over-week trend).
- Still open: submission confirmation beyond the toast; PWA/offline-tolerant submission queue for unreliable venue wifi.

### 4.4 League management

Unchanged — still open: multi-season support (today "Season 5" is just a heading label, not a data dimension), prize tracking, rules history (nothing records what the rules were on a given date).

### 4.5 Analytics

- Partially done: commander-level win-rate stats now exist (§2.3).
- Still open: season-over-season / week-over-week standings charts; fun side leaderboards (most Bad Guy points, most DQs, most draws) from data already tracked but not surfaced.

### 4.6 Technical foundation

- ~~Document the actual hosting/deploy path~~ — **done**: §2.5 above.
- Still open: no automated tests on any page despite meaningful parsing/validation logic (`parsePoints`, `parseDeck`, `parseStandings`, `validateRow`, the commander-aggregation logic).
- Partially done: the Worker now logs write failures server-side (`console.error`) instead of leaking raw D1 errors to the client, but there's still no structured telemetry/alerting beyond Cloudflare's own observability logs.

## 5. Open Questions

- Is `point_submissions` (D1) meant to become the real source of truth for standings, or stay Commander-Dashboard-only indefinitely? (§4.1)
- Who currently transcribes results into the Google Sheets, and how often — still true even after the D1 migration, since Standings didn't move.
- When should [#5](https://github.com/0F6klCgw/ATLB3League/issues/5)'s test data actually get cleaned out of production D1?

## 6. Related documents

If this app is ever offered to other leagues as a platform rather than a single-tenant tool, see [`MULTI_TENANCY_SCOPE.md`](MULTI_TENANCY_SCOPE.md) — a distinct, much larger initiative from the incremental items in §4 above.
