"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Re-fetches the page's chain data every 20 seconds and shows when it last did. */
export function Live({ renderedAt }: { renderedAt: number }) {
  const router = useRouter();
  const [now, setNow] = useState(renderedAt);

  useEffect(() => {
    const refresh = setInterval(() => router.refresh(), 20_000);
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [router]);

  const seconds = Math.max(0, Math.round((now - renderedAt) / 1000));
  return (
    <span className="live">
      <i /> Live from the chains · read {seconds < 2 ? "just now" : `${seconds}s ago`}
    </span>
  );
}
