import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getViewer } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export default async function RegisterPage() {
  const v = await getViewer();
  if (v.user) redirect("/");
  const s = await getSettings();
  return <AuthForm mode="register" registrationOpen={s.bool("registrationOpen")} />;
}
