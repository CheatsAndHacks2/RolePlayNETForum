import { cookies } from "next/headers";
import { and, count, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { categories, forums, notifications, postLikes, posts, reports, sessions, threadPrefixes, threads, users } from "@/db/schema";
import { SESSION_COOKIE, getViewer, hashPassword, json, sha, verifyPassword, notify } from "@/lib/auth";
import { canViewForum, writeBlock } from "@/lib/access";
import { hasPerm } from "@/lib/constants";
import { getSettings } from "@/lib/settings";
import { applyWordFilter } from "@/lib/format";
import { insertPost, insertThread, recountForum, recountThread } from "@/lib/forumops";

export const dynamic = "force-dynamic";

const HTTP = /^https?:\/\/[^\s<>"']{3,500}$/i;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return json({ error: "Некорректный запрос" }, 400);
  const v = await getViewer();
  const s = await getSettings();
  const action = body.action;

  // ---------- notifications ----------
  if (action === "notif.read") {
    if (!v.user) return json({ error: "Нужен вход" }, 401);
    await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, v.user.id));
    return json({ ok: true });
  }
  if (action === "notif.clear") {
    if (!v.user) return json({ error: "Нужен вход" }, 401);
    await db.delete(notifications).where(eq(notifications.userId, v.user.id));
    return json({ ok: true });
  }

  // ---------- profile ----------
  if (action === "profile.update") {
    if (!v.user) return json({ error: "Нужен вход" }, 401);
    const str = (k: string, max: number) => String(body[k] ?? "").trim().slice(0, max);
    const avatarUrl = str("avatarUrl", 500);
    const website = str("website", 200);
    const color = str("avatarColor", 9);
    if (avatarUrl && (!HTTP.test(avatarUrl) || !s.bool("allowAvatarUrls"))) return json({ error: "Недопустимая ссылка на аватар" }, 400);
    if (website && !HTTP.test(website)) return json({ error: "Сайт должен начинаться с http:// или https://" }, 400);
    const set: Partial<typeof users.$inferInsert> = {
      about: str("about", 1000),
      location: str("location", 60),
      website,
      avatarUrl,
      hideOnline: !!body.hideOnline,
    };
    if (/^#[0-9a-fA-F]{6}$/.test(color)) set.avatarColor = color;
    if (s.bool("allowSignatures")) set.signature = str("signature", 300);
    await db.update(users).set(set).where(eq(users.id, v.user.id));
    return json({ ok: true });
  }

  if (action === "password.change") {
    if (!v.user) return json({ error: "Нужен вход" }, 401);
    const cur = String(body.current ?? "");
    const next = String(body.next ?? "");
    if (!verifyPassword(cur, v.user.passwordHash)) return json({ error: "Текущий пароль неверен" }, 400);
    if (next.length < s.num("minPasswordLen") || next.length > 128) return json({ error: `Новый пароль: от ${s.num("minPasswordLen")} до 128 символов` }, 400);
    if (next === cur) return json({ error: "Новый пароль совпадает со старым" }, 400);
    await db.update(users).set({ passwordHash: hashPassword(next), forcePwChange: false }).where(eq(users.id, v.user.id));
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (token) await db.delete(sessions).where(and(eq(sessions.userId, v.user.id), ne(sessions.id, sha(token))));
    return json({ ok: true });
  }

  // ---------- writing ----------
  const block = writeBlock(v, s);
  if (block) return json({ error: block }, 403);
  const user = v.user!;
  const words = s.lines("wordFilter");

  async function floodCheck(): Promise<string | null> {
    if (hasPerm(v.perms, "forum.ignoreFlood")) return null;
    const flood = s.num("floodSeconds");
    if (flood <= 0) return null;
    const last = await db.select().from(posts).where(eq(posts.authorId, user.id)).orderBy(desc(posts.createdAt)).limit(1);
    if (last[0] && Date.now() - last[0].createdAt.getTime() < flood * 1000) {
      return `Антифлуд: подождите ${Math.ceil(flood - (Date.now() - last[0].createdAt.getTime()) / 1000)} сек.`;
    }
    return null;
  }

  function checkContent(text: string): string | null {
    if (text.length < s.num("minPostLength")) return `Сообщение слишком короткое (мин. ${s.num("minPostLength")})`;
    if (text.length > s.num("maxPostLength")) return `Сообщение слишком длинное (макс. ${s.num("maxPostLength")})`;
    return null;
  }

  if (action === "thread.create") {
    const forumId = Number(body.forumId);
    const title = applyWordFilter(String(body.title ?? "").trim(), words);
    const content = applyWordFilter(String(body.content ?? "").trim(), words);
    const f = await db.select({ f: forums, c: categories }).from(forums).innerJoin(categories, eq(categories.id, forums.categoryId)).where(eq(forums.id, forumId)).limit(1);
    if (!f[0] || !canViewForum(v, f[0].f, f[0].c)) return json({ error: "Форум не найден" }, 404);
    if (v.level < f[0].f.minThreadLevel) return json({ error: "У вас недостаточно прав для создания тем здесь" }, 403);
    if (f[0].f.isLocked && !hasPerm(v.perms, "forum.ignoreLock")) return json({ error: "Форум закрыт" }, 403);
    if (title.length < s.num("minTitleLength") || title.length > 150) return json({ error: `Заголовок: от ${s.num("minTitleLength")} до 150 символов` }, 400);
    const ce = checkContent(content);
    if (ce) return json({ error: ce }, 400);
    const fe = await floodCheck();
    if (fe) return json({ error: fe }, 429);
    let prefixId: number | null = Number(body.prefixId) || null;
    if (prefixId) {
      const p = await db.select().from(threadPrefixes).where(eq(threadPrefixes.id, prefixId)).limit(1);
      if (!p[0]) prefixId = null;
    }
    const approved = !f[0].f.requiresApproval || hasPerm(v.perms, "content.approve");
    const id = await insertThread({ forumId, authorId: user.id, title, content, prefixId, ip: v.ip, approved });
    if (!approved) return json({ ok: true, id, pending: true });
    return json({ ok: true, id });
  }

  if (action === "post.create") {
    const threadId = Number(body.threadId);
    const content = applyWordFilter(String(body.content ?? "").trim(), words);
    const t = await db.select({ t: threads, f: forums, c: categories }).from(threads).innerJoin(forums, eq(forums.id, threads.forumId)).innerJoin(categories, eq(categories.id, forums.categoryId)).where(eq(threads.id, threadId)).limit(1);
    if (!t[0] || !canViewForum(v, t[0].f, t[0].c) || ((t[0].t.isHidden || !t[0].t.isApproved) && !hasPerm(v.perms, "forum.viewHidden"))) return json({ error: "Тема не найдена" }, 404);
    if ((t[0].t.isLocked || t[0].f.isLocked) && !hasPerm(v.perms, "forum.ignoreLock")) return json({ error: "Тема закрыта" }, 403);
    if (v.level < t[0].f.minPostLevel) return json({ error: "У вас недостаточно прав для ответа здесь" }, 403);
    const ce = checkContent(content);
    if (ce) return json({ error: ce }, 400);
    const fe = await floodCheck();
    if (fe) return json({ error: fe }, 429);
    const id = await insertPost({ threadId, authorId: user.id, content, ip: v.ip });
    const [n] = await db.select({ n: count() }).from(posts).where(and(eq(posts.threadId, threadId), eq(posts.isHidden, false)));
    const page = Math.max(1, Math.ceil((n?.n ?? 1) / Math.max(1, s.num("postsPerPage"))));
    if (t[0].t.authorId !== user.id) await notify(t[0].t.authorId, `${user.username} ответил(а) в вашей теме «${t[0].t.title.slice(0, 60)}»`, `/thread/${threadId}?page=${page}#post-${id}`);
    return json({ ok: true, id, page });
  }

  if (action === "post.edit") {
    const postId = Number(body.postId);
    const content = applyWordFilter(String(body.content ?? "").trim(), words);
    const p = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    if (!p[0]) return json({ error: "Сообщение не найдено" }, 404);
    const own = p[0].authorId === user.id;
    if (!own && !hasPerm(v.perms, "content.edit")) return json({ error: "Нет прав" }, 403);
    if (own && !hasPerm(v.perms, "content.edit")) {
      const win = s.num("editWindowMinutes");
      if (win > 0 && Date.now() - p[0].createdAt.getTime() > win * 60_000) return json({ error: "Время редактирования истекло" }, 403);
      if (p[0].isHidden) return json({ error: "Сообщение удалено" }, 403);
    }
    const ce = checkContent(content);
    if (ce) return json({ error: ce }, 400);
    await db.update(posts).set({ content, editedAt: new Date(), editedBy: user.id }).where(eq(posts.id, postId));
    return json({ ok: true });
  }

  if (action === "post.delete") {
    const postId = Number(body.postId);
    const p = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    if (!p[0]) return json({ error: "Сообщение не найдено" }, 404);
    const own = p[0].authorId === user.id;
    if (!own && !hasPerm(v.perms, "content.delete")) return json({ error: "Нет прав" }, 403);
    if (own && !hasPerm(v.perms, "content.delete") && p[0].isFirst) return json({ error: "Первое сообщение темы может удалить только модератор" }, 403);
    await db.update(posts).set({ isHidden: true }).where(eq(posts.id, postId));
    await recountThread(p[0].threadId);
    const t = await db.select().from(threads).where(eq(threads.id, p[0].threadId)).limit(1);
    if (t[0]) await recountForum(t[0].forumId);
    return json({ ok: true });
  }

  if (action === "post.like") {
    if (!s.bool("allowLikes")) return json({ error: "Лайки отключены" }, 403);
    const postId = Number(body.postId);
    const p = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    if (!p[0]) return json({ error: "Сообщение не найдено" }, 404);
    if (p[0].authorId === user.id) return json({ error: "Нельзя лайкать свои сообщения" }, 400);
    const ex = await db.select().from(postLikes).where(and(eq(postLikes.postId, postId), eq(postLikes.userId, user.id))).limit(1);
    const author = await db.select().from(users).where(eq(users.id, p[0].authorId)).limit(1);
    if (ex[0]) {
      await db.delete(postLikes).where(eq(postLikes.id, ex[0].id));
      await db.update(posts).set({ likesCount: Math.max(0, p[0].likesCount - 1) }).where(eq(posts.id, postId));
      if (author[0]) await db.update(users).set({ reputation: author[0].reputation - 1 }).where(eq(users.id, author[0].id));
      return json({ ok: true, liked: false, likes: Math.max(0, p[0].likesCount - 1) });
    }
    await db.insert(postLikes).values({ postId, userId: user.id });
    await db.update(posts).set({ likesCount: p[0].likesCount + 1 }).where(eq(posts.id, postId));
    if (author[0]) await db.update(users).set({ reputation: author[0].reputation + 1 }).where(eq(users.id, author[0].id));
    return json({ ok: true, liked: true, likes: p[0].likesCount + 1 });
  }

  if (action === "post.report") {
    const postId = Number(body.postId);
    const reason = String(body.reason ?? "").trim();
    if (reason.length < 5 || reason.length > 500) return json({ error: "Опишите причину (5–500 символов)" }, 400);
    const p = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    if (!p[0]) return json({ error: "Сообщение не найдено" }, 404);
    const ex = await db.select().from(reports).where(and(eq(reports.postId, postId), eq(reports.reporterId, user.id), eq(reports.status, "open"))).limit(1);
    if (ex[0]) return json({ error: "Вы уже отправили жалобу на это сообщение" }, 400);
    await db.insert(reports).values({ postId, threadId: p[0].threadId, reporterId: user.id, reason });
    return json({ ok: true });
  }

  return json({ error: "Неизвестное действие" }, 400);
}
