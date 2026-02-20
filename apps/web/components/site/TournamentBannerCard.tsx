"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { resolveTournamentThumbnail } from "@/lib/tournamentImages";

type ThumbnailImageProps = {
  src: string;
  fit: "cover" | "contain";
  priority?: boolean;
  onFailure?: () => void;
};

const ThumbnailImage = ({ src, fit, priority, onFailure }: ThumbnailImageProps) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const hasNotifiedRef = useRef(false);

  useEffect(() => {
    setStatus("loading");
    hasNotifiedRef.current = false;
  }, [src]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !img.complete) return;
    if (img.naturalWidth > 0) {
      setStatus("loaded");
      return;
    }
    setStatus("failed");
    if (!hasNotifiedRef.current) {
      hasNotifiedRef.current = true;
      onFailure?.();
    }
  }, [src, onFailure]);

  const handleFailure = () => {
    setStatus("failed");
    if (!hasNotifiedRef.current) {
      hasNotifiedRef.current = true;
      onFailure?.();
    }
  };

  return (
    <img
      ref={imgRef}
      src={src}
      alt=""
      aria-hidden
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      onLoad={() => setStatus("loaded")}
      onError={handleFailure}
      className={`absolute inset-0 h-full w-full transition-opacity duration-300 ${
        fit === "cover" ? "object-cover" : "object-contain"
      } ${status === "loaded" ? "opacity-100" : "opacity-0"}`}
    />
  );
};

type TournamentBannerCardProps = {
  href: string;
  name: string;
  roundLabel: string;
  timeLabel?: string | null;
  status: "Live" | "Ongoing" | "Completed" | "Upcoming";
  heroImage?: string | null;
  logoImage?: string | null;
  flagCode?: string | null;
  priority?: boolean;
};

export default function TournamentBannerCard({
  href,
  name,
  roundLabel,
  timeLabel,
  status,
  heroImage,
  logoImage,
  flagCode,
  priority,
}: TournamentBannerCardProps) {
  const { candidates: thumbnailCandidates } = useMemo(
    () =>
      resolveTournamentThumbnail({
        heroImage,
        logoImage,
        flagCode,
      }),
    [heroImage, logoImage, flagCode]
  );
  const [candidateIndex, setCandidateIndex] = useState(0);
  const metaLabel = [roundLabel, timeLabel].filter(Boolean).join(" • ");
  const statusPill = (() => {
    if (status === "Live") {
      return {
        label: "Live",
        dot: true,
        className: "border-red-400/50 bg-red-500/20 text-red-100",
      };
    }
    if (status === "Ongoing") {
      return {
        label: "Ongoing",
        dot: false,
        className: "border-orange-300/40 bg-orange-400/10 text-orange-100",
      };
    }
    if (status === "Completed") {
      return {
        label: "Completed",
        dot: false,
        className: "border-emerald-300/40 bg-emerald-400/10 text-emerald-100",
      };
    }
    return {
      label: "Upcoming",
      dot: false,
      className: "border-sky-300/40 bg-sky-400/10 text-sky-100",
    };
  })();

  useEffect(() => {
    setCandidateIndex(0);
  }, [heroImage, logoImage, flagCode]);

  const activeCandidate = thumbnailCandidates[candidateIndex] ?? null;

  return (
    <Link href={href} className="group block h-full" aria-label={`Open ${name}`}>
      <article className="flex h-full min-h-[216px] flex-col overflow-hidden rounded-3xl border border-white/15 bg-[#050f22] shadow-[0_14px_32px_rgba(2,8,23,0.45)] transition duration-200 lg:hover:border-white/30 lg:hover:shadow-[0_26px_48px_rgba(2,8,23,0.6)]">
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-gradient-to-br from-slate-900 via-slate-950 to-black">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-black" />
          {activeCandidate ? (
            <>
              {activeCandidate.fit === "contain" ? (
                <img
                  src={activeCandidate.src}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 h-full w-full scale-105 object-cover opacity-35 blur-2xl saturate-150"
                />
              ) : null}
              <ThumbnailImage
                key={activeCandidate.src}
                src={activeCandidate.src}
                fit={activeCandidate.fit}
                priority={priority}
                onFailure={() =>
                  setCandidateIndex(prev => {
                    const nextIndex = prev + 1;
                    return nextIndex < thumbnailCandidates.length
                      ? nextIndex
                      : thumbnailCandidates.length;
                  })
                }
              />
            </>
          ) : (
            <div className="relative z-20 flex h-full w-full items-center justify-center" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/20 to-transparent" />
          <div className="absolute left-3 top-3 z-20">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] ${statusPill.className}`}
            >
              {statusPill.dot ? (
                <span className="h-1.5 w-1.5 rounded-full bg-red-200 shadow-[0_0_8px_rgba(248,113,113,0.85)]" />
              ) : null}
              {statusPill.label}
            </span>
          </div>
        </div>
        <div className="flex flex-1 flex-col px-3 pb-3 pt-2">
          <h3 className="text-[15px] font-semibold leading-snug text-white sm:text-base min-h-[2.6rem] line-clamp-2">
            <span className="transition group-hover:text-white/95">{name}</span>
          </h3>
          <p className="mt-1 min-h-[1rem] text-xs text-slate-300/80 truncate">
            {metaLabel}
          </p>
        </div>
      </article>
    </Link>
  );
}
