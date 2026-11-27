"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { renderBB } from "@/lib/format";
import { hasPerm } from "@/lib/constants";

export function BBEditor({ value, onChange, rows = 10, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  function wrap(open: string, close: string, ph = "") {
    const el = ref.current;
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const sel = value.slice(a, b) || ph;
    const next = value.slice(0, a) + open + sel + close + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + open.length, a + open.length + sel.length);
    });
  }

  const btn = (label: string, title: string, fn: () => void) => (
    <button type="button" key={title} className="btn btn-sm" title={title} onClick={fn}>
      {label}
    </button>
  );

  return (
    <div>
      <div className="toolbar mb-2 flex flex-wrap gap-1.5">
        {btn("B", "Жирный", () => wrap("[b]", "[/b]", "текст"))}
        {btn("I", "Курсив", () => wrap("[i]", "[/i]", "текст"))}
        {btn("U", "Подчёркнутый", () => wrap("[u]", "[/u]", "текст"))}
        {btn("S", "Зачёркнутый", () => wrap("[s]", "[/s]", "текст"))}
        {btn("❝", "Цитата", () => wrap("[quote]", "[/quote]", "цитата"))}
        {btn("</>", "Код", () => wrap("[code]", "[/code]", "код"))}
        {btn("🔗", "Ссылка", () => wrap("[url=https://]", "[/url]", "текст ссылки"))}
        {btn("🖼", "Картинка", () => wrap("[img]", "[/img]", "https://"))}
        {btn("👁", "Спойлер", () => wrap("[spoiler=Спойлер]", "[/spoiler]", "скрытый текст"))}
        {btn("• Список", "Список", () => wrap("[list]\n[*]", "\n[/list]", "пункт"))}
        {btn("🎨", "Цвет", () => wrap("[color=#a78bfa]", "[/color]", "текст"))}
        {btn("⬌", "По центру", () => wrap("[center]", "[/center]", "текст"))}
        <div className="flex-1" />
        <button type="button" className={`btn btn-sm ${preview ? "btn-primary" : ""}`} onClick={() => setPreview(!preview)}>
          {preview ? "✏️ Редактор" : "👁 Предпросмотр"}
        </button>
      </div>
      {preview ? (
        <div className="bb card-b min-h-[160px] rounded-lg border border-[var(--line)] bg-[#0c0d24]" dangerouslySetInnerHTML={{ __html: renderBB(value) || '<span class="muted">Пусто</span>' }} />
      ) : (
        <textarea ref={ref} className="textarea" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );
}

export function NewThreadForm({ forumId, prefixes, pendingNote }: { forumId: number; prefixes: { id: number; label: string }[]; pendingNote?: boolean }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [prefixId, setPrefixId] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const r = await fetch("/api/forum", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "thread.create", forumId, title, content, prefixId: prefixId || null }),
    });
    const j = await r.json();
    if (!r.ok) {
      setErr(j.error || "Ошибка");
      setBusy(false);
      return;
    }
    window.location.href = j.pending ? `/forum/${forumId}?pending=1` : `/thread/${j.id}`;
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-h">✍️ Новая тема</div>
      <div className="card-b flex flex-col gap-4">
        {err && <div className="alert alert-err">{err}</div>}
        {pendingNote && <div className="alert alert-info">В этом форуме включена премодерация: тема появится после одобрения модератором.</div>}
        <div className="grid gap-3 md:grid-cols-[200px_1fr]">
          <div>
            <label className="label">Префикс</label>
            <select className="select" value={prefixId} onChange={(e) => setPrefixId(e.target.value)}>
              <option value="">— без префикса —</option>
              {prefixes.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Заголовок</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required />
          </div>
        </div>
        <div>
          <label className="label">Сообщение (поддерживается BBCode)</label>
          <BBEditor value={content} onChange={setContent} rows={12} />
        </div>
        <div>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Публикация…" : "Опубликовать тему"}</button>
        </div>
      </div>
    </form>
  );
}

