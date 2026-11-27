// BBCode renderer (safe: input is HTML-escaped first). Works on server and client.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/;
const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i;

export function renderBB(src: string, opts: { allowImages?: boolean } = {}): string {
  const allowImages = opts.allowImages !== false;
  let s = escapeHtml(src);

  const codes: string[] = [];
  s = s.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_m, c: string) => {
    codes.push(`<pre class="bb-code"><code>${c.replace(/^\n/, "")}</code></pre>`);
    return `\u0000C${codes.length - 1}\u0000`;
  });

  const simple: [RegExp, string][] = [
    [/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>"],
    [/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>"],
    [/\[u\]([\s\S]*?)\[\/u\]/gi, "<u>$1</u>"],
    [/\[s\]([\s\S]*?)\[\/s\]/gi, "<s>$1</s>"],
    [/\[center\]([\s\S]*?)\[\/center\]/gi, '<div style="text-align:center">$1</div>'],
    [/\[right\]([\s\S]*?)\[\/right\]/gi, '<div style="text-align:right">$1</div>'],
    [/\[hr\]/gi, "<hr/>"],
  ];
  for (let pass = 0; pass < 3; pass++) for (const [re, rep] of simple) s = s.replace(re, rep);

  s = s.replace(/\[color=([#\w]+)\]([\s\S]*?)\[\/color\]/gi, (_m, c: string, t: string) =>
    SAFE_COLOR.test(c) ? `<span style="color:${c}">${t}</span>` : t,
  );
  s = s.replace(/\[size=([1-6])\]([\s\S]*?)\[\/size\]/gi, (_m, n: string, t: string) => {
    const sizes = ["", "0.75em", "0.9em", "1.1em", "1.35em", "1.7em", "2.1em"];
    return `<span style="font-size:${sizes[Number(n)]}">${t}</span>`;
  });
  s = s.replace(/\[url\](https?:\/\/[\s\S]*?)\[\/url\]/gi, (_m, u: string) =>
    SAFE_URL.test(u) ? `<a href="${u}" target="_blank" rel="nofollow noopener noreferrer">${u}</a>` : u,
  );
  s = s.replace(/\[url=(https?:\/\/[^\]\s]+)\]([\s\S]*?)\[\/url\]/gi, (_m, u: string, t: string) =>
    SAFE_URL.test(u) ? `<a href="${u}" target="_blank" rel="nofollow noopener noreferrer">${t}</a>` : t,
  );
  s = s.replace(/\[img\](https?:\/\/[^\s\[]+?)\[\/img\]/gi, (_m, u: string) =>
    allowImages && SAFE_URL.test(u) ? `<img class="bb-img" src="${u}" alt="" loading="lazy" referrerpolicy="no-referrer"/>` : u,
  );

  for (let i = 0; i < 4; i++) {
    s = s.replace(
      /\[quote(?:=(?:&quot;)?([^\]]*?)(?:&quot;)?)?\]([\s\S]*?)\[\/quote\]/i,
      (_m, who: string | undefined, t: string) =>
        `<blockquote class="bb-quote">${who ? `<div class="bb-quote-who">${who} писал(а):</div>` : ""}${t}</blockquote>`,
    );
  }
  for (let i = 0; i < 3; i++) {
    s = s.replace(
      /\[spoiler(?:=([^\]]*?))?\]([\s\S]*?)\[\/spoiler\]/i,
      (_m, title: string | undefined, t: string) =>
        `<details class="bb-spoiler"><summary>${title || "Спойлер"}</summary><div>${t}</div></details>`,
    );
  }
  s = s.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_m, inner: string) => {
    const items = inner.split(/\[\*\]/).map((x) => x.trim()).filter(Boolean);
    return `<ul class="bb-list">${items.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  });

  s = s.replace(/\r?\n/g, "<br/>");
  s = s.replace(/\u0000C(\d+)\u0000/g, (_m, i: string) => codes[Number(i)] ?? "");
  return s;
}

export function applyWordFilter(text: string, words: string[]): string {
  let out = text;
  for (const w of words) {
    if (!w) continue;
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "gi"), (m) => "*".repeat(m.length));
  }
  return out;
}

export function excerpt(text: string, n = 140): string {
  const t = text
    .replace(/\[quote[\s\S]*?\[\/quote\]/gi, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}
