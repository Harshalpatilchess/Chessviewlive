"use client";

import { useEffect, useState } from "react";
import EvalBar from "@/components/live/EvalBar";
import type { EvaluationAdvantage } from "@/lib/engine/evalMapping";
import useTweenedNumber from "@/lib/hooks/useTweenedNumber";

type MainEvalBarProps = {
  value: number | null | undefined;
  label?: string | null;
  advantage?: EvaluationAdvantage;
  show: boolean;
  orientation?: "white" | "black";
};

const clampValue = (val: number | null | undefined) => {
  if (typeof val !== "number" || !Number.isFinite(val)) return null;
  return Math.min(100, Math.max(0, val));
};

const normalizeLabel = (label?: string | null) => {
  if (!label || !label.trim().length) return "-";
  return label.trim();
};

const parseEvalNumber = (label: string): number | null => {
  if (typeof label !== "string") return null;
  if (!label.trim().length) return null;
  if (/m\d+/i.test(label)) return null;
  const parsed = Number.parseFloat(label);
  return Number.isFinite(parsed) ? parsed : null;
};

const deriveAdvantageFromValue = (val: number | null | undefined): EvaluationAdvantage => {
  if (typeof val !== "number" || !Number.isFinite(val)) return null;
  if (val > 50) return "white";
  if (val < 50) return "black";
  return "equal";
};

const MainEvalBar = ({
  value,
  label,
  advantage,
  show,
  orientation = "white",
}: MainEvalBarProps) => {
  const [displayValue, setDisplayValue] = useState<number | null>(null);
  const [displayLabel, setDisplayLabel] = useState<string>("-");
  const [displayAdvantage, setDisplayAdvantage] = useState<EvaluationAdvantage>(null);
  const [targetLabelNumber, setTargetLabelNumber] = useState<number | null>(null);
  const animatedValue = useTweenedNumber(displayValue, { durationMs: 200 });
  const animatedLabelNumber = useTweenedNumber(targetLabelNumber, { durationMs: 200 });

  useEffect(() => {
    if (!show) return;
    const nextValue = clampValue(value);
    const nextLabel = normalizeLabel(label);
    if (nextValue == null || nextLabel === "-") return;
    setDisplayValue(nextValue);
    setDisplayLabel(nextLabel);
    setDisplayAdvantage(advantage ?? deriveAdvantageFromValue(nextValue));
    setTargetLabelNumber(parseEvalNumber(nextLabel));
  }, [advantage, label, show, value]);

  useEffect(() => {
    if (!show || process.env.NODE_ENV === "production") return;
    console.log("[UI] Main eval bar props", {
      rawValue: value,
      rawLabel: label,
      rawAdvantage: advantage,
      displayValue,
      displayLabel,
      displayAdvantage,
      orientation,
    });
  }, [advantage, displayAdvantage, displayLabel, displayValue, label, orientation, show, value]);
  useEffect(() => {
    if (!show || process.env.NODE_ENV === "production") return;
    console.log("[EVAL BAR] input eval", { value, displayValue, label, displayLabel });
  }, [displayLabel, displayValue, label, show, value]);

  if (!show) return null;
  if (displayValue == null || displayLabel === "-") return null;
  const barValue = typeof animatedValue === "number" ? animatedValue : displayValue;
  const barLabel = (() => {
    if (typeof animatedLabelNumber === "number" && Number.isFinite(animatedLabelNumber)) {
      const rounded = Math.round(animatedLabelNumber * 10) / 10;
      return rounded.toFixed(1);
    }
    return displayLabel;
  })();
  const barAdvantage = displayAdvantage ?? deriveAdvantageFromValue(barValue) ?? "equal";

  return (
    <div className="hidden min-h-[320px] md:flex flex-col items-center justify-center">
      <EvalBar
        value={barValue}
        scoreLabel={barLabel}
        advantage={barAdvantage}
        orientation={orientation}
      />
    </div>
  );
};

export default MainEvalBar;
