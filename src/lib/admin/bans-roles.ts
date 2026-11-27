import { and, desc, eq, gt, isNull, lt, or, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bans, roles, users } from "@/db/schema";
import { findActiveBan, ipMatches } from "@/lib/auth";
import { ALL_PERMS, PERMS, ROLE_STYLES, fmtDate, hasPerm } from "@/lib/constants";
import {
  DURATIONS, act, fArea, fBool, fDur, fId, fNum, fRole, fText, fUser, fail, findRole, findUser, guardRole, guardUser, killSessions, kv, log, tbl, until,
  type ActionDef,
} from "./core";

const B = "Баны";
const R = "Роли";

const fmtUntil = (d: Date | null) => (d ? `до ${fmtDate(d)}` : "навсегда");
const activeCond = () => and(eq(bans.isActive, true), or(isNull(bans.expiresAt), gt(bans.expiresAt, new Date())));

const STYLE_OPTS = ROLE_STYLES.map((s) => ({ value: s, label: s }));
const PERM_OPTS = ALL_PERMS.map((k) => ({ value: k, label: `${k} — ${PERMS[k].label}` }));

export const banActions: ActionDef[] = [
  act({
    id: "ban.user", group: B, title: "Забанить пользователя", desc: "Бан аккаунта с выбором: также по IP и/или по железу, срок, теневой бан", perm: "bans.manage", danger: true,
    fields: [
      fUser(), fDur("duration", "Срок бана", "10080"), fText("reason", "Причина", true),
      fBool("banIp", "Забанить также по IP", "0"), fBool("banHw", "Забанить также по железу", "0"),
      fBool("shadow", "Теневой бан (видит форум, но не может писать)", "0"),
    ],
    run: async (ctx, p) => {
      const t = await guardUser(ctx, p.s("user"));
      const notes: string[] = [];
      let ip: string | null = null;
      let hw: string | null = null;
      if (p.b("banIp")) {
        if (!hasPerm(ctx.v.perms, "bans.ip")) fail("Нет права банить по IP");
        ip = t.u.lastIp || t.u.regIp || null;
        if (!ip) notes.push("IP неизвестен");
        if (ip && ipMatches(ip, ctx.ip)) fail("IP цели совпадает с вашим — бан по IP отменён");
      }
      if (p.b("banHw")) {
        if (!hasPerm(ctx.v.perms, "bans.hw")) fail("Нет права банить по железу");
        hw = t.u.hwHash ?? t.u.regHwHash ?? null;
        if (!hw) notes.push("устройство неизвестно");
        if (hw && hw === ctx.v.hw) fail("Устройство цели совпадает с вашим — бан по железу отменён");
      }
      const exp = until(p.n("duration", 10080));
      await db.insert(bans).values({
        userId: t.u.id, username: t.u.username, ip, hwHash: hw, reason: p.s("reason"),
        bannedBy: ctx.actor.id, bannedByName: ctx.actor.name, expiresAt: exp, shadow: p.b("shadow"),
      });
      if (!p.b("shadow")) await killSessions(t.u.id);
      await log(ctx, "ban.user", t.u.username, `${fmtUntil(exp)}; IP:${ip ? "да" : "нет"}; HW:${hw ? "да" : "нет"}; ${p.s("reason")}`);
      return { message: `${t.u.username} забанен ${fmtUntil(exp)}${ip ? " (+IP)" : ""}${hw ? " (+железо)" : ""}${notes.length ? ". Заметка: " + notes.join(", ") : ""}` };
    },
  }),
  act({
    id: "ban.ip", group: B, title: "Забанить IP", desc: "Бан адреса без привязки к аккаунту. Маска: 192.168.*", perm: "bans.ip", danger: true,
    fields: [fText("ip", "IP или маска", true, { placeholder: "1.2.3.4 или 1.2.*" }), fDur("duration", "Срок", "1440"), fText("reason", "Причина", true)],
    run: async (ctx, p) => {
      const ip = p.s("ip");
      if (!/^[0-9a-fA-F:.*]{3,64}$/.test(ip)) fail("Неверный формат IP");
      if (ipMatches(ip, ctx.ip)) fail("Это ваш текущий IP");
      const exp = until(p.n("duration", 1440));
      await db.insert(bans).values({ ip, reason: p.s("reason"), bannedBy: ctx.actor.id, bannedByName: ctx.actor.name, expiresAt: exp });
      await log(ctx, "ban.ip", ip, `${fmtUntil(exp)}; ${p.s("reason")}`);
      return { message: `IP ${ip} забанен ${fmtUntil(exp)}` };
    },
  }),
  act({
    id: "ban.hw", group: B, title: "Забанить устройство", desc: "Бан по хешу железа (64 hex)", perm: "bans.hw", danger: true,
    fields: [fText("hash", "Хеш устройства", true), fDur("duration", "Срок", "10080"), fText("reason", "Причина", true)],
    run: async (ctx, p) => {
      if (!/^[a-f0-9]{64}$/.test(p.s("hash"))) fail("Хеш должен состоять из 64 hex-символов");
      if (p.s("hash") === ctx.v.hw) fail("Это ваше устройство");
      const exp = until(p.n("duration", 10080));
      await db.insert(bans).values({ hwHash: p.s("hash"), reason: p.s("reason"), bannedBy: ctx.actor.id, bannedByName: ctx.actor.name, expiresAt: exp });
      await log(ctx, "ban.hw", p.s("hash").slice(0, 16), `${fmtUntil(exp)}; ${p.s("reason")}`);
      return { message: `Устройство забанено ${fmtUntil(exp)}` };
    },
  }),
  act({
    id: "ban.sameIp", group: B, title: "Забанить все аккаунты с IP", desc: "Забанить пользователя и все его мультиаккаунты с тем же IP", perm: "bans.manage", danger: true,
    fields: [fUser(), fDur("duration", "Срок", "10080"), fText("reason", "Причина", true)],
    run: async (ctx, p) => {
      const t = await guardUser(ctx, p.s("user"));
      const ip = t.u.lastIp || t.u.regIp;
      if (!ip) fail("IP неизвестен");
      const rows = await db.select({ u: users, r: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId))
        .where(or(eq(users.lastIp, ip), eq(users.regIp, ip)));
      const exp = until(p.n("duration", 10080));
      let n = 0;
      for (const x of rows) {
        if (x.u.isProtected || x.u.id === ctx.actor.id || (!ctx.v.isFounder && x.r.level >= ctx.v.level)) continue;
        await db.insert(bans).values({ userId: x.u.id, username: x.u.username, reason: `${p.s("reason")} (мультиаккаунт)`, bannedBy: ctx.actor.id, bannedByName: ctx.actor.name, expiresAt: exp });
        await killSessions(x.u.id);
        n++;
      }
      await log(ctx, "ban.sameIp", ip, `${n} акк.`);
      return { message: `Забанено аккаунтов: ${n}` };
    },
  }),
  act({
    id: "ban.lift", group: B, title: "Снять бан", desc: "Снять бан по ID", perm: "bans.manage",
    fields: [fId("banId", "ID бана")],
    run: async (ctx, p) => {
      const r = await db.update(bans).set({ isActive: false, liftedBy: ctx.actor.name, liftedAt: new Date() }).where(eq(bans.id, p.int("banId"))).returning({ id: bans.id });
      if (!r[0]) fail("Бан не найден");
      await log(ctx, "ban.lift", `#${r[0].id}`);
      return { message: "Бан снят" };
    },
  }),
  act({
    id: "ban.liftUser", group: B, title: "Разбанить пользователя", desc: "Снять все активные баны пользователя", perm: "bans.manage",
    fields: [fUser()],
    run: async (ctx, p) => {
      const t = await findUser(p.s("user"));
      const r = await db.update(bans).set({ isActive: false, liftedBy: ctx.actor.name, liftedAt: new Date() }).where(and(eq(bans.userId, t.u.id), eq(bans.isActive, true))).returning({ id: bans.id });
      await log(ctx, "ban.liftUser", t.u.username, `${r.length}`);
      return { message: `Снято банов: ${r.length}` };
    },
  }),
  act({
    id: "ban.liftIp", group: B, title: "Разбанить IP", desc: "Снять все активные баны по IP", perm: "bans.ip",
    fields: [fText("ip", "IP или маска (как в бане)", true)],
    run: async (ctx, p) => {
      const r = await db.update(bans).set({ isActive: false, liftedBy: ctx.actor.name, liftedAt: new Date() }).where(and(eq(bans.ip, p.s("ip")), eq(bans.isActive, true))).returning({ id: bans.id });
      await log(ctx, "ban.liftIp", p.s("ip"), `${r.length}`);
      return { message: `Снято банов: ${r.length}` };
    },
  }),
  act({
    id: "ban.edit", group: B, title: "Изменить бан", desc: "Поменять причину и/или срок (отсчёт от текущего момента)", perm: "bans.manage",
    fields: [fId("banId", "ID бана"), fText("reason", "Новая причина (пусто — не менять)"), { ...fDur("duration", "Срок", "keep"), options: [{ value: "keep", label: "Не менять" }, ...DURATIONS] }],
    run: async (ctx, p) => {
      const b = await db.select().from(bans).where(eq(bans.id, p.int("banId"))).limit(1);
      if (!b[0]) fail("Бан не найден");
      const set: Partial<typeof bans.$inferInsert> = {};
      if (p.s("reason")) set.reason = p.s("reason");
      if (p.s("duration") && p.s("duration") !== "keep") set.expiresAt = until(p.n("duration"));
      if (!Object.keys(set).length) fail("Нечего менять");
      await db.update(bans).set(set).where(eq(bans.id, b[0].id));
      await log(ctx, "ban.edit", `#${b[0].id}`);
      return { message: "Бан обновлён" };
    },
  }),
  act({
    id: "ban.extend", group: B, title: "Продлить бан", desc: "Добавить время к сроку бана", perm: "bans.manage",
    fields: [fId("banId", "ID бана"), fDur("duration", "Добавить", "10080")],
    run: async (ctx, p) => {
      const b = await db.select().from(bans).where(eq(bans.id, p.int("banId"))).limit(1);
      if (!b[0]) fail("Бан не найден");
      if (!b[0].expiresAt) fail("Бан уже бессрочный");
      const add = p.n("duration", 0);
      const exp = add > 0 ? new Date(Math.max(Date.now(), b[0].expiresAt.getTime()) + add * 60000) : null;
      await db.update(bans).set({ expiresAt: exp, isActive: true }).where(eq(bans.id, b[0].id));
      await log(ctx, "ban.extend", `#${b[0].id}`, fmtUntil(exp));
      return { message: `Бан продлён ${fmtUntil(exp)}` };
    },
  }),
  act({
    id: "ban.list", group: B, title: "Активные баны", desc: "Список действующих банов", perm: "bans.view",
    fields: [],
    run: async () => {
      const rows = await db.select().from(bans).where(activeCond()).orderBy(desc(bans.createdAt)).limit(200);
      return { message: `Активных: ${rows.length}`, data: tbl(["ID", "Цель", "IP", "Железо", "Причина", "Срок", "Кем"], rows.map((b) => [b.id, b.username || "—", b.ip ?? "—", b.hwHash ? b.hwHash.slice(0, 10) + "…" : "—", b.reason, b.expiresAt ? fmtDate(b.expiresAt) : "навсегда", b.bannedByName])) };
    },
  }),
  act({
    id: "ban.history", group: B, title: "История банов пользователя", desc: "Все баны (в т.ч. снятые)", perm: "bans.view",
    fields: [fUser()],
    run: async (_c, p) => {
      const t = await findUser(p.s("user"));
      const rows = await db.select().from(bans).where(eq(bans.userId, t.u.id)).orderBy(desc(bans.createdAt));
      return { message: `Записей: ${rows.length}`, data: tbl(["ID", "Дата", "Причина", "Срок", "Активен", "Кем"], rows.map((b) => [b.id, fmtDate(b.createdAt), b.reason, b.expiresAt ? fmtDate(b.expiresAt) : "навсегда", b.isActive ? "да" : "нет", b.bannedByName])) };
    },
  }),
  act({
    id: "ban.check", group: B, title: "Проверить блокировку", desc: "Забанены ли пользователь / IP / устройство", perm: "bans.view",
    fields: [{ ...fUser(), required: false }, fText("ip", "IP"), fText("hw", "Хеш устройства")],
    run: async (_c, p) => {
      const t = p.s("user") ? await findUser(p.s("user")) : null;
      const b = await findActiveBan({ userId: t?.u.id, ip: p.s("ip") || null, hw: p.s("hw") || null });
      if (!b) return { message: "Активных банов не найдено", data: kv([["Статус", "чисто"]]) };
      return { message: "Найден активный бан", data: kv([["ID", b.id], ["Цель", b.username], ["IP", b.ip], ["Железо", b.hwHash?.slice(0, 16)], ["Причина", b.reason], ["Срок", b.expiresAt ? fmtDate(b.expiresAt) : "навсегда"], ["Теневой", b.shadow ? "да" : "нет"]]) };
    },
  }),
  act({
    id: "ban.purgeExpired", group: B, title: "Очистить завершённые баны", desc: "Удалить истёкшие и снятые баны из базы", perm: "bans.manage",
    fields: [],
    run: async (ctx) => {
      const r = await db.delete(bans).where(or(eq(bans.isActive, false), lt(bans.expiresAt, new Date()))).returning({ id: bans.id });
      await log(ctx, "ban.purgeExpired", "", `${r.length}`);
      return { message: `Удалено записей: ${r.length}` };
    },
  }),
  act({
    id: "ban.liftAll", group: B, title: "Снять ВСЕ баны", desc: "Амнистия: деактивировать все действующие баны", perm: "bans.manage", danger: true,
    fields: [fBool("confirm", "Подтверждаю", "0")],
    run: async (ctx, p) => {
      if (!p.b("confirm")) fail("Подтвердите действие");
      const r = await db.update(bans).set({ isActive: false, liftedBy: ctx.actor.name, liftedAt: new Date() }).where(eq(bans.isActive, true)).returning({ id: bans.id });
      await log(ctx, "ban.liftAll", "", `${r.length}`);
      return { message: `Амнистия: снято ${r.length}` };
    },
  }),
];

