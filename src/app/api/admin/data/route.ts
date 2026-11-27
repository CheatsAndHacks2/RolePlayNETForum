import { and, count, desc, eq, gt, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, bans, categories, forums, loginLog, posts, reports, roles, threads, users } from "@/db/schema";
import { getViewer, json } from "@/lib/auth";
import { hasPerm } from "@/lib/constants";
import { excerpt } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || v.ban || !v.isStaff) return json({ error: "Нет доступа" }, 403);
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "";
  const q = (url.searchParams.get("q") ?? "").trim().replace(/[%_]/g, "");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const per = 25;
  const need = (p: string) => hasPerm(v.perms, p);
  const n = async (t: Parameters<typeof db.select>[0] extends never ? never : any, w?: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
    ((await db.select({ n: count() }).from(t).where(w))[0]?.n ?? 0);

  if (type === "dashboard") {
    if (!need("dashboard.view")) return json({ error: "Нет доступа" }, 403);
    const day = new Date(Date.now() - 86400_000);
    const stats = {
      users: await n(users),
      newUsers: await n(users, gt(users.createdAt, day)),
      online: await n(users, gt(users.lastSeenAt, new Date(Date.now() - 300_000))),
      threads: await n(threads),
      posts: await n(posts),
      posts24: await n(posts, gt(posts.createdAt, day)),
      openReports: await n(reports, eq(reports.status, "open")),
      activeBans: await n(bans, and(eq(bans.isActive, true), or(sql`${bans.expiresAt} is null`, gt(bans.expiresAt, new Date())))),
      pending: await n(users, eq(users.status, "pending")),
      muted: await n(users, gt(users.mutedUntil, new Date())),
      hidden: await n(threads, eq(threads.isHidden, true)),
      forums: await n(forums),
    };
    const dist = await db.execute(sql`select r.name, r.color, r.icon, count(u.id)::int c from roles r left join users u on u.role_id = r.id group by r.id order by r.level desc`);
    const recentUsers = await db.select({ id: users.id, name: users.username, at: users.createdAt, ip: users.regIp }).from(users).orderBy(desc(users.createdAt)).limit(8);
    const recent = need("logs.view") ? await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(10) : [];
    return json({ stats, dist: dist.rows, recentUsers: need("users.view") ? recentUsers : recentUsers.map((u) => ({ ...u, ip: "" })), recent });
  }

  if (type === "users") {
    if (!need("users.view")) return json({ error: "Нет доступа" }, 403);
    const roleId = Number(url.searchParams.get("role") ?? 0) || 0;
    const status = url.searchParams.get("status") ?? "";
    const conds = [];
    if (q) conds.push(or(ilike(users.username, `%${q}%`), ilike(users.lastIp, `%${q}%`), sql`${users.id}::text = ${q}`));
    if (roleId) conds.push(eq(users.roleId, roleId));
    if (status) conds.push(eq(users.status, status));
    const where = conds.length ? and(...conds) : undefined;
    const total = await n(users, where);
    const rows = await db.select({ u: users, r: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(where).orderBy(desc(users.id)).limit(per).offset((page - 1) * per);
    const ids = rows.map((x) => x.u.id);
    const banned = new Set<number>();
    if (ids.length) {
      const bs = await db.select({ id: bans.userId }).from(bans).where(and(eq(bans.isActive, true), or(sql`${bans.expiresAt} is null`, gt(bans.expiresAt, new Date()))));
      bs.forEach((b) => b.id && banned.add(b.id));
    }
    return json({
      total, page, per,
      rows: rows.map((x) => ({
        id: x.u.id, name: x.u.username, role: { name: x.r.name, color: x.r.color, icon: x.r.icon }, status: x.u.status,
        posts: x.u.postsCount, createdAt: x.u.createdAt, lastSeenAt: x.u.lastSeenAt, ip: x.u.lastIp,
        hwLocked: x.u.hwLocked, hwBound: !!x.u.hwHash, muted: !!x.u.mutedUntil && x.u.mutedUntil > new Date(), banned: banned.has(x.u.id), isProtected: x.u.isProtected, warn: x.u.warnPoints,
      })),
    });
  }

  if (type === "bans") {
    if (!need("bans.view")) return json({ error: "Нет доступа" }, 403);
    const onlyActive = url.searchParams.get("all") !== "1";
    const where = onlyActive ? and(eq(bans.isActive, true), or(sql`${bans.expiresAt} is null`, gt(bans.expiresAt, new Date()))) : undefined;
    const rows = await db.select().from(bans).where(where).orderBy(desc(bans.createdAt)).limit(150);
    return json({ rows: rows.map((b) => ({ id: b.id, target: b.username, ip: b.ip, hw: b.hwHash ? b.hwHash.slice(0, 12) : null, reason: b.reason, by: b.bannedByName, at: b.createdAt, exp: b.expiresAt, active: b.isActive && (!b.expiresAt || b.expiresAt > new Date()), shadow: b.shadow })) });
  }

  if (type === "reports") {
    if (!need("reports.handle")) return json({ error: "Нет доступа" }, 403);
    const status = url.searchParams.get("status") || "open";
    const rows = await db.execute(sql`
      select r.id, r.reason, r.status, r.created_at, r.thread_id, r.post_id, r.note,
        ru.username as reporter, au.username as author, p.content, t.title
      from reports r
      left join users ru on ru.id = r.reporter_id
      left join posts p on p.id = r.post_id
      left join users au on au.id = p.author_id
      left join threads t on t.id = r.thread_id
      where r.status = ${status}
      order by r.created_at desc limit 100`);
    return json({ rows: (rows.rows as Record<string, unknown>[]).map((r) => ({ ...r, content: excerpt(String(r.content ?? ""), 200) })) });
  }

  if (type === "audit") {
    if (!need("logs.view")) return json({ error: "Нет доступа" }, 403);
    const where = q ? or(ilike(auditLog.action, `%${q}%`), ilike(auditLog.target, `%${q}%`), ilike(auditLog.actorName, `%${q}%`), ilike(auditLog.details, `%${q}%`)) : undefined;
    const rows = await db.select().from(auditLog).where(where).orderBy(desc(auditLog.createdAt)).limit(200);
    return json({ rows });
  }

  if (type === "logins") {
    if (!need("logs.view")) return json({ error: "Нет доступа" }, 403);
    const where = q ? or(ilike(loginLog.username, `%${q}%`), ilike(loginLog.ip, `%${q}%`)) : undefined;
    const rows = await db.select().from(loginLog).where(where).orderBy(desc(loginLog.createdAt)).limit(200);
    return json({ rows: rows.map((r) => ({ ...r, hwHash: r.hwHash ? r.hwHash.slice(0, 12) : null })) });
  }

  if (type === "structure") {
    const cs = await db.select().from(categories).orderBy(categories.sortOrder);
    const fs = await db.select().from(forums).orderBy(forums.sortOrder);
    return json({ categories: cs, forums: fs });
  }

  if (type === "roles") {
    const rs = await db.select().from(roles).orderBy(desc(roles.level));
    const cnt = await db.execute(sql`select role_id, count(*)::int c from users group by role_id`);
    const m = new Map((cnt.rows as { role_id: number; c: number }[]).map((x) => [x.role_id, x.c]));
    return json({ rows: rs.map((r) => ({ ...r, members: m.get(r.id) ?? 0 })) });
  }

  return json({ error: "Неизвестный тип" }, 400);
}
