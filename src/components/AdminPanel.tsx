"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ALL_PERMS, PERMS, fmtDate, hasPerm } from "@/lib/constants";

type FieldT = { name: string; label: string; type: string; required?: boolean; options?: { value: string; label: string }[]; def?: string; placeholder?: string; help?: string };
type ActionT = { id: string; group: string; title: string; desc: string; danger: boolean; perm: string; fields: FieldT[] };
type RoleT = { id: number; slug: string; name: string; level: number; color: string; icon: string; permissions: string[]; style: string };
type Meta = {
  me: { id: number; name: string; level: number; perms: string[]; isFounder: boolean };
  actions: ActionT[]; roles: RoleT[];
  categories: { id: number; title: string }[]; forums: { id: number; title: string; categoryId: number }[]; prefixes: { id: number; label: string }[];
};
type Data = { type: "table"; columns: string[]; rows: (string | number)[][] } | { type: "kv"; items: [string, string][] };
type Prefill = Record<string, string | string[]>;
type Open = (id: string, prefill?: Prefill) => void;

const DURATIONS = [
  ["60", "1 час"], ["360", "6 часов"], ["720", "12 часов"], ["1440", "1 день"], ["4320", "3 дня"], ["10080", "7 дней"],
  ["20160", "14 дней"], ["43200", "30 дней"], ["129600", "90 дней"], ["262800", "6 месяцев"], ["525600", "1 год"], ["0", "Навсегда"],
].map(([value, label]) => ({ value, label }));

async function api<T = Record<string, unknown>>(url: string, body?: unknown): Promise<{ ok: boolean; j: T & { error?: string } }> {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({ error: "Ошибка ответа сервера" }));
  return { ok: r.ok, j };
}

function useFetch<T>(url: string | null, key: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setLoading(true);
    api<T>(url).then(({ ok, j }) => {
      if (!alive) return;
      if (ok) { setData(j as T); setErr(""); } else setErr((j as { error?: string }).error || "Ошибка");
      setLoading(false);
    });
    return () => { alive = false; };
  }, [url, key]);
  return { data, loading, err };
}

