"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { computeHw } from "@/lib/hw";

export default function HwBeacon() {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    computeHw().then((h) => {
      if (!alive) return;
      const m = document.cookie.match(/(?:^|; )rp_hw=([a-f0-9]{64})/);
      if (m && m[1] === h) return;
      document.cookie = `rp_hw=${h}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
      router.refresh();
    });
    return () => {
      alive = false;
    };
  }, [router]);
  return null;
}
