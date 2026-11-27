import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getViewer } from "@/lib/auth";
import { fmtDate } from "@/lib/constants";
import { NotifButtons } from "@/components/AccountClient";
import { Empty } from "@/components/ui";

export default async function NotificationsPage() {
  const v = await getViewer();
  if (!v.user) return <div className="alert alert-info">Войдите, чтобы видеть уведомления. <Link href="/login" className="underline">Войти</Link></div>;
  const rows = await db.select().from(notifications).where(eq(notifications.userId, v.user.id)).orderBy(desc(notifications.createdAt)).limit(100);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="card">
        <div className="card-h">🔔 Уведомления <span className="flex-1" /><NotifButtons /></div>
        {rows.length === 0 && <Empty>Уведомлений нет</Empty>}
        {rows.map((n) => (
          <div key={n.id} className="row-hover flex items-start gap-3 border-b border-[var(--line)] px-4 py-3 last:border-0" style={n.isRead ? { opacity: 0.65 } : { background: "rgba(139,92,246,.08)" }}>
            <span>{n.isRead ? "○" : "●"}</span>
            <div className="flex-1">
              {n.link ? <Link href={n.link} className="hover:underline">{n.text}</Link> : n.text}
              <div className="small muted">{fmtDate(n.createdAt)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
