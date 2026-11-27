import Link from "next/link";
import { notFound } from "next/navigation";
import { and, count, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { categories, forums, roles, threadPrefixes, threads, users } from "@/db/schema";
import { getViewer } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { canViewForum, writeBlock } from "@/lib/access";
import { hasPerm, timeAgo } from "@/lib/constants";
import { Avatar, Empty, Pagination, PrefixTag, UserLink } from "@/components/ui";

export default async function ForumPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; pending?: string }> }) {
  const { id: idS } = await params;
  const sp = await searchParams;
  const id = Number(idS);
  if (!Number.isInteger(id)) notFound();
  const v = await getViewer();
  const s = await getSettings();
  const rows = await db.select({ f: forums, c: categories }).from(forums).innerJoin(categories, eq(categories.id, forums.categoryId)).where(eq(forums.id, id)).limit(1);
  if (!rows[0] || !canViewForum(v, rows[0].f, rows[0].c)) notFound();
  const { f, c } = rows[0];

  const per = Math.max(5, s.num("threadsPerPage"));
  const page = Math.max(1, Number(sp.page) || 1);
  const seeHidden = hasPerm(v.perms, "forum.viewHidden");
  const vis = seeHidden
    ? undefined
    : and(eq(threads.isHidden, false), v.user ? or(eq(threads.isApproved, true), eq(threads.authorId, v.user.id)) : eq(threads.isApproved, true));
  const where = and(eq(threads.forumId, id), vis);
  const [tot] = await db.select({ n: count() }).from(threads).where(where);
  const pages = Math.max(1, Math.ceil((tot?.n ?? 0) / per));

  const list = await db
    .select({ t: threads, u: users, r: roles, p: threadPrefixes })
    .from(threads)
    .innerJoin(users, eq(users.id, threads.authorId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(threadPrefixes, eq(threadPrefixes.id, threads.prefixId))
    .where(where)
    .orderBy(desc(threads.isAnnouncement), desc(threads.isPinned), desc(threads.lastPostAt))
    .limit(per)
    .offset((page - 1) * per);

  const lpIds = Array.from(new Set(list.map((x) => x.t.lastPostUserId).filter((x): x is number => !!x)));
  const lps = lpIds.length ? await db.select({ u: users, r: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(inArray(users.id, lpIds)) : [];
  const lpMap = new Map(lps.map((x) => [x.u.id, x]));

  const block = writeBlock(v, s);
  const canThread = !block && v.level >= f.minThreadLevel && (!f.isLocked || hasPerm(v.perms, "forum.ignoreLock"));

  return (
    <div className="flex flex-col gap-4">
      <div className="small muted">
        <Link href="/" className="hover:text-white">Форум</Link> › {c.icon} {c.title} › <b className="text-white">{f.title}</b>
      </div>
      <div className="hero flex flex-wrap items-center gap-4">
        <div className="text-4xl">{f.icon}</div>
        <div className="flex-1">
          <h1 className="text-2xl font-extrabold">{f.title}</h1>
          <p className="muted">{f.description}</p>
        </div>
        {canThread ? (
          <Link href={`/forum/${f.id}/new`} className="btn btn-primary">✍️ Создать тему</Link>
        ) : !v.user ? (
          <Link href="/login" className="btn">Войдите, чтобы писать</Link>
        ) : (
          <span className="small muted">{f.isLocked ? "🔒 Форум закрыт" : block ?? "Создавать темы здесь нельзя"}</span>
        )}
      </div>
      {sp.pending && <div className="alert alert-ok">Тема отправлена на модерацию и появится после одобрения.</div>}

      <div className="card overflow-hidden">
        {list.length === 0 && <Empty>В этом форуме пока нет тем. Станьте первым!</Empty>}
        {list.map(({ t, u, r, p }) => {
          const lp = t.lastPostUserId ? lpMap.get(t.lastPostUserId) : null;
          return (
            <div key={t.id} className="row-hover grid items-center gap-3 border-b border-[var(--line)] px-4 py-3 last:border-0 md:grid-cols-[1fr_100px_220px]" style={t.isHidden ? { opacity: 0.55 } : undefined}>
              <div className="flex items-center gap-3">
                <Avatar user={u} size={40} />
                <div className="min-w-0">
                  <div className="truncate">
                    {t.isAnnouncement && <span title="Объявление">📣 </span>}
                    {t.isPinned && <span title="Закреплена">📌 </span>}
                    {t.isLocked && <span title="Закрыта">🔒 </span>}
                    <PrefixTag prefix={p} />
                    <Link href={`/thread/${t.id}`} className="font-bold hover:underline">{t.title}</Link>
                    {t.isHidden && <span className="pill ml-2" style={{ color: "#f87171", borderColor: "#f8717166" }}>удалена</span>}
                    {!t.isApproved && <span className="pill ml-2" style={{ color: "#fbbf24", borderColor: "#fbbf2466" }}>на модерации</span>}
                  </div>
                  <div className="small muted">
                    <UserLink user={u} role={r} /> · {timeAgo(t.createdAt)}
                  </div>
                </div>
              </div>
              <div className="small muted hidden text-center md:block">
                <b className="text-white">{t.repliesCount}</b> ответов<br />
                <b className="text-white">{t.views}</b> просм.
              </div>
              <div className="small hidden md:block">
                {lp ? <UserLink user={lp.u} role={lp.r} /> : "—"}
                <div className="muted">{timeAgo(t.lastPostAt)}</div>
              </div>
            </div>
          );
        })}
      </div>
      <Pagination page={page} pages={pages} base={`/forum/${f.id}`} />
    </div>
  );
}
