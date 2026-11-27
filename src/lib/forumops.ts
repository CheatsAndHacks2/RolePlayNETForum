import { db } from "@/db";
import { forums, posts, threads, users } from "@/db/schema";
import { and, count, desc, eq, sum } from "drizzle-orm";

export async function recountThread(id: number) {
  const t = await db.select().from(threads).where(eq(threads.id, id)).limit(1);
  if (!t[0]) return;
  const [c] = await db
    .select({ n: count() })
    .from(posts)
    .where(and(eq(posts.threadId, id), eq(posts.isHidden, false)));
  const last = await db
    .select()
    .from(posts)
    .where(and(eq(posts.threadId, id), eq(posts.isHidden, false)))
    .orderBy(desc(posts.createdAt))
    .limit(1);
  await db
    .update(threads)
    .set({
      repliesCount: Math.max(0, (c?.n ?? 0) - 1),
      lastPostAt: last[0]?.createdAt ?? t[0].createdAt,
      lastPostUserId: last[0]?.authorId ?? t[0].authorId,
    })
    .where(eq(threads.id, id));
}

export async function recountForum(id: number) {
  const [r] = await db
    .select({ n: count(), p: sum(threads.repliesCount) })
    .from(threads)
    .where(and(eq(threads.forumId, id), eq(threads.isHidden, false), eq(threads.isApproved, true)));
  const n = r?.n ?? 0;
  await db
    .update(forums)
    .set({ threadsCount: n, postsCount: n + Number(r?.p ?? 0) })
    .where(eq(forums.id, id));
}

export async function recountUser(id: number) {
  const [p] = await db
    .select({ n: count() })
    .from(posts)
    .where(and(eq(posts.authorId, id), eq(posts.isHidden, false)));
  const [t] = await db
    .select({ n: count() })
    .from(threads)
    .where(and(eq(threads.authorId, id), eq(threads.isHidden, false)));
  await db
    .update(users)
    .set({ postsCount: p?.n ?? 0, threadsCount: t?.n ?? 0 })
    .where(eq(users.id, id));
}

export async function insertThread(o: {
  forumId: number;
  authorId: number;
  title: string;
  content: string;
  prefixId?: number | null;
  ip?: string;
  approved?: boolean;
  pinned?: boolean;
  announcement?: boolean;
  createdAt?: Date;
}): Promise<number> {
  const createdAt = o.createdAt ?? new Date();
  const [t] = await db
    .insert(threads)
    .values({
      forumId: o.forumId,
      authorId: o.authorId,
      title: o.title,
      prefixId: o.prefixId ?? null,
      isApproved: o.approved ?? true,
      isPinned: o.pinned ?? false,
      isAnnouncement: o.announcement ?? false,
      createdAt,
      lastPostAt: createdAt,
      lastPostUserId: o.authorId,
    })
    .returning({ id: threads.id });
  await db.insert(posts).values({
    threadId: t.id,
    authorId: o.authorId,
    content: o.content,
    isFirst: true,
    ip: o.ip ?? "",
    createdAt,
  });
  await recountForum(o.forumId);
  await recountUser(o.authorId);
  return t.id;
}

export async function insertPost(o: {
  threadId: number;
  authorId: number;
  content: string;
  ip?: string;
  createdAt?: Date;
}): Promise<number> {
  const [p] = await db
    .insert(posts)
    .values({
      threadId: o.threadId,
      authorId: o.authorId,
      content: o.content,
      ip: o.ip ?? "",
      createdAt: o.createdAt ?? new Date(),
    })
    .returning({ id: posts.id });
  await recountThread(o.threadId);
  const t = await db.select().from(threads).where(eq(threads.id, o.threadId)).limit(1);
  if (t[0]) await recountForum(t[0].forumId);
  await recountUser(o.authorId);
  return p.id;
}

export async function recountAll() {
  const fs = await db.select({ id: forums.id }).from(forums);
  const ts = await db.select({ id: threads.id }).from(threads);
  const us = await db.select({ id: users.id }).from(users);
  for (const t of ts) await recountThread(t.id);
  for (const f of fs) await recountForum(f.id);
  for (const u of us) await recountUser(u.id);
  return { forums: fs.length, threads: ts.length, users: us.length };
}
