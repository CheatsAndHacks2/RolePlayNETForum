import type { ReactNode } from "react";
import Shell from "@/components/Shell";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <Shell gate={false}>{children}</Shell>;
}
