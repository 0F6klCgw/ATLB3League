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
    if (url.pathname === "/api/admin/submissions" && request.method === "GET") {
      return handleAdminList(request, env);
    }
    const deleteMatch = url.pathname.match(/^\/api\/admin\/submissions\/(\d+)$/);
    if (deleteMatch && request.method === "DELETE") {
      return handleAdminDelete(request, env, Number(deleteMatch[1]));
    }
    if (url.pathname === "/api/admin/audit-log" && request.method === "GET") {
      return handleAdminAuditLog(request, env);
    }
    if (url.pathname === "/api/deck" && request.method === "GET") {
      return handleDeckList(env);
    }
    if (url.pathname === "/api/admin/deck" && request.method === "POST") {
      return handleAdminDeckCreate(request, env);
    }
    const deckMatch = url.pathname.match(/^\/api\/admin\/deck\/(\d+)$/);
    if (deckMatch && request.method === "PUT") {
      return handleAdminDeckUpdate(request, env, Number(deckMatch[1]));
    }
    if (deckMatch && request.method === "DELETE") {
      return handleAdminDeckDelete(request, env, Number(deckMatch[1]));
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

// Verifies the Clerk session token from the Authorization header — never
// trusted from a client-asserted header, always checked cryptographically
// against Clerk's own keys — and returns the corresponding user, or null.
async function verifyClerkUser(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;
  try {
    const claims = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
    const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
    return await clerk.users.getUser(claims.sub);
  } catch {
    return null;
  }
}

function emailOf(user) {
  return user.primaryEmailAddress?.emailAddress || user.emailAddresses?.[0]?.emailAddress || "";
}

// Admin status lives in Clerk's publicMetadata (set via the Clerk dashboard
// or Backend API), not a hardcoded list — adding/removing an admin doesn't
// need a code change or deploy.
function isAdmin(user) {
  return user?.publicMetadata?.role === "admin";
}

async function requireAdmin(request, env) {
  const user = await verifyClerkUser(request, env);
  if (!user) return { error: jsonResponse({ error: "Invalid or expired session — please sign in again." }, 401) };
  if (!isAdmin(user)) return { error: jsonResponse({ error: "Not authorized." }, 403) };
  return { user };
}

async function handleAdminList(request, env) {
  const { error } = await requireAdmin(request, env);
  if (error) return error;

  const { results } = await env.DB.prepare(
    `SELECT id, submission_id, full_name, submitted_by_email, league_date, game,
            placement, game_total, dq, commander, partner, created_at
     FROM point_submissions
     ORDER BY created_at DESC, id DESC
     LIMIT 1000`
  ).all();

  return jsonResponse(results);
}

// Records who did what to which row, and a snapshot of it — so a mistaken
// delete is at least recoverable by hand from this log even though the row
// itself is gone. Logging failure doesn't fail the caller's request; it's
// only ever called after the actual action already succeeded.
async function logAdminAction(env, { user, action, targetTable, targetId, details }) {
  try {
    await env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, admin_email, action, target_table, target_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(user.id, emailOf(user), action, targetTable, String(targetId ?? ""), details ? JSON.stringify(details) : null).run();
  } catch (e) {
    console.error("[admin] audit log write failed:", e);
  }
}

async function handleAdminDelete(request, env, id) {
  const { error, user } = await requireAdmin(request, env);
  if (error) return error;

  const existing = await env.DB.prepare("SELECT * FROM point_submissions WHERE id = ?").bind(id).first();
  if (!existing) {
    return jsonResponse({ error: "Submission not found." }, 404);
  }

  try {
    await env.DB.prepare("DELETE FROM point_submissions WHERE id = ?").bind(id).run();
  } catch (e) {
    console.error("[admin] delete failed:", e);
    return jsonResponse({ error: "Could not delete submission." }, 500);
  }

  await logAdminAction(env, {
    user,
    action: "delete_submission",
    targetTable: "point_submissions",
    targetId: id,
    details: existing,
  });

  return jsonResponse({ ok: true });
}

async function handleAdminAuditLog(request, env) {
  const { error } = await requireAdmin(request, env);
  if (error) return error;

  const { results } = await env.DB.prepare(
    `SELECT id, created_at, admin_email, action, target_table, target_id, details
     FROM admin_audit_log
     ORDER BY created_at DESC, id DESC
     LIMIT 500`
  ).all();

  return jsonResponse(results);
}

async function handleDeckList(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, pts, goal, set_name FROM points_deck ORDER BY set_name, pts, id`
  ).all();
  return jsonResponse(results);
}

// Shared validation for creating/editing a deck card — same principle as
// validateRow for submissions: the server decides what's acceptable, not
// just the D1 CHECK constraints (which are still there as a second layer).
function validateDeckInput(body) {
  if (!body || typeof body !== "object") return { error: "Expected an object." };

  const pts = Number(body.pts);
  if (!Number.isInteger(pts) || pts < 1 || pts > 10) {
    return { error: "pts must be a whole number from 1 to 10." };
  }

  const goal = String(body.goal || "").trim();
  if (!goal || goal.length > 500) {
    return { error: "goal is required (max 500 chars)." };
  }

  const set_name = String(body.set_name || "").trim().slice(0, 100);

  return { value: { pts, goal, set_name } };
}

async function handleAdminDeckCreate(request, env) {
  const { error, user } = await requireAdmin(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const { error: validationError, value } = validateDeckInput(body);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  let result;
  try {
    result = await env.DB.prepare(
      "INSERT INTO points_deck (pts, goal, set_name) VALUES (?, ?, ?)"
    ).bind(value.pts, value.goal, value.set_name).run();
  } catch (e) {
    console.error("[admin] deck create failed:", e);
    return jsonResponse({ error: "Could not create card." }, 500);
  }

  const newId = result.meta.last_row_id;
  await logAdminAction(env, {
    user,
    action: "create_deck_card",
    targetTable: "points_deck",
    targetId: newId,
    details: value,
  });

  return jsonResponse({ id: newId, ...value });
}

async function handleAdminDeckUpdate(request, env, id) {
  const { error, user } = await requireAdmin(request, env);
  if (error) return error;

  const existing = await env.DB.prepare("SELECT * FROM points_deck WHERE id = ?").bind(id).first();
  if (!existing) return jsonResponse({ error: "Card not found." }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const { error: validationError, value } = validateDeckInput(body);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  try {
    await env.DB.prepare(
      "UPDATE points_deck SET pts = ?, goal = ?, set_name = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(value.pts, value.goal, value.set_name, id).run();
  } catch (e) {
    console.error("[admin] deck update failed:", e);
    return jsonResponse({ error: "Could not update card." }, 500);
  }

  await logAdminAction(env, {
    user,
    action: "update_deck_card",
    targetTable: "points_deck",
    targetId: id,
    details: { before: existing, after: value },
  });

  return jsonResponse({ id, ...value });
}

async function handleAdminDeckDelete(request, env, id) {
  const { error, user } = await requireAdmin(request, env);
  if (error) return error;

  const existing = await env.DB.prepare("SELECT * FROM points_deck WHERE id = ?").bind(id).first();
  if (!existing) return jsonResponse({ error: "Card not found." }, 404);

  try {
    await env.DB.prepare("DELETE FROM points_deck WHERE id = ?").bind(id).run();
  } catch (e) {
    console.error("[admin] deck delete failed:", e);
    return jsonResponse({ error: "Could not delete card." }, 500);
  }

  await logAdminAction(env, {
    user,
    action: "delete_deck_card",
    targetTable: "points_deck",
    targetId: id,
    details: existing,
  });

  return jsonResponse({ ok: true });
}

async function handleSubmissions(request, env) {
  const user = await verifyClerkUser(request, env);
  if (!user) {
    return jsonResponse({ error: "Invalid or expired session — please sign in again." }, 401);
  }
  const submitted_by_email = emailOf(user);
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
