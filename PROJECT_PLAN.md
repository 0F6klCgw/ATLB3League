# Project Plan — Code Review Fixes

Scope: the three issues filed from the 2026-07-31 code review (#2, #3, #4). Ordered by priority.

## 1. Lock down `point_submissions` INSERT policy — [#2](https://github.com/0F6klCgw/ATLB3League/issues/2)

**Priority:** High — the table currently accepts unrestricted writes from anyone with the publishable key.

- [ ] Add `CHECK` constraints bounding `game_total`, `placement`, and the per-item point columns to realistic ranges.
- [ ] Decide whether score validation should move server-side (a Postgres function/trigger recomputing `game_total` from the submitted flags) rather than trusting the client.
- [ ] Re-run the Supabase security advisor to confirm the `rls_policy_always_true` warning clears.

## 2. Replace the placement-badge regex heuristic — [#3](https://github.com/0F6klCgw/ATLB3League/issues/3)

**Priority:** Low — cosmetic, but fails silently.

- [ ] Add a dedicated marker for the placement row (sentinel value or separate column) instead of regex-matching the sheet's prose in `badgeFor()`.
- [ ] Update the Google Sheet to populate the new marker.
- [ ] Remove the regex fallback once the marker is in place.

## 3. Guard against `SECTIONS` / Supabase column drift — [#4](https://github.com/0F6klCgw/ATLB3League/issues/4)

**Priority:** Low — no active bug, but a future edit will break submissions silently.

- [ ] Add a startup assertion in `formsubmission.html` comparing `SECTIONS` item keys against a known column list, so a mismatch fails loudly.
- [ ] Document the coupling (e.g. a comment at the top of `SECTIONS`) so a schema change on either side prompts an update to the other.

## Out of scope

Broader feature work on the league site (new sections, standings logic, etc.) is not covered here — this plan only tracks the review findings above.
