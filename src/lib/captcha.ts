import crypto from "node:crypto";
import { db } from "@/db";
import { usedCaptchas } from "@/db/schema";
import { lt } from "drizzle-orm";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const COLORS = ["#c4b5fd", "#f0abfc", "#93c5fd", "#fca5a5", "#fcd34d", "#86efac", "#67e8f9"];

function secret(): string {
  return (
    process.env.AUTH_SECRET ||
    crypto.createHash("sha256").update("rp-captcha:" + (process.env.DATABASE_URL || "dev")).digest("hex")
  );
}

function sign(text: string, exp: number, nonce: string): string {
  return crypto.createHmac("sha256", secret()).update(`${text}|${exp}|${nonce}`).digest("hex");
}

function rnd(min: number, max: number) {
  return min + (crypto.randomInt(0, 10000) / 10000) * (max - min);
}

export function createCaptcha(): { token: string; image: string } {
  let text = "";
  for (let i = 0; i < 5; i++) text += CHARS[crypto.randomInt(0, CHARS.length)];
  const exp = Date.now() + 10 * 60 * 1000;
  const nonce = crypto.randomBytes(8).toString("hex");
  const token = `${exp}.${nonce}.${sign(text, exp, nonce)}`;

  const W = 190;
  const H = 64;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  svg += `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e1b4b"/><stop offset="1" stop-color="#312e81"/></linearGradient>`;
  svg += `<filter id="w"><feTurbulence type="turbulence" baseFrequency="0.02 0.06" numOctaves="2" seed="${crypto.randomInt(1, 999)}" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="7"/></filter></defs>`;
  svg += `<rect width="${W}" height="${H}" fill="url(#g)"/>`;
  for (let i = 0; i < 7; i++) {
    svg += `<path d="M${rnd(0, W).toFixed(1)} ${rnd(0, H).toFixed(1)} Q ${rnd(0, W).toFixed(1)} ${rnd(0, H).toFixed(1)} ${rnd(0, W).toFixed(1)} ${rnd(0, H).toFixed(1)}" stroke="${COLORS[crypto.randomInt(0, COLORS.length)]}" stroke-opacity="0.55" stroke-width="${rnd(1, 2.2).toFixed(1)}" fill="none"/>`;
  }
  svg += `<g filter="url(#w)">`;
  for (let i = 0; i < text.length; i++) {
    const x = 18 + i * 31 + rnd(-3, 3);
    const y = 42 + rnd(-6, 6);
    svg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Verdana, Arial, sans-serif" font-weight="800" font-size="${rnd(30, 38).toFixed(0)}" fill="${COLORS[crypto.randomInt(0, COLORS.length)]}" transform="rotate(${rnd(-24, 24).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">${text[i]}</text>`;
  }
  svg += `</g>`;
  for (let i = 0; i < 40; i++) {
    svg += `<circle cx="${rnd(0, W).toFixed(1)}" cy="${rnd(0, H).toFixed(1)}" r="${rnd(0.5, 1.5).toFixed(1)}" fill="${COLORS[crypto.randomInt(0, COLORS.length)]}" fill-opacity="0.7"/>`;
  }
  svg += `</svg>`;
  return { token, image: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64") };
}

export async function verifyCaptcha(token: unknown, answer: unknown): Promise<boolean> {
  if (typeof token !== "string" || typeof answer !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expS, nonce, sig] = parts;
  const exp = Number(expS);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  if (!/^[a-f0-9]{16}$/.test(nonce)) return false;

  // single use: any attempt burns the token
  try {
    await db.insert(usedCaptchas).values({ id: nonce, expiresAt: new Date(exp + 60_000) });
  } catch {
    return false;
  }
  if (Math.random() < 0.05) {
    db.delete(usedCaptchas).where(lt(usedCaptchas.expiresAt, new Date())).catch(() => {});
  }
  const expected = sign(answer.trim().toUpperCase(), exp, nonce);
  if (expected.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
