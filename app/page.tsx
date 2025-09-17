'use client';
import { useEffect, useState } from 'react';

type Category = 'All' | 'Top' | 'Live' | 'Upcoming' | 'Past';

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [active, setActive] = useState<Category>('All');
  const [evalOpen, setEvalOpen] = useState(false); // Evaluation bar toggle
  const [evalScore, setEvalScore] = useState(0);   // -10 (black) .. +10 (white)

  // persist dark mode
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('theme') : null;
    if (saved === 'dark') document.documentElement.classList.add('dark');
  }, []);
  const toggleDark = () => {
    const el = document.documentElement;
    el.classList.toggle('dark');
    localStorage.setItem('theme', el.classList.contains('dark') ? 'dark' : 'light');
  };

  // sidebar items with explicit Category typing
  const items: Array<{ key: Category; icon: React.ReactNode; label: string }> = [
    { key: 'All', icon: <span aria-hidden>♟️</span>, label: 'All Tournaments' },
    { key: 'Top', icon: <span aria-hidden>⭐</span>, label: 'Top Tournaments' },
    { key: 'Live', icon: <span aria-hidden>🔴</span>, label: 'Live Tournaments' },
    { key: 'Past', icon: <span aria-hidden>🕘</span>, label: 'Past Tournaments' },
    { key: 'Upcoming', icon: <span aria-hidden>⏳</span>, label: 'Upcoming Tournaments' },
  ];

  // helper for eval bar height percent (0..100), 50% = equal
  const evalPercent = (() => {
    const clamped = Math.max(-10, Math.min(10, evalScore));
    return ((clamped + 10) / 20) * 100;
  })();

  return (
    <div className="min-h-screen bg-white text-black dark:bg-[#0b0b0f] dark:text-white">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-black/10 dark:border-white/10 bg-white/80 dark:bg-[#0b0b0f]/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* Left: Logo + hamburger */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(s => !s)}
              aria-label="Toggle menu"
              className="p-2 rounded hover:bg-black/5 dark:hover:bg-white/10"
            >
              <div className="w-5 h-[2px] bg-current mb-[5px]" />
              <div className="w-5 h-[2px] bg-current mb-[5px]" />
              <div className="w-5 h-[2px] bg-current" />
            </button>
            <div className="flex items-center gap-2">
              <img
                src="/logo.png"
                alt="ChessviewLive logo"
                width={160}
                height={44}
                style={{ height: '40px', width: 'auto' }}
              />
              <span className="font-bold text-lg hidden sm:inline">ChessviewLive</span>
            </div>
          </div>

          {/* Right: search + auth */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setSearchOpen(o => !o)}
                className="p-2 rounded hover:bg-black/5 dark:hover:bg-white/10"
                aria-label="Open search"
              >
                🔍
              </button>
              {searchOpen && (
                <input
                  autoFocus
                  onBlur={() => setSearchOpen(false)}
                  placeholder="Search tournaments…"
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-64 border rounded px-3 py-1 bg-white dark:bg-[#12121a] outline-none"
                />
              )}
            </div>

            <button className="px-3 py-1.5 rounded bg-black text-white dark:bg-white dark:text-black">
              Sign in
            </button>
          </div>
        </div>
      </header>

      {/* Body: sticky sidebar that fits viewport under header */}
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex gap-4">
          {/* Sidebar */}
          <aside
            className={`${sidebarOpen ? 'w-64' : 'w-20'} transition-all border-r border-black/10 dark:border-white/10`}
          >
            <div
              className="sticky top-14 h-[calc(100vh-56px)] min-h-0 flex flex-col justify-between"
              role="navigation"
              aria-label="Primary"
            >
              {/* Top nav (scroll if needed) */}
              <nav className="flex-1 overflow-y-auto p-2 space-y-2">
                {items.map(item => (
                  <button
                    key={item.key}
                    onClick={() => setActive(item.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 ${
                      active === item.key
                        ? 'bg-black text-white dark:bg-white dark:text-black'
                        : ''
                    }`}
                    title={item.label}
                    aria-pressed={active === item.key}
                  >
                    <span className="text-lg">{item.icon}</span>
                    {sidebarOpen && <span className="text-sm">{item.label}</span>}
                  </button>
                ))}
              </nav>

              {/* Bottom section pinned. Hidden when sidebar collapsed */}
              {sidebarOpen && (
                <div className="shrink-0 p-2 border-t border-black/10 dark:border-white/10">
                  <a
                    className="block px-3 py-2 rounded hover:bg-black/5 dark:hover:bg-white/10"
                    href="/contact"
                  >
                    Contact us
                  </a>
                  <a
                    className="block px-3 py-2 rounded hover:bg-black/5 dark:hover:bg-white/10"
                    href="/organizer"
                  >
                    Organizer
                  </a>
                  <a
                    className="block px-3 py-2 rounded hover:bg-black/5 dark:hover:bg-white/10"
                    href="/legal"
                  >
                    Legal
                  </a>

                  <button
                    onClick={toggleDark}
                    className="w-full mt-2 px-3 py-2 rounded border border-black/10 dark:border-white/10"
                  >
                    🌓 Dark / Light
                  </button>

                  {/* Socials with current logos (SVG) */}
                  <div className="flex items-center gap-3 px-1 pt-3">
                    <a
                      href="https://www.instagram.com/"
                      aria-label="Instagram"
                      className="inline-flex"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {/* Instagram glyph */}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        width="24"
                        height="24"
                        aria-hidden="true"
                        className="fill-current"
                      >
                        <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3.5A5.5 5.5 0 1 1 6.5 13 5.5 5.5 0 0 1 12 7.5Zm0 2A3.5 3.5 0 1 0 15.5 13 3.5 3.5 0 0 0 12 9.5Zm6.25-3a1.25 1.25 0 1 1-1.25 1.25A1.25 1.25 0 0 1 18.25 6.5Z" />
                      </svg>
                    </a>
                    <a
                      href="https://www.youtube.com/"
                      aria-label="YouTube"
                      className="inline-flex"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {/* YouTube play button */}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        width="26"
                        height="26"
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

          {/* Main content */}
          <section className="flex-1 py-4 space-y-6">
            {/* Top grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Left: Board + controls + PGN */}
              <div className="p-4 border rounded">
                <div className="grid grid-cols-8 grid-rows-8 aspect-square overflow-hidden rounded">
                  {Array.from({ length: 64 }).map((_, i) => (
                    <div
                      key={i}
                      className={(Math.floor(i / 8) + (i % 8)) % 2 === 0 ? 'bg-[#eee]' : 'bg-[#b8c4d6] dark:bg-[#36465e]'}
                    />
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-center gap-3">
                  <button className="px-3 py-1.5 rounded border" aria-label="Previous move">
                    ◀︎ Prev
                  </button>
                  <button className="px-3 py-1.5 rounded bg-black text-white dark:bg-white dark:text-black" aria-pressed="true">
                    ● Live
                  </button>
                  <button className="px-3 py-1.5 rounded border" aria-label="Next move">
                    Next ▶︎
                  </button>
                </div>
                <pre className="mt-3 p-3 bg-black/5 dark:bg-white/10 rounded text-xs overflow-x-auto">
{`1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *`}
                </pre>
              </div>

              {/* Right: Video + options + AI commentary */}
              <div className="p-4 border rounded">
                <div className="aspect-video bg-black/10 dark:bg-white/10 rounded flex items-center justify-center">
                  <span>Live video here</span>
                </div>

                {/* Controls */}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button
                    className="px-3 py-1.5 rounded border"
                    onClick={() => setEvalOpen(v => !v)}
                    aria-pressed={evalOpen}
                    aria-label="Toggle evaluation bar"
                  >
                    Evaluation bar
                  </button>
                  <button className="px-3 py-1.5 rounded border">Engine ON</button>
                  <button className="px-3 py-1.5 rounded border">Commentary OFF</button>
                </div>

                {/* Simple vertical evaluation gauge */}
                {evalOpen && (
                  <div className="mt-3 flex items-end gap-3">
                    {/* Gauge */}
                    <div
                      className="relative w-4 h-40 rounded overflow-hidden border border-black/10 dark:border-white/10"
                      aria-label="Engine evaluation gauge"
                      title="White advantage at top, Black at bottom"
                    >
                      {/* background split */}
                      <div className="absolute inset-0 bg-gradient-to-b from-white to-black opacity-20 pointer-events-none" />
                      {/* fill per evalPercent */}
                      <div
                        className="absolute left-0 right-0 bottom-0 bg-white dark:bg-white"
                        style={{ height: `${evalPercent}%` }}
                      />
                    </div>

                    {/* Mock controls to adjust score for now */}
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      <div className="mb-1">Eval: {evalScore.toFixed(1)} (−10..+10)</div>
                      <div className="flex gap-2">
                        <button
                          className="px-2 py-1 rounded border"
                          onClick={() => setEvalScore(s => Math.max(-10, s - 0.5))}
                        >
                          −
                        </button>
                        <button
                          className="px-2 py-1 rounded border"
                          onClick={() => setEvalScore(s => Math.min(10, s + 0.5))}
                        >
                          +
                        </button>
                        <button className="px-2 py-1 rounded border" onClick={() => setEvalScore(0)}>
                          reset
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-3 p-3 bg-black/5 dark:bg-white/10 rounded text-sm">
                  <strong>AI commentary:</strong> White gains space in the center with e4; game is balanced.
                </div>
              </div>
            </div>

            {/* Tournaments */}
            <div>
              <h2 className="text-xl font-semibold mb-3">{active} tournaments</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <article key={i} className="rounded overflow-hidden border">
                    <img
                      src={`https://placehold.co/800x450?text=Tournament+${i + 1}`}
                      alt={`Tournament ${i + 1}`}
                      className="w-full h-40 object-cover"
                      loading="lazy"
                    />
                    <div className="p-3 space-y-1">
                      <div className="font-semibold">Sample Event {i + 1}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Next round in 4h • Top players: A, B, C
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
  );
}
