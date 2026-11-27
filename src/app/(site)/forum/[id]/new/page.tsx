import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, forums, threadPrefixes } from "@/db/schema";
import { getViewer } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { canViewForum, writeBlock } from "@/lib/access";
import { hasPerm } from "@/lib/constants";
import { NewThreadForm } from "@/components/ForumClient";

export default async function NewThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idS } = await params;
  const id = Number(idS);
  if (!Number.isInteger(id)) notFound();
  const v = await getViewer();
  const s = await getSettings();
  const rows = await db.select({ f: forums, c: categories }).from(forums).innerJoin(categories, eq(categories.id, forums.categoryId)).where(eq(forums.id, id)).limit(1);
  if (!rows[0] || !canViewForum(v, rows[0].f, rows[0].c)) notFound();
  const { f } = rows[0];
  const block = writeBlock(v, s);
  let deny: string | null = block;
  if (!deny && v.level < f.minThreadLevel) deny = "У вас недостаточно прав для создания тем в этом форуме";
  if (!deny && f.isLocked && !hasPerm(v.perms, "forum.ignoreLock")) deny = "Форум закрыт";
  const prefixes = await db.select().from(threadPrefixes).orderBy(asc(threadPrefixes.sortOrder));
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="small muted">
        <Link href={`/forum/${f.id}`} className="hover:text-white">← {f.title}</Link>
      </div>
      {deny ? (
        <div className="alert alert-err">
          {deny} {!v.user && <Link href="/login" className="underline">Войти</Link>}
        </div>
      ) : (
        <NewThreadForm forumId={f.id} prefixes={prefixes.map((p) => ({ id: p.id, label: p.label }))} pendingNote={f.requiresApproval && !hasPerm(v.perms, "content.approve")} />
      )}
    </div>
  );
}
