import { createCaptcha } from "@/lib/captcha";

export const dynamic = "force-dynamic";

export async function GET() {
  const c = createCaptcha();
  return Response.json(c, { headers: { "Cache-Control": "no-store" } });
}
