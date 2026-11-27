import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, bans, users } from "@/db/schema";
import { getViewer, json } from "@/lib/auth";
import { hasPerm } from "@/lib/constants";

export const dynamic = "force-dynamic";

function csv(rows: (string | number | boolean | Date | null)[][]): string {
  return (
    "\ufeff" +
    rows
      .map((r) =>
        r
          .map((c) => {
            const s = c instanceof Date ? c.toISOString() : c == null ? "" : String(c);
            return `"${s.replace(/"/g, '""')}"`;
          })
          .join(","),
      )
      .join("\n")
  );
}

export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || v.ban || !v.isStaff) return json({ error: "Нет доступа" }, 403);
  const type = new URL(req.url).searchParams.get("type");
  let body = "";
  if (type === "users" && hasPerm(v.perms, "users.view")) {
    const rows = await db.select().from(users).orderBy(users.id);
    body = csv([["id", "username", "status", "role_id", "posts", "threads", "reputation", "created", "last_seen", "reg_ip", "last_ip"], ...rows.map((u) => [u.id, u.username, u.status, u.roleId, u.postsCount, u.threadsCount, u.reputation, u.createdAt, u.lastSeenAt, u.regIp, u.lastIp])]);
  } else if (type === "bans" && hasPerm(v.perms, "bans.view")) {
    const rows = await db.select().from(bans).orderBy(desc(bans.createdAt));
    body = csv([["id", "user", "ip", "hw", "reason", "by", "created", "expires", "active"], ...rows.map((b) => [b.id, b.username, b.ip, b.hwHash, b.reason, b.bannedByName, b.createdAt, b.expiresAt, b.isActive])]);
  } else if (type === "audit" && hasPerm(v.perms, "logs.view")) {
    const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(5000);
    body = csv([["id", "actor", "action", "target", "details", "ip", "created"], ...rows.map((r) => [r.id, r.actorName, r.action, r.target, r.details, r.ip, r.createdAt])]);
  } else return json({ error: "Нет доступа" }, 403);
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${type}.csv"` } });
}
