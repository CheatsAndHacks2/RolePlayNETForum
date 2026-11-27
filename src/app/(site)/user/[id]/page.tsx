import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, or, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { bans, categories, forums, roles, threads, users } from "@/db/schema";
import { getViewer } from "@/lib/auth";
import { canViewForum } from "@/lib/access";
import { fmtDate, hasPerm, timeAgo } from "@/lib/constants";
import { renderBB } from "@/lib/format";
import { Avatar, RoleBadge, RoleName } from "@/components/ui";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idS } = await params;
  const id = Number(idS);
  if (!Number.isInteger(id)) notFound();
  const v = await getViewer();
  const rows = await db.select({ u: users, r: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, id)).limit(1);
  if (!rows[0]) notFound();
  const { u, r } = rows[0];
  if (u.status !== "active" && !hasPerm(v.perms, "users.view")) notFound();

  const recent = await db
    .select({ t: threads, f: forums, c: categories })
    .from(threads)
    .innerJoin(forums, eq(forums.id, threads.forumId))
    .innerJoin(categories, eq(categories.id, forums.categoryId))
    .where(and(eq(threads.authorId, u.id), eq(threads.isHidden, false), eq(threads.isApproved, true)))
    .orderBy(desc(threads.createdAt))
    .limit(30);
  const visible = recent.filter((x) => canViewForum(v, x.f, x.c)).slice(0, 8);

  const seeAdmin = hasPerm(v.perms, "users.view");
  let activeBan = false;
  if (seeAdmin) {
    const b = await db.select().from(bans).where(and(eq(bans.userId, u.id), eq(bans.isActive, true), or(isNull(bans.expiresAt), gt(bans.expiresAt, new Date())))).limit(1);
    activeBan = !!b[0];
  }
  const online = !!u.lastSeenAt && Date.now() - u.lastSeenAt.getTime() < 5 * 60_000 && !u.hideOnline;
  const muted = !!u.mutedUntil && u.mutedUntil > new Date();

  return (
    <div className="grid gap-5 md:grid-cols-[320px_1fr]">
      <div className="card h-fit">
        <div className="card-b flex flex-col items-center text-center">
          <Avatar user={u} size={128} />
          <h1 className="mt-3 text-2xl"><RoleName text={u.username} role={r} /></h1>
          <div className="mt-1"><RoleBadge role={r} /></div>
          {u.customTitle && <div className="muted mt-1 italic">{u.customTitle}</div>}
          <div className="small muted mt-2">{online ? <><span className="online-dot" /> Сейчас онлайн</> : u.hideOnline ? "Активность скрыта" : `Был(а) ${timeAgo(u.lastSeenAt)}`}</div>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {u.status === "deleted" && <span className="pill" style={{ color: "#f87171", borderColor: "#f8717166" }}>аккаунт удалён</span>}
            {u.status === "pending" && <span className="pill" style={{ color: "#fbbf24", borderColor: "#fbbf2466" }}>ожидает одобрения</span>}
            {muted && <span className="pill" style={{ color: "#fbbf24", borderColor: "#fbbf2466" }}>🔇 в муте</span>}
            {activeBan && <span className="pill" style={{ color: "#f87171", borderColor: "#f8717166" }}>⛔ забанен</span>}
            {u.isProtected && <span className="pill" style={{ color: "#a5b4fc", borderColor: "#6366f166" }}>🛡 защищён</span>}
          </div>
          <div className="mt-4 grid w-full grid-cols-3 gap-2">
            <div className="stat"><b>{u.postsCount}</b><span className="small muted">сообщ.</span></div>
            <div className="stat"><b>{u.threadsCount}</b><span className="small muted">тем</span></div>
            <div className="stat"><b>{u.reputation}</b><span className="small muted">реп.</span></div>
          </div>
          <div className="small muted mt-4 w-full text-left">
            <div>📅 Регистрация: {fmtDate(u.createdAt)}</div>
            {u.location && <div>📍 {u.location}</div>}
            {u.website && <div>🌐 <a className="underline" href={u.website} target="_blank" rel="nofollow noopener noreferrer">{u.website}</a></div>}
          </div>
          {v.user?.id === u.id && <Link href="/settings" className="btn mt-4 w-full">⚙ Настройки профиля</Link>}
          {seeAdmin && <Link href={`/admin?user=${encodeURIComponent(u.username)}`} className="btn mt-2 w-full" style={{ color: "#fda4af" }}>⚙ Открыть в админ-панели</Link>}
        </div>
      </div>
      <div className="flex flex-col gap-5">
        <div className="card">
          <div className="card-h">О себе</div>
          <div className="card-b">
            {u.about ? <div className="bb" dangerouslySetInnerHTML={{ __html: renderBB(u.about, { allowImages: false }) }} /> : <span className="muted">Пользователь ничего не рассказал о себе.</span>}
          </div>
        </div>
        <div className="card">
          <div className="card-h">Последние темы</div>
          {visible.length === 0 && <div className="muted p-4 small">Тем пока нет.</div>}
          {visible.map(({ t, f }) => (
            <div key={t.id} className="row-hover flex justify-between gap-3 border-b border-[var(--line)] px-4 py-2.5 last:border-0">
              <Link href={`/thread/${t.id}`} className="font-semibold hover:underline">{t.title}</Link>
              <span className="small muted whitespace-nowrap">{f.title} · {timeAgo(t.createdAt)}</span>
            </div>
          ))}
        </div>
        {seeAdmin && (
          <div className="card" style={{ borderColor: "rgba(244,63,94,.4)" }}>
            <div className="card-h">🔎 Данные для персонала</div>
            <div className="card-b small grid gap-1">
              <div>IP регистрации: <b>{u.regIp || "—"}</b> · Последний IP: <b>{u.lastIp || "—"}</b></div>
              <div>Привязка к железу: <b>{u.hwHash ? u.hwHash.slice(0, 16) + "…" : "нет"}</b> · Блок по железу: <b>{u.hwLocked ? "да" : "нет"}</b></div>
              <div>Очки варнов: <b>{u.warnPoints}</b></div>
              {u.adminNote && <div>Заметка: <i>{u.adminNote}</i></div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
