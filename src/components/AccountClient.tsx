"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NotifButtons() {
  const router = useRouter();
  return (
    <div className="flex gap-2">
      <button className="btn btn-sm" onClick={async () => { await fetch("/api/forum", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notif.read" }) }); router.refresh(); }}>✓ Прочитать все</button>
      <button className="btn btn-sm btn-danger" onClick={async () => { await fetch("/api/forum", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notif.clear" }) }); router.refresh(); }}>🗑 Очистить</button>
    </div>
  );
}

type Profile = { about: string; signature: string; location: string; website: string; avatarUrl: string; avatarColor: string; hideOnline: boolean };

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/forum", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, j: await r.json() };
}

export function SettingsForm({ initial, signaturesAllowed, avatarUrlsAllowed, focusPw }: { initial: Profile; signaturesAllowed: boolean; avatarUrlsAllowed: boolean; focusPw: boolean }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; s: string } | null>(null);
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [nw2, setNw2] = useState("");
  const [pwMsg, setPwMsg] = useState<{ t: "ok" | "err"; s: string } | null>(null);

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <form className="card" onSubmit={async (e) => { e.preventDefault(); const { ok, j } = await post({ action: "profile.update", ...p }); setMsg(ok ? { t: "ok", s: "Профиль сохранён" } : { t: "err", s: j.error }); if (ok) router.refresh(); }}>
        <div className="card-h">⚙ Профиль</div>
        <div className="card-b flex flex-col gap-4">
          {msg && <div className={`alert ${msg.t === "ok" ? "alert-ok" : "alert-err"}`}>{msg.s}</div>}
          <div>
            <label className="label">О себе (BBCode)</label>
            <textarea className="textarea" maxLength={1000} value={p.about} onChange={(e) => setP({ ...p, about: e.target.value })} />
          </div>
          {signaturesAllowed && (
            <div>
              <label className="label">Подпись</label>
              <input className="input" maxLength={300} value={p.signature} onChange={(e) => setP({ ...p, signature: e.target.value })} />
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div><label className="label">Город</label><input className="input" maxLength={60} value={p.location} onChange={(e) => setP({ ...p, location: e.target.value })} /></div>
            <div><label className="label">Сайт</label><input className="input" maxLength={200} placeholder="https://" value={p.website} onChange={(e) => setP({ ...p, website: e.target.value })} /></div>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_140px]">
            {avatarUrlsAllowed && <div><label className="label">Аватар (ссылка на картинку)</label><input className="input" maxLength={500} placeholder="https://…/avatar.png" value={p.avatarUrl} onChange={(e) => setP({ ...p, avatarUrl: e.target.value })} /></div>}
            <div><label className="label">Цвет аватара</label><input type="color" className="input" style={{ padding: 3, height: 40 }} value={p.avatarColor} onChange={(e) => setP({ ...p, avatarColor: e.target.value })} /></div>
          </div>
          <label className="chk"><input type="checkbox" checked={p.hideOnline} onChange={(e) => setP({ ...p, hideOnline: e.target.checked })} /> Скрывать меня из списка «онлайн»</label>
          <div><button className="btn btn-primary">Сохранить</button></div>
        </div>
      </form>

      <form className="card" style={focusPw ? { borderColor: "var(--accent)" } : undefined} onSubmit={async (e) => {
        e.preventDefault();
        if (nw !== nw2) return setPwMsg({ t: "err", s: "Пароли не совпадают" });
        const { ok, j } = await post({ action: "password.change", current: cur, next: nw });
        setPwMsg(ok ? { t: "ok", s: "Пароль изменён. Остальные сессии завершены." } : { t: "err", s: j.error });
        if (ok) { setCur(""); setNw(""); setNw2(""); router.refresh(); }
      }}>
        <div className="card-h">🔑 Смена пароля</div>
        <div className="card-b flex flex-col gap-4">
          {pwMsg && <div className={`alert ${pwMsg.t === "ok" ? "alert-ok" : "alert-err"}`}>{pwMsg.s}</div>}
          <div><label className="label">Текущий пароль</label><input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></div>
          <div className="grid gap-3 md:grid-cols-2">
            <div><label className="label">Новый пароль</label><input className="input" type="password" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)} required /></div>
            <div><label className="label">Повторите</label><input className="input" type="password" autoComplete="new-password" value={nw2} onChange={(e) => setNw2(e.target.value)} required /></div>
          </div>
          <div><button className="btn btn-primary">Сменить пароль</button></div>
        </div>
      </form>
    </div>
  );
}
