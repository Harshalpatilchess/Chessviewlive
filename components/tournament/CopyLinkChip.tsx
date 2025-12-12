"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Tone = "primary" | "neutral" | "overlay";

type CopyLinkChipProps = {
  label: string;
  path?: string;
  href?: string;
  tone?: Tone;
  className?: string;
};

const COPY_RESET_DELAY = 1300;

export function CopyLinkChip({ label, path, href, tone = "primary", className }: CopyLinkChipProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const targetPath = path ?? href;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!targetPath || typeof window === "undefined") return;
    const absoluteUrl = buildAbsoluteUrl(targetPath);
    if (!absoluteUrl) return;
    let success = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(absoluteUrl);
        success = true;
      }
    } catch (err) {
      console.info("[copy_link_chip] clipboard_write_failed", err);
    }
    if (!success) {
      try {
        if (typeof window.prompt === "function") {
          window.prompt("Copy link", absoluteUrl);
          success = true;
        }
      } catch (err) {
        console.info("[copy_link_chip] prompt_failed", err);
      }
    }
    if (success) {
      setCopied(true);
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        timeoutRef.current = null;
      }, COPY_RESET_DELAY);
    }
  }, [targetPath]);

  if (!targetPath) {
    return null;
  }

  const buttonClassName = getButtonClassName(tone);
  const inlineIndicatorClassName = getIndicatorClassName(tone);
  const wrapperClassName = ["inline-flex items-center gap-1", className].filter(Boolean).join(" ");

  const button = (
    <button type="button" onClick={handleCopy} className={buttonClassName}>
      <span className="inline-flex items-center gap-1">
        {label}
        {tone !== "overlay" && copied && (
          <span className={inlineIndicatorClassName}>Copied!</span>
        )}
      </span>
    </button>
  );

  if (tone === "overlay") {
    return (
      <span className={wrapperClassName}>
        {button}
        {copied && <span className={inlineIndicatorClassName}>Copied!</span>}
      </span>
    );
  }

  return <span className={wrapperClassName}>{button}</span>;
}

function buildAbsoluteUrl(path: string) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseEnv = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${normalizedPath}`;
  }
  if (baseEnv) {
    return `${baseEnv}${normalizedPath}`;
  }
  return normalizedPath;
}

function getButtonClassName(tone: Tone) {
  switch (tone) {
    case "neutral":
      return "pointer-events-auto rounded border border-neutral-200 px-2 py-0.5 text-neutral-700 transition hover:bg-neutral-100";
    case "overlay":
      return "pointer-events-auto inline-flex items-center gap-1 rounded bg-black/50 px-2 py-0.5 text-white/90 transition hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70";
    case "primary":
    default:
      return "pointer-events-auto rounded border border-blue-200 px-2 py-0.5 text-blue-700 transition hover:bg-blue-50";
  }
}

function getIndicatorClassName(tone: Tone) {
  switch (tone) {
    case "overlay":
      return "text-emerald-200 text-[11px] font-medium";
    default:
      return "text-[11px] font-medium text-emerald-600";
  }
}
