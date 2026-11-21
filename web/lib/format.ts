export function fmtMs(ms: number | null | undefined, digits = 0): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (digits === 0 && ms < 10) return `${ms.toFixed(1)}ms`;
  return `${ms.toFixed(digits)}ms`;
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtNum(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("en-US").format(v);
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Relative time. `now` must come from client state (see useNow) to stay hydration-safe. */
export function fmtAgo(iso: string | null | undefined, now: number | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  if (now == null) return fmtTime(iso);
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Normalize dataset text for display: literal "\\n" sequences → newlines, strip wrapping quotes. */
export function cleanText(s: string | null | undefined): string {
  if (!s) return "";
  let t = s.replace(/\\r\\n|\\n/g, "\n").replace(/\\t/g, "  ");
  if (t.length > 1 && t.startsWith('"') && !t.slice(1).includes('"')) t = t.slice(1);
  if (t.length > 1 && t.endsWith('"') && !t.slice(0, -1).includes('"')) t = t.slice(0, -1);
  return t.trim();
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) : id;
}
