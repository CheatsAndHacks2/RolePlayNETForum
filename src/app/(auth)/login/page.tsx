import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getViewer } from "@/lib/auth";

export default async function LoginPage() {
  const v = await getViewer();
  if (v.user) redirect("/");
  return <AuthForm mode="login" />;
}
