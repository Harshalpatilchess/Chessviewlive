"use client";

import { useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";

type InstallAppCardProps = {
  markSrc: string;
};

export default function InstallAppCard({ markSrc }: InstallAppCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="install-card install-card-tight nav-item group w-full rounded-2xl border border-white/10 bg-white/5 text-left text-sm text-slate-200 shadow-[0_18px_40px_-30px_rgba(16,185,129,0.55)] transition hover:border-white/40"
        title="Install"
        data-install-card="true"
      >
        <div className="install-card-inner grid w-full grid-rows-[auto_auto_auto] items-start">
          <div className="install-logo-wrap flex w-full items-start justify-center">
            <Image
              src={markSrc}
              alt="Chessviewlive app"
              width={240}
              height={240}
              className="install-mark h-12 w-12 object-contain drop-shadow-[0_0_18px_rgba(16,185,129,0.35)]"
            />
          </div>
          <div className="install-title nav-label pointer-events-none max-w-0 overflow-hidden opacity-0 translate-x-2 text-sm font-semibold leading-tight transition-all">
            Chessviewlive app
          </div>
          <div className="install-cta mt-2 inline-flex items-center justify-center rounded-full border border-emerald-400/60 bg-emerald-400/20 px-4 py-2 text-xs font-semibold text-emerald-100">
            <span>Install</span>
          </div>
        </div>
      </button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#050f22] p-5 text-slate-100 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Install</p>
                <h2 className="mt-2 text-lg font-semibold">Chessviewlive app</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-full border border-white/10 p-1 text-slate-300 transition hover:border-white/40 hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <p className="mt-4 text-sm text-slate-300">
              QR codes for Google Play and App Store will appear here soon.
            </p>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="mt-6 w-full rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-200 transition hover:border-emerald-300/70 hover:text-emerald-50"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
