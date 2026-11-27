import { and, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, forums, postLikes, posts, reports, threadPrefixes, threads, users } from "@/db/schema";
import { notify } from "@/lib/auth";
import { fmtDate } from "@/lib/constants";
import { recountForum, recountThread, recountUser } from "@/lib/forumops";
import {
  act, fArea, fBool, fCat, fForum, fId, fLevel, fNum, fText, fUser, fail, findUser, kv, log, tbl,
  type ActionDef,
} from "./core";

const S = "Структура";
const C = "Контент";
const M = "Жалобы и префиксы";

async function getThread(id: number) {
  const r = await db.select().from(threads).where(eq(threads.id, id)).limit(1);
  if (!r[0]) fail(`Тема #${id} не найдена`);
  return r[0];
}
async function getPost(id: number) {
  const r = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  if (!r[0]) fail(`Сообщение #${id} не найдено`);
  return r[0];
}
async function getForum(id: number) {
  const r = await db.select().from(forums).where(eq(forums.id, id)).limit(1);
  if (!r[0]) fail(`Форум #${id} не найден`);
  return r[0];
}
async function getCat(id: number) {
  const r = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  if (!r[0]) fail(`Раздел #${id} не найден`);
  return r[0];
}

async function purgeThreads(ids: number[]) {
  if (!ids.length) return;
  const ps = await db.select({ id: posts.id, a: posts.authorId }).from(posts).where(inArray(posts.threadId, ids));
  if (ps.length) await db.delete(postLikes).where(inArray(postLikes.postId, ps.map((p) => p.id)));
  await db.delete(reports).where(inArray(reports.threadId, ids));
  await db.delete(posts).where(inArray(posts.threadId, ids));
  await db.delete(threads).where(inArray(threads.id, ids));
  for (const a of new Set(ps.map((p) => p.a))) await recountUser(a);
}

function forumSetter(
  id: string, title: string, desc: string, extra: ReturnType<typeof fBool>[] | ReturnType<typeof fLevel>[],
  apply: (p: import("./core").P) => Partial<typeof forums.$inferInsert>,
): ActionDef {
  return act({
    id, group: S, title, desc, perm: "structure.manage",
    fields: [fForum(), ...extra],
    run: async (ctx, p) => {
      const f = await getForum(p.int("forum"));
      await db.update(forums).set(apply(p)).where(eq(forums.id, f.id));
      await log(ctx, id, f.title);
      return { message: `Форум «${f.title}» обновлён` };
    },
  });
}

function catSetter(
  id: string, title: string, desc: string, extra: ReturnType<typeof fBool>[] | ReturnType<typeof fLevel>[] | ReturnType<typeof fNum>[],
  apply: (p: import("./core").P) => Partial<typeof categories.$inferInsert>,
): ActionDef {
  return act({
    id, group: S, title, desc, perm: "structure.manage",
    fields: [fCat(), ...extra],
    run: async (ctx, p) => {
      const c = await getCat(p.int("category"));
      await db.update(categories).set(apply(p)).where(eq(categories.id, c.id));
      await log(ctx, id, c.title);
      return { message: `Раздел «${c.title}» обновлён` };
    },
  });
}

function threadFlag(id: string, title: string, desc: string, perm: string, label: string, col: "isPinned" | "isAnnouncement" | "isLocked"): ActionDef {
  return act({
    id, group: C, title, desc, perm,
    fields: [fId("thread", "ID темы"), fBool("value", label, "1")],
    run: async (ctx, p) => {
      const t = await getThread(p.int("thread"));
      await db.update(threads).set({ [col]: p.b("value") }).where(eq(threads.id, t.id));
      await log(ctx, id, `#${t.id} ${t.title}`, p.b("value") ? "вкл" : "выкл");
      return { message: `Тема #${t.id}: ${p.b("value") ? "включено" : "выключено"}` };
    },
  });
}

