import { Activity, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

type CornerControlsProps = {
  showEval: boolean;
  orientation: "white" | "black";
  onToggleEval: () => void;
  onFlip: () => void;
};

const IconButton = ({
  title,
  onClick,
  children,
  active,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
}) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={`rounded-full border p-2 shadow-md transition hover:border-white/60 hover:text-white ${
      active ? "border-emerald-400 text-emerald-200" : "border-white/20 text-slate-200"
    } bg-slate-900/80 backdrop-blur`}
  >
    {children}
  </button>
);

const CornerControls = ({ showEval, orientation, onToggleEval, onFlip }: CornerControlsProps) => {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-between px-3">
      <div className="pointer-events-auto">
        <IconButton title="Toggle engine evaluation" onClick={onToggleEval} active={showEval}>
          <Activity size={18} />
        </IconButton>
      </div>
      <div className="pointer-events-auto">
        <IconButton
          title={`Flip board (currently ${orientation})`}
          onClick={onFlip}
        >
          <RotateCw size={18} />
        </IconButton>
      </div>
    </div>
  );
};

export default CornerControls;
