"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** Detail view is a right-side panel driven by `?ticket=<id>` on any page (deep-linkable). */
export const ISSUE_PARAM = "ticket";

export function useIssueNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get(ISSUE_PARAM);

  const hrefFor = useCallback(
    (id: string | null) => {
      const sp = new URLSearchParams(params.toString());
      if (id) sp.set(ISSUE_PARAM, id);
      else sp.delete(ISSUE_PARAM);
      const qs = sp.toString();
      return `${pathname}${qs ? `?${qs}` : ""}`;
    },
    [params, pathname],
  );

  const open = useCallback((id: string) => router.push(hrefFor(id), { scroll: false }), [router, hrefFor]);
  const close = useCallback(() => router.replace(hrefFor(null), { scroll: false }), [router, hrefFor]);

  return { openId, open, close, hrefFor };
}
