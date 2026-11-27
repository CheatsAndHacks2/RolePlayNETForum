"use client";

// Browser/device fingerprint. Combines GPU, screen, CPU cores, memory and platform.
// NOTE: a web page cannot read true hardware serials; this is the strongest stable
// device identifier available in a browser.

function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

function gpu(): string {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") || c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "nogl";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (ext) return `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)}|${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}`;
    return `${gl.getParameter(gl.VENDOR)}|${gl.getParameter(gl.RENDERER)}`;
  } catch {
    return "glerr";
  }
}

export async function computeHw(): Promise<string> {
  const s = window.screen;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const parts = [
    [s.width, s.height].sort((a, b) => b - a).join("x"),
    String(s.colorDepth),
    String(nav.hardwareConcurrency || 0),
    String(nav.deviceMemory || 0),
    nav.platform || "",
    String(nav.maxTouchPoints || 0),
    gpu(),
    "rp-hw-v1",
  ].join("|");
  try {
    if (window.crypto?.subtle) {
      const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    /* fall through */
  }
  return [0, 1, 2, 3].map((i) => cyrb53(parts, i * 7919)).join("");
}
