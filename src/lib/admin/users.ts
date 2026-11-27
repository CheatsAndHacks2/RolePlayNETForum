import { and, count, desc, eq, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bans, loginLog, notifications, postLikes, posts, roles, sessions, threads, users, warnings } from "@/db/schema";
import { hashPassword, notify, validUsername } from "@/lib/auth";
import { fmtDate } from "@/lib/constants";
import { recountAll, recountForum, recountThread, recountUser } from "@/lib/forumops";
import {
  act, fArea, fBool, fDur, fId, fNum, fRole, fText, fUser, fail, findRole, findUser, ghostUser, guardUser, kv, killSessions, log, tbl, until,
  type ActionDef, type Field, type P,
} from "./core";

const G = "Пользователи";

function simple(
  id: string, title: string, desc: string, field: Field | null,
  apply: (p: P) => Partial<typeof users.$inferInsert>, perm = "users.edit", self = true,
): ActionDef {
  return act({
    id, group: G, title, desc, perm,
    fields: field ? [fUser(), field] : [fUser()],
    run: async (ctx, p) => {
      const t = await guardUser(ctx, p.s("user"), { self });
      await db.update(users).set(apply(p)).where(eq(users.id, t.u.id));
      await log(ctx, id, t.u.username);
      return { message: `Готово: ${t.u.username}` };
    },
  });
}

async function recountForumsOf(userId: number) {
  const ts = await db.select({ f: threads.forumId }).from(threads).where(eq(threads.authorId, userId));
  const ps = await db.select({ t: posts.threadId }).from(posts).where(eq(posts.authorId, userId));
  for (const t of new Set(ps.map((x) => x.t))) await recountThread(t);
  const forumIds = new Set(ts.map((x) => x.f));
  for (const t of new Set(ps.map((x) => x.t))) {
    const th = await db.select().from(threads).where(eq(threads.id, t)).limit(1);
    if (th[0]) forumIds.add(th[0].forumId);
  }
  for (const f of forumIds) await recountForum(f);
  await recountUser(userId);
}

async function removeUserHard(userId: number) {
  const ghost = await ghostUser();
  await db.update(posts).set({ authorId: ghost }).where(eq(posts.authorId, userId));
  await db.update(threads).set({ authorId: ghost }).where(eq(threads.authorId, userId));
  await db.update(posts).set({ editedBy: null }).where(eq(posts.editedBy, userId));
  await db.delete(postLikes).where(eq(postLikes.userId, userId));
  await db.delete(notifications).where(eq(notifications.userId, userId));
  await db.delete(warnings).where(eq(warnings.userId, userId));
  await killSessions(userId);
  await db.delete(users).where(eq(users.id, userId));
}

