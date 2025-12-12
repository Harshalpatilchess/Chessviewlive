"use client";

import type { ReactNode } from "react";

export default function ReplayLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {children}
    </div>
  );
}
