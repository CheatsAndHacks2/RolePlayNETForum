import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { roles, users } from "@/db/schema";
import { getViewer } from "@/lib/auth";
import { Avatar, RoleName } from "@/components/ui";

export default async function TeamPage() {
  await getViewer();
  const rs = await db.select().from(roles).where(eq(roles.showOnTeam, true)).orderBy(desc(roles.level));
  const us = await db.select().from(users).where(eq(users.status, "active"));
  return (
    <div className="flex flex-col gap-5">
      <div className="hero"><h1 className="text-2xl font-extrabold">🛡 Команда проекта</h1><p className="muted">Люди, которые следят за порядком и развивают RolePlay.NET</p></div>
      {rs.map((r) => {
        const members = us.filter((u) => u.roleId === r.id);
        return (
          <div key={r.id} className="card">
            <div className="card-h" style={{ borderBottomColor: r.color + "55" }}>
              <span className="text-xl">{r.icon}</span> <RoleName text={r.name} role={r} />
              <span className="small muted font-normal">— {r.description}</span>
              <span className="flex-1" /><span className="pill" style={{ color: r.color, borderColor: r.color + "66" }}>{members.length}</span>
            </div>
            <div className="card-b grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {members.length === 0 && <span className="muted small">Пока никого</span>}
              {members.map((u) => (
                <Link key={u.id} href={`/user/${u.id}`} className="row-hover flex items-center gap-3 rounded-xl border border-[var(--line)] p-3">
                  <Avatar user={u} size={44} />
                  <div>
                    <RoleName text={u.username} role={r} />
                    <div className="small muted">{u.customTitle || `${u.postsCount} сообщений`}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

