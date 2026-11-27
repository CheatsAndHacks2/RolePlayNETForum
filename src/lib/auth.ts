import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { and, count, eq, gt, isNull, or, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, bans, notifications, roles, sessions, users } from "@/db/schema";
import { hasPerm } from "@/lib/constants";
import { getSettings } from "@/lib/settings";
import { ensureSeed } from "@/lib/seed";

export type Role = typeof roles.$inferSelect;
export type User = typeof users.$inferSelect;
export type Ban = typeof bans.$inferSelect;

export const SESSION_COOKIE = "rp_session";
export const HW_COOKIE = "rp_hw";
export const HW_RE = /^[a-f0-9]{64}$/;

export type Viewer = {
  user: User | null;
  role: Role | null;
  perms: string[];
  level: number;
  ban: Ban | null;
  shadow: boolean;
  ip: string;
  hw: string | null;
  unread: number;
  isStaff: boolean;
  isFounder: boolean;
};

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `s1$${salt}$${h}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [v, salt, h] = stored.split("$");
  if (v !== "s1" || !salt || !h) return false;
  const c = crypto.scryptSync(pw, salt, 64);
  const hb = Buffer.from(h, "hex");
  return hb.length === c.length && crypto.timingSafeEqual(hb, c);
}

export function sha(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export async function getIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  const ip = (xff ? xff.split(",")[0] : h.get("x-real-ip") || "").trim();
  return ip.slice(0, 64) || "0.0.0.0";
}

export async function getUa(): Promise<string> {
  const h = await headers();
  return (h.get("user-agent") || "").slice(0, 300);
}

export function ipMatches(banIp: string, ip: string): boolean {
  if (banIp.endsWith("*")) return ip.startsWith(banIp.slice(0, -1));
  return banIp === ip;
}

export async function findActiveBan(q: { userId?: number | null; ip?: string | null; hw?: string | null }): Promise<Ban | null> {
  const s = await getSettings();
  const now = new Date();
  const conds = [];
  if (q.userId) conds.push(eq(bans.userId, q.userId));
  if (q.hw && s.bool("enforceHwBans")) conds.push(eq(bans.hwHash, q.hw));
  if (q.ip && s.bool("enforceIpBans")) conds.push(isNotNull(bans.ip));
  if (!conds.length) return null;
  const rows = await db
    .select()
    .from(bans)
    .where(and(eq(bans.isActive, true), or(isNull(bans.expiresAt), gt(bans.expiresAt, now)), or(...conds)));
  for (const b of rows) {
    if (q.userId && b.userId === q.userId) return b;
    if (q.hw && b.hwHash && b.hwHash === q.hw && s.bool("enforceHwBans")) return b;
    if (q.ip && b.ip && s.bool("enforceIpBans") && ipMatches(b.ip, q.ip)) return b;
  }
  return null;
}

export const getViewer = cache(async (): Promise<Viewer> => {
  await ensureSeed();
  const c = await cookies();
  const ip = await getIp();
  const hwRaw = c.get(HW_COOKIE)?.value;
  const hw = hwRaw && HW_RE.test(hwRaw) ? hwRaw : null;
  const token = c.get(SESSION_COOKIE)?.value;

  let user: User | null = null;
  let role: Role | null = null;
  if (token) {
    const rows = await db
      .select({ session: sessions, user: users, role: roles })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(eq(sessions.id, sha(token)))
      .limit(1);
    const r = rows[0];
    if (r && r.session.expiresAt > new Date() && r.user.status === "active") {
      if (!r.user.hwLocked || (r.user.hwHash && hw === r.user.hwHash)) {
        user = r.user;
        role = r.role;
      }
    }
  }

  if (user && (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 60_000)) {
    await db.update(users).set({ lastSeenAt: new Date(), lastIp: ip }).where(eq(users.id, user.id));
  }

  const perms = (role?.permissions as string[] | undefined) ?? [];
  let ban: Ban | null = null;
  let shadow = false;
  if (!user?.isProtected) {
    ban = await findActiveBan({ userId: user?.id, ip, hw });
    if (ban?.shadow) {
      shadow = true;
      ban = null;
    }
  }

  let unread = 0;
  if (user) {
    const r = await db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.isRead, false)));
    unread = r[0]?.n ?? 0;
  }

  return {
    user,
    role,
    perms,
    level: role?.level ?? 0,
    ban,
    shadow,
    ip,
    hw,
    unread,
    isStaff: hasPerm(perms, "admin.access"),
    isFounder: perms.includes("*"),
  };
});

export async function createSession(userId: number, hw: string | null): Promise<void> {
  const s = await getSettings();
  const token = crypto.randomBytes(32).toString("hex");
  const days = Math.max(1, s.num("sessionDays"));
  const expiresAt = new Date(Date.now() + days * 86400_000);
  await db.insert(sessions).values({
    id: sha(token),
    userId,
    expiresAt,
    ip: await getIp(),
    userAgent: await getUa(),
    hwHash: hw,
  });
  const c = await cookies();
  c.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const c = await cookies();
  const token = c.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, sha(token)));
  c.delete(SESSION_COOKIE);
}

export async function audit(
  actor: { id: number | null; name: string } | null,
  action: string,
  target = "",
  details = "",
  ip = "",
) {
  await db.insert(auditLog).values({
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? "system",
    action,
    target: target.slice(0, 200),
    details: details.slice(0, 1000),
    ip,
  });
}

export async function notify(userId: number, text: string, link = "") {
  await db.insert(notifications).values({ userId, text: text.slice(0, 500), link });
}

export function canManage(v: Viewer, target: { id: number; level: number; isProtected: boolean }): boolean {
  if (!v.user) return false;
  if (target.id === v.user.id) return true;
  if (target.isProtected) return false;
  if (v.isFounder) return true;
  return v.level > target.level;
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function validUsername(name: string, min: number, max: number): string | null {
  if (name.length < min || name.length > max) return `Ник должен быть от ${min} до ${max} символов`;
  if (!/^[A-Za-zА-Яа-яЁё0-9_.\-]+$/.test(name)) return "Ник может содержать буквы, цифры, _ . -";
  if (/^[.\-]|[.\-]$/.test(name)) return "Ник не должен начинаться или заканчиваться на . или -";
  return null;
}

export function matchesMask(name: string, mask: string): boolean {
  const esc = mask.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${esc}$`).test(name.toLowerCase());
}
