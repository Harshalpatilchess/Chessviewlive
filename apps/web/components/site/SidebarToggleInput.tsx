"use client";

type SidebarToggleInputProps = {
  id?: string;
  className?: string;
  defaultOpen?: boolean;
};

export default function SidebarToggleInput({
  id = "sidebar-toggle",
  className,
  defaultOpen,
}: SidebarToggleInputProps) {
  const resolvedDefaultOpen = defaultOpen ?? false;
  return (
    <input
      id={id}
      type="checkbox"
      className={className}
      defaultChecked={resolvedDefaultOpen}
    />
  );
}
