import Link from "next/link";
import { getViewer } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { SettingsForm } from "@/components/AccountClient";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ pw?: string }> }) {
  const sp = await searchParams;
  const v = await getViewer();
  const s = await getSettings();
  if (!v.user) return <div className="alert alert-info">Войдите, чтобы открыть настройки. <Link href="/login" className="underline">Войти</Link></div>;
  const u = v.user;
  return (
    <SettingsForm
      focusPw={!!sp.pw}
      signaturesAllowed={s.bool("allowSignatures")}
      avatarUrlsAllowed={s.bool("allowAvatarUrls")}
      initial={{ about: u.about, signature: u.signature, location: u.location, website: u.website, avatarUrl: u.avatarUrl, avatarColor: u.avatarColor, hideOnline: u.hideOnline }}
    />
  );
}
