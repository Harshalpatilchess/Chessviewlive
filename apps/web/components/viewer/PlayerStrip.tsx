// Minimal, SSR-safe player strip for live board view
export default function PlayerStrip(props: {
  white?: string;
  black?: string;
  result?: "1-0" | "0-1" | "½-½" | "ongoing";
}) {
  return (
    <div className="container mx-auto px-4">
      <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 backdrop-blur px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
        <div className="text-sm font-medium truncate">{props.white ?? "White Player"}</div>
        <div className="text-xs text-white/70 text-center">
          {props.result && props.result !== "ongoing" ? `Result: ${props.result}` : "Live game"}
        </div>
        <div className="text-sm font-medium text-right truncate">{props.black ?? "Black Player"}</div>
      </div>
    </div>
  );
}