export const userActions: ActionDef[] = [
  act({
    id: "user.info", group: G, title: "Досье пользователя", desc: "Полная информация об аккаунте: IP, железо, баны, сессии", perm: "users.view",
    fields: [fUser()],
    run: async (_c, p) => {
      const { u, role } = await findUser(p.s("user"));
      const [b] = await db.select({ n: count() }).from(bans).where(and(eq(bans.userId, u.id), eq(bans.isActive, true)));
      const [s] = await db.select({ n: count() }).from(sessions).where(eq(sessions.userId, u.id));
      return {
        message: `Досье: ${u.username}`,
        data: kv([
          ["ID", u.id], ["Ник", u.username], ["Роль", role.name], ["Статус", u.status],
          ["Регистрация", fmtDate(u.createdAt)], ["Последний вход", fmtDate(u.lastLoginAt)], ["Был(а) онлайн", fmtDate(u.lastSeenAt)],
          ["IP регистрации", u.regIp], ["Последний IP", u.lastIp],
          ["Привязка к железу", u.hwHash ? u.hwHash.slice(0, 16) + "…" : "нет"], ["Железо при регистрации", u.regHwHash ? u.regHwHash.slice(0, 16) + "…" : "—"],
          ["Блок по железу", u.hwLocked ? "ВКЛ" : "выкл"], ["Защищён", u.isProtected ? "да" : "нет"],
          ["Сообщений", u.postsCount], ["Тем", u.threadsCount], ["Репутация", u.reputation], ["Очки варнов", u.warnPoints],
          ["Мут до", u.mutedUntil && u.mutedUntil > new Date() ? fmtDate(u.mutedUntil) : "нет"],
          ["Активных банов", b?.n ?? 0], ["Активных сессий", s?.n ?? 0], ["Неудачных входов", u.failedLogins],
          ["Заметка", u.adminNote],
        ]),
      };
    },
  }),
  act({
    id: "user.search", group: G, title: "Поиск пользователей", desc: "Поиск по части ника", perm: "users.view",
    fields: [fText("q", "Часть ника", true)],
    run: async (_c, p) => {
      const rows = await db.select({ u: users, r: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId))
        .where(ilike(users.username, `%${p.s("q").replace(/[%_]/g, "")}%`)).orderBy(users.id).limit(50);
      return { message: `Найдено: ${rows.length}`, data: tbl(["ID", "Ник", "Роль", "Статус", "Последний IP"], rows.map((x) => [x.u.id, x.u.username, x.r.name, x.u.status, x.u.lastIp])) };
    },
  }),
  act({
    id: "user.listByRole", group: G, title: "Участники роли", desc: "Список пользователей с выбранной ролью", perm: "users.view",
    fields: [fRole()],
    run: async (_c, p) => {
      const r = await findRole(p.s("role"));
      const rows = await db.select().from(users).where(eq(users.roleId, r.id)).orderBy(users.id).limit(200);
      return { message: `${r.name}: ${rows.length}`, data: tbl(["ID", "Ник", "Статус", "Сообщений", "Регистрация"], rows.map((u) => [u.id, u.username, u.status, u.postsCount, fmtDate(u.createdAt)])) };
    },
  }),
  act({
    id: "user.setRole", group: G, title: "Выдать роль", desc: "Назначить пользователю любую роль ниже вашей", perm: "users.role",
    fields: [fUser(), fRole()],
    run: async (ctx, p) => {
      const t = await guardUser(ctx, p.s("user"));
      const role = await findRole(p.s("role"));
      if (!ctx.v.isFounder && role.level >= ctx.v.level) fail("Нельзя выдать роль, равную или выше вашей");
      if (role.slug === "founder" && !ctx.v.isFounder) fail("Роль основателя может выдать только основатель");
      await db.update(users).set({ roleId: role.id }).where(eq(users.id, t.u.id));
      await notify(t.u.id, `Ваша роль изменена: ${t.role.name} → ${role.name}`);
      await log(ctx, "user.setRole", t.u.username, `${t.role.name} → ${role.name}`);
      return { message: `${t.u.username}: теперь «${role.name}»` };
    },
  }),
  act({
    id: "user.massRole", group: G, title: "Массовая смена роли", desc: "Перевести всех участников одной роли в другую", perm: "users.role", danger: true,
    fields: [fRole("from", "Из роли"), fRole("to", "В роль")],
    run: async (ctx, p) => {
      const a = await findRole(p.s("from"));
      const b = await findRole(p.s("to"));
      if (!ctx.v.isFounder && (a.level >= ctx.v.level || b.level >= ctx.v.level)) fail("Нельзя работать с ролями не ниже вашей");
      const res = await db.update(users).set({ roleId: b.id }).where(and(eq(users.roleId, a.id), eq(users.isProtected, false))).returning({ id: users.id });
      await log(ctx, "user.massRole", `${a.name} → ${b.name}`, `${res.length} польз.`);
      return { message: `Переведено пользователей: ${res.length}` };
    },
  }),
  act({
    id: "user.rename", group: G, title: "Сменить ник", desc: "Изменить имя пользователя", perm: "users.edit",
    fields: [fUser(), fText("name", "Новый ник", true)],
    run: async (ctx, p) => {
      const t = await guardUser(ctx, p.s("user"), { self: true });
      const name = p.s("name");
      const e = validUsername(name, ctx.s.num("minUsernameLen"), ctx.s.num("maxUsernameLen"));
      if (e) fail(e);
      const dup = await db.select({ id: users.id }).from(users).where(eq(users.usernameLower, name.toLowerCase())).limit(1);
      if (dup[0] && dup[0].id !== t.u.id) fail("Ник уже занят");
      await db.update(users).set({ username: name, usernameLower: name.toLowerCase() }).where(eq(users.id, t.u.id));
      await log(ctx, "user.rename", t.u.username, `→ ${name}`);
      return { message: `${t.u.username} → ${name}` };
    },
  }),
  act({
    id: "user.resetPassword", group: G, title: "Сбросить пароль", desc: "Установить новый пароль и завершить все сессии", perm: "users.password", danger: true,
    fields: [fUser(), { name: "password", label: "Новый пароль", type: "password", required: true }, fBool("force", "Потребовать смену при входе", "1")],
    run: async (ctx, p) => {
      const t = await guardUser(ctx, p.s("user"));
      const pw = p.s("password");
      if (pw.length < ctx.s.num("minPasswordLen")) fail(`Пароль короче ${ctx.s.num("minPasswordLen")} символов`);
      await db.update(users).set({ passwordHash: hashPassword(pw), forcePwChange: p.b("force") }).where(eq(users.id, t.u.id));
      await killSessions(t.u.id);
      await log(ctx, "user.resetPassword", t.u.username);
      return { message: `Пароль ${t.u.username} изменён, сессии завершены` };
    },
  }),
  simple("user.forcePwChange", "Требовать смену пароля", "Пользователь обязан сменить пароль при следующем входе", fBool("value", "Включить", "1"),
    (p) => ({ forcePwChange: p.b("value") }), "users.password", false),
  simple("user.setTitle", "Установить титул", "Кастомная подпись под ником", fText("value", "Титул (пусто — убрать)", false, { placeholder: "Например: Мастер сюжета" }),
    (p) => ({ customTitle: p.s("value").slice(0, 40) })),
  simple("user.setSignature", "Изменить подпись", "Подпись под сообщениями", fArea("value", "Подпись"), (p) => ({ signature: p.s("value").slice(0, 300) })),
  simple("user.setAbout", "Изменить «О себе»", "Текст профиля", fArea("value", "Текст"), (p) => ({ about: p.s("value").slice(0, 1000) })),
  simple("user.setLocation", "Изменить город", "Поле «Откуда»", fText("value", "Город"), (p) => ({ location: p.s("value").slice(0, 60) })),
  simple("user.clearAvatar", "Удалить аватар", "Убрать ссылку на аватар", null, () => ({ avatarUrl: "" })),
  simple("user.setAvatarColor", "Цвет аватара", "Цвет заглушки аватара", { name: "value", label: "Цвет", type: "color", def: "#7c3aed" },
    (p) => ({ avatarColor: /^#[0-9a-fA-F]{6}$/.test(p.s("value")) ? p.s("value") : "#7c3aed" })),
  simple("user.clearProfile", "Очистить профиль", "Стереть о себе, подпись, сайт, город, титул и аватар", null,
    () => ({ about: "", signature: "", website: "", location: "", customTitle: "", avatarUrl: "" })),
  simple("user.setReputation", "Установить репутацию", "Задать значение репутации", fNum("value", "Репутация", true), (p) => ({ reputation: Math.round(p.n("value")) })),
  simple("user.setJoinDate", "Изменить дату регистрации", "Формат: ГГГГ-ММ-ДД", fText("value", "Дата", true, { placeholder: "2025-01-31" }), (p) => {
    const d = new Date(p.s("value"));
    if (isNaN(d.getTime())) fail("Неверная дата");
    return { createdAt: d };
  }),
  simple("user.hideOnline", "Скрыть из «онлайн»", "Не показывать пользователя в списке онлайн", fBool("value", "Скрыть", "1"), (p) => ({ hideOnline: p.b("value") })),
  simple("user.setNote", "Заметка администратора", "Приватная заметка о пользователе", fArea("value", "Заметка"), (p) => ({ adminNote: p.s("value").slice(0, 1000) }), "users.view"),
  act({
    id: "user.mute", group: G, title: "Выдать мут", desc: "Запретить писать на форуме на срок", perm: "users.mute",
    fields: [fUser(), fDur(), fText("reason", "Причина", true)],
    run: async (ctx, p) => {
      const t = await guardUser(ctx, p.s("user"));
      const d = until(p.n("duration", 1440));
      await db.update(users).set({ mutedUntil: d ?? new Date("2999-01-01"), muteReason: p.s("reason") }).where(eq(users.id, t.u.id));
      await notify(t.u.id, `Вам выдан мут${d ? " до " + fmtDate(d) : " навсегда"}. Причина: ${p.s("reason")}`);
      await log(ctx, "user.mute", t.u.username, p.s("reason"));
      return { message: `${t.u.username} в муте ${d ? "до " + fmtDate(d) : "навсегда"}` };
    },
  }),
  simple("user.unmute", "Снять мут", "Вернуть возможность писать", null, () => ({ mutedUntil: null, muteReason: "" }), "users.mute", false),
  act({
    id: "user.warn", group: G, title: "Выдать предупреждение", desc: "Варн с очками. При достижении лимита — автобан", perm: "users.warn",
    fields: [fUser(), fNum("points", "Очки", true, { def: "1" }), fText("reason", "Причина", true), fDur("duration", "Срок действия варна", "0")],
    run: async (ctx, p) => {
      const t = await guardUser(ctx, p.s("user"));
      const pts = Math.max(1, Math.min(100, Math.round(p.n("points", 1))));
      await db.insert(warnings).values({ userId: t.u.id, points: pts, reason: p.s("reason"), issuedBy: ctx.actor.name, expiresAt: until(p.n("duration", 0)) });
      const total = t.u.warnPoints + pts;
      await db.update(users).set({ warnPoints: total }).where(eq(users.id, t.u.id));
      await notify(t.u.id, `Вы получили предупреждение (+${pts}). Причина: ${p.s("reason")}`);
      let extra = "";
      const lim = ctx.s.num("autoWarnLimit");
      if (lim > 0 && total >= lim) {
        await db.insert(bans).values({ userId: t.u.id, username: t.u.username, reason: `Автобан: превышен лимит предупреждений (${total}/${lim})`, bannedByName: "система", expiresAt: until(ctx.s.num("autoBanDays") * 1440) });
        await killSessions(t.u.id);
        extra = " Достигнут лимит — выдан автобан.";
      }
      await log(ctx, "user.warn", t.u.username, `+${pts}: ${p.s("reason")}`);
      return { message: `Варн выдан (${total} оч.).${extra}` };
    },
  }),
  act({
    id: "user.unwarn", group: G, title: "Снять предупреждение", desc: "Удалить варн по ID", perm: "users.warn",
    fields: [fId("warnId", "ID варна")],
    run: async (ctx, p) => {
      const w = await db.select().from(warnings).where(eq(warnings.id, p.int("warnId"))).limit(1);
      if (!w[0]) fail("Варн не найден");
      const u = await db.select().from(users).where(eq(users.id, w[0].userId)).limit(1);
      await db.delete(warnings).where(eq(warnings.id, w[0].id));
      if (u[0]) await db.update(users).set({ warnPoints: Math.max(0, u[0].warnPoints - w[0].points) }).where(eq(users.id, u[0].id));
      await log(ctx, "user.unwarn", u[0]?.username ?? "", `варн #${w[0].id}`);
      return { message: "Варн снят" };
    },
  }),
  act({
    id: "user.clearWarns", group: G, title: "Обнулить предупреждения", desc: "Удалить все варны пользователя", perm: "users.warn",
    fields: [fUser()],
    run: async (ctx, p) => {
      const t = await guardUser(ctx, p.s("user"), { self: true });
      await db.delete(warnings).where(eq(warnings.userId, t.u.id));
      await db.update(users).set({ warnPoints: 0 }).where(eq(users.id, t.u.id));
      await log(ctx, "user.clearWarns", t.u.username);
      return { message: "Варны обнулены" };
    },
  }),
  act({
    id: "user.warnings", group: G, title: "Список предупреждений", desc: "История варнов пользователя", perm: "users.warn",
    fields: [fUser()],
    run: async (_c, p) => {
      const t = await findUser(p.s("user"));
      const rows = await db.select().from(warnings).where(eq(warnings.userId, t.u.id)).orderBy(desc(warnings.createdAt)).limit(100);
      return { message: `Варнов: ${rows.length}`, data: tbl(["ID", "Очки", "Причина", "Выдал", "Дата"], rows.map((w) => [w.id, w.points, w.reason, w.issuedBy, fmtDate(w.createdAt)])) };
    },
  }),
  act({
    id: "user.hwReset", group: G, title: "Сбросить привязку к железу", desc: "Следующий вход заново привяжет аккаунт к устройству", perm: "users.hw", danger: true,
    fields: [fUser()],
    run: async (ctx, p) => {
      const t = await findUser(p.s("user"));
      if (t.u.isProtected && t.u.id !== ctx.actor.id && !ctx.v.isFounder) fail("Только основатель может сбросить привязку защищённого аккаунта");
      if (t.u.id !== ctx.actor.id && !ctx.v.isFounder && ctx.v.level <= t.role.level) fail("Недостаточно прав");
      await db.update(users).set({ hwHash: null }).where(eq(users.id, t.u.id));
      await killSessions(t.u.id === ctx.actor.id ? -1 : t.u.id);
      await log(ctx, "user.hwReset", t.u.username);
      return { message: `Привязка ${t.u.username} сброшена` };
    },
  }),
  act({
    id: "user.hwLock", group: G, title: "Блокировка входа по железу", desc: "Разрешить вход только с привязанного устройства", perm: "users.hw",
    fields: [fUser(), fBool("value", "Включить", "1")],
    run: async (ctx, p) => {
      const t = await guardUser(ctx, p.s("user"), { self: false });
      await db.update(users).set({ hwLocked: p.b("value") }).where(eq(users.id, t.u.id));
      await log(ctx, "user.hwLock", t.u.username, p.b("value") ? "вкл" : "выкл");
      return { message: `Блокировка по железу: ${p.b("value") ? "включена" : "выключена"}` };
    },
  }),
  act({
    id: "user.hwSet", group: G, title: "Задать привязку вручную", desc: "Установить хеш устройства (64 hex)", perm: "users.hw", danger: true,
    fields: [fUser(), fText("hash", "Хеш устройства", true)],
    run: async (ctx, p) => {
      const t = await guardUser(ctx, p.s("user"));
      if (!/^[a-f0-9]{64}$/.test(p.s("hash"))) fail("Хеш должен состоять из 64 hex-символов");
      await db.update(users).set({ hwHash: p.s("hash") }).where(eq(users.id, t.u.id));
      await log(ctx, "user.hwSet", t.u.username);
      return { message: "Привязка задана" };
    },
  }),
  act({
    id: "user.protect", group: G, title: "Защитить аккаунт", desc: "Защищённый аккаунт нельзя банить, удалять и менять", perm: "system.manage",
    fields: [fUser(), fBool("value", "Защитить", "1")],
    run: async (ctx, p) => {
      const t = await findUser(p.s("user"));
      if (t.u.id === ctx.actor.id && !p.b("value")) fail("Нельзя снять защиту с самого себя");
      await db.update(users).set({ isProtected: p.b("value") }).where(eq(users.id, t.u.id));
      await log(ctx, "user.protect", t.u.username, p.b("value") ? "вкл" : "выкл");
      return { message: `Защита: ${p.b("value") ? "включена" : "снята"}` };
    },
  }),
  act({
    id: "user.logout", group: G, title: "Завершить все сессии", desc: "Принудительный выход пользователя", perm: "users.sessions",
    fields: [fUser()],
    run: async (ctx, p) => {
      const t = await guardUser(ctx, p.s("user"), { self: false });
      await killSessions(t.u.id);
      await log(ctx, "user.logout", t.u.username);
      return { message: "Сессии завершены" };
    },
  }),
  act({
    id: "user.sessions", group: G, title: "Активные сессии", desc: "Где сейчас авторизован пользователь", perm: "users.sessions",
    fields: [fUser()],
    run: async (_c, p) => {
      const t = await findUser(p.s("user"));
      const rows = await db.select().from(sessions).where(eq(sessions.userId, t.u.id)).orderBy(desc(sessions.createdAt)).limit(50);
      return { message: `Сессий: ${rows.length}`, data: tbl(["Создана", "IP", "Устройство (UA)", "Истекает"], rows.map((s) => [fmtDate(s.createdAt), s.ip, s.userAgent.slice(0, 60), fmtDate(s.expiresAt)])) };
    },
  }),
  act({
    id: "user.loginHistory", group: G, title: "История входов", desc: "Последние попытки входа пользователя", perm: "users.view",
    fields: [fUser()],
    run: async (_c, p) => {
      const t = await findUser(p.s("user"));
      const rows = await db.select().from(loginLog).where(eq(loginLog.userId, t.u.id)).orderBy(desc(loginLog.createdAt)).limit(40);
      return { message: `Записей: ${rows.length}`, data: tbl(["Дата", "IP", "Результат", "Причина"], rows.map((l) => [fmtDate(l.createdAt), l.ip, l.success ? "успех" : "отказ", l.reason])) };
    },
  }),
  simple("user.unlockLogin", "Разблокировать вход", "Сбросить счётчик неудачных входов", null, () => ({ failedLogins: 0 }), "users.edit"),
  act({
    id: "user.approve", group: G, title: "Одобрить регистрацию", desc: "Активировать аккаунт из очереди", perm: "users.approve",
    fields: [fUser()],
    run: async (ctx, p) => {
      const t = await findUser(p.s("user"));
      if (t.u.status !== "pending") fail("Аккаунт не ожидает одобрения");
      await db.update(users).set({ status: "active" }).where(eq(users.id, t.u.id));
      await log(ctx, "user.approve", t.u.username);
      return { message: `${t.u.username} одобрен` };
    },
  }),
  act({
    id: "user.approveAll", group: G, title: "Одобрить всех из очереди", desc: "Активировать все ожидающие аккаунты", perm: "users.approve",
    fields: [],
    run: async (ctx) => {
      const r = await db.update(users).set({ status: "active" }).where(eq(users.status, "pending")).returning({ id: users.id });
      await log(ctx, "user.approveAll", "", `${r.length}`);
      return { message: `Одобрено: ${r.length}` };
    },
  }),
  act({
    id: "user.reject", group: G, title: "Отклонить регистрацию", desc: "Удалить ожидающий аккаунт", perm: "users.approve",
    fields: [fUser()],
    run: async (ctx, p) => {
      const t = await findUser(p.s("user"));
      if (t.u.status !== "pending") fail("Аккаунт не ожидает одобрения");
      await removeUserHard(t.u.id);
      await log(ctx, "user.reject", t.u.username);
      return { message: "Заявка отклонена" };
    },
  }),
  act({
    id: "user.create", group: G, title: "Создать аккаунт", desc: "Ручное создание пользователя с выбранной ролью", perm: "users.create",
    fields: [fText("username", "Ник", true), { name: "password", label: "Пароль", type: "password", required: true }, fRole()],
    run: async (ctx, p) => {
      const name = p.s("username");
      const e = validUsername(name, ctx.s.num("minUsernameLen"), ctx.s.num("maxUsernameLen"));
      if (e) fail(e);
      if (p.s("password").length < ctx.s.num("minPasswordLen")) fail("Пароль слишком короткий");
      const role = await findRole(p.s("role"));
      if (!ctx.v.isFounder && role.level >= ctx.v.level) fail("Нельзя создать аккаунт с ролью не ниже вашей");
      const dup = await db.select({ id: users.id }).from(users).where(eq(users.usernameLower, name.toLowerCase())).limit(1);
      if (dup[0]) fail("Ник уже занят");
      await db.insert(users).values({ username: name, usernameLower: name.toLowerCase(), passwordHash: hashPassword(p.s("password")), roleId: role.id });
      await log(ctx, "user.create", name, role.name);
      return { message: `Аккаунт ${name} создан` };
    },
  }),
  act({
    id: "user.delete", group: G, title: "Удалить аккаунт", desc: "Мягко (можно восстановить) или полностью", perm: "users.delete", danger: true,
    fields: [
      fUser(),
      { name: "mode", label: "Режим", type: "select", def: "soft", options: [{ value: "soft", label: "Мягкое (скрыть, можно восстановить)" }, { value: "hard", label: "Полное (безвозвратно)" }] },
      fBool("content", "Скрыть сообщения и темы пользователя", "0"),
    ],
    run: async (ctx, p) => {
      const t = await guardUser(ctx, p.s("user"));
      if (p.b("content")) {
        await db.update(posts).set({ isHidden: true }).where(eq(posts.authorId, t.u.id));
        await db.update(threads).set({ isHidden: true }).where(eq(threads.authorId, t.u.id));
        await recountForumsOf(t.u.id);
      }
      if (p.s("mode") === "hard") await removeUserHard(t.u.id);
      else {
        await db.update(users).set({ status: "deleted" }).where(eq(users.id, t.u.id));
        await killSessions(t.u.id);
      }
      await log(ctx, "user.delete", t.u.username, p.s("mode"));
      return { message: `Аккаунт ${t.u.username} удалён (${p.s("mode") === "hard" ? "полностью" : "мягко"})` };
    },
  }),
  act({
    id: "user.restore", group: G, title: "Восстановить аккаунт", desc: "Вернуть мягко удалённого пользователя", perm: "users.delete",
    fields: [fUser()],
    run: async (ctx, p) => {
      const t = await findUser(p.s("user"));
      if (t.u.status !== "deleted") fail("Аккаунт не удалён");
      await db.update(users).set({ status: "active" }).where(eq(users.id, t.u.id));
      await log(ctx, "user.restore", t.u.username);
      return { message: "Аккаунт восстановлен" };
    },
  }),
  act({
    id: "user.purgeContent", group: G, title: "Скрыть весь контент пользователя", desc: "Скрыть все его сообщения и темы (антиспам)", perm: "content.delete", danger: true,
    fields: [fUser()],
    run: async (ctx, p) => {
      const t = await guardUser(ctx, p.s("user"), { self: true });
      await db.update(posts).set({ isHidden: true }).where(eq(posts.authorId, t.u.id));
      await db.update(threads).set({ isHidden: true }).where(eq(threads.authorId, t.u.id));
      await recountForumsOf(t.u.id);
      await log(ctx, "user.purgeContent", t.u.username);
      return { message: "Контент скрыт" };
    },
  }),
  act({
    id: "user.restoreContent", group: G, title: "Вернуть контент пользователя", desc: "Показать все скрытые сообщения и темы", perm: "content.delete",
    fields: [fUser()],
    run: async (ctx, p) => {
      const t = await findUser(p.s("user"));
      await db.update(posts).set({ isHidden: false }).where(eq(posts.authorId, t.u.id));
      await db.update(threads).set({ isHidden: false }).where(eq(threads.authorId, t.u.id));
      await recountForumsOf(t.u.id);
      await log(ctx, "user.restoreContent", t.u.username);
      return { message: "Контент восстановлен" };
    },
  }),
  act({
    id: "user.recount", group: G, title: "Пересчитать счётчики", desc: "Сообщения и темы пользователя", perm: "users.edit",
    fields: [fUser()],
    run: async (_c, p) => {
      const t = await findUser(p.s("user"));
      await recountUser(t.u.id);
      return { message: "Счётчики обновлены" };
    },
  }),
  act({
    id: "user.lookupIp", group: G, title: "Аккаунты по IP", desc: "Найти все аккаунты с данным IP (поддерживается маска *)", perm: "users.view",
    fields: [fText("ip", "IP", true, { placeholder: "1.2.3.4 или 1.2.*" })],
    run: async (_c, p) => {
      const ip = p.s("ip");
      const pat = ip.replace(/[%_]/g, "").replace(/\*/g, "%");
      const rows = await db.select().from(users).where(or(sql`${users.lastIp} like ${pat}`, sql`${users.regIp} like ${pat}`)).limit(100);
      return { message: `Найдено: ${rows.length}`, data: tbl(["ID", "Ник", "IP регистрации", "Последний IP", "Последний вход"], rows.map((u) => [u.id, u.username, u.regIp, u.lastIp, fmtDate(u.lastLoginAt)])) };
    },
  }),
  act({
    id: "user.lookupHw", group: G, title: "Аккаунты по железу", desc: "Найти все аккаунты с данным хешем устройства", perm: "users.view",
    fields: [fText("hash", "Хеш (или его начало)", true)],
    run: async (_c, p) => {
      const h = p.s("hash").replace(/[^a-f0-9]/gi, "").toLowerCase();
      if (h.length < 6) fail("Введите минимум 6 символов хеша");
      const rows = await db.select().from(users).where(or(sql`${users.hwHash} like ${h + "%"}`, sql`${users.regHwHash} like ${h + "%"}`)).limit(100);
      return { message: `Найдено: ${rows.length}`, data: tbl(["ID", "Ник", "Привязка", "Железо при регистрации"], rows.map((u) => [u.id, u.username, u.hwHash?.slice(0, 14) ?? "—", u.regHwHash?.slice(0, 14) ?? "—"])) };
    },
  }),
  act({
    id: "user.multiAccounts", group: G, title: "Поиск мультиаккаунтов", desc: "Группы аккаунтов с одинаковым IP или железом", perm: "users.view",
    fields: [{ name: "by", label: "Критерий", type: "select", def: "ip", options: [{ value: "ip", label: "По IP" }, { value: "hw", label: "По железу" }] }],
    run: async (_c, p) => {
      const q = p.s("by") === "hw"
        ? sql`select left(reg_hw_hash, 14) k, count(*)::int c, string_agg(username, ', ') n from users where reg_hw_hash is not null group by reg_hw_hash having count(*) > 1 order by c desc limit 50`
        : sql`select last_ip k, count(*)::int c, string_agg(username, ', ') n from users where last_ip <> '' group by last_ip having count(*) > 1 order by c desc limit 50`;
      const r = await db.execute(q);
      const rows = r.rows as { k: string; c: number; n: string }[];
      return { message: `Групп: ${rows.length}`, data: tbl(["Ключ", "Аккаунтов", "Ники"], rows.map((x) => [x.k, x.c, x.n])) };
    },
  }),
  act({
    id: "user.purgeInactive", group: G, title: "Удалить неактивные аккаунты", desc: "Мягко удалить пользователей без сообщений, не заходивших N дней", perm: "users.delete", danger: true,
    fields: [fNum("days", "Дней неактивности", true, { def: "90" })],
    run: async (ctx, p) => {
      const days = Math.max(7, p.n("days", 90));
      const cutoff = new Date(Date.now() - days * 86400_000);
      const rows = await db.select({ u: users, r: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId))
        .where(and(eq(users.status, "active"), eq(users.postsCount, 0), eq(users.threadsCount, 0), eq(users.isProtected, false), lt(users.createdAt, cutoff), or(isNull(users.lastSeenAt), lt(users.lastSeenAt, cutoff))));
      const ids = rows.filter((x) => x.r.level < Math.max(ctx.v.level, ctx.v.isFounder ? 101 : 0)).map((x) => x.u.id);
      if (ids.length) {
        await db.update(users).set({ status: "deleted" }).where(inArray(users.id, ids));
        await db.delete(sessions).where(inArray(sessions.userId, ids));
      }
      await log(ctx, "user.purgeInactive", "", `${ids.length}`);
      return { message: `Удалено неактивных: ${ids.length}` };
    },
  }),
  act({
    id: "sys.deleteDemo", group: G, title: "Удалить демо-аккаунты", desc: "Удалить тестовых пользователей и их контент (очистка тестового форума)", perm: "system.manage", danger: true,
    fields: [fBool("content", "Также удалить их темы и сообщения", "1")],
    run: async (ctx, p) => {
      const demo = await db.select().from(users).where(sql`${users.adminNote} like 'Демо-аккаунт%'`);
      for (const u of demo) {
        if (p.b("content")) {
          await db.update(posts).set({ isHidden: true }).where(eq(posts.authorId, u.id));
          await db.update(threads).set({ isHidden: true }).where(eq(threads.authorId, u.id));
        }
        await removeUserHard(u.id);
      }
      await recountAll();
      await log(ctx, "sys.deleteDemo", "", `${demo.length}`);
      return { message: `Удалено демо-аккаунтов: ${demo.length}` };
    },
  }),
];
