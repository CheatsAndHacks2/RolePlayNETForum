import { and, count, desc, eq, gt, ilike, inArray, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, bans, loginLog, notifications, posts, reports, sessions, settings, threads, usedCaptchas, users } from "@/db/schema";
import { notify } from "@/lib/auth";
import { SETTING_DEFS, fmtDate } from "@/lib/constants";
import { recountAll } from "@/lib/forumops";
import { setSetting } from "@/lib/settings";
import { act, fArea, fBool, fNum, fRole, fText, fUser, fail, findRole, findUser, kv, log, tbl, type ActionDef, type Field } from "./core";

const SYS = "Система";
const SET = "Настройки";

const GROUP_TITLES: Record<string, [string, string]> = {
  general: ["Основные настройки", "Название, слоган, приветствие, подвал"],
  registration: ["Регистрация и ники", "Правила регистрации, капча, длина ника и пароля, запрещённые ники"],
  security: ["Безопасность и входы", "Блокировки, капча при входе, сессии, проверка банов, автобан"],
  posting: ["Публикации и лимиты", "Антифлуд, пагинация, длины, лайки, подписи, фильтр слов"],
  maintenance: ["Режимы работы", "Техработы, только чтение, доступ гостей"],
  banner: ["Баннер-объявление", "Полоса с объявлением на всех страницах"],
  rules: ["Правила форума", "Текст страницы правил"],
};

function groupAction(group: string): ActionDef {
  const [title, desc] = GROUP_TITLES[group];
  const keys = Object.keys(SETTING_DEFS).filter((k) => SETTING_DEFS[k].group === group);
  const fields: Field[] = keys.map((k) => ({
    name: k, label: SETTING_DEFS[k].label, def: SETTING_DEFS[k].def,
    type: SETTING_DEFS[k].type === "bool" ? "bool" : SETTING_DEFS[k].type === "number" ? "number" : SETTING_DEFS[k].type === "textarea" ? "textarea" : SETTING_DEFS[k].type === "color" ? "color" : "text",
  }));
  return act({
    id: `settings.${group}`, group: SET, title, desc, perm: "settings.manage", settingsGroup: group, fields,
    run: async (ctx, p) => {
      const changed: string[] = [];
      for (const k of keys) {
        if (p.raw[k] === undefined) continue;
        const def = SETTING_DEFS[k];
        let val: string;
        if (def.type === "bool") val = p.b(k) ? "1" : "0";
        else if (def.type === "number") {
          const n = Number(p.s(k));
          if (!Number.isFinite(n) || n < 0) fail(`«${def.label}»: введите число ≥ 0`);
          val = String(Math.round(n));
        } else val = String(p.raw[k] ?? "").trim();
        if (val !== ctx.s.str(k)) {
          await setSetting(k, val);
          changed.push(k);
        }
      }
      await log(ctx, `settings.${group}`, group, changed.join(", "));
      return { message: changed.length ? `Сохранено: ${changed.length} параметр(ов)` : "Изменений нет" };
    },
  });
}

function toggle(id: string, title: string, desc: string, key: string): ActionDef {
  return act({
    id, group: SET, title, desc, perm: "settings.manage",
    fields: [fBool("value", "Включить", ctx0(key))],
    run: async (ctx, p) => {
      await setSetting(key, p.b("value") ? "1" : "0");
      await log(ctx, id, key, p.b("value") ? "вкл" : "выкл");
      return { message: `${title}: ${p.b("value") ? "включено" : "выключено"}` };
    },
  });
}
const ctx0 = (key: string) => SETTING_DEFS[key].def;

async function listEdit(ctx: Parameters<ActionDef["run"]>[0], key: string, mutate: (lines: string[]) => string[]) {
  const lines = mutate(ctx.s.lines(key));
  await setSetting(key, lines.join("\n"));
}

