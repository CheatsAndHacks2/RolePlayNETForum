import Link from "next/link";
import { and, count, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { forums, posts, roles, threadPrefixes, threads, users } from "@/db/schema";
import { getViewer } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { getVisibleStructure } from "@/lib/forumdata";
import { timeAgo } from "@/lib/constants";
import { PrefixTag, RoleName, UserLink } from "@/components/ui";

export default async function HomePage() {
  const v = await getViewer();
  const s = await getSettings();
  const structure = await getVisibleStructure(v);
  const forumIds = structure.flatMap((x) => x.forums.map((f) => f.id));

  const lastByForum = new Map<number, { id: number; title: string; at: Date; uid: number | null; uname: string | null; role: typeof roles.$inferSelect | null }>();
  let recent: { id: number; title: string; forum: string; at: Date; uname: string | null; role: typeof roles.$inferSelect | null; uid: number | null; prefix: { label: string; color: string } | null }[] = [];
  if (forumIds.length) {
    const last = await db
      .selectDistinctOn([threads.forumId], {
        forumId: threads.forumId, id: threads.id, title: threads.title, at: threads.lastPostAt,
        uid: users.id, uname: users.username, role: roles,
      })
      .from(threads)
      .leftJoin(users, eq(users.id, threads.lastPostUserId))
      .leftJoin(roles, eq(roles.id, users.roleId))
      .where(and(inArray(threads.forumId, forumIds), eq(threads.isHidden, false), eq(threads.isApproved, true)))
      .orderBy(threads.forumId, desc(threads.lastPostAt));
    for (const l of last) lastByForum.set(l.forumId, l);

    const rec = await db
      .select({ t: threads, f: forums.title, u: users, r: roles, p: threadPrefixes })
      .from(threads)
      .innerJoin(forums, eq(forums.id, threads.forumId))
      .leftJoin(users, eq(users.id, threads.lastPostUserId))
      .leftJoin(roles, eq(roles.id, users.roleId))
      .leftJoin(threadPrefixes, eq(threadPrefixes.id, threads.prefixId))
      .where(and(inArray(threads.forumId, forumIds), eq(threads.isHidden, false), eq(threads.isApproved, true)))
      .orderBy(desc(threads.lastPostAt))
      .limit(8);
    recent = rec.map((x) => ({ id: x.t.id, title: x.t.title, forum: x.f, at: x.t.lastPostAt, uname: x.u?.username ?? null, uid: x.u?.id ?? null, role: x.r, prefix: x.p }));
  }

  const [uc] = await db.select({ n: count() }).from(users).where(eq(users.status, "active"));
  const [tc] = await db.select({ n: count() }).from(threads).where(and(eq(threads.isHidden, false), eq(threads.isApproved, true)));
  const [pc] = await db.select({ n: count() }).from(posts).where(eq(posts.isHidden, false));
  const newest = await db.select({ u: users, r: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.status, "active")).orderBy(desc(users.createdAt)).limit(1);
  const online = await db
    .select({ u: users, r: roles })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.status, "active"), eq(users.hideOnline, false), gt(users.lastSeenAt, new Date(Date.now() - 5 * 60_000))))
    .orderBy(desc(roles.level))
    .limit(40);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-5">
        <section className="hero">
          <h1 className="text-2xl font-extrabold md:text-3xl">{s.str("siteName")}</h1>
          <p className="muted mt-1">{s.str("siteTagline")}</p>
          <p className="mt-3 max-w-3xl">{s.str("welcomeMessage")}</p>
          {!v.user && (
            <div className="mt-4 flex gap-2">
              <Link href="/register" className="btn btn-primary">Присоединиться</Link>
              <Link href="/login" className="btn">Войти</Link>
            </div>
          )}
        </section>

        {structure.length === 0 && <div className="card card-b muted">Разделов пока нет.</div>}
        {structure.map(({ cat, forums: fs }) => (
          <details key={cat.id} open={!cat.isCollapsed} className="card overflow-hidden">
            <summary className="cursor-pointer list-none">
              <div className="cat-bar" style={{ background: cat.color }} />
              <div className="card-h">
                <span className="text-xl">{cat.icon}</span>
                <div className="flex-1">
                  <div>{cat.title}</div>
                  {cat.description && <div className="small muted font-normal">{cat.description}</div>}
                </div>
                {cat.minViewLevel > 0 && <span className="pill" style={{ color: "#fbbf24", borderColor: "#fbbf2466" }}>🔒 закрытый</span>}
                {cat.isHidden && <span className="pill" style={{ color: "#f87171", borderColor: "#f8717166" }}>скрыт</span>}
              </div>
            </summary>
            {fs.length === 0 && <div className="muted small p-4">В этом разделе пока нет форумов.</div>}
            {fs.map((f) => {
              const l = lastByForum.get(f.id);
              return (
                <div key={f.id} className="row-hover grid items-center gap-3 border-b border-[var(--line)] px-4 py-3 last:border-0 md:grid-cols-[1fr_110px_260px]">
                  <div className="flex items-center gap-3">
                    <div className="grid h-11 w-11 place-items-center rounded-xl text-xl" style={{ background: cat.color + "26", border: `1px solid ${cat.color}55` }}>{f.icon}</div>
                    <div>
                      <Link href={`/forum/${f.id}`} className="font-bold hover:underline">
                        {f.title}
                      </Link>{" "}
                      {f.isLocked && <span title="Закрыт">🔒</span>}
                      {f.isHidden && <span className="pill" style={{ color: "#f87171", borderColor: "#f8717166" }}>скрыт</span>}
                      {f.requiresApproval && <span className="small muted" title="Премодерация"> · 🛡</span>}
                      <div className="small muted">{f.description}</div>
                    </div>
                  </div>
                  <div className="small muted hidden text-center md:block">
                    <b className="text-white">{f.threadsCount}</b> тем<br />
                    <b className="text-white">{f.postsCount}</b> сообщ.
                  </div>
                  <div className="small hidden md:block">
                    {l ? (
                      <>
                        <Link href={`/thread/${l.id}`} className="font-semibold hover:underline">
                          {l.title.length > 34 ? l.title.slice(0, 34) + "…" : l.title}
                        </Link>
                        <div className="muted">
                          {l.uname && l.role && l.uid ? <UserLink user={{ id: l.uid, username: l.uname }} role={l.role} /> : "—"} · {timeAgo(l.at)}
                        </div>
                      </>
                    ) : (
                      <span className="muted">Нет сообщений</span>
                    )}
                  </div>
                </div>
              );
            })}
          </details>
        ))}
      </div>

      <aside className="flex flex-col gap-5">
        <div className="card">
          <div className="card-h">🔥 Последние обсуждения</div>
          <div>
            {recent.length === 0 && <div className="muted small p-4">Пока пусто</div>}
            {recent.map((t) => (
              <div key={t.id} className="row-hover border-b border-[var(--line)] px-4 py-2.5 last:border-0">
                <Link href={`/thread/${t.id}`} className="text-sm font-semibold hover:underline">
                  <PrefixTag prefix={t.prefix} />
                  {t.title}
                </Link>
                <div className="small muted">
                  {t.forum} · {t.uname && t.role ? <RoleName text={t.uname} role={t.role} /> : "—"} · {timeAgo(t.at)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <span className="online-dot" /> Сейчас на форуме ({online.length})
          </div>
          <div className="card-b flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {online.length === 0 && <span className="muted">Никого нет</span>}
            {online.map((o) => (
              <UserLink key={o.u.id} user={o.u} role={o.r} />
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-h">📊 Статистика</div>
          <div className="card-b grid grid-cols-3 gap-2 text-center">
            <div className="stat"><b>{uc?.n ?? 0}</b><span className="small muted">участников</span></div>
            <div className="stat"><b>{tc?.n ?? 0}</b><span className="small muted">тем</span></div>
            <div className="stat"><b>{pc?.n ?? 0}</b><span className="small muted">сообщений</span></div>
          </div>
          {newest[0] && (
            <div className="small muted px-4 pb-4">
              Новый участник: <UserLink user={newest[0].u} role={newest[0].r} />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
