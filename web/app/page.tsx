import type { Metadata } from "next";
import { Suspense } from "react";
import { BoardView } from "@/components/board/board-view";

export const metadata: Metadata = { title: "Board" };

export default function BoardPage() {
  return (
    <Suspense>
      <BoardView />
    </Suspense>
  );
}
