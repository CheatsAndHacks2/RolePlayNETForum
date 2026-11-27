import { cookies } from "next/headers";
import { and, count, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { roles, users } from "@/db/schema";
import { HW_COOKIE, HW_RE, audit, createSession, findActiveBan, getIp, hashPassword, json, matchesMask, validUsername } from "@/lib/auth";
import { verifyCaptcha } from "@/lib/captcha";
import { getSettings } from "@/lib/settings";
import { ensureSeed } from "@/lib/seed";
import { fmtDate } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await ensureSeed();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Некорректный запрос" }, 400);
  const s = await getSettings();
  const ip = await getIp();

  if (!s.bool("registrationOpen")) return json({ error: "Регистрация временно закрыта администрацией" }, 403);

  // anti-bot: honeypot + minimal fill time
  if (typeof body.website === "string" && body.website.length > 0) return json({ error: "Подозрение на бота" }, 400);
  const elapsed = Number(body.elapsed);
  if (!Number.isFinite(elapsed) || elapsed < 2500) return json({ error: "Слишком быстро. Заполните форму внимательнее" }, 400);

  const hw = typeof body.hw === "string" && HW_RE.test(body.hw) ? body.hw : null;
  if (!hw) return json({ error: "Не удалось определить устройство. Включите JavaScript и обновите страницу" }, 400);

  const ban = await findActiveBan({ ip, hw });
  if (ban) {
    return json({ error: `Регистрация недоступна: ваше устройство или IP заблокированы. Причина: ${ban.reason || "не указана"}. ${ban.expiresAt ? "До " + fmtDate(ban.expiresAt) : "Навсегда"}` }, 403);
  }

  if (s.bool("captchaEnabled")) {
    const ok = await verifyCaptcha(body.captchaToken, body.captchaAnswer);
    if (!ok) return json({ error: "Неверная капча", captcha: true }, 400);
  }

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const err = validUsername(username, s.num("minUsernameLen"), s.num("maxUsernameLen"));
  if (err) return json({ error: err }, 400);
  for (const mask of s.lines("reservedNames")) {
    if (matchesMask(username, mask)) return json({ error: "Этот ник зарезервирован" }, 400);
  }
  if (password.length < s.num("minPasswordLen")) return json({ error: `Пароль должен быть не короче ${s.num("minPasswordLen")} символов` }, 400);
  if (password.length > 128) return json({ error: "Пароль слишком длинный" }, 400);
  if (password.toLowerCase() === username.toLowerCase()) return json({ error: "Пароль не должен совпадать с ником" }, 400);
  if (password !== String(body.password2 ?? password)) return json({ error: "Пароли не совпадают" }, 400);

  const dup = await db.select({ id: users.id }).from(users).where(eq(users.usernameLower, username.toLowerCase())).limit(1);
  if (dup[0]) return json({ error: "Этот ник уже занят" }, 409);

  const limit = s.num("maxRegsPerIpPerDay");
  if (limit > 0) {
    const [r] = await db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.regIp, ip), gt(users.createdAt, new Date(Date.now() - 86400_000))));
    if ((r?.n ?? 0) >= limit) return json({ error: "Слишком много регистраций с вашего IP. Попробуйте завтра" }, 429);
  }

  const roleRows = await db.select().from(roles).where(eq(roles.slug, s.str("defaultRoleSlug"))).limit(1);
  const role = roleRows[0] ?? (await db.select().from(roles).where(eq(roles.slug, "member")).limit(1))[0];
  const pending = s.bool("requireApproval");
  const colors = ["#7c3aed", "#2563eb", "#0891b2", "#059669", "#d97706", "#dc2626", "#c026d3", "#4f46e5"];
  const [u] = await db
    .insert(users)
    .values({
      username,
      usernameLower: username.toLowerCase(),
      passwordHash: hashPassword(password),
      roleId: role.id,
      status: pending ? "pending" : "active",
      regIp: ip,
      lastIp: ip,
      regHwHash: hw,
      avatarColor: colors[Math.floor(Math.random() * colors.length)],
    })
    .returning({ id: users.id });
  await audit({ id: u.id, name: username }, "auth.register", username, pending ? "ожидает одобрения" : "", ip);

  if (pending) return json({ ok: true, pending: true });
  await createSession(u.id, hw);
  (await cookies()).set(HW_COOKIE, hw, { path: "/", maxAge: 86400 * 365, sameSite: "lax" });
  return json({ ok: true });
}
