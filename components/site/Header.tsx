import Image from "next/image";
import Link from "next/link";
import { ReactNode } from "react";

export default function Header(): ReactNode {
  return (
    <header
      role="banner"
      className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur container mx-auto px-4 py-3 flex items-center justify-between gap-3 mt-4 mb-6"
    >
      <Link href="/" aria-label="Home" className="inline-flex items-center gap-2">
        <Image
          src="/chessviewlive-logo.png"
          alt="Chessviewlive"
          width={112}
          height={28}
          className="h-7 w-auto"
          priority
        />
        <span className="sr-only">Chessviewlive</span>
      </Link>
      <span className="text-xs text-slate-200/60">Broadcast-quality chess viewing</span>
    </header>
  );
}
