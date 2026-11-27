import Link from "next/link";
import { and, desc, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { categories, forums, posts, threads, users } from "@/db/schema";
import { getViewer } from "@/lib/auth";
import { canViewForum } from "@/lib/access";
import { hasPerm, timeAgo } from "@/lib/constants";
import { excerpt } from "@/lib/format";
import { Empty } from "@/components/ui";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const v = await getViewer();
  const q = (sp.q ?? "").trim().slice(0, 80);
  const pat = `%${q.replace(/[%_]/g, "")}%`;
  const seeHidden = hasPerm(v.perms, "forum.viewHidden");
  let tr: { id: number; title: string; forum: string; at: Date }[] = [];
  let pr: { id: number; threadId: number; title: string; text: string; user: string; at: Date }[] = [];
  if (q.length >= 2) {
    const ts = await db
      .select({ t: threads, f: forums, c: categories })
      .from(threads).innerJoin(forums, eq(forums.id, threads.forumId)).innerJoin(categories, eq(categories.id, forums.categoryId))
      .where(and(ilike(threads.title, pat), seeHidden ? undefined : and(eq(threads.isHidden, false), eq(threads.isApproved, true))))
      .orderBy(desc(threads.lastPostAt)).limit(60);
    tr = ts.filter((x) => canViewForum(v, x.f, x.c)).slice(0, 20).map((x) => ({ id: x.t.id, title: x.t.title, forum: x.f.title, at: x.t.lastPostAt }));
    const ps = await db
      .select({ p: posts, t: threads, f: forums, c: categories, u: users })
      .from(posts).innerJoin(threads, eq(threads.id, posts.threadId)).innerJoin(forums, eq(forums.id, threads.forumId)).innerJoin(categories, eq(categories.id, forums.categoryId)).innerJoin(users, eq(users.id, posts.authorId))
      .where(and(ilike(posts.content, pat), seeHidden ? undefined : and(eq(posts.isHidden, false), eq(threads.isHidden, false), eq(threads.isApproved, true))))
      .orderBy(desc(posts.createdAt)).limit(80);
    pr = ps.filter((x) => canViewForum(v, x.f, x.c)).slice(0, 25).map((x) => ({ id: x.p.id, threadId: x.t.id, title: x.t.title, text: excerpt(x.p.content, 180), user: x.u.username, at: x.p.createdAt }));
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="hero">
        <h1 className="text-2xl font-extrabold">🔍 Поиск</h1>
        <form className="mt-3 flex gap-2"><input className="input" style={{ maxWidth: 420 }} name="q" defaultValue={q} placeholder="Минимум 2 символа" /><button className="btn btn-primary">Искать</button></form>
      </div>
      {q.length >= 2 && (
        <>
          <div className="card">
            <div className="card-h">Темы ({tr.length})</div>
            {tr.length === 0 && <Empty>Ничего не найдено</Empty>}
            {tr.map((t) => (
              <div key={t.id} className="row-hover border-b border-[var(--line)] px-4 py-2.5 last:border-0">
                <Link href={`/thread/${t.id}`} className="font-semibold hover:underline">{t.title}</Link>
                <div className="small muted">{t.forum} · {timeAgo(t.at)}</div>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-h">Сообщения ({pr.length})</div>
            {pr.length === 0 && <Empty>Ничего не найдено</Empty>}
            {pr.map((p) => (
              <div key={p.id} className="row-hover border-b border-[var(--line)] px-4 py-2.5 last:border-0">
                <Link href={`/thread/${p.threadId}#post-${p.id}`} className="font-semibold hover:underline">{p.title}</Link>
                <div className="small">{p.text}</div>
                <div className="small muted">{p.user} · {timeAgo(p.at)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
