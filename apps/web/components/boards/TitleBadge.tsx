type TitleBadgeProps = {
  title: string;
  compact?: boolean;
  className?: string;
};

const baseClassName =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md border border-amber-200/50 bg-amber-200/10 px-1.5 py-[2px] text-[9px] font-semibold leading-tight text-amber-100";

export default function TitleBadge({ title, compact = false, className }: TitleBadgeProps) {
  return (
    <span className={`${baseClassName} ${compact ? "text-[8px]" : ""} ${className ?? ""}`}>
      {title}
    </span>
  );
}
