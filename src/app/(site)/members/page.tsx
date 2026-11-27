import Link from "next/link";
import { and, count, desc, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { roles, users } from "@/db/schema";
import { getViewer } from "@/lib/auth";
import { timeAgo } from "@/lib/constants";
import { Avatar, Pagination, RoleBadge, RoleName } from "@/components/ui";

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; page?: string }> }) {
  const sp = await searchParams;
  await getViewer();
  const q = (sp.q ?? "").trim().replace(/[%_]/g, "").slice(0, 40);
  const roleId = Number(sp.role) || 0;
  const page = Math.max(1, Number(sp.page) || 1);
  const per = 30;
  const conds = [eq(users.status, "active")];
  if (q) conds.push(ilike(users.username, `%${q}%`));
  if (roleId) conds.push(eq(users.roleId, roleId));
  const where = and(...conds);
  const [tot] = await db.select({ n: count() }).from(users).where(where);
  const rows = await db.select({ u: users, r: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(where).orderBy(desc(roles.level), users.username).limit(per).offset((page - 1) * per);
  const allRoles = await db.select().from(roles).orderBy(desc(roles.level));
  const base = `/members?${q ? `q=${encodeURIComponent(q)}&` : ""}${roleId ? `role=${roleId}` : ""}`.replace(/[&?]$/, "");

  return (
    <div className="flex flex-col gap-4">
      <div className="hero">
        <h1 className="text-2xl font-extrabold">👥 Участники ({tot?.n ?? 0})</h1>
        <form className="mt-3 flex flex-wrap gap-2">
          <input className="input" style={{ maxWidth: 280 }} name="q" defaultValue={q} placeholder="Поиск по нику…" />
          <select className="select" style={{ maxWidth: 240 }} name="role" defaultValue={roleId || ""}>
            <option value="">Все роли</option>
            {allRoles.map((r) => (<option key={r.id} value={r.id}>{r.icon} {r.name}</option>))}
          </select>
          <button className="btn btn-primary">Найти</button>
        </form>
      </div>
      <div className="card tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Пользователь</th><th>Роль</th><th>Сообщений</th><th>Репутация</th><th>Регистрация</th><th>Активность</th></tr>
          </thead>
          <tbody>
            {rows.map(({ u, r }) => (
              <tr key={u.id}>
                <td>
                  <Link href={`/user/${u.id}`} className="flex items-center gap-3">
                    <Avatar user={u} size={34} />
                    <RoleName text={u.username} role={r} />
                  </Link>
                </td>
                <td><RoleBadge role={r} /></td>
                <td>{u.postsCount}</td>
                <td>{u.reputation}</td>
                <td className="muted">{u.createdAt.toLocaleDateString("ru-RU")}</td>
                <td className="muted">{u.hideOnline ? "скрыто" : timeAgo(u.lastSeenAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted p-6 text-center">Никого не найдено</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pages={Math.max(1, Math.ceil((tot?.n ?? 0) / per))} base={base || "/members"} />
    </div>
  );
}
