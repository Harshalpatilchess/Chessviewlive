'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import BroadcastBoardShell from "@/components/viewer/BroadcastBoardShell";
import Header from "../components/site/Header";
import SectionTitle from "../components/site/SectionTitle";
import NowLiveBadge from "../components/site/NowLiveBadge";
import { formatEvalLabel } from "@/lib/engine/evalMapping";

type Category = 'All' | 'Top' | 'Live' | 'Upcoming' | 'Past';

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [active, setActive] = useState<Category>('All');
  const [evalOpen, setEvalOpen] = useState(false);
  const [evalScore, setEvalScore] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const saved = window.localStorage.getItem('theme');
    if (saved === 'dark') {
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleDark = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const el = document.documentElement;
    el.classList.toggle('dark');
    window.localStorage.setItem('theme', el.classList.contains('dark') ? 'dark' : 'light');
  };

  const items: Array<{ key: Category; icon: ReactNode; label: string }> = [
    { key: 'All', icon: <span aria-hidden>♟️</span>, label: 'All Tournaments' },
    { key: 'Top', icon: <span aria-hidden>⭐</span>, label: 'Top Tournaments' },
    { key: 'Live', icon: <span aria-hidden>🔴</span>, label: 'Live Tournaments' },
    { key: 'Past', icon: <span aria-hidden>🕘</span>, label: 'Past Tournaments' },
    { key: 'Upcoming', icon: <span aria-hidden>⏳</span>, label: 'Upcoming Tournaments' },
  ];

  const evalPercent = useMemo(() => {
    const clamped = Math.max(-10, Math.min(10, evalScore));
    return ((clamped + 10) / 20) * 100;
  }, [evalScore]);

  return (
    <>
      <Header />
      <div className="min-h-screen bg-[#020817] text-slate-100">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-[#030f25]/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(s => !s)}
                aria-label="Toggle menu"
                className="rounded-full border border-white/10 p-2 text-white transition hover:border-white/40 hover:bg-white/5"
              >
                <div className="mb-[5px] h-[2px] w-5 bg-current" />
                <div className="mb-[5px] h-[2px] w-5 bg-current" />
                <div className="h-[2px] w-5 bg-current" />
              </button>
              <div className="flex items-center gap-3">
                <Image
                  src="/logo.png"
                  alt="Chessviewlive"
                  width={160}
                  height={44}
                  className="h-9 w-auto"
                  priority
                />
                <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
                  The best online chess viewing experience.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  onClick={() => setSearchOpen(o => !o)}
                  className="rounded-full border border-white/10 p-2 transition hover:border-white/40 hover:bg-white/5"
                  aria-label="Open search"
                >
                  🔍
                </button>
                {searchOpen && (
                  <input
                    autoFocus
                    onBlur={() => setSearchOpen(false)}
                    placeholder="Search tournaments…"
                    className="absolute right-0 top-1/2 w-64 -translate-y-1/2 rounded-full border border-white/10 bg-[#07142c] px-4 py-2 text-sm text-white outline-none shadow-xl"
                  />
                )}
              </div>

              <button className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300">
                Sign in
              </button>
            </div>
          </div>
        </header>

        <div className="container mx-auto px-4 py-6 space-y-6">
          <div className="mx-auto flex max-w-7xl gap-4 pb-12 pt-6 px-0">
            <aside
              className={`${sidebarOpen ? 'w-64' : 'w-20'} sticky top-16 h-[calc(100vh-70px)] rounded-3xl border border-white/10 bg-[#030d1f]/70 p-2 transition-all`}
            >
              <div className="flex h-full flex-col justify-between">
                <nav className="flex-1 space-y-2 overflow-y-auto">
                  {items.map(item => (
                    <button
                      key={item.key}
                      onClick={() => setActive(item.key)}
                      className={`w-full rounded-2xl border px-3 py-2 text-left transition ${
                        active === item.key
                          ? 'border-emerald-400/60 bg-emerald-400/10 text-white'
                          : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/40 hover:text-white'
                      }`}
                      title={item.label}
                      aria-pressed={active === item.key}
                    >
                      <span className="flex items-center gap-3 text-sm">
                        <span className="text-lg">{item.icon}</span>
                        {sidebarOpen && <span>{item.label}</span>}
                      </span>
                    </button>
                  ))}
                </nav>

                {sidebarOpen && (
                  <div className="mt-4 space-y-2 rounded-2xl border border-white/10 p-3">
                    <Link className="block rounded-full px-3 py-2 text-sm text-slate-300 hover:bg-white/5" href="/contact">
                      Contact us
                    </Link>
                    <Link className="block rounded-full px-3 py-2 text-sm text-slate-300 hover:bg-white/5" href="/organizer">
                      Organizer
                    </Link>
                    <Link className="block rounded-full px-3 py-2 text-sm text-slate-300 hover:bg-white/5" href="/legal">
                      Legal
                    </Link>
                    <button
                      onClick={toggleDark}
                      className="w-full rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:border-white/40 hover:text-white"
                    >
                      🌓 Dark / Light
                    </button>
                    <div className="flex items-center gap-3 pt-2 text-slate-400">
                      <a
                        href="https://www.instagram.com/"
                        aria-label="Instagram"
                        className="rounded-full border border-white/10 p-2 hover:border-white/40"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          width="20"
                          height="20"
                          aria-hidden="true"
                          className="fill-current"
                        >
                          <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3.5A5.5 5.5 0 1 1 6.5 13 5.5 5.5 0 0 1 12 7.5Zm0 2A3.5 3.5 0 1 0 15.5 13 3.5 3.5 0 0 0 12 9.5Zm6.25-3a1.25 1.25 0 1 1-1.25 1.25A1.25 1.25 0 0 1 18.25 6.5Z" />
                        </svg>
                      </a>
                      <a
                        href="https://www.youtube.com/"
                        aria-label="YouTube"
                        className="rounded-full border border-white/10 p-2 hover:border-white/40"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          width="22"
                          height="22"
                          aria-hidden="true"
                          className="fill-current"
                        >
                          <path d="M23.5 7.2a4 4 0 0 0-2.8-2.8C18.8 3.8 12 3.8 12 3.8s-6.8 0-8.7.6A4 4 0 0 0 .5 7.2 41.7 41.7 0 0 0 0 12a41.7 41.7 0 0 0 .5 4.8 4 4 0 0 0 2.8 2.8c1.9.6 8.7.6 8.7.6s6.8 0 8.7-.6a4 4 0 0 0 2.8-2.8A41.7 41.7 0 0 0 24 12a41.7 41.7 0 0 0-.5-4.8ZM9.75 15.02V8.98L15.5 12z" />
                        </svg>
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </aside>

            <section className="flex-1 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionTitle>Featured</SectionTitle>
                <NowLiveBadge />
              </div>
              <div className="mt-2" />
              <div className="space-y-3">
                <p className="px-4 text-xs uppercase tracking-[0.4em] text-slate-500">Live board preview</p>
                <BroadcastBoardShell />
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-3xl border border-white/10 bg-[#050f22] p-4 shadow-[0_20px_60px_rgba(2,8,23,0.6)]">
                  <div className="grid aspect-square grid-cols-8 overflow-hidden rounded-2xl border border-white/10 bg-[#030c1c]">
                    {Array.from({ length: 64 }).map((_, i) => (
                      <div
                        key={i}
                        className={(Math.floor(i / 8) + (i % 8)) % 2 === 0 ? 'bg-[#f0d9b5]' : 'bg-[#b58863]'}
                      />
                    ))}
                  </div>
                  <div className="mt-4 flex items-center justify-center gap-3">
                    <button className="rounded-full border border-white/20 px-4 py-2 text-sm text-slate-200 transition hover:border-white/60">
                      ◀︎ Prev
                    </button>
                    <button className="rounded-full bg-rose-500/90 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-rose-500/30">
                      ● Live
                    </button>
                    <button className="rounded-full border border-white/20 px-4 py-2 text-sm text-slate-200 transition hover:border-white/60">
                      Next ▶︎
                    </button>
                  </div>
                  <pre className="mt-4 rounded-2xl border border-white/5 bg-[#040c1a] p-3 text-xs text-slate-300">
{`1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *`}
                  </pre>
                </div>

                <div className="rounded-3xl border border-white/10 bg-[#050f22] p-4 shadow-[0_20px_60px_rgba(2,8,23,0.6)]">
                  <div className="flex flex-col gap-3 lg:h-full">
                    <div className="flex-1 rounded-2xl border border-white/10 bg-black/40 text-center text-sm text-slate-400">
                      <div className="flex h-full items-center justify-center">Live video here</div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <button
                        className="rounded-full border border-white/20 px-3 py-2 text-sm text-slate-200 transition hover:border-white/60"
                        onClick={() => setEvalOpen(v => !v)}
                        aria-pressed={evalOpen}
                        aria-label="Toggle evaluation bar"
                      >
                        Evaluation bar
                      </button>
                      <button className="rounded-full border border-white/20 px-3 py-2 text-sm text-slate-200 transition hover:border-white/60">
                        Engine ON
                      </button>
                      <button className="rounded-full border border-white/20 px-3 py-2 text-sm text-slate-200 transition hover:border-white/60">
                        Commentary OFF
                      </button>
                    </div>

                    {evalOpen && (
                      <div className="mt-3 flex items-end gap-3">
                        <div
                          className="relative h-40 w-4 overflow-hidden rounded-full border border-white/10 bg-black/40"
                          aria-label="Engine evaluation gauge"
                          title="White advantage at top, Black at bottom"
                        >
                          <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-black/30" />
                          <div className="absolute bottom-0 left-0 right-0 bg-white/90" style={{ height: `${evalPercent}%` }} />
                        </div>
                        <div className="text-xs text-slate-400">
                          <div className="mb-1">Eval: {formatEvalLabel(evalScore)} (−10..+10)</div>
                          <div className="flex gap-2">
                            <button
                              className="rounded-full border border-white/20 px-2 py-1"
                              onClick={() => setEvalScore(s => Math.max(-10, s - 0.5))}
                            >
                              −
                            </button>
                            <button
                              className="rounded-full border border-white/20 px-2 py-1"
                              onClick={() => setEvalScore(s => Math.min(10, s + 0.5))}
                            >
                              +
                            </button>
                            <button className="rounded-full border border-white/20 px-2 py-1" onClick={() => setEvalScore(0)}>
                              reset
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="rounded-2xl border border-white/5 bg-[#040c1a] p-3 text-sm text-slate-300">
                      <strong>AI commentary:</strong> White gains space in the center with e4; game is balanced.
                    </div>
                  </div>
                </div>
              </div>

              <SectionTitle>Tournaments</SectionTitle>
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.4em] text-slate-500">{active} tournaments</p>
                    <h2 className="text-2xl font-semibold text-white">Broadcast lineup</h2>
                  </div>
                  <Link
                    href="/organizer"
                    className="rounded-full border border-white/20 px-4 py-2 text-sm text-slate-200 transition hover:border-white/60"
                  >
                    Explore tournaments
                  </Link>
                </div>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <article
                      key={i}
                      className="overflow-hidden rounded-3xl border border-white/10 bg-[#050f22] shadow-[0_18px_40px_rgba(2,8,23,0.45)]"
                    >
                      <Image
                        src={`https://placehold.co/800x450?text=Tournament+${i + 1}`}
                        alt={`Tournament ${i + 1}`}
                        width={800}
                        height={450}
                        className="h-40 w-full object-cover"
                        loading="lazy"
                      />
                      <div className="space-y-2 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Tournament {i + 1}</p>
                            <div className="text-lg font-semibold text-white">Sample Event {i + 1}</div>
                          </div>
                          <span className="rounded-full bg-rose-500/20 px-3 py-1 text-xs font-semibold text-rose-200">
                            NOW LIVE
                          </span>
                        </div>
                        <p className="text-sm text-slate-400">Next round in 4h • Top players: A, B, C</p>
                        <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                          <Link
                            href={`/t/sample-${i + 1}`}
                            className="rounded-full border border-white/15 px-3 py-1 transition hover:border-white/60"
                          >
                            Hub
                          </Link>
                          <Link
                            href={`/t/sample-${i + 1}/live/1`}
                            className="rounded-full border border-emerald-400/60 px-3 py-1 text-emerald-200 transition hover:border-emerald-200"
                          >
                            Live
                          </Link>
                          <Link
                            href={`/t/sample-${i + 1}/replay/1`}
                            className="rounded-full border border-white/15 px-3 py-1 transition hover:border-white/60"
                          >
                            Replay
                          </Link>
                          <Link
                            href={`/t/sample-${i + 1}/organizer/1`}
                            className="rounded-full border border-white/15 px-3 py-1 transition hover:border-white/60"
                          >
                            Organizer
                          </Link>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