export const structureActions: ActionDef[] = [
  act({
    id: "category.create", group: S, title: "Создать раздел", desc: "Новая категория на главной странице", perm: "structure.manage",
    fields: [fText("title", "Название", true), fArea("desc", "Описание"), fText("icon", "Значок (эмодзи)", false, { def: "📁" }), { name: "color", label: "Цвет", type: "color", def: "#7c3aed" }, fLevel("minView", "Мин. уровень для просмотра")],
    run: async (ctx, p) => {
      const [max] = await db.select({ m: sql<number>`coalesce(max(${categories.sortOrder}), 0)` }).from(categories);
      await db.insert(categories).values({ title: p.s("title").slice(0, 80), description: p.s("desc"), icon: p.s("icon") || "📁", color: p.s("color") || "#7c3aed", minViewLevel: Math.max(0, p.n("minView")), sortOrder: Number(max?.m ?? 0) + 1 });
      await log(ctx, "category.create", p.s("title"));
      return { message: "Раздел создан" };
    },
  }),
  act({
    id: "category.update", group: S, title: "Изменить раздел", desc: "Название, описание, значок, цвет (пустые не меняются)", perm: "structure.manage",
    fields: [fCat(), fText("title", "Название"), fArea("desc", "Описание"), fText("icon", "Значок"), { name: "color", label: "Цвет", type: "color", def: "" }],
    run: async (ctx, p) => {
      const c = await getCat(p.int("category"));
      const set: Partial<typeof categories.$inferInsert> = {};
      if (p.s("title")) set.title = p.s("title").slice(0, 80);
      if (p.s("desc")) set.description = p.s("desc");
      if (p.s("icon")) set.icon = p.s("icon");
      if (/^#[0-9a-fA-F]{6}$/.test(p.s("color"))) set.color = p.s("color");
      if (!Object.keys(set).length) fail("Нечего менять");
      await db.update(categories).set(set).where(eq(categories.id, c.id));
      await log(ctx, "category.update", c.title);
      return { message: "Раздел обновлён" };
    },
  }),
  catSetter("category.setOrder", "Порядок раздела", "Меньше число — выше на главной", [fNum("order", "Позиция", true)], (p) => ({ sortOrder: Math.round(p.n("order")) })),
  catSetter("category.setVisibility", "Доступ к разделу", "Мин. уровень роли для просмотра", [fLevel("minView", "Мин. уровень")], (p) => ({ minViewLevel: Math.max(0, Math.round(p.n("minView"))) })),
  catSetter("category.hide", "Скрыть/показать раздел", "Скрытый раздел видят только модераторы", [fBool("value", "Скрыть", "1")], (p) => ({ isHidden: p.b("value") })),
  catSetter("category.collapse", "Свернуть раздел", "Сворачивать по умолчанию на главной", [fBool("value", "Свернуть", "1")], (p) => ({ isCollapsed: p.b("value") })),
  act({
    id: "category.delete", group: S, title: "Удалить раздел", desc: "Форумы раздела переносятся в другой раздел", perm: "structure.manage", danger: true,
    fields: [fCat(), { ...fCat("moveTo", "Перенести форумы в"), required: false }],
    run: async (ctx, p) => {
      const c = await getCat(p.int("category"));
      const fs = await db.select().from(forums).where(eq(forums.categoryId, c.id));
      if (fs.length) {
        if (!p.s("moveTo")) fail("В разделе есть форумы — выберите раздел для переноса");
        const to = await getCat(p.int("moveTo"));
        if (to.id === c.id) fail("Выберите другой раздел");
        await db.update(forums).set({ categoryId: to.id }).where(eq(forums.categoryId, c.id));
      }
      await db.delete(categories).where(eq(categories.id, c.id));
      await log(ctx, "category.delete", c.title);
      return { message: "Раздел удалён" };
    },
  }),
  act({
    id: "forum.create", group: S, title: "Создать форум", desc: "Новый форум внутри раздела с настройкой доступа", perm: "structure.manage",
    fields: [fCat(), fText("title", "Название", true), fArea("desc", "Описание"), fText("icon", "Значок", false, { def: "💬" }), fLevel("minView", "Мин. уровень: просмотр"), fLevel("minPost", "Мин. уровень: ответы", "1"), fLevel("minThread", "Мин. уровень: создание тем", "1"), fBool("locked", "Закрыт для записи", "0"), fBool("approval", "Премодерация тем", "0")],
    run: async (ctx, p) => {
      const c = await getCat(p.int("category"));
      const [max] = await db.select({ m: sql<number>`coalesce(max(${forums.sortOrder}), 0)` }).from(forums).where(eq(forums.categoryId, c.id));
      await db.insert(forums).values({ categoryId: c.id, title: p.s("title").slice(0, 80), description: p.s("desc"), icon: p.s("icon") || "💬", minViewLevel: Math.max(0, p.n("minView")), minPostLevel: Math.max(0, p.n("minPost", 1)), minThreadLevel: Math.max(0, p.n("minThread", 1)), isLocked: p.b("locked"), requiresApproval: p.b("approval"), sortOrder: Number(max?.m ?? 0) + 1 });
      await log(ctx, "forum.create", p.s("title"), c.title);
      return { message: "Форум создан" };
    },
  }),
  act({
    id: "forum.update", group: S, title: "Изменить форум", desc: "Название, описание, значок (пустые не меняются)", perm: "structure.manage",
    fields: [fForum(), fText("title", "Название"), fArea("desc", "Описание"), fText("icon", "Значок")],
    run: async (ctx, p) => {
      const f = await getForum(p.int("forum"));
      const set: Partial<typeof forums.$inferInsert> = {};
      if (p.s("title")) set.title = p.s("title").slice(0, 80);
      if (p.s("desc")) set.description = p.s("desc");
      if (p.s("icon")) set.icon = p.s("icon");
      if (!Object.keys(set).length) fail("Нечего менять");
      await db.update(forums).set(set).where(eq(forums.id, f.id));
      await log(ctx, "forum.update", f.title);
      return { message: "Форум обновлён" };
    },
  }),
  forumSetter("forum.lock", "Закрыть/открыть форум", "В закрытом форуме нельзя писать", [fBool("value", "Закрыть", "1")], (p) => ({ isLocked: p.b("value") })),
  forumSetter("forum.hide", "Скрыть/показать форум", "Скрытый форум видят только модераторы", [fBool("value", "Скрыть", "1")], (p) => ({ isHidden: p.b("value") })),
  forumSetter("forum.approval", "Премодерация форума", "Новые темы требуют одобрения", [fBool("value", "Включить", "1")], (p) => ({ requiresApproval: p.b("value") })),
  forumSetter("forum.setOrder", "Порядок форума", "Меньше число — выше", [fNum("order", "Позиция", true)], (p) => ({ sortOrder: Math.round(p.n("order")) })),
  forumSetter("forum.setAccess", "Уровни доступа форума", "Просмотр / ответы / создание тем по уровню роли", [fLevel("minView", "Просмотр"), fLevel("minPost", "Ответы", "1"), fLevel("minThread", "Создание тем", "1")],
    (p) => ({ minViewLevel: Math.max(0, p.n("minView")), minPostLevel: Math.max(0, p.n("minPost")), minThreadLevel: Math.max(0, p.n("minThread")) })),
  act({
    id: "forum.move", group: S, title: "Переместить форум", desc: "В другой раздел", perm: "structure.manage",
    fields: [fForum(), fCat("category", "В раздел")],
    run: async (ctx, p) => {
      const f = await getForum(p.int("forum"));
      const c = await getCat(p.int("category"));
      await db.update(forums).set({ categoryId: c.id }).where(eq(forums.id, f.id));
      await log(ctx, "forum.move", f.title, c.title);
      return { message: `«${f.title}» → «${c.title}»` };
    },
  }),
  act({
    id: "forum.merge", group: S, title: "Объединить форумы", desc: "Перенести все темы в другой форум и удалить исходный", perm: "structure.manage", danger: true,
    fields: [fForum("source", "Исходный (будет удалён)"), fForum("target", "Целевой")],
    run: async (ctx, p) => {
      const a = await getForum(p.int("source"));
      const b = await getForum(p.int("target"));
      if (a.id === b.id) fail("Выберите разные форумы");
      await db.update(threads).set({ forumId: b.id }).where(eq(threads.forumId, a.id));
      await db.delete(forums).where(eq(forums.id, a.id));
      await recountForum(b.id);
      await log(ctx, "forum.merge", a.title, `→ ${b.title}`);
      return { message: "Форумы объединены" };
    },
  }),
  act({
    id: "forum.delete", group: S, title: "Удалить форум", desc: "Темы переносятся в другой форум или удаляются навсегда", perm: "structure.manage", danger: true,
    fields: [fForum(), { ...fForum("moveTo", "Перенести темы в"), required: false }, fBool("confirm", "Подтверждаю", "0")],
    run: async (ctx, p) => {
      if (!p.b("confirm")) fail("Подтвердите удаление");
      const f = await getForum(p.int("forum"));
      if (p.s("moveTo")) {
        const to = await getForum(p.int("moveTo"));
        if (to.id === f.id) fail("Выберите другой форум");
        await db.update(threads).set({ forumId: to.id }).where(eq(threads.forumId, f.id));
        await recountForum(to.id);
      } else {
        const ts = await db.select({ id: threads.id }).from(threads).where(eq(threads.forumId, f.id));
        await purgeThreads(ts.map((t) => t.id));
      }
      await db.delete(forums).where(eq(forums.id, f.id));
      await log(ctx, "forum.delete", f.title);
      return { message: "Форум удалён" };
    },
  }),
  act({
    id: "forum.prune", group: S, title: "Очистить старые темы", desc: "Скрыть или удалить темы без активности N дней (закреплённые не трогаются)", perm: "structure.manage", danger: true,
    fields: [fForum(), fNum("days", "Дней без активности", true, { def: "180" }), { name: "mode", label: "Режим", type: "select", def: "hide", options: [{ value: "hide", label: "Скрыть" }, { value: "purge", label: "Удалить навсегда" }] }],
    run: async (ctx, p) => {
      const f = await getForum(p.int("forum"));
      const cutoff = new Date(Date.now() - Math.max(1, p.n("days", 180)) * 86400_000);
      const ts = await db.select({ id: threads.id }).from(threads).where(and(eq(threads.forumId, f.id), eq(threads.isPinned, false), eq(threads.isAnnouncement, false), lt(threads.lastPostAt, cutoff)));
      if (p.s("mode") === "purge") await purgeThreads(ts.map((t) => t.id));
      else if (ts.length) await db.update(threads).set({ isHidden: true }).where(inArray(threads.id, ts.map((t) => t.id)));
      await recountForum(f.id);
      await log(ctx, "forum.prune", f.title, `${ts.length}`);
      return { message: `Обработано тем: ${ts.length}` };
    },
  }),
  act({
    id: "forum.lockThreads", group: S, title: "Закрыть/открыть все темы форума", desc: "Массово изменить состояние всех тем", perm: "content.lock",
    fields: [fForum(), fBool("value", "Закрыть", "1")],
    run: async (ctx, p) => {
      const f = await getForum(p.int("forum"));
      const r = await db.update(threads).set({ isLocked: p.b("value") }).where(eq(threads.forumId, f.id)).returning({ id: threads.id });
      await log(ctx, "forum.lockThreads", f.title, `${r.length}`);
      return { message: `Изменено тем: ${r.length}` };
    },
  }),
  act({
    id: "forum.approveAll", group: S, title: "Одобрить все ожидающие темы", desc: "Опубликовать темы, ожидающие премодерации", perm: "content.approve",
    fields: [fForum()],
    run: async (ctx, p) => {
      const f = await getForum(p.int("forum"));
      const r = await db.update(threads).set({ isApproved: true }).where(and(eq(threads.forumId, f.id), eq(threads.isApproved, false))).returning({ id: threads.id });
      await recountForum(f.id);
      await log(ctx, "forum.approveAll", f.title, `${r.length}`);
      return { message: `Одобрено: ${r.length}` };
    },
  }),
  act({
    id: "forum.recount", group: S, title: "Пересчитать счётчики форума", desc: "Количество тем и сообщений", perm: "structure.manage",
    fields: [fForum()],
    run: async (_c, p) => {
      const f = await getForum(p.int("forum"));
      const ts = await db.select({ id: threads.id }).from(threads).where(eq(threads.forumId, f.id));
      for (const t of ts) await recountThread(t.id);
      await recountForum(f.id);
      return { message: "Счётчики обновлены" };
    },
  }),
];

export const contentActions: ActionDef[] = [
  threadFlag("thread.pin", "Закрепить тему", "Закреплённые темы идут первыми", "content.pin", "Закрепить", "isPinned"),
  threadFlag("thread.announce", "Сделать объявлением", "Выделяется как важное объявление", "content.pin", "Объявление", "isAnnouncement"),
  threadFlag("thread.lock", "Закрыть тему", "В закрытой теме нельзя отвечать", "content.lock", "Закрыть", "isLocked"),
  act({
    id: "thread.move", group: C, title: "Переместить тему", desc: "В другой форум", perm: "content.move",
    fields: [fId("thread", "ID темы"), fForum("forum", "В форум")],
    run: async (ctx, p) => {
      const t = await getThread(p.int("thread"));
      const f = await getForum(p.int("forum"));
      await db.update(threads).set({ forumId: f.id }).where(eq(threads.id, t.id));
      await recountForum(t.forumId);
      await recountForum(f.id);
      await log(ctx, "thread.move", `#${t.id}`, `→ ${f.title}`);
      return { message: `Тема перемещена в «${f.title}»` };
    },
  }),
  act({
    id: "thread.rename", group: C, title: "Переименовать тему", desc: "Изменить заголовок", perm: "content.edit",
    fields: [fId("thread", "ID темы"), fText("title", "Новый заголовок", true)],
    run: async (ctx, p) => {
      const t = await getThread(p.int("thread"));
      await db.update(threads).set({ title: p.s("title").slice(0, 150) }).where(eq(threads.id, t.id));
      await log(ctx, "thread.rename", `#${t.id}`, p.s("title"));
      return { message: "Заголовок изменён" };
    },
  }),
  act({
    id: "thread.setPrefix", group: C, title: "Префикс темы", desc: "Установить или убрать префикс", perm: "content.prefix",
    fields: [fId("thread", "ID темы"), { name: "prefix", label: "Префикс", type: "prefix" }],
    run: async (ctx, p) => {
      const t = await getThread(p.int("thread"));
      const pid = p.n("prefix") || null;
      await db.update(threads).set({ prefixId: pid }).where(eq(threads.id, t.id));
      await log(ctx, "thread.setPrefix", `#${t.id}`);
      return { message: "Префикс обновлён" };
    },
  }),
  act({
    id: "thread.delete", group: C, title: "Удалить тему", desc: "Скрыть тему (можно восстановить)", perm: "content.delete", danger: true,
    fields: [fId("thread", "ID темы"), fText("reason", "Причина (уйдёт автору)")],
    run: async (ctx, p) => {
      const t = await getThread(p.int("thread"));
      await db.update(threads).set({ isHidden: true }).where(eq(threads.id, t.id));
      await recountForum(t.forumId);
      await recountUser(t.authorId);
      if (p.s("reason") && t.authorId !== ctx.actor.id) await notify(t.authorId, `Ваша тема «${t.title.slice(0, 60)}» удалена. Причина: ${p.s("reason")}`);
      await log(ctx, "thread.delete", `#${t.id} ${t.title}`, p.s("reason"));
      return { message: "Тема удалена" };
    },
  }),
  act({
    id: "thread.restore", group: C, title: "Восстановить тему", desc: "Показать скрытую тему", perm: "content.delete",
    fields: [fId("thread", "ID темы")],
    run: async (ctx, p) => {
      const t = await getThread(p.int("thread"));
      await db.update(threads).set({ isHidden: false }).where(eq(threads.id, t.id));
      await recountForum(t.forumId);
      await recountUser(t.authorId);
      await log(ctx, "thread.restore", `#${t.id}`);
      return { message: "Тема восстановлена" };
    },
  }),
  act({
    id: "thread.purge", group: C, title: "Удалить тему навсегда", desc: "Физическое удаление темы со всеми сообщениями", perm: "content.purge", danger: true,
    fields: [fId("thread", "ID темы"), fBool("confirm", "Подтверждаю", "0")],
    run: async (ctx, p) => {
      if (!p.b("confirm")) fail("Подтвердите удаление");
      const t = await getThread(p.int("thread"));
      await purgeThreads([t.id]);
      await recountForum(t.forumId);
      await log(ctx, "thread.purge", `#${t.id} ${t.title}`);
      return { message: "Тема удалена навсегда" };
    },
  }),
  act({
    id: "thread.merge", group: C, title: "Объединить темы", desc: "Перенести сообщения одной темы в другую", perm: "content.merge", danger: true,
    fields: [fId("source", "ID темы-источника"), fId("target", "ID целевой темы")],
    run: async (ctx, p) => {
      const a = await getThread(p.int("source"));
      const b = await getThread(p.int("target"));
      if (a.id === b.id) fail("Выберите разные темы");
      await db.update(posts).set({ threadId: b.id, isFirst: false }).where(eq(posts.threadId, a.id));
      await db.delete(threads).where(eq(threads.id, a.id));
      await recountThread(b.id);
      await recountForum(a.forumId);
      await recountForum(b.forumId);
      await log(ctx, "thread.merge", `#${a.id} → #${b.id}`);
      return { message: "Темы объединены" };
    },
  }),
  act({
    id: "thread.changeAuthor", group: C, title: "Сменить автора темы", desc: "Передать тему другому пользователю", perm: "content.edit",
    fields: [fId("thread", "ID темы"), fUser("Новый автор", "user")],
    run: async (ctx, p) => {
      const t = await getThread(p.int("thread"));
      const u = await findUser(p.s("user"));
      await db.update(threads).set({ authorId: u.u.id }).where(eq(threads.id, t.id));
      await db.update(posts).set({ authorId: u.u.id }).where(and(eq(posts.threadId, t.id), eq(posts.isFirst, true)));
      await recountUser(t.authorId);
      await recountUser(u.u.id);
      await log(ctx, "thread.changeAuthor", `#${t.id}`, u.u.username);
      return { message: `Автор: ${u.u.username}` };
    },
  }),
  act({
    id: "thread.approve", group: C, title: "Одобрить/отклонить тему", desc: "Премодерация: опубликовать или скрыть тему", perm: "content.approve",
    fields: [fId("thread", "ID темы"), fBool("value", "Одобрить (нет — отклонить)", "1")],
    run: async (ctx, p) => {
      const t = await getThread(p.int("thread"));
      if (p.b("value")) {
        await db.update(threads).set({ isApproved: true }).where(eq(threads.id, t.id));
        await notify(t.authorId, `Ваша тема «${t.title.slice(0, 60)}» одобрена`, `/thread/${t.id}`);
      } else {
        await db.update(threads).set({ isApproved: false, isHidden: true }).where(eq(threads.id, t.id));
        await notify(t.authorId, `Ваша тема «${t.title.slice(0, 60)}» отклонена модератором`);
      }
      await recountForum(t.forumId);
      await log(ctx, "thread.approve", `#${t.id}`, p.b("value") ? "одобрена" : "отклонена");
      return { message: p.b("value") ? "Тема одобрена" : "Тема отклонена" };
    },
  }),
  act({
    id: "thread.bump", group: C, title: "Поднять тему", desc: "Обновить время последней активности", perm: "content.edit",
    fields: [fId("thread", "ID темы")],
    run: async (ctx, p) => {
      const t = await getThread(p.int("thread"));
      await db.update(threads).set({ lastPostAt: new Date() }).where(eq(threads.id, t.id));
      await log(ctx, "thread.bump", `#${t.id}`);
      return { message: "Тема поднята" };
    },
  }),
  act({
    id: "thread.info", group: C, title: "Информация о теме", desc: "Автор, IP, счётчики, статусы", perm: "users.view",
    fields: [fId("thread", "ID темы")],
    run: async (_c, p) => {
      const t = await getThread(p.int("thread"));
      const first = await db.select().from(posts).where(and(eq(posts.threadId, t.id), eq(posts.isFirst, true))).limit(1);
      const a = await db.select().from(users).where(eq(users.id, t.authorId)).limit(1);
      return { message: `Тема #${t.id}`, data: kv([["Заголовок", t.title], ["Автор", a[0]?.username], ["IP автора", first[0]?.ip], ["Создана", fmtDate(t.createdAt)], ["Ответов", t.repliesCount], ["Просмотров", t.views], ["Закреплена", t.isPinned ? "да" : "нет"], ["Закрыта", t.isLocked ? "да" : "нет"], ["Скрыта", t.isHidden ? "да" : "нет"], ["Одобрена", t.isApproved ? "да" : "нет"]]) };
    },
  }),
  act({
    id: "post.delete", group: C, title: "Удалить сообщение", desc: "Скрыть сообщение (можно восстановить)", perm: "content.delete", danger: true,
    fields: [fId("post", "ID сообщения")],
    run: async (ctx, p) => {
      const x = await getPost(p.int("post"));
      await db.update(posts).set({ isHidden: true }).where(eq(posts.id, x.id));
      await recountThread(x.threadId);
      await recountUser(x.authorId);
      const t = await getThread(x.threadId);
      await recountForum(t.forumId);
      await log(ctx, "post.delete", `#${x.id}`);
      return { message: "Сообщение удалено" };
    },
  }),
  act({
    id: "post.restore", group: C, title: "Восстановить сообщение", desc: "Показать скрытое сообщение", perm: "content.delete",
    fields: [fId("post", "ID сообщения")],
    run: async (ctx, p) => {
      const x = await getPost(p.int("post"));
      await db.update(posts).set({ isHidden: false }).where(eq(posts.id, x.id));
      await recountThread(x.threadId);
      await recountUser(x.authorId);
      const t = await getThread(x.threadId);
      await recountForum(t.forumId);
      await log(ctx, "post.restore", `#${x.id}`);
      return { message: "Сообщение восстановлено" };
    },
  }),
  act({
    id: "post.edit", group: C, title: "Отредактировать сообщение", desc: "Заменить текст сообщения", perm: "content.edit",
    fields: [fId("post", "ID сообщения"), fArea("content", "Новый текст", true)],
    run: async (ctx, p) => {
      const x = await getPost(p.int("post"));
      await db.update(posts).set({ content: p.s("content"), editedAt: new Date(), editedBy: ctx.actor.id }).where(eq(posts.id, x.id));
      await log(ctx, "post.edit", `#${x.id}`);
      return { message: "Сообщение изменено" };
    },
  }),
  act({
    id: "post.changeAuthor", group: C, title: "Сменить автора сообщения", desc: "Передать авторство другому пользователю", perm: "content.edit",
    fields: [fId("post", "ID сообщения"), fUser("Новый автор", "user")],
    run: async (ctx, p) => {
      const x = await getPost(p.int("post"));
      const u = await findUser(p.s("user"));
      await db.update(posts).set({ authorId: u.u.id }).where(eq(posts.id, x.id));
      await recountUser(x.authorId);
      await recountUser(u.u.id);
      await log(ctx, "post.changeAuthor", `#${x.id}`, u.u.username);
      return { message: "Автор изменён" };
    },
  }),
  act({
    id: "post.move", group: C, title: "Перенести сообщение в другую тему", desc: "Не работает для первого сообщения темы", perm: "content.move",
    fields: [fId("post", "ID сообщения"), fId("thread", "ID целевой темы")],
    run: async (ctx, p) => {
      const x = await getPost(p.int("post"));
      if (x.isFirst) fail("Первое сообщение переносить нельзя");
      const t = await getThread(p.int("thread"));
      const old = await getThread(x.threadId);
      await db.update(posts).set({ threadId: t.id }).where(eq(posts.id, x.id));
      await recountThread(old.id);
      await recountThread(t.id);
      await recountForum(old.forumId);
      await recountForum(t.forumId);
      await log(ctx, "post.move", `#${x.id}`, `→ тема #${t.id}`);
      return { message: "Сообщение перенесено" };
    },
  }),
  act({
    id: "post.purge", group: C, title: "Удалить сообщение навсегда", desc: "Физическое удаление (не для первого сообщения)", perm: "content.purge", danger: true,
    fields: [fId("post", "ID сообщения")],
    run: async (ctx, p) => {
      const x = await getPost(p.int("post"));
      if (x.isFirst) fail("Для первого сообщения удалите тему целиком");
      await db.delete(postLikes).where(eq(postLikes.postId, x.id));
      await db.delete(reports).where(eq(reports.postId, x.id));
      await db.delete(posts).where(eq(posts.id, x.id));
      await recountThread(x.threadId);
      await recountUser(x.authorId);
      const t = await getThread(x.threadId);
      await recountForum(t.forumId);
      await log(ctx, "post.purge", `#${x.id}`);
      return { message: "Сообщение удалено навсегда" };
    },
  }),
  act({
    id: "post.info", group: C, title: "Информация о сообщении", desc: "Автор, IP, лайки", perm: "users.view",
    fields: [fId("post", "ID сообщения")],
    run: async (_c, p) => {
      const x = await getPost(p.int("post"));
      const a = await db.select().from(users).where(eq(users.id, x.authorId)).limit(1);
      return { message: `Сообщение #${x.id}`, data: kv([["Автор", a[0]?.username], ["IP", x.ip], ["Тема", x.threadId], ["Создано", fmtDate(x.createdAt)], ["Изменено", fmtDate(x.editedAt)], ["Лайков", x.likesCount], ["Скрыто", x.isHidden ? "да" : "нет"]]) };
    },
  }),
  act({
    id: "content.deleteByIp", group: C, title: "Скрыть сообщения с IP", desc: "Скрыть все сообщения, написанные с указанного IP (антиспам)", perm: "content.delete", danger: true,
    fields: [fText("ip", "IP", true)],
    run: async (ctx, p) => {
      const rows = await db.update(posts).set({ isHidden: true }).where(and(eq(posts.ip, p.s("ip")), eq(posts.isFirst, false))).returning({ id: posts.id, t: posts.threadId, a: posts.authorId });
      for (const t of new Set(rows.map((r) => r.t))) await recountThread(t);
      for (const a of new Set(rows.map((r) => r.a))) await recountUser(a);
      await log(ctx, "content.deleteByIp", p.s("ip"), `${rows.length}`);
      return { message: `Скрыто сообщений: ${rows.length}` };
    },
  }),
  act({
    id: "content.purgeDeleted", group: C, title: "Очистить корзину", desc: "Физически удалить все скрытые темы и сообщения", perm: "content.purge", danger: true,
    fields: [fBool("confirm", "Подтверждаю", "0")],
    run: async (ctx, p) => {
      if (!p.b("confirm")) fail("Подтвердите действие");
      const ts = await db.select({ id: threads.id }).from(threads).where(eq(threads.isHidden, true));
      await purgeThreads(ts.map((t) => t.id));
      const ps = await db.select({ id: posts.id, t: posts.threadId, a: posts.authorId }).from(posts).where(and(eq(posts.isHidden, true), eq(posts.isFirst, false)));
      if (ps.length) {
        await db.delete(postLikes).where(inArray(postLikes.postId, ps.map((x) => x.id)));
        await db.delete(reports).where(inArray(reports.postId, ps.map((x) => x.id)));
        await db.delete(posts).where(inArray(posts.id, ps.map((x) => x.id)));
        for (const t of new Set(ps.map((x) => x.t))) await recountThread(t);
        for (const a of new Set(ps.map((x) => x.a))) await recountUser(a);
      }
      const fs = await db.select({ id: forums.id }).from(forums);
      for (const f of fs) await recountForum(f.id);
      await log(ctx, "content.purgeDeleted", "", `тем ${ts.length}, сообщений ${ps.length}`);
      return { message: `Удалено тем: ${ts.length}, сообщений: ${ps.length}` };
    },
  }),
  act({
    id: "content.hiddenList", group: C, title: "Корзина (скрытое)", desc: "Список скрытых тем", perm: "forum.viewHidden",
    fields: [],
    run: async () => {
      const ts = await db.select().from(threads).where(eq(threads.isHidden, true)).orderBy(desc(threads.createdAt)).limit(100);
      return { message: `Скрытых тем: ${ts.length}`, data: tbl(["ID", "Заголовок", "Форум", "Создана"], ts.map((t) => [t.id, t.title, t.forumId, fmtDate(t.createdAt)])) };
    },
  }),
];

export const reportActions: ActionDef[] = [
  act({
    id: "report.list", group: M, title: "Открытые жалобы", desc: "Очередь нерассмотренных жалоб", perm: "reports.handle",
    fields: [],
    run: async () => {
      const rs = await db.select().from(reports).where(eq(reports.status, "open")).orderBy(desc(reports.createdAt)).limit(100);
      return { message: `Открытых: ${rs.length}`, data: tbl(["ID", "Сообщение", "Тема", "Причина", "Дата"], rs.map((r) => [r.id, r.postId, r.threadId, r.reason, fmtDate(r.createdAt)])) };
    },
  }),
  ...(["resolve", "reject", "reopen"] as const).map((k) =>
    act({
      id: `report.${k}`, group: M,
      title: k === "resolve" ? "Закрыть жалобу (принята)" : k === "reject" ? "Отклонить жалобу" : "Переоткрыть жалобу",
      desc: k === "reopen" ? "Вернуть жалобу в очередь" : "Отметить жалобу как рассмотренную", perm: "reports.handle",
      fields: [fId("report", "ID жалобы"), fText("note", "Комментарий")],
      run: async (ctx, p) => {
        const r = (await db.select().from(reports).where(eq(reports.id, p.int("report"))).limit(1))[0];
        if (!r) fail("Жалоба не найдена");
        const status = k === "resolve" ? "resolved" : k === "reject" ? "rejected" : "open";
        await db.update(reports).set({ status, handledBy: ctx.actor.id, note: p.s("note"), handledAt: new Date() }).where(eq(reports.id, r.id));
        if (k !== "reopen") await notify(r.reporterId, `Ваша жалоба #${r.id} ${k === "resolve" ? "рассмотрена и принята" : "отклонена"}.${p.s("note") ? " Комментарий: " + p.s("note") : ""}`, `/thread/${r.threadId}`);
        await log(ctx, `report.${k}`, `#${r.id}`);
        return { message: `Жалоба #${r.id}: ${status}` };
      },
    }),
  ),
  act({
    id: "report.delete", group: M, title: "Удалить жалобу", desc: "Стереть запись о жалобе", perm: "reports.handle",
    fields: [fId("report", "ID жалобы")],
    run: async (ctx, p) => {
      await db.delete(reports).where(eq(reports.id, p.int("report")));
      await log(ctx, "report.delete", `#${p.int("report")}`);
      return { message: "Жалоба удалена" };
    },
  }),
  act({
    id: "report.clearClosed", group: M, title: "Очистить закрытые жалобы", desc: "Удалить все рассмотренные и отклонённые", perm: "reports.handle",
    fields: [],
    run: async (ctx) => {
      const r = await db.delete(reports).where(ne(reports.status, "open")).returning({ id: reports.id });
      await log(ctx, "report.clearClosed", "", `${r.length}`);
      return { message: `Удалено: ${r.length}` };
    },
  }),
  act({
    id: "prefix.create", group: M, title: "Создать префикс темы", desc: "Цветная метка перед заголовком", perm: "content.prefix",
    fields: [fText("label", "Текст", true), { name: "color", label: "Цвет", type: "color", def: "#7c3aed" }],
    run: async (ctx, p) => {
      await db.insert(threadPrefixes).values({ label: p.s("label").slice(0, 24), color: p.s("color") || "#7c3aed" });
      await log(ctx, "prefix.create", p.s("label"));
      return { message: "Префикс создан" };
    },
  }),
  act({
    id: "prefix.update", group: M, title: "Изменить префикс", desc: "Текст и цвет", perm: "content.prefix",
    fields: [{ name: "prefix", label: "Префикс", type: "prefix", required: true }, fText("label", "Новый текст"), { name: "color", label: "Цвет", type: "color", def: "" }],
    run: async (ctx, p) => {
      const set: Partial<typeof threadPrefixes.$inferInsert> = {};
      if (p.s("label")) set.label = p.s("label").slice(0, 24);
      if (/^#[0-9a-fA-F]{6}$/.test(p.s("color"))) set.color = p.s("color");
      if (!Object.keys(set).length) fail("Нечего менять");
      await db.update(threadPrefixes).set(set).where(eq(threadPrefixes.id, p.int("prefix")));
      await log(ctx, "prefix.update", `#${p.int("prefix")}`);
      return { message: "Префикс обновлён" };
    },
  }),
  act({
    id: "prefix.delete", group: M, title: "Удалить префикс", desc: "Убирается из всех тем", perm: "content.prefix", danger: true,
    fields: [{ name: "prefix", label: "Префикс", type: "prefix", required: true }],
    run: async (ctx, p) => {
      await db.update(threads).set({ prefixId: null }).where(eq(threads.prefixId, p.int("prefix")));
      await db.delete(threadPrefixes).where(eq(threadPrefixes.id, p.int("prefix")));
      await log(ctx, "prefix.delete", `#${p.int("prefix")}`);
      return { message: "Префикс удалён" };
    },
  }),
  act({
    id: "prefix.list", group: M, title: "Список префиксов", desc: "Все префиксы тем", perm: "content.prefix",
    fields: [],
    run: async () => {
      const rs = await db.select().from(threadPrefixes).orderBy(threadPrefixes.sortOrder);
      return { message: `Префиксов: ${rs.length}`, data: tbl(["ID", "Текст", "Цвет"], rs.map((r) => [r.id, r.label, r.color])) };
    },
  }),
];
