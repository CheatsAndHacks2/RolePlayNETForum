"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { computeHw } from "@/lib/hw";

export default function AuthForm({ mode, registrationOpen = true }: { mode: "login" | "register"; registrationOpen?: boolean }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [answer, setAnswer] = useState("");
  const [token, setToken] = useState("");
  const [image, setImage] = useState("");
  const [needCaptcha, setNeedCaptcha] = useState(mode === "register");
  const [honey, setHoney] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(Date.now());

  const loadCaptcha = useCallback(async () => {
    try {
      const r = await fetch("/api/captcha", { cache: "no-store" });
      const j = await r.json();
      setToken(j.token);
      setImage(j.image);
      setAnswer("");
    } catch {
      setErr("Не удалось загрузить капчу");
    }
  }, []);

  useEffect(() => {
    if (needCaptcha) loadCaptcha();
  }, [needCaptcha, loadCaptcha]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setOk("");
    if (mode === "register" && password !== password2) return setErr("Пароли не совпадают");
    setBusy(true);
    try {
      const hw = await computeHw();
      const r = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username, password, password2, hw, website: honey,
          elapsed: Date.now() - started.current,
          captchaToken: token, captchaAnswer: answer,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error || "Ошибка");
        if (j.needCaptcha || j.captcha) setNeedCaptcha(true);
        if (needCaptcha || j.needCaptcha || j.captcha) loadCaptcha();
        setBusy(false);
        return;
      }
      if (j.pending) {
        setOk("Аккаунт создан и ожидает одобрения администрацией.");
        setBusy(false);
        return;
      }
      window.location.href = j.forcePw ? "/settings?pw=1" : "/";
    } catch {
      setErr("Сеть недоступна");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="card">
        <div className="card-h text-lg">{mode === "login" ? "🔐 Вход на форум" : "📝 Регистрация"}</div>
        <form className="card-b flex flex-col gap-4" onSubmit={submit} autoComplete="off">
          {err && <div className="alert alert-err">{err}</div>}
          {ok && <div className="alert alert-ok">{ok}</div>}
          {mode === "register" && !registrationOpen && <div className="alert alert-info">Регистрация временно закрыта администрацией.</div>}
          <div>
            <label className="label">Ник</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={32} autoComplete="username" placeholder="Например: Alex_Stalker" />
          </div>
          <div>
            <label className="label">Пароль</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </div>
          {mode === "register" && (
            <div>
              <label className="label">Повторите пароль</label>
              <input className="input" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} required maxLength={128} autoComplete="new-password" />
            </div>
          )}
          {/* honeypot — invisible to humans */}
          <div style={{ position: "absolute", left: "-9999px", height: 0, overflow: "hidden" }} aria-hidden="true">
            <input tabIndex={-1} autoComplete="off" value={honey} onChange={(e) => setHoney(e.target.value)} name="website" />
          </div>
          {needCaptcha && (
            <div>
              <label className="label">Защита от ботов: введите символы с картинки</label>
              <div className="flex items-center gap-3">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="captcha" width={190} height={64} className="rounded-lg border border-[var(--line)]" />
                ) : (
                  <div className="h-16 w-[190px] rounded-lg bg-[#0c0d24]" />
                )}
                <button type="button" className="btn btn-sm" onClick={loadCaptcha} title="Обновить">🔄</button>
              </div>
              <input className="input mt-2 tracking-widest uppercase" value={answer} onChange={(e) => setAnswer(e.target.value)} required maxLength={8} placeholder="XXXXX" autoComplete="off" />
            </div>
          )}
          <button className="btn btn-primary py-2.5" disabled={busy || (mode === "register" && !registrationOpen)}>
            {busy ? "Подождите…" : mode === "login" ? "Войти" : "Создать аккаунт"}
          </button>
          <div className="small muted text-center">
            {mode === "login" ? (
              <>Нет аккаунта? <Link href="/register" className="text-[#a5b4fc] underline">Зарегистрироваться</Link></>
            ) : (
              <>Уже есть аккаунт? <Link href="/login" className="text-[#a5b4fc] underline">Войти</Link></>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
