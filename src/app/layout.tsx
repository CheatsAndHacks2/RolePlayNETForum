import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import HwBeacon from "@/components/HwBeacon";

export const metadata: Metadata = {
  title: "RolePlay.NET — Универсальный форум для RolePlay (RP) игр",
  description: "RolePlay.NET — форум для ролевых проектов, анкет, сюжетов и общения.",
  icons: { icon: "/logo.svg" },
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <HwBeacon />
        {children}
      </body>
    </html>
  );
}