export const systemActions: ActionDef[] = [
  ...Object.keys(GROUP_TITLES).map(groupAction),
  toggle("sys.toggleRegistration", "Открыть/закрыть регистрацию", "Быстрый переключатель регистрации", "registrationOpen"),
  toggle("sys.toggleMaintenance", "Режим техработ", "Пускать на форум только персонал", "maintenanceMode"),
  toggle("sys.toggleCaptcha", "Капча при регистрации", "Включить/выключить защиту от ботов", "captchaEnabled"),
  toggle("sys.toggleReadOnly", "Режим «только чтение»", "Запретить писать всем, кроме персонала", "readOnlyMode"),
  toggle("sys.toggleGuests", "Доступ гостей", "Разрешить гостям читать форум", "guestsCanView"),
  toggle("sys.toggleApproval", "Одобрение новых аккаунтов", "Ручная проверка регистраций", "requireApproval"),
  toggle("sys.toggleLikes", "Лайки", "Включить/выключить лайки сообщений", "allowLikes"),
  toggle("sys.toggleBanner", "Баннер-объявление", "Показать/скрыть баннер", "bannerEnabled"),
  act({
    id: "sys.setBanner", group: SET, title: "Опубликовать объявление", desc: "Текст, цвет и включение баннера за один шаг", perm: "settings.manage",
    fields: [fArea("text", "Текст", true), { name: "color", label: "Цвет", type: "color", def: "#7c3aed" }],
    run: async (ctx, p) => {
      await setSetting("bannerText", p.s("text"));
      await setSetting("bannerColor", p.s("color") || "#7c3aed");
      await setSetting("bannerEnabled", "1");
      await log(ctx, "sys.setBanner", "", p.s("text").slice(0, 100));
      return { message: "Объявление опубликовано" };
    },
  }),
  act({
    id: "sys.wordAdd", group: SET, title: "Добавить слово в фильтр", desc: "Слово заменяется звёздочками в новых сообщениях", perm: "settings.manage",
    fields: [fText("word", "Слово", true)],
    run: async (ctx, p) => {
      await listEdit(ctx, "wordFilter", (l) => Array.from(new Set([...l, p.s("word").toLowerCase()])));
      await log(ctx, "sys.wordAdd", p.s("word"));
      return { message: "Слово добавлено" };
    },
  }),
  act({
    id: "sys.wordRemove", group: SET, title: "Убрать слово из фильтра", desc: "Удалить слово из списка", perm: "settings.manage",
    fields: [fText("word", "Слово", true)],
    run: async (ctx, p) => {
      await listEdit(ctx, "wordFilter", (l) => l.filter((x) => x.toLowerCase() !== p.s("word").toLowerCase()));
      await log(ctx, "sys.wordRemove", p.s("word"));
      return { message: "Слово удалено из фильтра" };
    },
  }),
  act({
    id: "sys.reservedAdd", group: SET, title: "Зарезервировать ник", desc: "Запретить регистрацию ника/маски (например, admin*)", perm: "settings.manage",
    fields: [fText("name", "Ник или маска", true)],
    run: async (ctx, p) => {
      await listEdit(ctx, "reservedNames", (l) => Array.from(new Set([...l, p.s("name").toLowerCase()])));
      await log(ctx, "sys.reservedAdd", p.s("name"));
      return { message: "Ник зарезервирован" };
    },
  }),
  act({
    id: "sys.reservedRemove", group: SET, title: "Снять резерв с ника", desc: "Разрешить регистрацию ника", perm: "settings.manage",
    fields: [fText("name", "Ник или маска", true)],
    run: async (ctx, p) => {
      await listEdit(ctx, "reservedNames", (l) => l.filter((x) => x.toLowerCase() !== p.s("name").toLowerCase()));
      await log(ctx, "sys.reservedRemove", p.s("name"));
      return { message: "Резерв снят" };
    },
  }),
  act({
    id: "sys.settingReset", group: SET, title: "Сбросить параметр", desc: "Вернуть одну настройку к значению по умолчанию", perm: "settings.manage",
    fields: [{ name: "key", label: "Параметр", type: "select", required: true, options: Object.keys(SETTING_DEFS).map((k) => ({ value: k, label: `${k} — ${SETTING_DEFS[k].label}` })) }],
    run: async (ctx, p) => {
      if (!SETTING_DEFS[p.s("key")]) fail("Неизвестный параметр");
      await db.delete(settings).where(eq(settings.key, p.s("key")));
      await log(ctx, "sys.settingReset", p.s("key"));
      return { message: "Параметр сброшен" };
    },
  }),
  act({
    id: "sys.settingsResetAll", group: SET, title: "Сбросить ВСЕ настройки", desc: "Вернуть заводские значения", perm: "settings.manage", danger: true,
    fields: [fBool("confirm", "Подтверждаю", "0")],
    run: async (ctx, p) => {
      if (!p.b("confirm")) fail("Подтвердите действие");
      await db.delete(settings).where(sql`${settings.key} <> 'seeded_content_v1'`);
      await log(ctx, "sys.settingsResetAll");
      return { message: "Настройки сброшены" };
    },
  }),
  act({
    id: "sys.settingsDump", group: SET, title: "Показать текущие настройки", desc: "Все параметры с их значениями", perm: "settings.manage",
    fields: [],
    run: async (ctx) => ({ message: "Текущие настройки", data: kv(Object.keys(SETTING_DEFS).map((k) => [k, ctx.s.str(k).slice(0, 80)] as [string, string])) }),
  }),
  act({
    id: "sys.stats", group: SYS, title: "Сводная статистика", desc: "Ключевые цифры форума", perm: "dashboard.view",
    fields: [],
    run: async () => {
      const c = async (t: typeof users | typeof threads | typeof posts | typeof reports | typeof sessions | typeof bans) => ((await db.select({ n: count() }).from(t))[0]?.n ?? 0);
      return { message: "Статистика", data: kv([["Пользователей", await c(users)], ["Тем", await c(threads)], ["Сообщений", await c(posts)], ["Жалоб (всего)", await c(reports)], ["Сессий", await c(sessions)], ["Банов (записей)", await c(bans)]]) };
    },
  }),
  act({
    id: "sys.recountAll", group: SYS, title: "Пересчитать все счётчики", desc: "Темы, сообщения, пользователи, форумы", perm: "system.manage",
    fields: [],
    run: async (ctx) => {
      const r = await recountAll();
      await log(ctx, "sys.recountAll");
      return { message: `Пересчитано: форумов ${r.forums}, тем ${r.threads}, пользователей ${r.users}` };
    },
  }),
  act({
    id: "sys.killAllSessions", group: SYS, title: "Завершить все чужие сессии", desc: "Разлогинить всех, кроме вас", perm: "system.manage", danger: true,
    fields: [fBool("confirm", "Подтверждаю", "0")],
    run: async (ctx, p) => {
      if (!p.b("confirm")) fail("Подтвердите действие");
      const r = await db.delete(sessions).where(ne(sessions.userId, ctx.actor.id)).returning({ id: sessions.id });
      await log(ctx, "sys.killAllSessions", "", `${r.length}`);
      return { message: `Завершено сессий: ${r.length}` };
    },
  }),
  act({
    id: "sys.purgeSessions", group: SYS, title: "Очистить просроченные сессии", desc: "Удалить истёкшие сессии", perm: "users.sessions",
    fields: [],
    run: async (ctx) => {
      const r = await db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ id: sessions.id });
      await log(ctx, "sys.purgeSessions", "", `${r.length}`);
      return { message: `Удалено: ${r.length}` };
    },
  }),
  act({
    id: "sys.cleanupCaptchas", group: SYS, title: "Очистить кэш капчи", desc: "Удалить использованные токены капчи", perm: "system.manage",
    fields: [],
    run: async () => {
      const r = await db.delete(usedCaptchas).where(lt(usedCaptchas.expiresAt, new Date())).returning({ id: usedCaptchas.id });
      return { message: `Удалено: ${r.length}` };
    },
  }),
  act({
    id: "sys.clearAudit", group: SYS, title: "Очистить журнал действий", desc: "Удалить весь журнал аудита", perm: "logs.clear", danger: true,
    fields: [fBool("confirm", "Подтверждаю", "0")],
    run: async (ctx, p) => {
      if (!p.b("confirm")) fail("Подтвердите действие");
      await db.delete(auditLog);
      await log(ctx, "sys.clearAudit");
      return { message: "Журнал очищен" };
    },
  }),
  act({
    id: "sys.clearLogins", group: SYS, title: "Очистить журнал входов", desc: "Удалить историю попыток входа", perm: "logs.clear", danger: true,
    fields: [fBool("confirm", "Подтверждаю", "0")],
    run: async (ctx, p) => {
      if (!p.b("confirm")) fail("Подтвердите действие");
      await db.delete(loginLog);
      await log(ctx, "sys.clearLogins");
      return { message: "Журнал входов очищен" };
    },
  }),
  act({
    id: "sys.purgeOldLogs", group: SYS, title: "Удалить старые логи", desc: "Записи старше N дней", perm: "logs.clear",
    fields: [fNum("days", "Дней", true, { def: "30" })],
    run: async (ctx, p) => {
      const cutoff = new Date(Date.now() - Math.max(1, p.n("days", 30)) * 86400_000);
      const a = await db.delete(auditLog).where(lt(auditLog.createdAt, cutoff)).returning({ id: auditLog.id });
      const b = await db.delete(loginLog).where(lt(loginLog.createdAt, cutoff)).returning({ id: loginLog.id });
      await log(ctx, "sys.purgeOldLogs", "", `аудит ${a.length}, входы ${b.length}`);
      return { message: `Удалено: аудит ${a.length}, входы ${b.length}` };
    },
  }),
  act({
    id: "sys.auditSearch", group: SYS, title: "Поиск по журналу действий", desc: "По действию, цели, исполнителю или деталям", perm: "logs.view",
    fields: [fText("q", "Текст", true)],
    run: async (_c, p) => {
      const q = `%${p.s("q").replace(/[%_]/g, "")}%`;
      const rows = await db.select().from(auditLog).where(or(ilike(auditLog.action, q), ilike(auditLog.target, q), ilike(auditLog.actorName, q), ilike(auditLog.details, q))).orderBy(desc(auditLog.createdAt)).limit(100);
      return { message: `Найдено: ${rows.length}`, data: tbl(["Дата", "Кто", "Действие", "Цель", "Детали"], rows.map((r) => [fmtDate(r.createdAt), r.actorName, r.action, r.target, r.details])) };
    },
  }),
  act({
    id: "sys.loginFailures", group: SYS, title: "Неудачные входы", desc: "Последние неудачные попытки авторизации", perm: "logs.view",
    fields: [],
    run: async () => {
      const rows = await db.select().from(loginLog).where(eq(loginLog.success, false)).orderBy(desc(loginLog.createdAt)).limit(100);
      return { message: `Записей: ${rows.length}`, data: tbl(["Дата", "Ник", "IP", "Причина"], rows.map((r) => [fmtDate(r.createdAt), r.username, r.ip, r.reason])) };
    },
  }),
  act({
    id: "sys.hwMismatches", group: SYS, title: "Попытки входа с чужого железа", desc: "Отказы по привязке к устройству (защита владельцев)", perm: "logs.view",
    fields: [],
    run: async () => {
      const rows = await db.select().from(loginLog).where(eq(loginLog.reason, "hw_mismatch")).orderBy(desc(loginLog.createdAt)).limit(100);
      return { message: `Записей: ${rows.length}`, data: tbl(["Дата", "Ник", "IP", "Устройство"], rows.map((r) => [fmtDate(r.createdAt), r.username, r.ip, r.hwHash?.slice(0, 14) ?? "—"])) };
    },
  }),
  act({
    id: "sys.notify", group: SYS, title: "Отправить уведомление", desc: "Личное уведомление пользователю", perm: "notify.send",
    fields: [fUser(), fArea("text", "Текст", true), fText("link", "Ссылка (необязательно)", false, { placeholder: "/thread/1" })],
    run: async (ctx, p) => {
      const t = await findUser(p.s("user"));
      await notify(t.u.id, p.s("text"), p.s("link").startsWith("/") ? p.s("link") : "");
      await log(ctx, "sys.notify", t.u.username);
      return { message: "Уведомление отправлено" };
    },
  }),
  act({
    id: "sys.broadcast", group: SYS, title: "Рассылка уведомлений", desc: "Всем или только пользователям выбранной роли", perm: "notify.send", danger: true,
    fields: [{ ...fRole("role", "Роль (пусто — всем)"), required: false }, fArea("text", "Текст", true), fText("link", "Ссылка (необязательно)")],
    run: async (ctx, p) => {
      const rows = p.s("role")
        ? await db.select({ id: users.id }).from(users).where(and(eq(users.status, "active"), eq(users.roleId, (await findRole(p.s("role"))).id)))
        : await db.select({ id: users.id }).from(users).where(eq(users.status, "active"));
      const link = p.s("link").startsWith("/") ? p.s("link") : "";
      if (rows.length) await db.insert(notifications).values(rows.map((r) => ({ userId: r.id, text: p.s("text").slice(0, 500), link })));
      await log(ctx, "sys.broadcast", p.s("role") || "все", `${rows.length}`);
      return { message: `Отправлено: ${rows.length}` };
    },
  }),
  act({
    id: "sys.clearNotifications", group: SYS, title: "Очистить прочитанные уведомления", desc: "Удалить прочитанные уведомления старше N дней", perm: "system.manage",
    fields: [fNum("days", "Дней", true, { def: "14" })],
    run: async (ctx, p) => {
      const cutoff = new Date(Date.now() - Math.max(0, p.n("days", 14)) * 86400_000);
      const r = await db.delete(notifications).where(and(eq(notifications.isRead, true), lt(notifications.createdAt, cutoff))).returning({ id: notifications.id });
      await log(ctx, "sys.clearNotifications", "", `${r.length}`);
      return { message: `Удалено: ${r.length}` };
    },
  }),
  act({
    id: "sys.onlineList", group: SYS, title: "Кто онлайн", desc: "Пользователи, активные за последние 10 минут (с IP)", perm: "users.view",
    fields: [],
    run: async () => {
      const rows = await db.select().from(users).where(gt(users.lastSeenAt, new Date(Date.now() - 600_000))).orderBy(desc(users.lastSeenAt)).limit(100);
      return { message: `Онлайн: ${rows.length}`, data: tbl(["Ник", "IP", "Активность"], rows.map((u) => [u.username, u.lastIp, fmtDate(u.lastSeenAt)])) };
    },
  }),
  act({
    id: "sys.pendingList", group: SYS, title: "Очередь регистраций", desc: "Аккаунты, ожидающие одобрения", perm: "users.approve",
    fields: [],
    run: async () => {
      const rows = await db.select().from(users).where(eq(users.status, "pending")).orderBy(users.createdAt).limit(100);
      return { message: `В очереди: ${rows.length}`, data: tbl(["ID", "Ник", "IP", "Дата"], rows.map((u) => [u.id, u.username, u.regIp, fmtDate(u.createdAt)])) };
    },
  }),
  act({
    id: "sys.mutedList", group: SYS, title: "Список замьюченных", desc: "Активные муты", perm: "users.mute",
    fields: [],
    run: async () => {
      const rows = await db.select().from(users).where(gt(users.mutedUntil, new Date())).limit(100);
      return { message: `В муте: ${rows.length}`, data: tbl(["ID", "Ник", "До", "Причина"], rows.map((u) => [u.id, u.username, fmtDate(u.mutedUntil), u.muteReason])) };
    },
  }),
  act({
    id: "sys.staffList", group: SYS, title: "Список персонала", desc: "Все пользователи с правом доступа в админ-панель", perm: "users.view",
    fields: [],
    run: async () => {
      const r = await db.execute(sql`select u.id, u.username, r.name, r.level from users u join roles r on r.id = u.role_id where r.permissions ? 'admin.access' or r.permissions ? '*' order by r.level desc, u.username`);
      const rows = r.rows as { id: number; username: string; name: string; level: number }[];
      return { message: `Сотрудников: ${rows.length}`, data: tbl(["ID", "Ник", "Роль", "Уровень"], rows.map((x) => [x.id, x.username, x.name, x.level])) };
    },
  }),
];
export { inArray };
