type CommentaryPanelProps = {
  commentary: string[];
};

const CommentaryPanel = ({ commentary }: CommentaryPanelProps) => {
  const hasCommentary = commentary.length > 0;

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm backdrop-blur-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
        Live commentary
      </p>
      <div className="mt-3 space-y-2">
        {hasCommentary ? (
          commentary.map((line, index) => (
            <p
              key={`${index}-${line.slice(0, 12)}`}
              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300"
            >
              {line}
            </p>
          ))
        ) : (
          <p className="text-xs text-slate-400">
            Live commentary will appear here once the broadcast starts.
          </p>
        )}
      </div>
    </section>
  );
};

export default CommentaryPanel;
// Add a simple dark footer that says "Chessviewlive © 2025"
