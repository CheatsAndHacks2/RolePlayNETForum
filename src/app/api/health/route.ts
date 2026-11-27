import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, service: "roleplay-forum", database: "connected" });
  } catch {
    return Response.json({ ok: false, service: "roleplay-forum", database: "unavailable" }, { status: 503 });
  }
}
