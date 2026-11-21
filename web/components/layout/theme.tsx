"use client";

import { useCallback, useSyncExternalStore } from "react";

export type ThemeMode = "dark" | "light";
const KEY = "sentineldesk.theme";

/** Inline script (rendered in <head>) that applies the saved theme before paint. Light is the default. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${KEY}");var d=t==="dark";var c=document.documentElement.classList;c.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot(): ThemeMode {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
function getServerSnapshot(): ThemeMode {
  return "light";
}

export function useTheme(): { theme: ThemeMode; setTheme: (t: ThemeMode) => void } {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setTheme = useCallback((t: ThemeMode) => {
    const root = document.documentElement;
    root.classList.toggle("dark", t === "dark");
    root.style.colorScheme = t;
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* storage unavailable */
    }
    listeners.forEach((l) => l());
  }, []);
  return { theme, setTheme };
}
