// Worker entry point: serves the static site (index.html, formsubmission.html,
// theme.css) via the ASSETS binding, and handles POST /api/submissions by
// validating each row against the live scoring rules (in D1, editable from
// the admin center) and writing it to D1.
//
// The server is the authority here, not the client: every submitted point
// is checked against the scoring_items row it claims to be (0/fixed value
// never trusted from the client), and game_total/dq are recomputed from the
// validated set rather than trusting whatever the client sent. This is what
// closes the "RLS always true" gap from the old Supabase setup (see
// PROJECT_PLAN.md #2). Scoring items being admin-editable means D1 can no
// longer statically CHECK each one's exact value the way point_submissions'
// old fixed columns did — submission_points' CHECK is a coarse sanity bound
// instead, and the Worker (checked against the live scoring_items table) is
// the real authority for scoring now.
//
// Identity: the client attaches a Clerk session token (Authorization:
// Bearer <token>), which we verify against Clerk's own keys — not a
// header any edge or proxy could inject, so this is checked cryptographically
// rather than trusted positionally.

import { createClerkClient, verifyToken } from "@clerk/backend";

const PLACEMENTS = [0, 1, 2, 3, 4];

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
    if (url.pathname === "/api/admin/users" && request.method === "GET") {
      return handleAdminUsersList(request, env);
    }
    const userRoleMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
    if (userRoleMatch && request.method === "PUT") {
      return handleAdminUserRoleUpdate(request, env, userRoleMatch[1]);
    }
    if (url.pathname === "/api/scoring" && request.method === "GET") {
      return handleScoringList(env);
    }
    if (url.pathname === "/api/admin/scoring/categories" && request.method === "POST") {
      return handleAdminScoringCategoryCreate(request, env);
    }
    const catMatch = url.pathname.match(/^\/api\/admin\/scoring\/categories\/(\d+)$/);
    if (catMatch && request.method === "PUT") {
      return handleAdminScoringCategoryUpdate(request, env, Number(catMatch[1]));
    }
    if (catMatch && request.method === "DELETE") {
      return handleAdminScoringCategoryDelete(request, env, Number(catMatch[1]));
    }
    if (url.pathname === "/api/admin/scoring/items" && request.method === "POST") {
      return handleAdminScoringItemCreate(request, env);
    }
    const itemMatch = url.pathname.match(/^\/api\/admin\/scoring\/items\/(\d+)$/);
    if (itemMatch && request.method === "PUT") {
      return handleAdminScoringItemUpdate(request, env, Number(itemMatch[1]));
    }
    if (itemMatch && request.method === "DELETE") {
      return handleAdminScoringItemDelete(request, env, Number(itemMatch[1]));
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
// need a code change or deploy. super_admin is a strict superset of admin.
function isAdmin(user) {
  const role = user?.publicMetadata?.role;
  return role === "admin" || role === "super_admin";
}

function isSuperAdmin(user) {
  return user?.publicMetadata?.role === "super_admin";
}

async function requireAdmin(request, env) {
  const user = await verifyClerkUser(request, env);
  if (!user) return { error: jsonResponse({ error: "Invalid or expired session — please sign in again." }, 401) };
  if (!isAdmin(user)) return { error: jsonResponse({ error: "Not authorized." }, 403) };
  return { user };
}

// Gates the user-management endpoints — listing every Clerk user and
// changing roles is more sensitive than the regular admin actions (which
// only ever touch this app's own D1 rows), so it's restricted to super
// admins rather than every admin.
async function requireSuperAdmin(request, env) {
  const user = await verifyClerkUser(request, env);
  if (!user) return { error: jsonResponse({ error: "Invalid or expired session — please sign in again." }, 401) };
  if (!isSuperAdmin(user)) return { error: jsonResponse({ error: "Not authorized." }, 403) };
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

// ---- Scoring data (categories + items) ----
// Public read (formsubmission.html and printsheet.html both fetch this to
// render the live rule set), admin-only writes.

async function loadScoringCategoriesWithItems(env) {
  const [{ results: categories }, { results: items }] = await Promise.all([
    env.DB.prepare(
      `SELECT id, title, kind, sort_order FROM scoring_categories ORDER BY sort_order, id`
    ).all(),
    env.DB.prepare(
      `SELECT id, category_id, val, dq, desc, sort_order FROM scoring_items ORDER BY sort_order, id`
    ).all(),
  ]);

  const byCategory = new Map();
  for (const it of items) {
    if (!byCategory.has(it.category_id)) byCategory.set(it.category_id, []);
    byCategory.get(it.category_id).push({ id: it.id, val: it.val, dq: !!it.dq, desc: it.desc, sort_order: it.sort_order });
  }

  return categories.map((c) => ({
    id: c.id,
    title: c.title,
    kind: c.kind,
    sort_order: c.sort_order,
    items: byCategory.get(c.id) || [],
  }));
}

async function handleScoringList(env) {
  return jsonResponse(await loadScoringCategoriesWithItems(env));
}

// Every scoring item currently live, keyed by id — fetched once per
// /api/submissions request and used to validate/resolve what the client
// submitted (never trusting its claimed point value or dq-ness directly).
async function loadScoringItemsMap(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, val, dq, desc FROM scoring_items`
  ).all();
  return new Map(results.map((it) => [it.id, it]));
}

function validateScoringCategoryInput(body) {
  if (!body || typeof body !== "object") return { error: "Expected an object." };

  const title = String(body.title || "").trim();
  if (!title || title.length > 200) return { error: "title is required (max 200 chars)." };

  const kind = String(body.kind || "");
  if (!["pos", "neg"].includes(kind)) return { error: "kind must be 'pos' or 'neg'." };

  const sort_order = Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0;

  return { value: { title, kind, sort_order } };
}

function validateScoringItemInput(body) {
  if (!body || typeof body !== "object") return { error: "Expected an object." };

  const category_id = Number(body.category_id);
  if (!Number.isInteger(category_id) || category_id <= 0) {
    return { error: "category_id is required." };
  }

  const dq = !!body.dq;
  const val = dq ? 0 : Number(body.val);
  if (!dq && (!Number.isInteger(val) || val < -20 || val > 20 || val === 0)) {
    return { error: "val must be a non-zero whole number from -20 to 20 (unless dq is set)." };
  }

  const desc = String(body.desc || "").trim();
  if (!desc || desc.length > 500) return { error: "desc is required (max 500 chars)." };

  const sort_order = Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0;

  return { value: { category_id, val, dq: dq ? 1 : 0, desc, sort_order } };
}

async function handleAdminScoringCategoryCreate(request, env) {
  const { error, user } = await requireAdmin(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const { error: validationError, value } = validateScoringCategoryInput(body);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  let result;
  try {
    result = await env.DB.prepare(
      "INSERT INTO scoring_categories (title, kind, sort_order) VALUES (?, ?, ?)"
    ).bind(value.title, value.kind, value.sort_order).run();
  } catch (e) {
    console.error("[admin] scoring category create failed:", e);
    return jsonResponse({ error: "Could not create category." }, 500);
  }

  const newId = result.meta.last_row_id;
  await logAdminAction(env, {
    user,
    action: "create_scoring_category",
    targetTable: "scoring_categories",
    targetId: newId,
    details: value,
  });

  return jsonResponse({ id: newId, ...value, items: [] });
}

async function handleAdminScoringCategoryUpdate(request, env, id) {
  const { error, user } = await requireAdmin(request, env);
  if (error) return error;

  const existing = await env.DB.prepare("SELECT * FROM scoring_categories WHERE id = ?").bind(id).first();
  if (!existing) return jsonResponse({ error: "Category not found." }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const { error: validationError, value } = validateScoringCategoryInput(body);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  try {
    await env.DB.prepare(
      "UPDATE scoring_categories SET title = ?, kind = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(value.title, value.kind, value.sort_order, id).run();
  } catch (e) {
    console.error("[admin] scoring category update failed:", e);
    return jsonResponse({ error: "Could not update category." }, 500);
  }

  await logAdminAction(env, {
    user,
    action: "update_scoring_category",
    targetTable: "scoring_categories",
    targetId: id,
    details: { before: existing, after: value },
  });

  return jsonResponse({ id, ...value });
}

async function handleAdminScoringCategoryDelete(request, env, id) {
  const { error, user } = await requireAdmin(request, env);
  if (error) return error;

  const existing = await env.DB.prepare("SELECT * FROM scoring_categories WHERE id = ?").bind(id).first();
  if (!existing) return jsonResponse({ error: "Category not found." }, 404);

  // Deleting a category cascades to its items (schema FK), so the audit
  // snapshot captures both — otherwise the deleted items would be
  // unrecoverable even from the log.
  const { results: items } = await env.DB.prepare("SELECT * FROM scoring_items WHERE category_id = ?").bind(id).all();

  try {
    await env.DB.prepare("DELETE FROM scoring_categories WHERE id = ?").bind(id).run();
  } catch (e) {
    console.error("[admin] scoring category delete failed:", e);
    return jsonResponse({ error: "Could not delete category. Remove its items first if this fails." }, 500);
  }

  await logAdminAction(env, {
    user,
    action: "delete_scoring_category",
    targetTable: "scoring_categories",
    targetId: id,
    details: { ...existing, items },
  });

  return jsonResponse({ ok: true });
}

async function handleAdminScoringItemCreate(request, env) {
  const { error, user } = await requireAdmin(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const { error: validationError, value } = validateScoringItemInput(body);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  const category = await env.DB.prepare("SELECT id FROM scoring_categories WHERE id = ?").bind(value.category_id).first();
  if (!category) return jsonResponse({ error: "Category not found." }, 404);

  let result;
  try {
    result = await env.DB.prepare(
      "INSERT INTO scoring_items (category_id, val, dq, desc, sort_order) VALUES (?, ?, ?, ?, ?)"
    ).bind(value.category_id, value.val, value.dq, value.desc, value.sort_order).run();
  } catch (e) {
    console.error("[admin] scoring item create failed:", e);
    return jsonResponse({ error: "Could not create item." }, 500);
  }

  const newId = result.meta.last_row_id;
  await logAdminAction(env, {
    user,
    action: "create_scoring_item",
    targetTable: "scoring_items",
    targetId: newId,
    details: value,
  });

  return jsonResponse({ id: newId, ...value });
}

async function handleAdminScoringItemUpdate(request, env, id) {
  const { error, user } = await requireAdmin(request, env);
  if (error) return error;

  const existing = await env.DB.prepare("SELECT * FROM scoring_items WHERE id = ?").bind(id).first();
  if (!existing) return jsonResponse({ error: "Item not found." }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const { error: validationError, value } = validateScoringItemInput(body);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  const category = await env.DB.prepare("SELECT id FROM scoring_categories WHERE id = ?").bind(value.category_id).first();
  if (!category) return jsonResponse({ error: "Category not found." }, 404);

  try {
    await env.DB.prepare(
      "UPDATE scoring_items SET category_id = ?, val = ?, dq = ?, desc = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(value.category_id, value.val, value.dq, value.desc, value.sort_order, id).run();
  } catch (e) {
    console.error("[admin] scoring item update failed:", e);
    return jsonResponse({ error: "Could not update item." }, 500);
  }

  await logAdminAction(env, {
    user,
    action: "update_scoring_item",
    targetTable: "scoring_items",
    targetId: id,
    details: { before: existing, after: value },
  });

  return jsonResponse({ id, ...value });
}

async function handleAdminScoringItemDelete(request, env, id) {
  const { error, user } = await requireAdmin(request, env);
  if (error) return error;

  const existing = await env.DB.prepare("SELECT * FROM scoring_items WHERE id = ?").bind(id).first();
  if (!existing) return jsonResponse({ error: "Item not found." }, 404);

  try {
    await env.DB.prepare("DELETE FROM scoring_items WHERE id = ?").bind(id).run();
  } catch (e) {
    console.error("[admin] scoring item delete failed:", e);
    return jsonResponse({ error: "Could not delete item." }, 500);
  }

  await logAdminAction(env, {
    user,
    action: "delete_scoring_item",
    targetTable: "scoring_items",
    targetId: id,
    details: existing,
  });

  return jsonResponse({ ok: true });
}

const USER_ROLES = ["", "admin", "super_admin"];

// User accounts and roles live entirely in Clerk (there's no local `users`
// table) — these two endpoints go straight to the Clerk Backend API rather
// than D1, using the same CLERK_SECRET_KEY already used for session
// verification above.
async function handleAdminUsersList(request, env) {
  const { error } = await requireSuperAdmin(request, env);
  if (error) return error;

  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  const { data: users } = await clerk.users.getUserList({ limit: 200 });

  const list = users.map((u) => ({
    id: u.id,
    email: emailOf(u),
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
    role: u.publicMetadata?.role || "",
  }));

  return jsonResponse(list);
}

async function handleAdminUserRoleUpdate(request, env, targetUserId) {
  const { error, user } = await requireSuperAdmin(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const role = String(body.role ?? "");
  if (!USER_ROLES.includes(role)) {
    return jsonResponse({ error: "role must be '', 'admin', or 'super_admin'." }, 400);
  }

  // Guard against a super admin locking themselves out with no one left to
  // undo it — that would require going into the Clerk dashboard by hand.
  if (targetUserId === user.id && role !== "super_admin") {
    return jsonResponse({ error: "You can't remove your own super admin access." }, 400);
  }

  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  let targetUser;
  try {
    targetUser = await clerk.users.getUser(targetUserId);
  } catch {
    return jsonResponse({ error: "User not found." }, 404);
  }
  const beforeRole = targetUser.publicMetadata?.role || "";

  try {
    await clerk.users.updateUserMetadata(targetUserId, { publicMetadata: { role } });
  } catch (e) {
    console.error("[admin] role update failed:", e);
    return jsonResponse({ error: "Could not update role." }, 500);
  }

  await logAdminAction(env, {
    user,
    action: "update_user_role",
    targetTable: "clerk_user",
    targetId: targetUserId,
    details: { email: emailOf(targetUser), before: beforeRole, after: role },
  });

  return jsonResponse({ id: targetUserId, role });
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

  const itemsMap = await loadScoringItemsMap(env);

  const validatedRows = [];
  for (const row of rows) {
    const { row: validated, error } = validateRow(row, submitted_by_email, itemsMap);
    if (error) return jsonResponse({ error }, 400);
    validatedRows.push(validated);
  }

  // Each row needs its own generated point_submissions id before its
  // submission_points children can reference it, so these can't all go in
  // one D1 batch() — a handful of sequential round trips (one game night
  // is at most 3 rows) is not worth the complexity of avoiding.
  try {
    for (const row of validatedRows) {
      const result = await env.DB.prepare(
        `INSERT INTO point_submissions
           (submission_id, full_name, league_date, game, placement, dq, game_total,
            submitted_by_email, commander, commander_scryfall_id, commander_image_url,
            partner, partner_scryfall_id, partner_image_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        row.submission_id, row.full_name, row.league_date, row.game, row.placement, row.dq, row.game_total,
        row.submitted_by_email, row.commander, row.commander_scryfall_id, row.commander_image_url,
        row.partner, row.partner_scryfall_id, row.partner_image_url
      ).run();

      const pointSubmissionId = result.meta.last_row_id;
      if (row.points.length) {
        await env.DB.batch(row.points.map((p) =>
          env.DB.prepare(
            `INSERT INTO submission_points (point_submission_id, item_id, item_desc, points_awarded, is_dq)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(pointSubmissionId, p.item_id, p.item_desc, p.points_awarded, p.is_dq)
        ));
      }
    }
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

function validateRow(row, submitted_by_email, itemsMap) {
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

  // The client sends which scoring items it claims were checked, as a list
  // of ids — never a value or dq-ness, both of which are always resolved
  // here from the live scoring_items table, not the client's say-so.
  const rawIds = Array.isArray(row.points) ? row.points : [];
  const seen = new Set();
  const points = [];
  let anyDq = false;
  let pointsTotal = 0;
  for (const rawId of rawIds) {
    const itemId = Number(rawId);
    if (!Number.isInteger(itemId) || seen.has(itemId)) continue;
    seen.add(itemId);
    const item = itemsMap.get(itemId);
    if (!item) return { error: `Unknown scoring item id ${itemId}.` };
    if (item.dq) {
      anyDq = true;
      points.push({ item_id: itemId, item_desc: item.desc, points_awarded: 0, is_dq: 1 });
    } else {
      pointsTotal += item.val;
      points.push({ item_id: itemId, item_desc: item.desc, points_awarded: item.val, is_dq: 0 });
    }
  }

  // Authoritative total — the client's own game_total is ignored.
  const game_total = placement + pointsTotal;

  const truncate = (v, max) => (v == null ? null : String(v).slice(0, max));

  return {
    row: {
      submission_id,
      full_name,
      league_date,
      game,
      placement,
      points,
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
