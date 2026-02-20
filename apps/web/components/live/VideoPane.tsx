"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import LivekitPanel from "@/components/LivekitPanel";

type VideoPaneProps = {
  src?: string;
  offline?: boolean;
  replayHref?: string;
};

const VideoPane = ({ src, offline = true, replayHref }: VideoPaneProps) => {
  const router = useRouter();
  const handleReplayClick = () => {
    if (!replayHref) return;
    router.push(replayHref);
  };

  const canShowOverlay = offline && Boolean(replayHref);

  return (
    <div className="relative w-full">
      <div className="absolute top-2 left-2 rounded bg-lime-600/80 px-2 py-1 text-[10px]">VIDEO V3</div>
      <div className="relative aspect-video w-full max-h-[52vh] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-sm lg:aspect-[16/8.5] lg:max-h-[60vh]">
        {src ? (
          <video src={src} controls className="h-full w-full object-cover" />
        ) : (
          <LivekitPanel />
        )}
        {canShowOverlay ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <button
              type="button"
              onClick={handleReplayClick}
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/30 bg-black/70 px-4 py-2 text-sm font-semibold text-white shadow-lg backdrop-blur transition hover:bg-black/80"
            >
              <RotateCcw className="h-5 w-5" />
              Watch replay
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default VideoPane;
