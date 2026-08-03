// Worker entry point: serves the static site (index.html, formsubmission.html,
// theme.css) via the ASSETS binding, and handles POST /api/submissions by
// validating each row against the known scoring table and writing it to D1.
//
// The server is the authority here, not the client: every point column is
// checked against POINT_VALUES (0 or its fixed value, never anything else),
// and game_total/dq are recomputed from the validated flags rather than
// trusting whatever the client sent. This is what closes the "RLS always
// true" gap from the old Supabase setup (see PROJECT_PLAN.md #2) — the D1
// schema's CHECK constraints are a second, independent layer of the same
// guarantee.
//
// Identity: the client attaches a Clerk session token (Authorization:
// Bearer <token>), which we verify against Clerk's own keys — not a
// header any edge or proxy could inject, so this is checked cryptographically
// rather than trusted positionally.

import { createClerkClient, verifyToken } from "@clerk/backend";

const POINT_VALUES = {
  // Standard points
  draw: 1,
  win_no_gc_solring: 1,
  alt_win: 1,
  remove_counter_2plus: 1,
  stop_win: 1,
  protect_player: 1,
  cast_cmdr_4x: 1,
  recent_ub_uw_cmdr: 1,
  seat4_loss_or_3pod: 1,
  coolest_card: 1,
  // Rotating points
  convoke_improvise_2: 1,
  team_creatures_5: 1,
  prepared_adventure_3: 1,
  lightning_bolted: 1,
  lightning_bolt_range: 1,
  // Bad Guy points
  win_before_t6: -4,
  stax_4plus: -2,
  infinite_combo_win: -1,
  edhtop16_cmdr: -1,
  infinite_loop_fail: -6,
  acted_jerk: -2,
};

const DQ_FLAGS = ["mass_land_denial", "banned_card", "chain_extra_turns"];
const PLACEMENTS = [0, 1, 2, 3, 4];

const COLUMNS = [
  "submission_id", "full_name", "league_date", "game", "placement",
  ...Object.keys(POINT_VALUES),
  ...DQ_FLAGS,
  "dq", "game_total", "submitted_by_email",
  "commander", "commander_scryfall_id", "commander_image_url",
  "partner", "partner_scryfall_id", "partner_image_url",
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/submissions" && request.method === "POST") {
      return handleSubmissions(request, env);
    }
    if (url.pathname === "/api/commanders" && request.method === "GET") {
      return handleCommanders(env);
    }
    return env.ASSETS.fetch(request);
  },
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function handleSubmissions(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return jsonResponse({ error: "Missing session token." }, 401);
  }

  let submitted_by_email;
  try {
    const claims = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
    const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
    const user = await clerk.users.getUser(claims.sub);
    submitted_by_email =
      user.primaryEmailAddress?.emailAddress ||
      user.emailAddresses?.[0]?.emailAddress ||
      "";
  } catch (e) {
    return jsonResponse({ error: "Invalid or expired session — please sign in again." }, 401);
  }
  if (!submitted_by_email) {
    return jsonResponse({ error: "Your Clerk account has no email on file." }, 401);
  }

  let rows;
  try {
    rows = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse({ error: "Expected a non-empty array of game rows." }, 400);
  }

  const validatedRows = [];
  for (const row of rows) {
    const { row: validated, error } = validateRow(row, submitted_by_email);
    if (error) return jsonResponse({ error }, 400);
    validatedRows.push(validated);
  }

  try {
    await env.DB.batch(validatedRows.map((row) => insertStatement(env, row)));
  } catch (e) {
    console.error("[submissions] D1 write failed:", e);
    return jsonResponse({ error: "Could not save submission. Please try again." }, 500);
  }

  return jsonResponse({ ok: true, saved: validatedRows.length });
}

// A partner pair ("Thrasios, Triton Hero" + "Tymna the Weaver") is one deck
// identity regardless of which commander a given submission listed as
// primary vs partner — sort the pair so both orderings land on the same key.
async function handleCommanders(env) {
  const { results } = await env.DB.prepare(
    `SELECT commander, commander_scryfall_id, commander_image_url,
            partner, partner_scryfall_id, partner_image_url,
            placement, dq
     FROM point_submissions
     WHERE commander IS NOT NULL AND trim(commander) != ''`
  ).all();

  const stats = new Map();

  for (const row of results) {
    const hasPartner = row.partner && String(row.partner).trim();
    let key, name, names;

    if (hasPartner) {
      names = [row.commander, row.partner].sort((a, b) => a.localeCompare(b));
      name = names.join(" + ");
      key = name.toLowerCase();
    } else {
      name = row.commander;
      names = [name];
      key = name.toLowerCase();
    }

    if (!stats.has(key)) {
      stats.set(key, { name, names, played: 0, wins: 0 });
    }
    const s = stats.get(key);
    s.played += 1;
    if (Number(row.placement) === 4 && !row.dq) s.wins += 1;
  }

  const list = Array.from(stats.values())
    .map((s) => ({
      ...s,
      winPct: s.played ? Math.round((s.wins / s.played) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.winPct - a.winPct || b.played - a.played || a.name.localeCompare(b.name));

  return jsonResponse(list);
}

function validateRow(row, submitted_by_email) {
  if (!row || typeof row !== "object") return { error: "Each row must be an object." };

  const full_name = String(row.full_name || "").trim();
  if (!full_name || full_name.length > 80) {
    return { error: "full_name is required (max 80 chars)." };
  }

  const submission_id = String(row.submission_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(submission_id)) {
    return { error: "submission_id must be a UUID." };
  }

  const game = Number(row.game);
  if (![1, 2, 3].includes(game)) return { error: "game must be 1, 2, or 3." };

  const placement = Number(row.placement) || 0;
  if (!PLACEMENTS.includes(placement)) return { error: "placement must be 0-4." };

  const league_date = row.league_date ? String(row.league_date).slice(0, 10) : null;

  const points = {};
  for (const [key, val] of Object.entries(POINT_VALUES)) {
    const submitted = Number(row[key]) || 0;
    if (submitted !== 0 && submitted !== val) {
      return { error: `${key} must be 0 or ${val}.` };
    }
    points[key] = submitted;
  }

  const dqFlags = {};
  let anyDq = false;
  for (const key of DQ_FLAGS) {
    const on = !!row[key];
    dqFlags[key] = on ? 1 : 0;
    if (on) anyDq = true;
  }

  // Authoritative total — the client's own game_total is ignored.
  const game_total = placement + Object.values(points).reduce((a, b) => a + b, 0);

  const truncate = (v, max) => (v == null ? null : String(v).slice(0, max));

  return {
    row: {
      submission_id,
      full_name,
      league_date,
      game,
      placement,
      ...points,
      ...dqFlags,
      dq: anyDq ? 1 : 0,
      game_total,
      submitted_by_email: submitted_by_email.slice(0, 254),
      commander: truncate(row.commander, 200),
      commander_scryfall_id: truncate(row.commander_scryfall_id, 64),
      commander_image_url: truncate(row.commander_image_url, 500),
      partner: truncate(row.partner, 200),
      partner_scryfall_id: truncate(row.partner_scryfall_id, 64),
      partner_image_url: truncate(row.partner_image_url, 500),
    },
  };
}

function insertStatement(env, row) {
  const placeholders = COLUMNS.map(() => "?").join(", ");
  const sql = `INSERT INTO point_submissions (${COLUMNS.join(", ")}) VALUES (${placeholders})`;
  return env.DB.prepare(sql).bind(...COLUMNS.map((c) => row[c] ?? null));
}
