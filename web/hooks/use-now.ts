"use client";

import { useEffect, useState } from "react";

/** Current time that ticks on the client only (null during SSR → hydration-safe). */
export function useNow(intervalMs = 10_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const first = setTimeout(update, 0);
    const id = setInterval(update, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}
