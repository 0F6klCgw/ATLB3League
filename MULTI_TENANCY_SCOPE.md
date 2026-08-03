# Multi-Tenant SaaS — Project Scope

Speculative scope for turning this single-league app into a platform that hosts multiple Commander leagues, each with its own scoring rules, branding, and membership, managed from one place. Nothing here is committed work — this is the scoping pass to make before committing to it.

## 1. Why this document exists

The current app (`redirectlightning.com`) is built for exactly one league: one Cloudflare Worker, one D1 database, one Clerk instance, hardcoded scoring rules and branding. If ATL B3 proves this is worth offering to other leagues, "copy the codebase per customer" was considered and rejected — it can't support **platform management from within the platform** (one dashboard to create/manage every league), which is the actual goal. That means real multi-tenancy, which is a bigger lift than it first looks, concentrated in a few specific places. This document scopes those places out.

## 2. The decision everything else depends on: how tenants share infrastructure

This has to be resolved first — the schema design, the admin UI's "create a league" flow, and the cost model all depend on it.

**The constraint:** Cloudflare Worker bindings (D1, KV, etc.) are declared statically in `wrangler.jsonc` at deploy time. A Worker cannot dynamically bind to an arbitrary D1 database at runtime based on the incoming request. This isn't a workaround-able gap — it's confirmed by Cloudflare's own community/discussion threads, and there's a documented real-world case of a company building exactly this (database-per-tenant on D1) that hit this wall at ~400 tenants and had to hardcode a subset of tenants into their Worker because they couldn't bind them all.

Three real options, in order of how much they fight that constraint:

### Option A — Shared D1 database, `league_id` on every table
The classic multi-tenant SaaS pattern. One database, every table gets a `league_id` column, every query filters on it.
- ✅ Scales to any number of leagues with zero redeploys to onboard one.
- ✅ Simplest cost model (one database).
- ⚠️ Real isolation risk: a single query missing its `WHERE league_id = ?` clause leaks one league's data into another's view. Needs to be mitigated by process (a query-builder/ORM layer that injects the filter automatically, never hand-written raw SQL touching tenant tables) rather than trusted to code review alone.

### Option B — One D1 database per league, native bindings, provisioning = a deploy
Keep today's clean-isolation model (one league, one database), but make "add a league" trigger an automated pipeline that regenerates `wrangler.jsonc` with the new binding and redeploys.
- ✅ True data isolation — no shared table, no possible cross-tenant query bug.
- ✅ Matches the architecture already proven out for ATL B3.
- ⚠️ "Creating a league" becomes a CI/CD event (maybe a minute or two of provisioning latency), not instant. Fine at dozens-to-low-hundreds of leagues; this is the exact pattern that broke down for the company referenced above once they hit ~400+ tenants trying to bind them all natively.

