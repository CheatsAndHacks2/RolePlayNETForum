import { db } from "@/db";
import { settings } from "@/db/schema";
import { SETTING_DEFS } from "@/lib/constants";
import { eq } from "drizzle-orm";

export type Settings = {
  raw: Record<string, string>;
  str: (k: string) => string;
  num: (k: string) => number;
  bool: (k: string) => boolean;
  lines: (k: string) => string[];
};

export async function getSettings(): Promise<Settings> {
  const rows = await db.select().from(settings);
  const raw: Record<string, string> = {};
  for (const [k, d] of Object.entries(SETTING_DEFS)) raw[k] = d.def;
  for (const r of rows) raw[r.key] = r.value;
  const str = (k: string) => raw[k] ?? SETTING_DEFS[k]?.def ?? "";
  return {
    raw,
    str,
    num: (k) => {
      const n = Number(str(k));
      return Number.isFinite(n) ? n : Number(SETTING_DEFS[k]?.def ?? 0);
    },
    bool: (k) => str(k) === "1" || str(k) === "true",
    lines: (k) =>
      str(k)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
  };
}

export async function setSetting(key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function getSettingRaw(key: string): Promise<string | null> {
  const r = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return r[0]?.value ?? null;
}
