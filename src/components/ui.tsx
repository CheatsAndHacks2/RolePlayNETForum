import Link from "next/link";
import type { CSSProperties } from "react";

type RoleLike = { name: string; color: string; icon: string; style: string };

export function RoleName({ text, role, className = "" }: { text: string; role: RoleLike; className?: string }) {
  const style = { color: role.color, ["--c" as string]: role.color } as CSSProperties;
  return (
    <span className={`nick nick-${role.style} ${className}`} style={style}>
      {text}
    </span>
  );
}

export function RoleBadge({ role }: { role: RoleLike }) {
  return (
    <span
      className="pill"
      style={{ color: role.color, borderColor: role.color + "88", background: role.color + "1f" }}
    >
      {role.icon} {role.name}
    </span>
  );
}

export function Avatar({
  user,
  size = 48,
}: {
  user: { username: string; avatarUrl: string; avatarColor: string };
  size?: number;
}) {
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, background: user.avatarUrl ? "#000" : user.avatarColor, fontSize: size * 0.42 }}
    >
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        user.username.slice(0, 1).toUpperCase()
      )}
    </div>
  );
}

export function UserLink({ user, role }: { user: { id: number; username: string }; role: RoleLike }) {
  return (
    <Link href={`/user/${user.id}`} className="hover:underline">
      <RoleName text={user.username} role={role} />
    </Link>
  );
}

export function Pagination({ page, pages, base }: { page: number; pages: number; base: string }) {
  if (pages <= 1) return null;
  const items: (number | "…")[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 2) items.push(i);
    else if (items[items.length - 1] !== "…") items.push("…");
  }
  const sep = base.includes("?") ? "&" : "?";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((it, i) =>
        it === "…" ? (
          <span key={`e${i}`} className="muted px-1">…</span>
        ) : (
          <Link key={it} href={`${base}${sep}page=${it}`} className={`page-btn ${it === page ? "on" : ""}`}>
            {it}
          </Link>
        ),
      )}
    </div>
  );
}

export function PrefixTag({ prefix }: { prefix?: { label: string; color: string } | null }) {
  if (!prefix) return null;
  return (
    <span className="tag" style={{ background: prefix.color }}>
      {prefix.label}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="muted p-8 text-center">{children}</div>;
}
