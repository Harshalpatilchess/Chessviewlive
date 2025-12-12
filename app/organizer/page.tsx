'use client';

import { useEffect, useMemo, useState } from 'react';

export default function OrganizerPage() {
  const [tournament, setTournament] = useState('');
  const [board, setBoard] = useState('');
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // convenience: remember last values
    const t = localStorage.getItem('org.tournament') || '';
    const b = localStorage.getItem('org.board') || '';
    setTournament(t);
    setBoard(b);
  }, []);

  const room = useMemo(() => {
    const t = tournament.trim().toLowerCase().replace(/\s+/g, '-');
    const b = board.trim();
    if (!t || !b) return '';
    return `${t}-b${b}`;
  }, [tournament, board]);

  const viewerHref = room ? `/live/test?room=${encodeURIComponent(room)}` : '';

  function start() {
    setErr(null);
    if (!room) { setErr('Enter tournament and board.'); return; }
    if (!secret) { setErr('Enter password.'); return; }
    // Navigate to publisher URL
    const pub = `/live/test?room=${encodeURIComponent(room)}&publish=1&secret=${encodeURIComponent(secret)}`;
    window.location.href = pub;
  }

  return (
    <div className="max-w-md mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold text-white">Start board broadcast</h1>

      <label className="block text-sm text-slate-300">
        Tournament code (e.g., cv-open)
        <input
          className="mt-1 w-full rounded-lg bg-slate-800 text-white px-3 py-2"
          value={tournament}
          onChange={(e) => { setTournament(e.target.value); localStorage.setItem('org.tournament', e.target.value); }}
          placeholder="cv-open"
        />
      </label>

      <label className="block text-sm text-slate-300">
        Board number
        <input
          className="mt-1 w-full rounded-lg bg-slate-800 text-white px-3 py-2"
          value={board}
          onChange={(e) => { setBoard(e.target.value); localStorage.setItem('org.board', e.target.value); }}
          placeholder="7-1"
        />
      </label>

      <label className="block text-sm text-slate-300">
        Password
        <input
          className="mt-1 w-full rounded-lg bg-slate-800 text-white px-3 py-2"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="chess-admin-test"
        />
      </label>

      <button
        onClick={start}
        className="w-full rounded-xl bg-emerald-600 text-white py-2 font-medium"
      >
        Go live
      </button>

      {viewerHref && (
        <div className="text-xs text-slate-300">
          Viewer link (share): <code className="break-all">{viewerHref}</code>
        </div>
      )}

      {err && <div className="text-sm text-red-400">{err}</div>}
    </div>
  );
}