function DataView({ data }: { data: Data }) {
  if (data.type === "kv") {
    return (
      <div className="tbl-wrap rounded-lg border border-[var(--line)]">
        <table className="tbl"><tbody>{data.items.map(([k, v]) => (<tr key={k}><td className="muted" style={{ width: "40%" }}>{k}</td><td className="font-semibold break-all">{v}</td></tr>))}</tbody></table>
      </div>
    );
  }
  return (
    <div className="tbl-wrap max-h-80 overflow-y-auto rounded-lg border border-[var(--line)]">
      <table className="tbl">
        <thead><tr>{data.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {data.rows.map((r, i) => (<tr key={i}>{r.map((c, j) => <td key={j}>{String(c)}</td>)}</tr>))}
          {data.rows.length === 0 && <tr><td colSpan={data.columns.length} className="muted text-center">Пусто</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ActionModal({ meta, action, prefill, onClose, onDone }: { meta: Meta; action: ActionT; prefill: Prefill; onClose: () => void; onDone: () => void }) {
  const [vals, setVals] = useState<Prefill>(() => {
    const v: Prefill = {};
    for (const f of action.fields) v[f.name] = prefill[f.name] ?? (f.type === "perms" ? [] : f.def ?? "");
    return v;
  });
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; msg: string; data?: Data } | null>(null);
  const set = (k: string, val: string | string[]) => setVals((p) => ({ ...p, [k]: val }));

  const levelOpts = useMemo(() => {
    const m = new Map<string, string>([["0", "0 — Все (включая гостей)"], ["1", "1 — Зарегистрированные"]]);
    for (const r of [...meta.roles].sort((a, b) => a.level - b.level)) m.set(String(r.level), `${r.level} — ${r.icon} ${r.name} и выше`);
    return Array.from(m.entries()).map(([value, label]) => ({ value, label }));
  }, [meta.roles]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (action.danger && !confirm(`Опасное действие: «${action.title}». Продолжить?`)) return;
    setBusy(true);
    const { ok, j } = await api<{ message: string; data?: Data }>("/api/admin/run", { action: action.id, params: vals });
    setBusy(false);
    setRes({ ok, msg: ok ? j.message : j.error || "Ошибка", data: ok ? j.data : undefined });
    if (ok) onDone();
  }

  function renderField(f: FieldT) {
    const v = vals[f.name];
    const sv = typeof v === "string" ? v : "";
    switch (f.type) {
      case "textarea":
        return <textarea className="textarea" required={f.required} value={sv} onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} />;
      case "bool":
        return (
          <select className="select" value={sv === "1" ? "1" : "0"} onChange={(e) => set(f.name, e.target.value)}>
            <option value="1">Да</option><option value="0">Нет</option>
          </select>
        );
      case "color":
        return <input type="color" className="input" style={{ padding: 3, height: 40 }} value={/^#[0-9a-fA-F]{6}$/.test(sv) ? sv : "#7c3aed"} onChange={(e) => set(f.name, e.target.value)} />;
      case "perms":
        return (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--line)] p-3">
            {Array.from(new Set(ALL_PERMS.map((p) => PERMS[p].group))).map((g) => (
              <div key={g} className="mb-2">
                <div className="small muted mb-1 font-bold">{g}</div>
                <div className="perm-grid">
                  {ALL_PERMS.filter((p) => PERMS[p].group === g).map((p) => {
                    const arr = Array.isArray(v) ? v : [];
                    return (
                      <label key={p} className="chk"><input type="checkbox" checked={arr.includes(p)} onChange={(e) => set(f.name, e.target.checked ? [...arr, p] : arr.filter((x) => x !== p))} /> {PERMS[p].label}</label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      case "select":
      case "duration":
      case "level":
      case "role":
      case "category":
      case "forum":
      case "prefix": {
        let opts: { value: string; label: string }[] = [];
        if (f.type === "select") opts = f.options ?? [];
        if (f.type === "duration") opts = f.options ?? DURATIONS;
        if (f.type === "level") { opts = levelOpts.slice(); if (sv && !opts.some((o) => o.value === sv)) opts.push({ value: sv, label: sv }); }
        if (f.type === "role") opts = meta.roles.map((r) => ({ value: String(r.id), label: `${r.icon} ${r.name} (ур. ${r.level})` }));
        if (f.type === "category") opts = meta.categories.map((c) => ({ value: String(c.id), label: c.title }));
        if (f.type === "forum") opts = meta.forums.map((x) => ({ value: String(x.id), label: `${meta.categories.find((c) => c.id === x.categoryId)?.title ?? "?"} › ${x.title}` }));
        if (f.type === "prefix") opts = [{ value: "", label: "— нет —" }, ...meta.prefixes.map((p) => ({ value: String(p.id), label: p.label }))];
        return (
          <select
            className="select" required={f.required && f.type !== "prefix"} value={sv}
            onChange={(e) => {
              set(f.name, e.target.value);
              if (action.id === "role.setPerms" && f.name === "role") {
                const r = meta.roles.find((x) => String(x.id) === e.target.value);
                if (r) set("perms", r.permissions.includes("*") ? [...ALL_PERMS] : r.permissions);
              }
            }}
          >
            {f.type !== "level" && f.type !== "duration" && f.type !== "prefix" && <option value="">— выберите —</option>}
            {opts.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
          </select>
        );
      }
      default:
        return <input className="input" type={f.type === "number" ? "number" : f.type === "password" ? "text" : "text"} required={f.required} value={sv} onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} autoComplete="off" />;
    }
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card modal" style={action.danger ? { borderColor: "rgba(239,68,68,.6)" } : undefined}>
        <div className="card-h">
          <span>{action.danger ? "⚠️" : "⚡"} {action.title}</span>
          <span className="flex-1" />
          <button className="btn btn-sm btn-ghost" onClick={onClose}>✕</button>
        </div>
        <form className="card-b flex flex-col gap-3" onSubmit={submit}>
          <p className="small muted">{action.desc}</p>
          {action.fields.map((f) => (
            <div key={f.name}>
              {f.type !== "bool" || true ? <label className="label">{f.label}{f.required ? " *" : ""}</label> : null}
              {renderField(f)}
              {f.help && <div className="help">{f.help}</div>}
            </div>
          ))}
          {res && (
            <div className="flex flex-col gap-2">
              <div className={`alert ${res.ok ? "alert-ok" : "alert-err"}`}>{res.msg}</div>
              {res.data && <DataView data={res.data} />}
            </div>
          )}
          <div className="flex gap-2">
            <button className={`btn ${action.danger ? "btn-danger" : "btn-primary"}`} disabled={busy}>{busy ? "Выполняется…" : "Выполнить"}</button>
            <button type="button" className="btn" onClick={onClose}>Закрыть</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RoleChip({ r }: { r: { name: string; color: string; icon: string } }) {
  return <span className="pill" style={{ color: r.color, borderColor: r.color + "88", background: r.color + "1f" }}>{r.icon} {r.name}</span>;
}

function Btn({ id, meta, open, prefill, label, cls = "btn btn-sm" }: { id: string; meta: Meta; open: Open; prefill?: Prefill; label: string; cls?: string }) {
  if (!meta.actions.some((a) => a.id === id)) return null;
  return <button className={cls} onClick={() => open(id, prefill)}>{label}</button>;
}

/* ---------------- tabs ---------------- */

function Dashboard({ meta, open, rk }: { meta: Meta; open: Open; rk: number }) {
  const { data, loading, err } = useFetch<{ stats: Record<string, number>; dist: { name: string; color: string; icon: string; c: number }[]; recentUsers: { id: number; name: string; at: string; ip: string }[]; recent: { id: number; actorName: string; action: string; target: string; createdAt: string }[] }>("/api/admin/data?type=dashboard", rk);
  const labels: [string, string, string][] = [
    ["users", "Пользователей", "👥"], ["newUsers", "Новых за 24ч", "🆕"], ["online", "Онлайн (5 мин)", "🟢"], ["threads", "Тем", "🧵"], ["posts", "Сообщений", "💬"], ["posts24", "Сообщений за 24ч", "⚡"],
    ["openReports", "Открытых жалоб", "🚩"], ["activeBans", "Активных банов", "⛔"], ["pending", "Ожидают одобрения", "⏳"], ["muted", "В муте", "🔇"], ["hidden", "Скрытых тем", "🗑"], ["forums", "Форумов", "📁"],
  ];
  return (
    <div className="flex flex-col gap-4">
      {err && <div className="alert alert-err">{err}</div>}
      {loading && !data && <div className="muted">Загрузка…</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {labels.map(([k, l, i]) => (<div key={k} className="stat"><span className="small muted">{i} {l}</span><b>{data.stats[k]}</b></div>))}
          </div>
          <div className="card">
            <div className="card-h">⚡ Быстрые действия</div>
            <div className="card-b flex flex-wrap gap-2">
              <Btn id="sys.toggleMaintenance" meta={meta} open={open} label="🛠 Техработы" />
              <Btn id="sys.toggleRegistration" meta={meta} open={open} label="📝 Регистрация" />
              <Btn id="sys.toggleReadOnly" meta={meta} open={open} label="👁 Только чтение" />
              <Btn id="sys.setBanner" meta={meta} open={open} label="📣 Объявление" />
              <Btn id="sys.broadcast" meta={meta} open={open} label="🔔 Рассылка" />
              <Btn id="ban.user" meta={meta} open={open} label="⛔ Забанить" cls="btn btn-sm btn-danger" />
              <Btn id="ban.ip" meta={meta} open={open} label="🌐 Бан IP" cls="btn btn-sm btn-danger" />
              <Btn id="user.create" meta={meta} open={open} label="➕ Создать аккаунт" />
              <Btn id="user.approveAll" meta={meta} open={open} label="✔ Одобрить очередь" />
              <Btn id="sys.recountAll" meta={meta} open={open} label="🔄 Пересчёт" />
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card">
              <div className="card-h">Распределение по ролям</div>
              <div className="card-b flex flex-wrap gap-2">{data.dist.map((d) => (<span key={d.name} className="pill" style={{ color: d.color, borderColor: d.color + "88" }}>{d.icon} {d.name}: {d.c}</span>))}</div>
            </div>
            <div className="card">
              <div className="card-h">Новые пользователи</div>
              <div className="card-b small flex flex-col gap-1">{data.recentUsers.map((u) => (<div key={u.id} className="flex justify-between"><Link href={`/user/${u.id}`} className="hover:underline">{u.name}</Link><span className="muted">{u.ip} · {fmtDate(u.at)}</span></div>))}</div>
            </div>
          </div>
          {data.recent.length > 0 && (
            <div className="card">
              <div className="card-h">Последние действия персонала</div>
              <div className="tbl-wrap"><table className="tbl"><tbody>{data.recent.map((r) => (<tr key={r.id}><td className="muted">{fmtDate(r.createdAt)}</td><td>{r.actorName}</td><td><code>{r.action}</code></td><td>{r.target}</td></tr>))}</tbody></table></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActionsTab({ meta, open }: { meta: Meta; open: Open }) {
  const [q, setQ] = useState("");
  const list = meta.actions.filter((a) => !q || (a.title + a.desc + a.id + a.group).toLowerCase().includes(q.toLowerCase()));
  const groups = Array.from(new Set(list.map((a) => a.group)));
  return (
    <div className="flex flex-col gap-4">
      <div className="card card-b flex flex-wrap items-center gap-3">
        <input className="input" style={{ maxWidth: 360 }} placeholder="🔍 Поиск функции…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">Доступно функций: <b className="text-white">{meta.actions.length}</b> · показано: {list.length}</span>
      </div>
      {groups.map((g) => (
        <div key={g} className="card">
          <div className="card-h">{g} <span className="pill" style={{ color: "#a5b4fc", borderColor: "#6366f166" }}>{list.filter((a) => a.group === g).length}</span></div>
          <div className="card-b grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.filter((a) => a.group === g).map((a) => (
              <button key={a.id} className={`act-card ${a.danger ? "danger" : ""}`} onClick={() => open(a.id)}>
                <div className="font-bold">{a.danger ? "⚠️ " : ""}{a.title}</div>
                <div className="small muted mt-0.5">{a.desc}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function UsersTab({ meta, open, rk }: { meta: Meta; open: Open; rk: number }) {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [qq, setQq] = useState("");
  const url = `/api/admin/data?type=users&q=${encodeURIComponent(qq)}&role=${role}&status=${status}&page=${page}`;
  const { data, loading, err } = useFetch<{ total: number; per: number; rows: { id: number; name: string; role: { name: string; color: string; icon: string }; status: string; posts: number; createdAt: string; lastSeenAt: string | null; ip: string; hwLocked: boolean; hwBound: boolean; muted: boolean; banned: boolean; isProtected: boolean; warn: number }[] }>(url, rk);
  const [menu, setMenu] = useState<string | null>(null);
  const userActs = meta.actions.filter((a) => a.fields.some((f) => f.name === "user" && f.type === "user"));
  return (
    <div className="flex flex-col gap-4">
      <form className="card card-b flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setQq(q); setPage(1); }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Ник, ID или IP…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ maxWidth: 220 }} value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
          <option value="">Все роли</option>{meta.roles.map((r) => (<option key={r.id} value={r.id}>{r.icon} {r.name}</option>))}
        </select>
        <select className="select" style={{ maxWidth: 180 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Любой статус</option><option value="active">Активные</option><option value="pending">Ожидают</option><option value="deleted">Удалённые</option>
        </select>
        <button className="btn btn-primary">Найти</button>
        <span className="flex-1" />
        <Btn id="user.create" meta={meta} open={open} label="➕ Создать" />
        <a className="btn btn-sm" href="/api/admin/export?type=users">⬇ CSV</a>
      </form>
      {err && <div className="alert alert-err">{err}</div>}
      <div className="card tbl-wrap">
        <table className="tbl">
          <thead><tr><th>ID</th><th>Ник</th><th>Роль</th><th>Статус</th><th>Сообщ.</th><th>IP</th><th>Метки</th><th>Был</th><th>Действия</th></tr></thead>
          <tbody>
            {data?.rows.map((u) => (
              <tr key={u.id}>
                <td className="muted">{u.id}</td>
                <td><Link href={`/user/${u.id}`} className="font-bold hover:underline">{u.name}</Link></td>
                <td><RoleChip r={u.role} /></td>
                <td>{u.status}</td>
                <td>{u.posts}</td>
                <td className="small">{u.ip || "—"}</td>
                <td className="small">{u.banned && "⛔ "}{u.muted && "🔇 "}{u.isProtected && "🛡 "}{u.hwLocked && (u.hwBound ? "🔗 " : "🔓 ")}{u.warn > 0 && `⚠${u.warn}`}</td>
                <td className="small muted">{u.lastSeenAt ? fmtDate(u.lastSeenAt) : "—"}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    <Btn id="user.info" meta={meta} open={open} prefill={{ user: `#${u.id}` }} label="📋" />
                    <Btn id="user.setRole" meta={meta} open={open} prefill={{ user: `#${u.id}` }} label="🎭" />
                    <Btn id="user.mute" meta={meta} open={open} prefill={{ user: `#${u.id}` }} label="🔇" />
                    <Btn id="ban.user" meta={meta} open={open} prefill={{ user: `#${u.id}` }} label="⛔" cls="btn btn-sm btn-danger" />
                    <button className="btn btn-sm" onClick={() => setMenu(`#${u.id}`)}>⋯</button>
                  </div>
                </td>
              </tr>
            ))}
            {loading && <tr><td colSpan={9} className="muted text-center">Загрузка…</td></tr>}
          </tbody>
        </table>
      </div>
      {data && (
        <div className="flex items-center gap-2">
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
          <span className="small muted">Стр. {page} из {Math.max(1, Math.ceil(data.total / data.per))} · всего {data.total}</span>
          <button className="btn btn-sm" disabled={page >= Math.ceil(data.total / data.per)} onClick={() => setPage(page + 1)}>→</button>
        </div>
      )}
      {menu && (
        <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) setMenu(null); }}>
          <div className="card modal">
            <div className="card-h">Действия над {menu} <span className="flex-1" /><button className="btn btn-sm btn-ghost" onClick={() => setMenu(null)}>✕</button></div>
            <div className="card-b grid gap-2 md:grid-cols-2">
              {userActs.map((a) => (
                <button key={a.id} className={`act-card ${a.danger ? "danger" : ""}`} onClick={() => { setMenu(null); open(a.id, { user: menu }); }}>
                  <div className="small font-bold">{a.danger ? "⚠️ " : ""}{a.title}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BansTab({ meta, open, rk }: { meta: Meta; open: Open; rk: number }) {
  const [all, setAll] = useState(false);
  const { data, loading, err } = useFetch<{ rows: { id: number; target: string; ip: string | null; hw: string | null; reason: string; by: string; at: string; exp: string | null; active: boolean; shadow: boolean }[] }>(`/api/admin/data?type=bans${all ? "&all=1" : ""}`, rk);
  return (
    <div className="flex flex-col gap-4">
      <div className="card card-b flex flex-wrap items-center gap-2">
        <Btn id="ban.user" meta={meta} open={open} label="⛔ Бан пользователя" cls="btn btn-danger" />
        <Btn id="ban.ip" meta={meta} open={open} label="🌐 Бан IP" cls="btn btn-danger" />
        <Btn id="ban.hw" meta={meta} open={open} label="💻 Бан устройства" cls="btn btn-danger" />
        <Btn id="ban.sameIp" meta={meta} open={open} label="👥 Бан мультиаккаунтов" cls="btn btn-danger" />
        <Btn id="ban.check" meta={meta} open={open} label="🔎 Проверить" cls="btn" />
        <Btn id="ban.purgeExpired" meta={meta} open={open} label="🧹 Очистить старые" cls="btn" />
        <span className="flex-1" />
        <label className="chk"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Показать и снятые</label>
        <a className="btn btn-sm" href="/api/admin/export?type=bans">⬇ CSV</a>
      </div>
      {err && <div className="alert alert-err">{err}</div>}
      <div className="card tbl-wrap">
        <table className="tbl">
          <thead><tr><th>ID</th><th>Цель</th><th>IP</th><th>Железо</th><th>Причина</th><th>Выдан</th><th>Истекает</th><th>Кем</th><th></th></tr></thead>
          <tbody>
            {data?.rows.map((b) => (
              <tr key={b.id} style={b.active ? undefined : { opacity: 0.5 }}>
                <td>{b.id}</td><td>{b.target || "—"}{b.shadow && " 👻"}</td><td className="small">{b.ip ?? "—"}</td><td className="small">{b.hw ? b.hw + "…" : "—"}</td>
                <td>{b.reason}</td><td className="small muted">{fmtDate(b.at)}</td><td className="small">{b.exp ? fmtDate(b.exp) : "навсегда"}</td><td>{b.by}</td>
                <td><div className="flex gap-1"><Btn id="ban.lift" meta={meta} open={open} prefill={{ banId: String(b.id) }} label="Снять" cls="btn btn-sm btn-ok" /><Btn id="ban.edit" meta={meta} open={open} prefill={{ banId: String(b.id) }} label="✏️" /><Btn id="ban.extend" meta={meta} open={open} prefill={{ banId: String(b.id) }} label="⏱" /></div></td>
              </tr>
            ))}
            {loading && <tr><td colSpan={9} className="muted text-center">Загрузка…</td></tr>}
            {data && data.rows.length === 0 && <tr><td colSpan={9} className="muted text-center">Банов нет</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportsTab({ meta, open, rk }: { meta: Meta; open: Open; rk: number }) {
  const [status, setStatus] = useState("open");
  const { data, loading, err } = useFetch<{ rows: { id: number; reason: string; status: string; created_at: string; thread_id: number; post_id: number; reporter: string; author: string; content: string; title: string; note: string }[] }>(`/api/admin/data?type=reports&status=${status}`, rk);
  return (
    <div className="flex flex-col gap-4">
      <div className="card card-b flex gap-2">
        {["open", "resolved", "rejected"].map((s) => (<button key={s} className={`btn btn-sm ${status === s ? "btn-primary" : ""}`} onClick={() => setStatus(s)}>{s === "open" ? "Открытые" : s === "resolved" ? "Принятые" : "Отклонённые"}</button>))}
        <span className="flex-1" /><Btn id="report.clearClosed" meta={meta} open={open} label="🧹 Очистить закрытые" />
      </div>
      {err && <div className="alert alert-err">{err}</div>}
      {loading && <div className="muted">Загрузка…</div>}
      {data?.rows.length === 0 && <div className="card card-b muted">Жалоб нет 🎉</div>}
      {data?.rows.map((r) => (
        <div key={r.id} className="card card-b flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2"><b>Жалоба #{r.id}</b><span className="small muted">от {r.reporter} · {fmtDate(r.created_at)}</span><span className="flex-1" /><Link className="btn btn-sm" href={`/thread/${r.thread_id}#post-${r.post_id}`}>Перейти к сообщению</Link></div>
          <div className="small">Тема: <b>{r.title}</b> · Автор сообщения: <b>{r.author}</b></div>
          <div className="alert alert-info small">«{r.content}»</div>
          <div><b>Причина:</b> {r.reason}</div>
          {r.note && <div className="small muted">Комментарий: {r.note}</div>}
          <div className="flex flex-wrap gap-2">
            <Btn id="report.resolve" meta={meta} open={open} prefill={{ report: String(r.id) }} label="✔ Принять" cls="btn btn-sm btn-ok" />
            <Btn id="report.reject" meta={meta} open={open} prefill={{ report: String(r.id) }} label="✖ Отклонить" />
            <Btn id="post.delete" meta={meta} open={open} prefill={{ post: String(r.post_id) }} label="🗑 Удалить сообщение" cls="btn btn-sm btn-danger" />
            <Btn id="user.warn" meta={meta} open={open} prefill={{ user: r.author, reason: r.reason }} label="⚠ Варн автору" />
            <Btn id="user.mute" meta={meta} open={open} prefill={{ user: r.author, reason: r.reason }} label="🔇 Мут автору" />
            <Btn id="ban.user" meta={meta} open={open} prefill={{ user: r.author, reason: r.reason }} label="⛔ Бан автору" cls="btn btn-sm btn-danger" />
            {r.status !== "open" && <Btn id="report.reopen" meta={meta} open={open} prefill={{ report: String(r.id) }} label="↩ Переоткрыть" />}
          </div>
        </div>
      ))}
    </div>
  );
}

function RolesTab({ meta, open, rk }: { meta: Meta; open: Open; rk: number }) {
  const { data } = useFetch<{ rows: (RoleT & { members: number; description: string; showOnTeam: boolean })[] }>("/api/admin/data?type=roles", rk);
  const groups = Array.from(new Set(ALL_PERMS.map((p) => PERMS[p].group)));
  const roles = data?.rows ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="card card-b flex flex-wrap gap-2">
        <Btn id="role.create" meta={meta} open={open} label="➕ Создать роль" cls="btn btn-primary" />
        <Btn id="role.clone" meta={meta} open={open} label="📋 Клонировать" cls="btn" />
        <Btn id="role.copyPerms" meta={meta} open={open} label="🔁 Копировать права" cls="btn" />
        <Btn id="role.list" meta={meta} open={open} label="📃 Список" cls="btn" />
        <Btn id="user.massRole" meta={meta} open={open} label="👥 Массовая смена роли" cls="btn btn-danger" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {roles.map((r) => (
          <div key={r.id} className="card card-b flex flex-col gap-2" style={{ borderColor: r.color + "66" }}>
            <div className="flex items-center gap-2"><span className="text-2xl">{r.icon}</span><div><div className={`nick nick-${r.style} text-lg`} style={{ color: r.color, ["--c" as string]: r.color } as React.CSSProperties}>{r.name}</div><div className="small muted">ур. {r.level} · {r.slug} · {r.members} уч.</div></div></div>
            <div className="small muted">{r.description}</div>
            <div className="small">Прав: <b>{r.permissions.includes("*") ? "все" : r.permissions.length}</b>{r.showOnTeam && " · в команде"}</div>
            <div className="flex flex-wrap gap-1">
              <Btn id="role.setPerms" meta={meta} open={open} prefill={{ role: String(r.id), perms: r.permissions.includes("*") ? [...ALL_PERMS] : r.permissions }} label="🔑 Права" />
              <Btn id="role.setStyle" meta={meta} open={open} prefill={{ role: String(r.id), color: r.color, style: r.style }} label="🎨 Вид" />
              <Btn id="role.update" meta={meta} open={open} prefill={{ role: String(r.id) }} label="✏️" />
              <Btn id="role.setLevel" meta={meta} open={open} prefill={{ role: String(r.id), level: String(r.level) }} label="📶" />
              <Btn id="user.listByRole" meta={meta} open={open} prefill={{ role: String(r.id) }} label="👥" />
              <Btn id="role.delete" meta={meta} open={open} prefill={{ role: String(r.id) }} label="🗑" cls="btn btn-sm btn-danger" />
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-h">Матрица прав</div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Право</th>{roles.map((r) => (<th key={r.id} title={r.name} style={{ textAlign: "center" }}>{r.icon}</th>))}</tr></thead>
            <tbody>
              {groups.map((g) => (
                <>
                  <tr key={g}><td colSpan={roles.length + 1} className="small font-bold" style={{ background: "rgba(139,92,246,.1)" }}>{g}</td></tr>
                  {ALL_PERMS.filter((p) => PERMS[p].group === g).map((p) => (
                    <tr key={p}><td className="small">{PERMS[p].label}</td>{roles.map((r) => (<td key={r.id} style={{ textAlign: "center", color: r.color }}>{hasPerm(r.permissions, p) ? "●" : <span className="muted">·</span>}</td>))}</tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StructureTab({ meta, open, rk }: { meta: Meta; open: Open; rk: number }) {
  const { data } = useFetch<{ categories: { id: number; title: string; icon: string; color: string; sortOrder: number; minViewLevel: number; isHidden: boolean; isCollapsed: boolean }[]; forums: { id: number; categoryId: number; title: string; icon: string; sortOrder: number; isLocked: boolean; isHidden: boolean; requiresApproval: boolean; minViewLevel: number; minPostLevel: number; minThreadLevel: number; threadsCount: number; postsCount: number }[] }>("/api/admin/data?type=structure", rk);
  return (
    <div className="flex flex-col gap-4">
      <div className="card card-b flex flex-wrap gap-2">
        <Btn id="category.create" meta={meta} open={open} label="➕ Создать раздел" cls="btn btn-primary" />
        <Btn id="forum.create" meta={meta} open={open} label="➕ Создать форум" cls="btn btn-primary" />
        <Btn id="forum.merge" meta={meta} open={open} label="🔀 Объединить форумы" cls="btn" />
        <Btn id="prefix.create" meta={meta} open={open} label="🏷 Префикс" cls="btn" />
        <Btn id="prefix.list" meta={meta} open={open} label="Список префиксов" cls="btn" />
        <Btn id="content.hiddenList" meta={meta} open={open} label="🗑 Корзина" cls="btn" />
      </div>
      {data?.categories.map((c) => (
        <div key={c.id} className="card overflow-hidden">
          <div className="cat-bar" style={{ background: c.color }} />
          <div className="card-h flex-wrap">
            <span>{c.icon} {c.title}</span>
            <span className="small muted font-normal">#{c.id} · порядок {c.sortOrder} · ур. просмотра {c.minViewLevel}{c.isHidden && " · скрыт"}{c.isCollapsed && " · свёрнут"}</span>
            <span className="flex-1" />
            <div className="flex flex-wrap gap-1">
              <Btn id="category.update" meta={meta} open={open} prefill={{ category: String(c.id) }} label="✏️" />
              <Btn id="category.setVisibility" meta={meta} open={open} prefill={{ category: String(c.id), minView: String(c.minViewLevel) }} label="🔒" />
              <Btn id="category.setOrder" meta={meta} open={open} prefill={{ category: String(c.id), order: String(c.sortOrder) }} label="↕" />
              <Btn id="category.hide" meta={meta} open={open} prefill={{ category: String(c.id), value: c.isHidden ? "0" : "1" }} label={c.isHidden ? "👁" : "🙈"} />
              <Btn id="forum.create" meta={meta} open={open} prefill={{ category: String(c.id) }} label="➕ форум" />
              <Btn id="category.delete" meta={meta} open={open} prefill={{ category: String(c.id) }} label="🗑" cls="btn btn-sm btn-danger" />
            </div>
          </div>
          {data.forums.filter((f) => f.categoryId === c.id).map((f) => (
            <div key={f.id} className="row-hover flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2.5 last:border-0">
              <div className="min-w-[220px] flex-1">
                <b>{f.icon} {f.title}</b> <span className="small muted">#{f.id} · {f.threadsCount} тем · {f.postsCount} сообщ.</span>
                <div className="small muted">просмотр {f.minViewLevel} · ответы {f.minPostLevel} · темы {f.minThreadLevel}{f.isLocked && " · 🔒"}{f.isHidden && " · скрыт"}{f.requiresApproval && " · 🛡 премод."}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Btn id="forum.update" meta={meta} open={open} prefill={{ forum: String(f.id) }} label="✏️" />
                <Btn id="forum.setAccess" meta={meta} open={open} prefill={{ forum: String(f.id), minView: String(f.minViewLevel), minPost: String(f.minPostLevel), minThread: String(f.minThreadLevel) }} label="🔑" />
                <Btn id="forum.lock" meta={meta} open={open} prefill={{ forum: String(f.id), value: f.isLocked ? "0" : "1" }} label={f.isLocked ? "🔓" : "🔒"} />
                <Btn id="forum.approval" meta={meta} open={open} prefill={{ forum: String(f.id), value: f.requiresApproval ? "0" : "1" }} label="🛡" />
                <Btn id="forum.hide" meta={meta} open={open} prefill={{ forum: String(f.id), value: f.isHidden ? "0" : "1" }} label={f.isHidden ? "👁" : "🙈"} />
                <Btn id="forum.move" meta={meta} open={open} prefill={{ forum: String(f.id) }} label="📦" />
                <Btn id="forum.setOrder" meta={meta} open={open} prefill={{ forum: String(f.id), order: String(f.sortOrder) }} label="↕" />
                <Btn id="forum.prune" meta={meta} open={open} prefill={{ forum: String(f.id) }} label="🧹" />
                <Btn id="forum.delete" meta={meta} open={open} prefill={{ forum: String(f.id) }} label="🗑" cls="btn btn-sm btn-danger" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function LogTab({ type, rk, meta }: { type: "audit" | "logins"; rk: number; meta: Meta }) {
  const [q, setQ] = useState("");
  const [qq, setQq] = useState("");
  const { data, loading, err } = useFetch<{ rows: Record<string, string | number | boolean | null>[] }>(`/api/admin/data?type=${type}&q=${encodeURIComponent(qq)}`, rk);
  return (
    <div className="flex flex-col gap-4">
      <form className="card card-b flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setQq(q); }}>
        <input className="input" style={{ maxWidth: 300 }} placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-primary">Найти</button>
        {type === "audit" && <a className="btn" href="/api/admin/export?type=audit">⬇ CSV</a>}
        <span className="flex-1" />
        {meta.actions.some((a) => a.id === "sys.hwMismatches") && type === "logins" && <span className="small muted">Отказы по железу: red</span>}
      </form>
      {err && <div className="alert alert-err">{err}</div>}
      <div className="card tbl-wrap">
        {type === "audit" ? (
          <table className="tbl"><thead><tr><th>Дата</th><th>Кто</th><th>Действие</th><th>Цель</th><th>Детали</th><th>IP</th></tr></thead>
            <tbody>{data?.rows.map((r) => (<tr key={String(r.id)}><td className="small muted">{fmtDate(String(r.createdAt))}</td><td>{r.actorName}</td><td><code>{r.action}</code></td><td>{r.target}</td><td className="small">{r.details}</td><td className="small">{r.ip}</td></tr>))}</tbody></table>
        ) : (
          <table className="tbl"><thead><tr><th>Дата</th><th>Ник</th><th>IP</th><th>Устройство</th><th>Итог</th><th>Причина</th></tr></thead>
            <tbody>{data?.rows.map((r) => (<tr key={String(r.id)}><td className="small muted">{fmtDate(String(r.createdAt))}</td><td>{r.username}</td><td className="small">{r.ip}</td><td className="small">{r.hwHash ?? "—"}</td><td>{r.success ? "✅" : "❌"}</td><td className="small" style={r.reason === "hw_mismatch" ? { color: "#f87171", fontWeight: 700 } : undefined}>{r.reason}</td></tr>))}</tbody></table>
        )}
        {loading && <div className="muted p-4">Загрузка…</div>}
      </div>
    </div>
  );
}

/* ---------------- root ---------------- */

export default function AdminPanel() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("dashboard");
  const [modal, setModal] = useState<{ id: string; prefill: Prefill } | null>(null);
  const [rk, setRk] = useState(0);
  const [toast, setToast] = useState("");

  const loadMeta = useCallback(async () => {
    const { ok, j } = await api<Meta>("/api/admin/meta");
    if (ok) setMeta(j as Meta);
    else setErr((j as { error?: string }).error || "Нет доступа");
  }, []);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  const open: Open = useCallback((id, prefill = {}) => {
    setModal({ id, prefill });
  }, []);

  useEffect(() => {
    if (!meta) return;
    const u = new URLSearchParams(window.location.search).get("user");
    if (u && meta.actions.some((a) => a.id === "user.info")) {
      setModal({ id: "user.info", prefill: { user: u } });
      setTab("users");
    }
  }, [meta]);

  if (err) return <div className="alert alert-err">{err}</div>;
  if (!meta) return <div className="muted p-8">Загрузка панели…</div>;

  const p = meta.me.perms;
  const tabs: [string, string, boolean][] = [
    ["dashboard", "📊 Дашборд", hasPerm(p, "dashboard.view")],
    ["actions", `⚡ Все функции (${meta.actions.length})`, true],
    ["users", "👥 Пользователи", hasPerm(p, "users.view")],
    ["bans", "⛔ Баны", hasPerm(p, "bans.view")],
    ["reports", "🚩 Жалобы", hasPerm(p, "reports.handle")],
    ["roles", "🎭 Роли и права", hasPerm(p, "roles.manage")],
    ["structure", "🗂 Структура", hasPerm(p, "structure.manage")],
    ["audit", "📜 Журнал действий", hasPerm(p, "logs.view")],
    ["logins", "🔐 Журнал входов", hasPerm(p, "logs.view")],
  ];
  const visible = tabs.filter((t) => t[2]);
  const cur = visible.some((t) => t[0] === tab) ? tab : visible[0][0];
  const action = modal ? meta.actions.find((a) => a.id === modal.id) : null;

  return (
    <div className="adm">
      <aside className="card adm-nav">
        <div className="px-3 py-2 small muted">Вы вошли как <b className="text-white">{meta.me.name}</b></div>
        {visible.map(([id, label]) => (<button key={id} className={cur === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>))}
        <div className="divider my-2" />
        <button onClick={() => { loadMeta(); setRk((x) => x + 1); }}>🔄 Обновить данные</button>
      </aside>
      <section className="min-w-0">
        {toast && <div className="alert alert-ok mb-3">{toast}</div>}
        {cur === "dashboard" && <Dashboard meta={meta} open={open} rk={rk} />}
        {cur === "actions" && <ActionsTab meta={meta} open={open} />}
        {cur === "users" && <UsersTab meta={meta} open={open} rk={rk} />}
        {cur === "bans" && <BansTab meta={meta} open={open} rk={rk} />}
        {cur === "reports" && <ReportsTab meta={meta} open={open} rk={rk} />}
        {cur === "roles" && <RolesTab meta={meta} open={open} rk={rk} />}
        {cur === "structure" && <StructureTab meta={meta} open={open} rk={rk} />}
        {cur === "audit" && <LogTab type="audit" rk={rk} meta={meta} />}
        {cur === "logins" && <LogTab type="logins" rk={rk} meta={meta} />}
      </section>
      {modal && action && (
        <ActionModal
          key={modal.id + JSON.stringify(modal.prefill)}
          meta={meta} action={action} prefill={modal.prefill}
          onClose={() => setModal(null)}
          onDone={() => { setRk((x) => x + 1); loadMeta(); setToast(""); }}
        />
      )}
    </div>
  );
}