export function ReplyBox({ threadId }: { threadId: number }) {
  const [content, setContent] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ text: string }>).detail;
      setContent((c) => (c ? c + "\n" : "") + d.text + "\n");
      boxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener("rp-quote", h);
    return () => window.removeEventListener("rp-quote", h);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const r = await fetch("/api/forum", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "post.create", threadId, content }),
    });
    const j = await r.json();
    if (!r.ok) {
      setErr(j.error || "Ошибка");
      setBusy(false);
      return;
    }
    window.location.href = `/thread/${threadId}?page=${j.page}#post-${j.id}`;
  }

  return (
    <form className="card" onSubmit={submit} ref={boxRef as unknown as React.RefObject<HTMLFormElement>}>
      <div className="card-h">💬 Быстрый ответ</div>
      <div className="card-b flex flex-col gap-3">
        {err && <div className="alert alert-err">{err}</div>}
        <BBEditor value={content} onChange={setContent} rows={7} />
        <div><button className="btn btn-primary" disabled={busy || !content.trim()}>{busy ? "Отправка…" : "Ответить"}</button></div>
      </div>
    </form>
  );
}

async function run(action: string, params: Record<string, unknown>) {
  const r = await fetch("/api/admin/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, params }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Ошибка");
  return j as { message: string };
}

