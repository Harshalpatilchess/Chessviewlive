import { useEffect, useRef, useState } from "react";

type TweenOptions = {
  durationMs?: number;
};

const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export default function useTweenedNumber(target: number | null, options: TweenOptions = {}) {
  const durationMs = typeof options.durationMs === "number" && Number.isFinite(options.durationMs)
    ? Math.max(50, Math.min(1000, options.durationMs))
    : 200;

  const [animated, setAnimated] = useState<number | null>(target);
  const previousTargetRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (target == null || !Number.isFinite(target)) {
      previousTargetRef.current = null;
      setAnimated(null);
      return;
    }

    const previousTarget = previousTargetRef.current;
    previousTargetRef.current = target;

    if (previousTarget == null || !Number.isFinite(previousTarget) || previousTarget === target) {
      setAnimated(target);
      return;
    }

    const from = previousTarget;
    const to = target;
    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.max(0, Math.min(1, elapsed / durationMs));
      const eased = easeInOutQuad(t);
      setAnimated(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [durationMs, target]);

  return animated;
}

