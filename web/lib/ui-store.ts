"use client";

import { create } from "zustand";

/** Small UI-only store (kept separate from the live data store). */
interface UiState {
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  createOpen: false,
  setCreateOpen: (createOpen) => set({ createOpen }),
}));