export function PostActions(props: {
  postId: number; author: string; content: string; likes: number; liked: boolean; loggedIn: boolean;
  canLike: boolean; canEdit: boolean; canDelete: boolean; canReply: boolean; isHidden: boolean; isFirst: boolean;
}) {
  const router = useRouter();
  const [likes, setLikes] = useState(props.likes);
  const [liked, setLiked] = useState(props.liked);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(props.content);
  const [msg, setMsg] = useState("");

  async function api(body: Record<string, unknown>) {
    const r = await fetch("/api/forum", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) {
      setMsg(j.error || "Ошибка");
      return null;
    }
    return j;
  }

  return (
    <div className="mt-3 border-t border-[var(--line)] pt-2">
      {msg && <div className="alert alert-err mb-2 small">{msg}</div>}
      {editing && (
        <div className="mb-3 flex flex-col gap-2">
          <BBEditor value={text} onChange={setText} rows={8} />
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" onClick={async () => { const j = await api({ action: "post.edit", postId: props.postId, content: text }); if (j) { setEditing(false); router.refresh(); } }}>Сохранить</button>
            <button className="btn btn-sm" onClick={() => setEditing(false)}>Отмена</button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {props.canLike && (
          <button className={`btn btn-sm ${liked ? "btn-primary" : ""}`} onClick={async () => { const j = await api({ action: "post.like", postId: props.postId }); if (j) { setLiked(j.liked); setLikes(j.likes); } }}>
            👍 {likes}
          </button>
        )}
        {!props.canLike && likes > 0 && <span className="pill" style={{ color: "#a5b4fc", borderColor: "#6366f166" }}>👍 {likes}</span>}
        {props.canReply && (
          <button className="btn btn-sm" onClick={() => window.dispatchEvent(new CustomEvent("rp-quote", { detail: { text: `[quote=${props.author}]${props.content.replace(/\[quote[\s\S]*?\[\/quote\]/gi, "").trim()}[/quote]` } }))}>❝ Цитата</button>
        )}
        {props.loggedIn && (
          <button className="btn btn-sm" onClick={async () => { const reason = prompt("Причина жалобы:"); if (!reason) return; const j = await api({ action: "post.report", postId: props.postId, reason }); if (j) setMsg(""); if (j) alert("Жалоба отправлена модераторам"); }}>🚩 Жалоба</button>
        )}
        <div className="flex-1" />
        {props.canEdit && <button className="btn btn-sm" onClick={() => setEditing(!editing)}>✏️ Изменить</button>}
        {props.canDelete && !props.isHidden && !props.isFirst && (
          <button className="btn btn-sm btn-danger" onClick={async () => { if (!confirm("Удалить сообщение?")) return; const j = await api({ action: "post.delete", postId: props.postId }); if (j) router.refresh(); }}>🗑 Удалить</button>
        )}
        {props.isHidden && props.canDelete && (
          <button className="btn btn-sm btn-ok" onClick={async () => { try { await run("post.restore", { post: props.postId }); router.refresh(); } catch (e) { setMsg((e as Error).message); } }}>♻ Восстановить</button>
        )}
      </div>
    </div>
  );
}

export function ModBar(props: {
  threadId: number; forumId: number; perms: string[]; forums: { id: number; title: string }[];
  pinned: boolean; locked: boolean; hidden: boolean; announcement: boolean; approved: boolean; title: string;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [moveTo, setMoveTo] = useState(String(props.forumId));
  const can = (p: string) => hasPerm(props.perms, p);

  async function go(action: string, params: Record<string, unknown>, after?: () => void) {
    try {
      const j = await run(action, { thread: props.threadId, ...params });
      setMsg(j.message);
      if (after) after();
      else router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="card" style={{ borderColor: "rgba(245,158,11,.5)" }}>
      <div className="card-b flex flex-wrap items-center gap-2">
        <span className="pill" style={{ color: "#fbbf24", borderColor: "#fbbf2466" }}>🛡 Модерация</span>
        {!props.approved && can("content.approve") && <button className="btn btn-sm btn-ok" onClick={() => go("thread.approve", { value: "1" })}>✔ Одобрить</button>}
        {can("content.pin") && <button className="btn btn-sm" onClick={() => go("thread.pin", { value: props.pinned ? "0" : "1" })}>{props.pinned ? "📌 Открепить" : "📌 Закрепить"}</button>}
        {can("content.pin") && <button className="btn btn-sm" onClick={() => go("thread.announce", { value: props.announcement ? "0" : "1" })}>{props.announcement ? "📣 Снять объявл." : "📣 Объявление"}</button>}
        {can("content.lock") && <button className="btn btn-sm" onClick={() => go("thread.lock", { value: props.locked ? "0" : "1" })}>{props.locked ? "🔓 Открыть" : "🔒 Закрыть"}</button>}
        {can("content.edit") && <button className="btn btn-sm" onClick={() => { const t = prompt("Новый заголовок:", props.title); if (t) go("thread.rename", { title: t }); }}>✏️ Переименовать</button>}
        {can("content.edit") && <button className="btn btn-sm" onClick={() => go("thread.bump", {})}>⬆ Поднять</button>}
        {can("content.merge") && <button className="btn btn-sm" onClick={() => { const t = prompt("ID темы, В КОТОРУЮ перенести все сообщения этой темы:"); if (t) go("thread.merge", { source: props.threadId, target: t }, () => { window.location.href = `/thread/${t}`; }); }}>🔀 Объединить</button>}
        {can("content.move") && (
          <span className="flex items-center gap-1">
            <select className="select" style={{ width: 180, padding: "4px 8px" }} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              {props.forums.map((f) => (<option key={f.id} value={f.id}>{f.title}</option>))}
            </select>
            <button className="btn btn-sm" onClick={() => go("thread.move", { forum: moveTo })}>➡ Переместить</button>
          </span>
        )}
        <div className="flex-1" />
        {can("content.delete") && !props.hidden && <button className="btn btn-sm btn-danger" onClick={() => { const r = prompt("Причина удаления (необязательно):"); if (r === null) return; go("thread.delete", { reason: r }, () => { window.location.href = `/forum/${props.forumId}`; }); }}>🗑 Удалить тему</button>}
        {can("content.delete") && props.hidden && <button className="btn btn-sm btn-ok" onClick={() => go("thread.restore", {})}>♻ Восстановить тему</button>}
        {msg && <span className="small muted w-full">{msg}</span>}
      </div>
    </div>
  );
}
