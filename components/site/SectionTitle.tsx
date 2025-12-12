import { ReactNode } from "react";

export default function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-medium tracking-wide uppercase text-white/70 mt-6 mb-3">
      {children}
    </h2>
  );
}
