import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { roles, sessions, users } from "@/db/schema";
import { audit, canManage, hashPassword, type Role, type User, type Viewer } from "@/lib/auth";
import type { Settings } from "@/lib/settings";
import crypto from "node:crypto";

export class ActionError extends Error {}
export function fail(msg: string): never {
  throw new ActionError(msg);
}

export type FieldType =
  | "text" | "textarea" | "number" | "bool" | "select" | "user" | "role" | "forum"
  | "category" | "duration" | "color" | "password" | "perms" | "level" | "prefix";

export type Field = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  def?: string;
  placeholder?: string;
  help?: string;
};

export type Ctx = { v: Viewer; s: Settings; ip: string; actor: { id: number; name: string } };
export type TableData = { type: "table"; columns: string[]; rows: (string | number)[][] };
export type KvData = { type: "kv"; items: [string, string][] };
export type Result = { message: string; data?: TableData | KvData };

export type ActionDef = {
  id: string;
  group: string;
  title: string;
  desc: string;
  perm: string;
  danger?: boolean;
  settingsGroup?: string;
  fields: Field[];
  run: (ctx: Ctx, p: P) => Promise<Result>;
};

export const act = (d: ActionDef): ActionDef => d;

export class P {
  constructor(public raw: Record<string, unknown>) {}
  s(k: string): string {
    const v = this.raw[k];
    return v == null ? "" : String(v).trim();
  }
  req(k: string, label?: string): string {
    const v = this.s(k);
    if (!v) fail(`Поле «${label ?? k}» обязательно`);
    return v;
  }
  n(k: string, def = 0): number {
    const raw = this.s(k);
    if (raw === "") return def;
    const x = Number(raw);
    return Number.isFinite(x) ? x : def;
  }
  int(k: string, label?: string): number {
    const raw = this.s(k).replace(/^#/, "");
    const x = Number(raw);
    if (!raw || !Number.isInteger(x)) fail(`Поле «${label ?? k}» должно быть числом (ID)`);
    return x;
  }
  b(k: string): boolean {
    const v = this.raw[k];
    return v === true || v === "1" || v === "true" || v === "on";
  }
  arr(k: string): string[] {
    const v = this.raw[k];
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string" && v.trim().startsWith("[")) {
      try {
        const a = JSON.parse(v);
        return Array.isArray(a) ? a.map(String) : [];
      } catch {
        return [];
      }
    }
    return [];
  }
}

export const DURATIONS = [
  { value: "60", label: "1 час" },
  { value: "360", label: "6 часов" },
  { value: "720", label: "12 часов" },
  { value: "1440", label: "1 день" },
  { value: "4320", label: "3 дня" },
  { value: "10080", label: "7 дней" },
  { value: "20160", label: "14 дней" },
  { value: "43200", label: "30 дней" },
  { value: "129600", label: "90 дней" },
  { value: "262800", label: "6 месяцев" },
  { value: "525600", label: "1 год" },
  { value: "0", label: "Навсегда" },
];

export const until = (minutes: number): Date | null => (minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null);

export const tbl = (columns: string[], rows: (string | number)[][]): TableData => ({ type: "table", columns, rows });
export const kv = (items: [string, string | number | null | undefined][]): KvData => ({
  type: "kv",
  items: items.map(([a, b]) => [a, b == null || b === "" ? "—" : String(b)]),
});

export async function findUser(ref: string): Promise<{ u: User; role: Role }> {
  const r = ref.trim().replace(/^@/, "");
  if (!r) fail("Укажите пользователя (ник или #ID)");
  const rows = await db
    .select({ u: users, role: roles })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(/^#\d+$/.test(r) ? eq(users.id, Number(r.slice(1))) : eq(users.usernameLower, r.toLowerCase()))
    .limit(1);
  if (!rows[0]) fail(`Пользователь не найден: ${ref}`);
  return rows[0];
}

/** Find a user and verify that the actor may act on them. */
export async function guardUser(ctx: Ctx, ref: string, opts: { self?: boolean } = {}): Promise<{ u: User; role: Role }> {
  const t = await findUser(ref);
  if (t.u.id === ctx.actor.id && !opts.self) fail("Это действие нельзя применить к самому себе");
  if (!canManage(ctx.v, { id: t.u.id, level: t.role.level, isProtected: t.u.isProtected })) {
    fail(t.u.isProtected ? "Этот аккаунт защищён от изменений" : "Недостаточно прав: ранг цели не ниже вашего");
  }
  return t;
}

export async function findRole(ref: string): Promise<Role> {
  const r = ref.trim();
  if (!r) fail("Укажите роль");
  const rows = await db.select().from(roles).where(/^\d+$/.test(r) ? eq(roles.id, Number(r)) : eq(roles.slug, r)).limit(1);
  if (!rows[0]) fail("Роль не найдена");
  return rows[0];
}

/** Actor may touch only roles strictly below their level (founders: any except the founder role's core). */
export function guardRole(ctx: Ctx, role: Role, what = "изменять") {
  if (ctx.v.isFounder) return;
  if (role.level >= ctx.v.level) fail(`Нельзя ${what} роль, равную или выше вашей`);
}

export async function killSessions(userId: number) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function log(ctx: Ctx, action: string, target = "", details = "") {
  await audit(ctx.actor, action, target, details, ctx.ip);
}

export async function ghostUser(): Promise<number> {
  const ex = await db.select().from(users).where(eq(users.usernameLower, "удалённый")).limit(1);
  if (ex[0]) return ex[0].id;
  const r = (await db.select().from(roles).where(eq(roles.slug, "member")).limit(1))[0];
  const [u] = await db
    .insert(users)
    .values({
      username: "Удалённый",
      usernameLower: "удалённый",
      passwordHash: hashPassword(crypto.randomBytes(24).toString("hex")),
      roleId: r.id,
      status: "deleted",
      avatarColor: "#374151",
      isProtected: true,
    })
    .returning({ id: users.id });
  return u.id;
}

export const BOOL_OPTS = [
  { value: "1", label: "Да" },
  { value: "0", label: "Нет" },
];

export const fUser = (label = "Пользователь", name = "user"): Field => ({
  name, label, type: "user", required: true, placeholder: "Ник или #ID",
});
export const fText = (name: string, label: string, required = false, extra: Partial<Field> = {}): Field => ({
  name, label, type: "text", required, ...extra,
});
export const fArea = (name: string, label: string, required = false, extra: Partial<Field> = {}): Field => ({
  name, label, type: "textarea", required, ...extra,
});
export const fNum = (name: string, label: string, required = false, extra: Partial<Field> = {}): Field => ({
  name, label, type: "number", required, ...extra,
});
export const fBool = (name: string, label: string, def = "0", extra: Partial<Field> = {}): Field => ({
  name, label, type: "bool", def, ...extra,
});
export const fDur = (name = "duration", label = "Срок", def = "1440"): Field => ({
  name, label, type: "duration", def, required: true,
});
export const fRole = (name = "role", label = "Роль"): Field => ({ name, label, type: "role", required: true });
export const fForum = (name = "forum", label = "Форум"): Field => ({ name, label, type: "forum", required: true });
export const fCat = (name = "category", label = "Раздел"): Field => ({ name, label, type: "category", required: true });
export const fId = (name: string, label: string, ph = "ID"): Field => ({
  name, label, type: "number", required: true, placeholder: ph,
});
export const fLevel = (name: string, label: string, def = "0", help = "Минимальный уровень роли (0 = все, включая гостей)"): Field => ({
  name, label, type: "level", def, help,
});

export { and, eq };