function checkPerms(ctx: { v: { isFounder: boolean; perms: string[] } }, list: string[]) {
  for (const k of list) {
    if (k === "*") {
      if (!ctx.v.isFounder) fail("Полный доступ (*) может выдать только основатель");
      continue;
    }
    if (!PERMS[k]) fail(`Неизвестное право: ${k}`);
    if (!ctx.v.isFounder && !hasPerm(ctx.v.perms, k)) fail(`Нельзя выдать право, которого нет у вас: ${k}`);
  }
}

export const roleActions: ActionDef[] = [
  act({
    id: "role.create", group: R, title: "Создать роль", desc: "Новая роль со своим цветом, значком и уровнем", perm: "roles.manage",
    fields: [fText("name", "Название", true), fText("slug", "Slug (латиница)", true, { placeholder: "event-master" }), fNum("level", "Уровень (1–99)", true, { def: "25" }),
      { name: "color", label: "Цвет", type: "color", def: "#a78bfa" }, fText("icon", "Значок (эмодзи)", false, { def: "⭐" }),
      { name: "style", label: "Стиль ника", type: "select", def: "plain", options: STYLE_OPTS }, fArea("desc", "Описание"), fBool("team", "Показывать в списке команды", "0")],
    run: async (ctx, p) => {
      const slug = p.s("slug").toLowerCase();
      if (!/^[a-z0-9-]{2,30}$/.test(slug)) fail("Slug: латиница, цифры и дефис, 2–30 символов");
      const level = Math.round(p.n("level", 25));
      if (level < 1 || level > 99) fail("Уровень от 1 до 99");
      if (!ctx.v.isFounder && level >= ctx.v.level) fail("Нельзя создать роль с уровнем не ниже вашего");
      if ((await db.select().from(roles).where(eq(roles.slug, slug)).limit(1))[0]) fail("Такой slug уже есть");
      await db.insert(roles).values({ slug, name: p.s("name").slice(0, 40), level, color: p.s("color") || "#a78bfa", icon: p.s("icon") || "⭐", style: ROLE_STYLES.includes(p.s("style")) ? p.s("style") : "plain", description: p.s("desc"), showOnTeam: p.b("team"), permissions: [] });
      await log(ctx, "role.create", p.s("name"));
      return { message: `Роль «${p.s("name")}» создана` };
    },
  }),
  act({
    id: "role.update", group: R, title: "Изменить роль", desc: "Название, значок, описание (пустые поля не меняются)", perm: "roles.manage",
    fields: [fRole(), fText("name", "Название"), fText("icon", "Значок"), fArea("desc", "Описание")],
    run: async (ctx, p) => {
      const r = await findRole(p.s("role"));
      guardRole(ctx, r);
      const set: Partial<typeof roles.$inferInsert> = {};
      if (p.s("name")) set.name = p.s("name").slice(0, 40);
      if (p.s("icon")) set.icon = p.s("icon").slice(0, 8);
      if (p.s("desc")) set.description = p.s("desc").slice(0, 300);
      if (!Object.keys(set).length) fail("Нечего менять");
      await db.update(roles).set(set).where(eq(roles.id, r.id));
      await log(ctx, "role.update", r.name);
      return { message: "Роль обновлена" };
    },
  }),
  act({
    id: "role.setStyle", group: R, title: "Оформление роли", desc: "Цвет и стиль отображения ника (обычный, свечение, градиент, контур, анимация)", perm: "roles.manage",
    fields: [fRole(), { name: "color", label: "Цвет", type: "color", def: "#a78bfa" }, { name: "style", label: "Стиль", type: "select", def: "glow", options: STYLE_OPTS }],
    run: async (ctx, p) => {
      const r = await findRole(p.s("role"));
      guardRole(ctx, r);
      await db.update(roles).set({ color: /^#[0-9a-fA-F]{6}$/.test(p.s("color")) ? p.s("color") : r.color, style: ROLE_STYLES.includes(p.s("style")) ? p.s("style") : r.style }).where(eq(roles.id, r.id));
      await log(ctx, "role.setStyle", r.name);
      return { message: "Оформление обновлено" };
    },
  }),
  act({
    id: "role.setLevel", group: R, title: "Изменить уровень роли", desc: "Уровень определяет иерархию и доступ к разделам", perm: "roles.manage",
    fields: [fRole(), fNum("level", "Новый уровень (1–99)", true)],
    run: async (ctx, p) => {
      const r = await findRole(p.s("role"));
      if (r.slug === "founder") fail("Уровень основателя изменить нельзя");
      guardRole(ctx, r);
      const lv = Math.round(p.n("level"));
      if (lv < 1 || lv > 99) fail("Уровень от 1 до 99");
      if (!ctx.v.isFounder && lv >= ctx.v.level) fail("Нельзя поставить уровень не ниже вашего");
      await db.update(roles).set({ level: lv }).where(eq(roles.id, r.id));
      await log(ctx, "role.setLevel", r.name, `${r.level} → ${lv}`);
      return { message: `Уровень «${r.name}»: ${lv}` };
    },
  }),
  act({
    id: "role.toggleTeam", group: R, title: "Показ в «Команде»", desc: "Выводить роль на странице команды", perm: "roles.manage",
    fields: [fRole(), fBool("value", "Показывать", "1")],
    run: async (ctx, p) => {
      const r = await findRole(p.s("role"));
      await db.update(roles).set({ showOnTeam: p.b("value") }).where(eq(roles.id, r.id));
      await log(ctx, "role.toggleTeam", r.name);
      return { message: "Готово" };
    },
  }),
  act({
    id: "role.setPerms", group: R, title: "Права роли (полный набор)", desc: "Заменить все права роли выбранным набором", perm: "roles.manage", danger: true,
    fields: [fRole(), { name: "perms", label: "Права", type: "perms" }],
    run: async (ctx, p) => {
      const r = await findRole(p.s("role"));
      if (r.slug === "founder") fail("Права основателя неизменяемы");
      guardRole(ctx, r);
      const list = p.arr("perms");
      checkPerms(ctx, list);
      await db.update(roles).set({ permissions: list }).where(eq(roles.id, r.id));
      await log(ctx, "role.setPerms", r.name, `${list.length} прав`);
      return { message: `Права «${r.name}» обновлены (${list.length})` };
    },
  }),
  act({
    id: "role.grantPerm", group: R, title: "Добавить право роли", desc: "Выдать одно право", perm: "roles.manage",
    fields: [fRole(), { name: "perm", label: "Право", type: "select", required: true, options: PERM_OPTS }],
    run: async (ctx, p) => {
      const r = await findRole(p.s("role"));
      if (r.slug === "founder") fail("Права основателя неизменяемы");
      guardRole(ctx, r);
      checkPerms(ctx, [p.s("perm")]);
      const list = Array.from(new Set([...(r.permissions as string[]), p.s("perm")]));
      await db.update(roles).set({ permissions: list }).where(eq(roles.id, r.id));
      await log(ctx, "role.grantPerm", r.name, p.s("perm"));
      return { message: "Право выдано" };
    },
  }),
  act({
    id: "role.revokePerm", group: R, title: "Забрать право у роли", desc: "Убрать одно право", perm: "roles.manage",
    fields: [fRole(), { name: "perm", label: "Право", type: "select", required: true, options: PERM_OPTS }],
    run: async (ctx, p) => {
      const r = await findRole(p.s("role"));
      if (r.slug === "founder") fail("Права основателя неизменяемы");
      guardRole(ctx, r);
      await db.update(roles).set({ permissions: (r.permissions as string[]).filter((x) => x !== p.s("perm")) }).where(eq(roles.id, r.id));
      await log(ctx, "role.revokePerm", r.name, p.s("perm"));
      return { message: "Право отозвано" };
    },
  }),
  act({
    id: "role.clearPerms", group: R, title: "Снять все права роли", desc: "Роль станет без особых прав", perm: "roles.manage", danger: true,
    fields: [fRole()],
    run: async (ctx, p) => {
      const r = await findRole(p.s("role"));
      if (r.slug === "founder") fail("Права основателя неизменяемы");
      guardRole(ctx, r);
      await db.update(roles).set({ permissions: [] }).where(eq(roles.id, r.id));
      await log(ctx, "role.clearPerms", r.name);
      return { message: "Права сняты" };
    },
  }),
  act({
    id: "role.copyPerms", group: R, title: "Скопировать права", desc: "Права одной роли → другой", perm: "roles.manage",
    fields: [fRole("from", "Откуда"), fRole("to", "Куда")],
    run: async (ctx, p) => {
      const a = await findRole(p.s("from"));
      const b = await findRole(p.s("to"));
      if (b.slug === "founder") fail("Права основателя неизменяемы");
      guardRole(ctx, b);
      const list = a.permissions as string[];
      checkPerms(ctx, list);
      await db.update(roles).set({ permissions: list }).where(eq(roles.id, b.id));
      await log(ctx, "role.copyPerms", `${a.name} → ${b.name}`);
      return { message: "Права скопированы" };
    },
  }),
  act({
    id: "role.clone", group: R, title: "Клонировать роль", desc: "Создать копию роли с новым названием", perm: "roles.manage",
    fields: [fRole(), fText("name", "Название копии", true), fText("slug", "Slug копии", true)],
    run: async (ctx, p) => {
      const r = await findRole(p.s("role"));
      const slug = p.s("slug").toLowerCase();
      if (!/^[a-z0-9-]{2,30}$/.test(slug)) fail("Неверный slug");
      if ((await db.select().from(roles).where(eq(roles.slug, slug)).limit(1))[0]) fail("Такой slug уже есть");
      const lv = Math.min(r.level, ctx.v.isFounder ? 99 : ctx.v.level - 1);
      const perms = r.slug === "founder" ? [] : (r.permissions as string[]);
      checkPerms(ctx, perms);
      await db.insert(roles).values({ slug, name: p.s("name"), color: r.color, icon: r.icon, level: Math.max(1, lv), style: r.style, description: r.description, permissions: perms, showOnTeam: r.showOnTeam });
      await log(ctx, "role.clone", r.name, p.s("name"));
      return { message: "Роль склонирована" };
    },
  }),
  act({
    id: "role.delete", group: R, title: "Удалить роль", desc: "Участники переводятся в выбранную роль", perm: "roles.manage", danger: true,
    fields: [fRole(), fRole("moveTo", "Перевести участников в")],
    run: async (ctx, p) => {
      const r = await findRole(p.s("role"));
      const to = await findRole(p.s("moveTo"));
      if (r.slug === "founder" || r.slug === "member") fail("Эту роль удалить нельзя");
      if (r.id === to.id) fail("Выберите другую роль для переноса");
      guardRole(ctx, r, "удалять");
      if (!ctx.v.isFounder && to.level >= ctx.v.level) fail("Нельзя переводить участников в роль не ниже вашей");
      const moved = await db.update(users).set({ roleId: to.id }).where(eq(users.roleId, r.id)).returning({ id: users.id });
      await db.delete(roles).where(eq(roles.id, r.id));
      await log(ctx, "role.delete", r.name, `${moved.length} перенесено в ${to.name}`);
      return { message: `Роль удалена, перенесено: ${moved.length}` };
    },
  }),
  act({
    id: "role.list", group: R, title: "Список ролей", desc: "Роли, уровни и число участников", perm: "roles.manage",
    fields: [],
    run: async () => {
      const rs = await db.select().from(roles).orderBy(desc(roles.level));
      const us = await db.select({ r: users.roleId }).from(users).where(inArray(users.roleId, rs.map((r) => r.id)));
      const cnt = new Map<number, number>();
      us.forEach((x) => cnt.set(x.r, (cnt.get(x.r) ?? 0) + 1));
      return { message: `Ролей: ${rs.length}`, data: tbl(["ID", "Роль", "Slug", "Уровень", "Прав", "Участников"], rs.map((r) => [r.id, `${r.icon} ${r.name}`, r.slug, r.level, (r.permissions as string[]).includes("*") ? "все" : (r.permissions as string[]).length, cnt.get(r.id) ?? 0])) };
    },
  }),
];
