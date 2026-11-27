import { getViewer, json } from "@/lib/auth";
import { hasPerm } from "@/lib/constants";
import { getSettings } from "@/lib/settings";
import { ACTION_MAP } from "@/lib/admin/registry";
import { ActionError, P } from "@/lib/admin/core";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { action?: string; params?: Record<string, unknown> } | null;
  if (!body?.action) return json({ error: "Некорректный запрос" }, 400);
  const v = await getViewer();
  if (!v.user || v.ban) return json({ error: "Нужен вход" }, 401);
  const def = ACTION_MAP.get(body.action);
  if (!def) return json({ error: "Неизвестное действие" }, 404);
  if (!hasPerm(v.perms, def.perm)) return json({ error: "Недостаточно прав для этого действия" }, 403);
  const s = await getSettings();
  try {
    const res = await def.run({ v, s, ip: v.ip, actor: { id: v.user.id, name: v.user.username } }, new P(body.params ?? {}));
    return json({ ok: true, ...res });
  } catch (e) {
    if (e instanceof ActionError) return json({ error: e.message }, 400);
    console.error("admin action failed", def.id, e);
    return json({ error: "Внутренняя ошибка при выполнении действия" }, 500);
  }
}
