import Link from "next/link";
import type { ReactNode } from "react";
import { getViewer } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/constants";
import { Avatar, RoleName } from "@/components/ui";
import LogoutButton from "@/components/LogoutButton";

export default async function Shell({ children, gate }: { children: ReactNode; gate: boolean }) {
  const v = await getViewer();
  const s = await getSettings();

  let content: ReactNode = children;
  if (v.ban) {
    content = (
      <div className="mx-auto max-w-xl py-12">
        <div className="card" style={{ borderColor: "rgba(239,68,68,.6)" }}>
          <div className="card-h text-lg">⛔ Доступ заблокирован</div>
          <div className="card-b flex flex-col gap-3">
            <div className="alert alert-err">
              <div><b>Причина:</b> {v.ban.reason || "не указана"}</div>
              <div><b>Срок:</b> {v.ban.expiresAt ? `до ${fmtDate(v.ban.expiresAt)}` : "бессрочно"}</div>
              <div><b>Выдал:</b> {v.ban.bannedByName || "администрация"}</div>
              <div className="small mt-1 muted">Блокировка #{v.ban.id}{v.ban.hwHash ? " · по устройству" : ""}{v.ban.ip ? " · по IP" : ""}</div>
            </div>
            <p className="muted small">Если вы считаете, что блокировка выдана ошибочно, обратитесь к администрации проекта.</p>
            {v.user && <LogoutButton className="btn" />}
          </div>
        </div>
      </div>
    );
  } else if (gate && s.bool("maintenanceMode") && !v.isStaff) {
    content = (
      <div className="mx-auto max-w-xl py-12">
        <div className="card">
          <div className="card-h text-lg">🛠 Технические работы</div>
          <div className="card-b flex flex-col gap-3">
            <p>{s.str("maintenanceMessage")}</p>
            {!v.user && <Link href="/login" className="btn btn-primary w-fit">Вход для персонала</Link>}
          </div>
        </div>
      </div>
    );
  } else if (gate && !s.bool("guestsCanView") && !v.user) {
    content = (
      <div className="mx-auto max-w-xl py-12">
        <div className="card">
          <div className="card-h text-lg">🔒 Только для участников</div>
          <div className="card-b flex flex-col gap-3">
            <p>Форум доступен только зарегистрированным пользователям.</p>
            <div className="flex gap-2">
              <Link href="/login" className="btn btn-primary">Войти</Link>
              <Link href="/register" className="btn">Регистрация</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="hdr">
        <div className="wrap hdr-in">
          <Link href="/" className="logo" title="На главную">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="RolePlay.NET" />
          </Link>
          <nav className="nav">
            <Link href="/">Форум</Link>
            <Link href="/members">Участники</Link>
            <Link href="/team">Команда</Link>
            <Link href="/rules">Правила</Link>
            {v.isStaff && !v.ban && <Link href="/admin" style={{ color: "#fda4af" }}>⚙ Админ-панель</Link>}
          </nav>
          <div className="flex-1" />
          <form action="/search" className="search">
            <input className="input" name="q" placeholder="🔍 Поиск…" maxLength={80} />
          </form>
          {v.user && !v.ban ? (
            <div className="flex items-center gap-2">
              <Link href="/notifications" className="btn btn-sm" title="Уведомления">
                🔔 {v.unread > 0 && <span className="badge-dot">{v.unread > 99 ? "99+" : v.unread}</span>}
              </Link>
              <Link href={`/user/${v.user.id}`} className="flex items-center gap-2">
                <Avatar user={v.user} size={36} />
                <span className="hidden md:inline">
                  <RoleName text={v.user.username} role={v.role!} />
                </span>
              </Link>
              <Link href="/settings" className="btn btn-sm" title="Настройки">⚙</Link>
              <LogoutButton />
            </div>
          ) : !v.ban ? (
            <div className="flex items-center gap-2">
              <Link href="/login" className="btn btn-sm">Вход</Link>
              <Link href="/register" className="btn btn-sm btn-primary">Регистрация</Link>
            </div>
          ) : null}
        </div>
      </header>
      {s.bool("bannerEnabled") && s.str("bannerText") && (
        <div style={{ background: s.str("bannerColor") + "33", borderBottom: `1px solid ${s.str("bannerColor")}88` }}>
          <div className="wrap py-2 text-center text-sm font-semibold">📣 {s.str("bannerText")}</div>
        </div>
      )}
      {v.user?.forcePwChange && (
        <div className="wrap mt-3">
          <div className="alert alert-info">
            Администратор требует сменить пароль. <Link className="underline" href="/settings?pw=1">Сменить сейчас</Link>
          </div>
        </div>
      )}
      <main className="wrap py-5">{content}</main>
      <footer className="mt-8 border-t border-[var(--line)] py-6">
        <div className="wrap flex flex-wrap items-center justify-between gap-3 text-sm muted">
          <span>{s.str("footerText")}</span>
          <span className="flex gap-4">
            <Link href="/rules" className="hover:text-white">Правила</Link>
            <Link href="/team" className="hover:text-white">Команда</Link>
            <Link href="/members" className="hover:text-white">Участники</Link>
          </span>
        </div>
      </footer>
    </>
  );
}
