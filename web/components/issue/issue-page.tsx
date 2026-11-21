"use client";

import { useParams } from "next/navigation";
import { IssueById } from "./issue-view";

/** Full-page issue view at /tickets/[id] (deep-linkable). */
export function IssuePage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id ?? "");
  return (
    <div className="mx-auto max-w-6xl">
      <IssueById key={id} id={id} variant="page" />
    </div>
  );
}
