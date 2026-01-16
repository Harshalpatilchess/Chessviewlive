export const broadcastTheme = {
  background: "#020817",
  backdrop: "#030712",
  surface: "#050f1e",
  panel: "#0b172f",
  panelAlt: "#0f1f3c",
  accent: "#2dd4bf",
  accentSoft: "rgba(45, 212, 191, 0.14)",
  accentStrong: "#0fb389",
  live: "#f43f5e",
  liveSoft: "rgba(244, 63, 94, 0.18)",
  border: "rgba(148, 163, 184, 0.22)",
  borderStrong: "rgba(226, 232, 240, 0.4)",
  muted: "#94a3b8",
  pillText: "#e2e8f0",
  radiusLg: "1.5rem",
  radiusXl: "2rem",
};

export const broadcastClasses = {
  page: "min-h-screen bg-[#020817] text-slate-100",
  panel:
    "rounded-[32px] border border-white/10 bg-gradient-to-br from-[#0a152c] via-[#050f1e] to-[#030712] p-6 sm:p-8 shadow-[0_30px_80px_rgba(2,8,23,0.7)]",
  pill: "inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-200",
  livePill:
    "inline-flex items-center gap-1 rounded-full border border-rose-400/70 bg-rose-500/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-100 drop-shadow",
  buttonPrimary:
    "inline-flex items-center justify-center rounded-full bg-emerald-400/90 px-6 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200",
  buttonSecondary:
    "inline-flex items-center justify-center rounded-full border border-white/20 bg-white/5 px-6 py-2.5 text-sm font-semibold text-white/90 transition hover:border-white/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40",
  card:
    "rounded-3xl border border-white/10 bg-[#070f1e]/70 p-6 shadow-[0_20px_60px_rgba(2,8,23,0.55)]",
};

export const focusRingClass =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200";

export const badgeMutedClass =
  "inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-300";
