import { cookies } from "next/headers";
import { and, count, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { loginLog, users } from "@/db/schema";
import { HW_COOKIE, HW_RE, audit, createSession, findActiveBan, getIp, getUa, json, verifyPassword } from "@/lib/auth";
import { verifyCaptcha } from "@/lib/captcha";
import { getSettings } from "@/lib/settings";
import { ensureSeed } from "@/lib/seed";
import { fmtDate } from "@/lib/constants";

export const dynamic = "force-dynamic";

const DUMMY = "s1$00000000000000000000000000000000$" + "0".repeat(128);

export async function POST(req: Request) {
  await ensureSeed();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Некорректный запрос" }, 400);
  const s = await getSettings();
  const ip = await getIp();
  const ua = await getUa();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const hw = typeof body.hw === "string" && HW_RE.test(body.hw) ? body.hw : null;
  if (!username || !password) return json({ error: "Введите ник и пароль" }, 400);

  const log = (userId: number | null, success: boolean, reason: string) =>
    db.insert(loginLog).values({ userId, username: username.slice(0, 64), ip, hwHash: hw, success, reason, userAgent: ua });

  // brute-force protection
  const windowStart = new Date(Date.now() - Math.max(1, s.num("lockoutMinutes")) * 60_000);
  const [fails] = await db
    .select({ n: count() })
    .from(loginLog)
    .where(and(eq(loginLog.ip, ip), eq(loginLog.success, false), gt(loginLog.createdAt, windowStart)));
  const failN = fails?.n ?? 0;
  if (s.num("maxLoginAttempts") > 0 && failN >= s.num("maxLoginAttempts")) {
    return json({ error: `Слишком много неудачных попыток. Повторите через ${s.num("lockoutMinutes")} мин.` }, 429);
  }
  if (s.num("captchaAfterFails") > 0 && failN >= s.num("captchaAfterFails")) {
    const ok = await verifyCaptcha(body.captchaToken, body.captchaAnswer);
    if (!ok) return json({ error: body.captchaAnswer ? "Неверная капча" : "Подтвердите, что вы не бот", needCaptcha: true }, 400);
  }

  const rows = await db.select().from(users).where(eq(users.usernameLower, username.toLowerCase())).limit(1);
  const user = rows[0];
  const okPw = verifyPassword(password, user?.passwordHash ?? DUMMY);
  if (!user || !okPw || user.status === "deleted") {
    await log(user?.id ?? null, false, "bad_credentials");
    if (user) await db.update(users).set({ failedLogins: user.failedLogins + 1 }).where(eq(users.id, user.id));
    return json({ error: "Неверный ник или пароль", needCaptcha: s.num("captchaAfterFails") > 0 && failN + 1 >= s.num("captchaAfterFails") }, 401);
  }
  if (user.status === "pending") {
    await log(user.id, false, "pending");
    return json({ error: "Ваш аккаунт ожидает одобрения администрацией" }, 403);
  }

  if (!user.isProtected) {
    const ban = await findActiveBan({ userId: user.id, ip, hw });
    if (ban && !ban.shadow) {
      await log(user.id, false, "banned");
      return json({ error: `Доступ заблокирован. Причина: ${ban.reason || "не указана"}. ${ban.expiresAt ? "До " + fmtDate(ban.expiresAt) : "Навсегда"}` }, 403);
    }
  }

  // hardware lock (owners): first login binds the device, others are rejected
  if (user.hwLocked) {
    if (!hw) {
      await log(user.id, false, "no_hw");
      return json({ error: "Не удалось определить устройство. Обновите страницу" }, 400);
    }
    if (!user.hwHash) {
      await db.update(users).set({ hwHash: hw }).where(eq(users.id, user.id));
      await audit({ id: user.id, name: user.username }, "hw.bind", user.username, "Первый вход: аккаунт привязан к устройству", ip);
    } else if (user.hwHash !== hw) {
      await log(user.id, false, "hw_mismatch");
      await audit({ id: user.id, name: user.username }, "hw.mismatch", user.username, `Попытка входа с чужого устройства (${hw.slice(0, 12)})`, ip);
      return json({ error: "Вход запрещён: аккаунт привязан к другому устройству." }, 403);
    }
  }

  await createSession(user.id, hw);
  if (hw) (await cookies()).set(HW_COOKIE, hw, { path: "/", maxAge: 86400 * 365, sameSite: "lax" });
  await db
    .update(users)
    .set({ lastLoginAt: new Date(), lastIp: ip, lastSeenAt: new Date(), failedLogins: 0, regHwHash: user.regHwHash ?? hw })
    .where(eq(users.id, user.id));
  await log(user.id, true, "ok");
  return json({ ok: true, forcePw: user.forcePwChange });
}
