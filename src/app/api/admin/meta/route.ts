import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { categories, forums, roles, threadPrefixes } from "@/db/schema";
import { getViewer, json } from "@/lib/auth";
import { hasPerm } from "@/lib/constants";
import { getSettings } from "@/lib/settings";
import { ALL_ACTIONS } from "@/lib/admin/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const v = await getViewer();
  if (!v.user || v.ban) return json({ error: "Нет доступа" }, 403);
  if (!v.isStaff) return json({ error: "Нет доступа" }, 403);
  const s = await getSettings();
  const actions = ALL_ACTIONS.filter((a) => hasPerm(v.perms, a.perm)).map((a) => ({
    id: a.id,
    group: a.group,
    title: a.title,
    desc: a.desc,
    danger: !!a.danger,
    perm: a.perm,
    fields: a.fields.map((f) => (a.settingsGroup ? { ...f, def: s.str(f.name) } : f)),
  }));
  const [rs, cs, fs, ps] = await Promise.all([
    db.select().from(roles).orderBy(desc(roles.level)),
    db.select().from(categories).orderBy(asc(categories.sortOrder)),
    db.select().from(forums).orderBy(asc(forums.sortOrder)),
    db.select().from(threadPrefixes).orderBy(asc(threadPrefixes.sortOrder)),
  ]);
  return json({
    me: { id: v.user.id, name: v.user.username, level: v.level, perms: v.perms, isFounder: v.isFounder },
    actions,
    roles: rs.map((r) => ({ id: r.id, slug: r.slug, name: r.name, level: r.level, color: r.color, icon: r.icon, permissions: r.permissions, style: r.style })),
    categories: cs.map((c) => ({ id: c.id, title: c.title })),
    forums: fs.map((f) => ({ id: f.id, title: f.title, categoryId: f.categoryId })),
    prefixes: ps.map((p) => ({ id: p.id, label: p.label })),
  });
}
