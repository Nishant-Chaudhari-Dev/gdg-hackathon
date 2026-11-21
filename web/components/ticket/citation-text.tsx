"use client";

import { cn } from "@/lib/utils";

const BRACKET_SRC = "\\[([^\\[\\]\\n]{3,120})\\]";
const ID_LIKE = /^[A-Za-z]{2,}[-_]?[A-Za-z0-9][\w-]*$/;

/** Renders reply text, turning citation tokens like [TKT-01234] into clickable chips. */
export function CitationText({
  text,
  knownIds,
  citedIds,
  onCite,
}: {
  text: string;
  knownIds: string[];
  citedIds: string[];
  onCite: (id: string) => void;
}) {
  const known = new Set([...knownIds, ...citedIds]);
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(BRACKET_SRC, "g");
  while ((m = re.exec(text))) {
    const ids = m[1].split(/\s*[,;]\s*/).filter(Boolean);
    const valid = ids.length > 0 && ids.every((id) => known.has(id) || (ID_LIKE.test(id) && /\d/.test(id)));
    if (!valid) continue;
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    ids.forEach((id, i) => {
      const inHits = knownIds.includes(id);
      out.push(
        <button
          key={`${at}-${i}`}
          type="button"
          onClick={() => inHits && onCite(id)}
          title={inHits ? `Jump to precedent ${id}` : `${id} (not in retrieved set)`}
          className={cn(
            "mx-0.5 inline-flex h-[18px] translate-y-[-1px] items-center rounded border px-1 align-middle font-mono text-[10.5px] font-semibold transition-colors",
            inHits
              ? "border-primary/35 bg-primary/10 text-primary hover:bg-primary/20"
              : "cursor-help border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
          )}
        >
          {id}
        </button>,
      );
    });
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
