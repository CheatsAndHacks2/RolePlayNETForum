import Link from "next/link";
import { getViewer } from "@/lib/auth";
import AdminPanel from "@/components/AdminPanel";

export default async function AdminPage() {
  const v = await getViewer();
  if (!v.user) return <div className="alert alert-info">Войдите, чтобы открыть панель. <Link href="/login" className="underline">Войти</Link></div>;
  if (!v.isStaff) return <div className="alert alert-err">Доступ запрещён: у вашей роли нет права доступа в админ-панель.</div>;
  return (
    <div className="flex flex-col gap-4">
      <div className="hero">
        <h1 className="text-2xl font-extrabold">⚙ Админ-панель RolePlay.NET</h1>
        <p className="muted">Ваша роль: {v.role?.icon} {v.role?.name} · функции отображаются в зависимости от прав роли.</p>
      </div>
      <AdminPanel />
    </div>
  );
}