### Option C — One D1 database per league, accessed via Cloudflare's D1 REST API instead of a binding
Same per-tenant database isolation as B, but the Worker looks up which database ID belongs to the requested hostname (from a small control-plane table) and queries it over Cloudflare's HTTP API using an account-scoped API token, instead of a native binding.
- ✅ True data isolation, and no redeploy needed to onboard a league — provisioning can be instant.
- ⚠️ Slower per request (an HTTP round-trip to Cloudflare's control plane instead of the internal binding RPC) and a different rate-limit/cost profile worth load-testing before committing.

**Recommendation:** start with **Option B**. It's the smallest step from what already exists (ATL B3 becomes "tenant #1" with no schema rework), the isolation guarantee is the strongest, and the "provisioning is a deploy" limitation is a non-issue until well past the number of leagues this is likely to have in year one. Revisit Option C if/when onboarding speed or tenant count makes B's redeploy step a real bottleneck. Option A is the fallback if per-tenant database sprawl ever becomes an operational problem of its own.

**This needs a validation spike before being treated as decided** — confirm current D1 per-account database limits and Workers Builds' ability to redeploy on demand (e.g. via the Cloudflare API, similar to how this session drove deploys manually) actually support an automated "provision a league" pipeline.

## 3. Identity & access: Clerk Organizations

Clerk has a built-in **Organizations** feature that maps naturally onto "one league = one org":
- A user can belong to multiple orgs (playing in more than one league), each with its own role (player vs league admin).
- Clerk's session token carries active-org context, so the Worker can check not just "is this person signed in" but "is this person a member of *this* league's org" before accepting a submission — closing a gap the current single-tenant app doesn't need to worry about.
- A platform-level super-admin role (you, managing every league) needs its own mechanism — likely a dedicated admin org or Clerk metadata flag, separate from any single league's membership.

This needs a spike too: confirm Organizations' current pricing/limits at the Clerk plan tier this would run on, and how org-scoped tokens actually flow through to `verifyToken()` in the Worker.

## 4. Configurable scoring engine

This is the single biggest product-design lift, bigger than the infrastructure work above. Today, `POINT_VALUES`, `DQ_FLAGS`, `PLACEMENTS`, and `SECTIONS` are hardcoded JS constants specific to ATL B3's house rules, duplicated across `formsubmission.html`, `src/index.js`, and `schema.sql` (already tracked as a drift risk in [#4](https://github.com/0F6klCgw/ATLB3League/issues/4)).

For multi-tenancy, these need to become **per-league data**, not code:
- A scoring-rules schema flexible enough to express ATL B3's actual rules (three tiers — Standard/Rotating/Bad Guy — fixed point values, a 4-tier placement scale) *and* plausibly different house rules another league might run (different tiers, different point values, maybe no "Bad Guy" concept at all, a different placement scale).
- The Worker's validation (`validateRow`) changes from "check against the one hardcoded `POINT_VALUES`" to "look up this league's rules, validate against those" — same authoritative-server-side principle as today, just data-driven instead of constant-driven.
- The Commander Dashboard's win definition ([#6](https://github.com/0F6klCgw/ATLB3League/issues/6), `placement === 4`) folds into this same effort — "what counts as a win" becomes part of a league's configured rules instead of a second hardcoded assumption.
- Risk to manage deliberately: don't over-build a generic rules DSL before seeing a second real league's actual house rules. Design against ATL B3 plus at least one other concrete example, not an imagined abstraction.

## 5. Configurable branding

`theme.css`'s color tokens, the WUBRG pip brand mark, fonts, and the "ATL B3" nav text are all hardcoded. A second tenant needs at least:
- Per-league color tokens (the `:root` custom properties in `theme.css` becoming per-league values rather than fixed).
- Per-league nav text/logo in place of the pips + "ATL B3" wordmark.
- Open question: is the WUBRG five-color pip mark an ATL-B3-specific flourish, or core to every tenant (since this is explicitly a *Commander* league platform)? Worth deciding whether v1 targets Commander leagues specifically (keep the Magic-flavored branding as a platform constant) or aims broader (make even that configurable/removable).

Mechanically, the simplest approach: the Worker reads the requesting league's theme config and inlines the resulting `<style>` block server-side before serving the page, rather than a client-side fetch-and-repaint that would flash the wrong colors first.

## 6. Platform admin surface

The actual "manage from within the platform" deliverable — today there is no admin UI at all; management happens by hand-editing files and running SQL directly. This is realistically its own application, arguably larger than the current player-facing site:
- League creation flow (name, subdomain/custom domain, initial scoring rules, branding).
- Scoring-rules editor (CRUD over the config from §4).
- Membership management (invite players, assign league-admin roles) — layers on top of Clerk Organizations from §3.
- Submission moderation (review/void submissions, the trust/moderation gap already tracked in the original `PROJECT_PLAN.md` §4.2) — more important here than for a single hobby league, since a platform operator can't personally eyeball every league's data the way this session did for ATL B3.
- Billing/subscription management, if this is monetized (a Stripe integration, most likely).

## 7. Domain/DNS strategy

Two models, not mutually exclusive:
- **Shared-domain subdomains** (`leaguename.yourplatform.com`) — instant provisioning, no per-customer domain purchase or DNS handoff needed. Natural default/free tier.
- **Custom domains per league** (what ATL B3 has today, `redirectlightning.com`) — nicer for a paying customer's own brand, but needs Cloudflare's **Cloudflare for SaaS** product (automated custom-hostname provisioning + SSL for platforms that host many customer domains behind one Worker) rather than the manual custom-domain attach done for ATL B3 in this session. Worth a research spike alongside §2 — this is the same "many tenants, one Worker" problem applied to routing instead of data.

## 8. Migrating ATL B3 into the new model

Whatever shape §2 lands on, ATL B3 becomes the first tenant, not a special case:
- Its D1 data (already isolated in its own database) becomes "league #1" under Option B with no data migration needed — it already *is* a per-tenant database.
- Its hardcoded scoring rules (§4) and branding (§5) get extracted into the new config format as the reference example the multi-tenant schema is designed against.
- Its Clerk instance/organization becomes the first org under whatever platform-level Clerk setup §3 lands on — may require re-parenting existing users, worth checking Clerk's supported migration path for this.

## 9. Cost model

Needs real numbers before committing, but the shape to check:
- **D1**: free tier is generous per database; confirm current per-account database-count limits at whatever plan tier this would run on (Option B multiplies database count by tenant count).
- **Workers**: request-based pricing scales naturally with tenant traffic; no tenant-count penalty by itself.
- **Clerk**: typically priced by total MAU across the whole account regardless of org count — should stay favorable at this scale, but confirm against Clerk's current pricing before assuming.
- **Cloudflare for SaaS** (if custom domains per tenant are offered): has its own per-hostname pricing to factor in.

## 10. Suggested phasing

1. **Spike** the §2 binding/redeploy mechanics for real (a throwaway second D1 database + a scripted redeploy, timed end-to-end) before designing anything else — this is the one section of this doc that could invalidate the rest.
2. Extract ATL B3's scoring rules and branding into the config shapes from §4/§5, with ATL B3 still running as a single tenant against those configs (no multi-tenant infra yet) — proves the config design against a real league before multiplying it.
3. Stand up the per-league D1 + Clerk Organization wiring (§2/§3) with ATL B3 as tenant #1 and one synthetic second tenant, to prove isolation actually holds.
4. Build the minimum admin surface (§6) needed to onboard a second *real* league by hand through the platform, not through direct file/SQL edits.
5. Only then: domains-for-customers (§7) and billing, once there's a second paying customer to justify them.

## 11. Open questions requiring a decision before scoping further

- Is this aimed at Commander leagues specifically (keep MTG-flavored branding/scoring assumptions as platform constants) or Magic leagues broadly, or non-Magic game leagues eventually? Changes how much of §4/§5 is truly generic vs. Commander-specific.
- Who is the buyer — a league organizer paying for their own instance, or players paying individually? Changes the billing and org-membership model in §3/§6.
- Target scale for year one — a handful of leagues, or hundreds? Directly determines whether Option B's redeploy-per-onboarding is fine or a blocker from day one.
