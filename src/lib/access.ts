import type { Viewer } from "@/lib/auth";
import { hasPerm } from "@/lib/constants";
import type { Settings } from "@/lib/settings";

type Lvl = { isHidden: boolean; minViewLevel: number };

export function canViewForum(v: Viewer, f: Lvl, c: Lvl): boolean {
  if ((f.isHidden || c.isHidden) && !hasPerm(v.perms, "forum.viewHidden")) return false;
  if (hasPerm(v.perms, "forum.viewAll")) return true;
  return v.level >= f.minViewLevel && v.level >= c.minViewLevel;
}

export function canViewCategory(v: Viewer, c: Lvl): boolean {
  if (c.isHidden && !hasPerm(v.perms, "forum.viewHidden")) return false;
  if (hasPerm(v.perms, "forum.viewAll")) return true;
  return v.level >= c.minViewLevel;
}

export function isMuted(v: Viewer): boolean {
  return !!v.user?.mutedUntil && v.user.mutedUntil.getTime() > Date.now();
}

/** Returns an error string if the viewer can't write anything right now. */
export function writeBlock(v: Viewer, s: Settings): string | null {
  if (!v.user) return "Войдите, чтобы писать на форуме";
  if (v.ban) return "Ваш доступ заблокирован";
  if (v.shadow) return "Вы не можете писать на форуме";
  if (isMuted(v)) return `Вы в муте до ${v.user.mutedUntil!.toLocaleString("ru-RU")}. Причина: ${v.user.muteReason || "не указана"}`;
  if (s.bool("readOnlyMode") && !v.isStaff) return "Форум в режиме «только чтение»";
  if (s.bool("maintenanceMode") && !v.isStaff) return "Идут технические работы";
  return null;
}
