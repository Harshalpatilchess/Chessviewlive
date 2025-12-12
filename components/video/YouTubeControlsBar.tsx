"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Settings, Volume2, VolumeX, Maximize2, Minimize2, ExternalLink } from "lucide-react";

type YouTubeControlsBarProps = {
  className?: string;
  isMuted?: boolean;
  onToggleMute?: () => void;
  isLowBandwidth?: boolean;
  onToggleLowBandwidth?: () => void;
  onTogglePictureInPicture?: () => void;
  onToggleFullscreen?: () => void;
  onClickEmbed?: () => void;
  isFullscreen?: boolean;
  isPip?: boolean;
  statusContent?: ReactNode;
  showLowBandwidth?: boolean;
  showPiP?: boolean;
  videoAvailable?: boolean;
};

const baseButtonClass =
  "inline-flex items-center gap-1 rounded border border-white/25 bg-black/40 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:cursor-not-allowed disabled:opacity-50";

export default function YouTubeControlsBar({
  className = "",
  isMuted,
  onToggleMute,
  isLowBandwidth,
  onToggleLowBandwidth,
  onTogglePictureInPicture,
  onToggleFullscreen,
  onClickEmbed,
  isFullscreen,
  isPip,
  statusContent,
  showLowBandwidth = true,
  showPiP = true,
  videoAvailable = true,
}: YouTubeControlsBarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    };
    const handleClick = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setSettingsOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [settingsOpen]);

  return (
    <div
      className={`pointer-events-auto flex w-full items-center gap-2 rounded-full bg-black/60 px-2 py-1 text-xs text-white shadow ${className} ${
        videoAvailable ? "" : "opacity-60"
      }`}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={baseButtonClass}
          onClick={videoAvailable ? onToggleMute : undefined}
          disabled={!onToggleMute || !videoAvailable}
          aria-pressed={isMuted}
          title="Toggle mute"
        >
          {isMuted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
          <span>{isMuted ? "Unmute" : "Mute"}</span>
        </button>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={baseButtonClass}
          onClick={videoAvailable ? onToggleFullscreen : undefined}
          disabled={!onToggleFullscreen || !videoAvailable}
          aria-pressed={isFullscreen}
          title="Toggle Fullscreen"
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
          <span>{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</span>
        </button>
        <button
          type="button"
          className={baseButtonClass}
          onClick={videoAvailable ? onClickEmbed : undefined}
          disabled={!onClickEmbed || !videoAvailable}
          title="Copy embed HTML"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
          Embed
        </button>
        <div className="relative">
          <button
            type="button"
            className={baseButtonClass}
            onClick={() => setSettingsOpen(prev => !prev)}
            disabled={!videoAvailable}
            aria-expanded={settingsOpen}
            aria-haspopup="true"
            title="Settings"
          >
            <Settings className="h-4 w-4" aria-hidden />
            Settings
          </button>
          {settingsOpen ? (
            <div
              ref={menuRef}
              className="absolute right-0 top-full z-20 mt-1 min-w-[200px] rounded-lg border border-white/15 bg-slate-900/95 p-2 text-xs text-white shadow-lg backdrop-blur"
            >
              {showPiP && onTogglePictureInPicture ? (
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
                  onClick={() => {
                    setSettingsOpen(false);
                    onTogglePictureInPicture?.();
                  }}
                  aria-pressed={isPip}
                  disabled={!videoAvailable}
                >
                  <span>Picture-in-Picture</span>
                  {isPip ? <span className="text-emerald-300">On</span> : null}
                </button>
              ) : null}
              {showLowBandwidth && onToggleLowBandwidth ? (
                <button
                  type="button"
                  className="mt-1 flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
                  onClick={() => {
                    setSettingsOpen(false);
                    onToggleLowBandwidth?.();
                  }}
                  aria-pressed={isLowBandwidth}
                  disabled={!videoAvailable}
                >
                  <span>Low Bandwidth Mode (360p)</span>
                  {isLowBandwidth ? <span className="text-emerald-300">On</span> : null}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-1 text-[11px] text-white/80">
        {!videoAvailable ? <span className="text-white/70">Video unavailable for this board</span> : null}
        {statusContent}
      </div>
    </div>
  );
}
