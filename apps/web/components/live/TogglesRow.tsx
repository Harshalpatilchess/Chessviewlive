const toggles = [
  { id: "evaluation", label: "Evaluation" },
  { id: "engine", label: "Engine" },
  { id: "commentary", label: "Commentary" },
];

const TogglesRow = () => {
  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm backdrop-blur-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
        Broadcast Overlays
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        {toggles.map(toggle => (
          <button
            key={toggle.id}
            type="button"
            aria-pressed="false"
            className="flex items-center gap-3 rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/35 hover:text-white"
          >
            <span className="relative inline-flex h-5 w-10 items-center rounded-full bg-slate-600">
              <span className="absolute left-1 h-3.5 w-3.5 rounded-full bg-slate-300" />
            </span>
            {toggle.label}
          </button>
        ))}
      </div>
    </section>
  );
};

export default TogglesRow;
