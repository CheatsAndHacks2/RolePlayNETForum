import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, forums, postLikes, posts, roles, threadPrefixes, threads, users } from "@/db/schema";
import { getViewer } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { canViewForum, writeBlock } from "@/lib/access";
import { fmtDate, hasPerm, timeAgo } from "@/lib/constants";
import { renderBB } from "@/lib/format";
import { Avatar, Pagination, PrefixTag, RoleBadge, RoleName } from "@/components/ui";
import { ModBar, PostActions, ReplyBox } from "@/components/ForumClient";

export default async function ThreadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const { id: idS } = await params;
  const sp = await searchParams;
  const id = Number(idS);
  if (!Number.isInteger(id)) notFound();
  const v = await getViewer();
  const s = await getSettings();

  const rows = await db
    .select({ t: threads, f: forums, c: categories, p: threadPrefixes })
    .from(threads)
    .innerJoin(forums, eq(forums.id, threads.forumId))
    .innerJoin(categories, eq(categories.id, forums.categoryId))
    .leftJoin(threadPrefixes, eq(threadPrefixes.id, threads.prefixId))
    .where(eq(threads.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || !canViewForum(v, row.f, row.c)) notFound();
  const { t, f, c, p } = row;
  const seeHidden = hasPerm(v.perms, "forum.viewHidden");
  const own = !!v.user && v.user.id === t.authorId;
  if ((t.isHidden || !t.isApproved) && !seeHidden && !(own && !t.isHidden)) notFound();

  await db.update(threads).set({ views: sql`${threads.views} + 1` }).where(eq(threads.id, id));

  const per = Math.max(5, s.num("postsPerPage"));
  const page = Math.max(1, Number(sp.page) || 1);
  const where = and(eq(posts.threadId, id), seeHidden ? undefined : eq(posts.isHidden, false));
  const [tot] = await db.select({ n: count() }).from(posts).where(where);
  const pages = Math.max(1, Math.ceil((tot?.n ?? 0) / per));

  const list = await db
    .select({ p: posts, u: users, r: roles })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(where)
    .orderBy(asc(posts.createdAt), asc(posts.id))
    .limit(per)
    .offset((page - 1) * per);

  const likedSet = new Set<number>();
  if (v.user && list.length) {
    const ls = await db.select({ id: postLikes.postId }).from(postLikes).where(and(eq(postLikes.userId, v.user.id), inArray(postLikes.postId, list.map((x) => x.p.id))));
    ls.forEach((l) => likedSet.add(l.id));
  }

  const block = writeBlock(v, s);
  const locked = t.isLocked || f.isLocked;
  const canReply = !block && v.level >= f.minPostLevel && (!locked || hasPerm(v.perms, "forum.ignoreLock"));
  const hasModTools = ["content.pin", "content.lock", "content.move", "content.delete", "content.edit", "content.merge", "content.approve"].some((x) => hasPerm(v.perms, x));
  const allForums = hasPerm(v.perms, "content.move") ? await db.select({ id: forums.id, title: forums.title }).from(forums).orderBy(asc(forums.title)) : [];
  const online = (d: Date | null) => !!d && Date.now() - d.getTime() < 5 * 60_000;
  const editWin = s.num("editWindowMinutes");

  return (
    <div className="flex flex-col gap-4">
      <div className="small muted">
        <Link href="/" className="hover:text-white">Форум</Link> › {c.icon} {c.title} › <Link href={`/forum/${f.id}`} className="hover:text-white">{f.title}</Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-extrabold">
          <PrefixTag prefix={p} />
          {t.isPinned && "📌 "}
          {t.isLocked && "🔒 "}
          {t.title}
        </h1>
        <span className="small muted">👁 {t.views + 1} · 💬 {t.repliesCount}</span>
      </div>
      {!t.isApproved && <div className="alert alert-info">Тема ожидает одобрения модератором.</div>}
      {t.isHidden && <div className="alert alert-err">Тема удалена и видна только персоналу.</div>}

      {hasModTools && (
        <ModBar
          threadId={t.id} forumId={f.id} perms={v.perms} forums={allForums} title={t.title}
          pinned={t.isPinned} locked={t.isLocked} hidden={t.isHidden} announcement={t.isAnnouncement} approved={t.isApproved}
        />
      )}

      <Pagination page={page} pages={pages} base={`/thread/${t.id}`} />

      {list.map(({ p: post, u, r }) => {
        const mine = !!v.user && v.user.id === u.id;
        const withinWindow = editWin <= 0 || Date.now() - post.createdAt.getTime() <= editWin * 60_000;
        const canEdit = hasPerm(v.perms, "content.edit") || (mine && withinWindow && !post.isHidden && !block);
        const canDelete = hasPerm(v.perms, "content.delete") || (mine && !post.isFirst && !block);
        return (
          <article key={post.id} id={`post-${post.id}`} className="card post" style={post.isHidden ? { opacity: 0.6, borderColor: "rgba(239,68,68,.5)" } : undefined}>
            <div className="post-side">
              <div className="flex justify-center"><Avatar user={u} size={84} /></div>
              <div className="mt-2 text-lg">
                <Link href={`/user/${u.id}`} className="hover:underline"><RoleName text={u.username} role={r} /></Link>
              </div>
              <div className="mt-1"><RoleBadge role={r} /></div>
              {u.customTitle && <div className="small muted mt-1 italic">{u.customTitle}</div>}
              <div className="small muted mt-2 flex flex-col gap-0.5 max-md:hidden">
                <span>{online(u.lastSeenAt) && !u.hideOnline ? <><span className="online-dot" /> онлайн</> : `был(а) ${timeAgo(u.lastSeenAt)}`}</span>
                <span>Сообщений: <b className="text-white">{u.postsCount}</b></span>
                <span>Репутация: <b className="text-white">{u.reputation}</b></span>
                <span>С нами с {u.createdAt.toLocaleDateString("ru-RU")}</span>
                {u.status === "deleted" && <span style={{ color: "#f87171" }}>аккаунт удалён</span>}
                {u.mutedUntil && u.mutedUntil > new Date() && <span style={{ color: "#fbbf24" }}>🔇 в муте</span>}
              </div>
            </div>
            <div className="post-body">
              <div className="small muted mb-3 flex flex-wrap justify-between gap-2">
                <span>
                  <a href={`#post-${post.id}`} className="hover:text-white">#{post.id}</a> · {fmtDate(post.createdAt)}
                  {post.isHidden && <span className="pill ml-2" style={{ color: "#f87171", borderColor: "#f8717166" }}>удалено</span>}
                  {post.editedAt && <span> · изменено {timeAgo(post.editedAt)}</span>}
                </span>
                {post.isFirst && <span>Автор темы</span>}
              </div>
              <div className="bb" dangerouslySetInnerHTML={{ __html: renderBB(post.content, { allowImages: s.bool("allowImages") }) }} />
              {s.bool("allowSignatures") && u.signature && (
                <div className="small muted mt-4 border-t border-dashed border-[var(--line)] pt-2" dangerouslySetInnerHTML={{ __html: renderBB(u.signature, { allowImages: false }) }} />
              )}
              <PostActions
                postId={post.id} author={u.username} content={post.content} likes={post.likesCount} liked={likedSet.has(post.id)}
                loggedIn={!!v.user && !block} canLike={!!v.user && !mine && s.bool("allowLikes") && !block} canEdit={canEdit} canDelete={canDelete}
                canReply={canReply} isHidden={post.isHidden} isFirst={post.isFirst}
              />
            </div>
          </article>
        );
      })}

      <Pagination page={page} pages={pages} base={`/thread/${t.id}`} />

      {canReply ? (
        <ReplyBox threadId={t.id} />
      ) : (
        <div className="alert alert-info">
          {!v.user ? <>Чтобы ответить, <Link href="/login" className="underline">войдите</Link> или <Link href="/register" className="underline">зарегистрируйтесь</Link>.</> : locked ? "🔒 Тема закрыта для ответов." : block ?? "У вас недостаточно прав для ответа здесь."}
        </div>
      )}
    </div>
  );
}
