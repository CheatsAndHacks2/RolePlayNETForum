import { asc } from "drizzle-orm";
import { db } from "@/db";
import { categories, forums } from "@/db/schema";
import type { Viewer } from "@/lib/auth";
import { canViewCategory, canViewForum } from "@/lib/access";

export async function getVisibleStructure(v: Viewer) {
  const cats = await db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.id));
  const fs = await db.select().from(forums).orderBy(asc(forums.sortOrder), asc(forums.id));
  return cats
    .filter((c) => canViewCategory(v, c))
    .map((c) => ({ cat: c, forums: fs.filter((f) => f.categoryId === c.id && canViewForum(v, f, c)) }));
}
