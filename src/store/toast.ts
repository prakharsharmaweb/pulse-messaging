"use client";

import { create } from "zustand";

export type Toast = {
  id: string;
  message: string;
  variant: "info" | "error" | "success";
};

type ToastState = {
  toasts: Toast[];
  push: (message: string, variant?: Toast["variant"]) => void;
  dismiss: (id: string) => void;
};

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (message, variant = "info") => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helper usable outside React. */
export const toast = {
  info: (m: string) => useToasts.getState().push(m, "info"),
  error: (m: string) => useToasts.getState().push(m, "error"),
  success: (m: string) => useToasts.getState().push(m, "success"),
};
