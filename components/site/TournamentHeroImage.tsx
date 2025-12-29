"use client";

import { useState } from "react";
import Image from "next/image";

type TournamentHeroImageProps = {
  src: string;
  alt: string;
  priority?: boolean;
  sizes?: string;
  className?: string;
};

export default function TournamentHeroImage({
  src,
  alt,
  priority,
  sizes,
  className,
}: TournamentHeroImageProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError) return null;

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={className}
      onError={() => setHasError(true)}
    />
  );
}
