# ATL B3 Commander League — Project Plan

## 1. Purpose

This repo runs the web presence for the ATL B3 Commander League — an in-person Magic: The Gathering Commander (EDH) league that meets Mondays at Dice City. It serves two distinct jobs:

- **`index.html`** — the public landing page. Spectators and players use it to check standings, read the scoring rules, browse bonus goals, and find the FAQ.
- **`formsubmission.html`** — the score-entry tool players use on their phone after a match to log placement and bonus points for up to three games in a night.

There is no login system, no admin panel, and no backend service beyond Google Sheets (read-only, hand-maintained) and Supabase (write-only intake). This is a small, low-traffic community tool, not a product — the plan below should be read with that scale in mind.

## 2. Current Functionality

### 2.1 Public site (`index.html`)

- Sticky nav that collapses into a hamburger menu on scroll/narrow screens.
- Hero with CTAs to the submission form and the three underlying Google Sheets.
- **Standings** — live table (name, rank, points, entries) with search, tie handling (`T-4` style shared ranks), and a highlighted top-12 cut line.
- **How Scoring Works** — a static three-step explainer (play → mark points → claim deck goals).
- **Points Sheet** — renders the scoring categories (Standard / Rotating / Bad Guy) with color-coded point badges, parsed from a Google Sheet.
- **Points Deck** — a searchable, filterable grid of claimable bonus goals (by point value and card-set theme, e.g. "Hobbit"), also parsed from a Google Sheet.
- **FAQ** — static accordion.
- All three data sections pull live from Google Sheets via a JSONP shim against the `gviz` endpoint (Google doesn't send CORS headers, so a script-tag injection is used instead of `fetch`). Each has a hardcoded fallback snapshot so the page still renders if Sheets is unreachable.

### 2.2 Score submission (`formsubmission.html`)

- Player name, date, and commander/partner fields, with live Scryfall autocomplete (commander-legal cards only, ranked by EDHREC popularity) and card-image previews.
- Three game tabs, each with a placement selector and checkboxes for every scoring item (mirrors the Points Sheet categories) plus DQ flags.
- Running per-game and match-total scoring computed client-side.
- On submit, writes one row per played game directly to the Supabase `point_submissions` table via the REST API, using a public/publishable key.

### 2.3 Data architecture — important gap

**The submission form and the public standings are not connected.** Standings on `index.html` are read from a Google Sheet that appears to be maintained by hand; submissions from `formsubmission.html` land in a separate Supabase table that nothing on the site currently reads from. In practice this means either:

- an admin is manually transcribing Supabase submissions (or paper score sheets) into the Google Sheet, or
- the Supabase table is a newer addition not yet wired into the standings pipeline.

This is worth resolving explicitly — see [§4.1](#41-unify-the-scoring-pipeline) below — since it affects how much the RLS/validation work in §3 actually matters in practice.

### 2.4 Hosting & deployment

Not documented in-repo: no CI config, no `netlify.toml`/`vercel.json`/`_redirects`, and GitHub Pages is not enabled on this repo. `index.html` links to `/formsubmission` (no `.html`), which implies whatever host serves this handles clean URLs automatically or via a dashboard setting outside version control. Worth writing down wherever it's actually deployed, so it isn't tribal knowledge.

## 3. Tracked Review Issues

Filed from the 2026-07-31 code review. Ordered by priority.

### 3.1 Lock down `point_submissions` INSERT policy — [#2](https://github.com/0F6klCgw/ATLB3League/issues/2)

**Priority:** High — the table currently accepts unrestricted writes from anyone with the publishable key.

- [ ] Add `CHECK` constraints bounding `game_total`, `placement`, and the per-item point columns to realistic ranges.
- [ ] Decide whether score validation should move server-side (a Postgres function/trigger recomputing `game_total` from the submitted flags) rather than trusting the client.
- [ ] Re-run the Supabase security advisor to confirm the `rls_policy_always_true` warning clears.

### 3.2 Replace the placement-badge regex heuristic — [#3](https://github.com/0F6klCgw/ATLB3League/issues/3)

**Priority:** Low — cosmetic, but fails silently.

- [ ] Add a dedicated marker for the placement row (sentinel value or separate column) instead of regex-matching the sheet's prose in `badgeFor()`.
- [ ] Update the Google Sheet to populate the new marker.
- [ ] Remove the regex fallback once the marker is in place.

### 3.3 Guard against `SECTIONS` / Supabase column drift — [#4](https://github.com/0F6klCgw/ATLB3League/issues/4)

**Priority:** Low — no active bug, but a future edit will break submissions silently.

- [ ] Add a startup assertion in `formsubmission.html` comparing `SECTIONS` item keys against a known column list, so a mismatch fails loudly.
- [ ] Document the coupling (e.g. a comment at the top of `SECTIONS`) so a schema change on either side prompts an update to the other.

## 4. Future Possible Additions

Grouped by theme, roughly in order of how much they'd change the app's shape. None of this is committed work — it's a menu to pick from.

### 4.1 Unify the scoring pipeline

- Decide the intended source of truth: keep Google Sheets as the standings source and build an admin review step that approves Supabase submissions before an organizer copies them over, **or** retire the manual Sheet and compute standings directly from `point_submissions` (a Supabase view or scheduled function).
- If Supabase becomes the source of truth, standings on `index.html` would query it directly instead of the `gviz` JSONP hack — simpler and removes the Google-CORS workaround entirely.
- Either way, give submissions a status field (`pending` / `approved` / `rejected`) so bad data doesn't silently count.

### 4.2 Trust & moderation

- Lightweight admin view: list recent submissions, flag suspicious ones (e.g. `game_total` far outside normal range), approve/void.
- Optional light identity check (a shared league PIN, or per-player codes) so submissions can't be trivially spoofed under someone else's name.
- Edit/void window: let a player correct their own submission shortly after sending it, rather than it being permanent immediately.

### 4.3 Player experience

- Per-player history page: past submissions, commanders played, week-over-week point trend.
- "Most played commander" / commander stats leaderboard — the data (Scryfall IDs, images) is already being captured but not surfaced anywhere.
- Submission confirmation beyond the toast (e.g. a persisted "your last submission" summary) in case of a page refresh mid-flow.
- PWA basics (installable, offline-tolerant submission queue) since venue wifi may be unreliable — the form already fails gracefully, but a queued-retry would be friendlier than a toast error.

### 4.4 League management

- Multi-season support — "Season 5" is currently just a label in a heading, not a real dimension in the data model.
- Prize tracking (the FAQ already lists this as "TBD").
- Rules history — the Points Sheet/Points Deck already say they "change regularly"; nothing currently records what the rules were on a given date, which matters for disputes later.

### 4.5 Analytics

- Season-over-season and week-over-week standings charts.
- Fun/side leaderboards (most Bad Guy points, most DQs, most draws) — same data already tracked, just not aggregated for this.

### 4.6 Technical foundation

- No automated tests on either page today; given the amount of parsing logic (`parsePoints`, `parseDeck`, `parseStandings`), even a few snapshot tests against sample sheet exports would catch silent breakage from a sheet reformat.
- Document the actual hosting/deploy path (see §2.4).
- Consider basic error/telemetry capture on the submission form beyond `console.error`, so a run of failed submissions doesn't go unnoticed.

## 5. Open Questions

Worth settling before picking items from §4:

- Is `point_submissions` meant to become the real source of truth for standings, or stay a manual-review intake log indefinitely?
- Who currently transcribes scores into the Google Sheets, and how often?
- Where is this actually hosted/deployed?
- Is there an appetite for player accounts/identity at all, or should this stay a no-login honor-system tool?

## 6. Note on scope drift

This document is now out of date relative to the live app — since it was written, the site moved off Supabase onto Cloudflare Workers + D1 (closing #2), added Clerk-based identity, unified the nav, and added a Commander Dashboard. It's kept as-is here as a historical snapshot of the original review; a refresh covering the current architecture would be a reasonable follow-up.

Separately, if this app is ever offered to other leagues as a platform rather than a single-tenant tool, see [`MULTI_TENANCY_SCOPE.md`](MULTI_TENANCY_SCOPE.md) — that's a distinct, much larger initiative from the incremental items in §4 above.
