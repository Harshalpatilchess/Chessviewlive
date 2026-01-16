// Centralized stubs and helpers for organizer pages.
// All functions/types here must be SSR-safe unless noted. No browser-only APIs at top-level.

export type PreflightStatus = { className: string; label: string };
export const preflightStatus: PreflightStatus = { className: '', label: 'Ready' }; // TODO: real status

export function getCode(): void { /* TODO: implement join code logic */ }
export function handleAdminLogout(): void { /* TODO: implement admin logout */ }

/**
 * Formats seconds as zero-padded mm:ss. Clamps negatives to 0.
 */
export function mmss(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function handleCamSelection(_id: string): void { /* TODO: implement camera selection */ }
export function handleVideoPresetChange(_preset: unknown): void { /* TODO: implement video preset change */ }
export function handleMicSelection(_id: string): void { /* TODO: implement mic selection */ }
export function handleEchoCancellationToggle(_checked: boolean): void { /* TODO: implement EC toggle */ }
export function handleNoiseSuppressionToggle(_checked: boolean): void { /* TODO: implement NS toggle */ }
export function handleAutoGainToggle(_checked: boolean): void { /* TODO: implement AGC toggle */ }
export function handleDetectDevices(): void { /* TODO: implement device detection */ }
export async function connectPublisher(): Promise<void> { /* TODO: implement connect publisher */ }
export function connectDisabled(..._args: unknown[]): boolean { return false; } // TODO: real logic
export function toggleManualLowBandwidth(): void { /* TODO: implement manual low bandwidth toggle */ }
export const RECONNECT_MAX_ATTEMPTS = 3; // TODO: tune as needed

/**
 * Returns Tailwind classes for a small rounded pill badge by quality level.
 */
export function qualityBadgeClassName(level: "low" | "medium" | "high"): string {
  switch (level) {
    case "low":
      return "px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 border border-yellow-300 text-xs font-semibold";
    case "medium":
      return "px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-300 text-xs font-semibold";
    case "high":
      return "px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-semibold";
    default:
      return "px-2 py-0.5 rounded-full bg-neutral-200 text-neutral-700 border border-neutral-300 text-xs font-semibold";
  }
}

/**
 * Returns a human label for the given quality level.
 */
export function qualityLabel(level: "low" | "medium" | "high"): string {
  switch (level) {
    case "low": return "Low";
    case "medium": return "Medium";
    case "high": return "High";
    default: return "Unknown";
  }
}

/**
 * Formats uplink bitrate as kbps or Mbps, or "—" if missing.
 */
export function formattedUplinkKbps(kbps?: number | null): string {
  if (typeof kbps !== "number" || isNaN(kbps) || kbps <= 0) return "—";
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

/**
 * Formats uplink loss percent, or "—" if missing.
 */
export function formattedUplinkLoss(lossPct?: number | null): string {
  if (typeof lossPct !== "number" || isNaN(lossPct) || lossPct < 0) return "—";
  return `${lossPct.toFixed(1)}%`;
}

/**
 * Returns a label for the number of viewers.
 */
export function viewersLabel(n: number): string {
  return `${n} viewer${n === 1 ? '' : 's'}`;
}

/**
 * Returns a label for the number of hosts.
 */
export function hostsLabel(n: number): string {
  return n > 0 ? `${n} host${n === 1 ? '' : 's'}` : '';
}

/**
 * Attempts to copy text to clipboard. SSR-safe, works in most browsers.
 */
export async function copy(text: string): Promise<boolean> {
  if (typeof window !== 'undefined' && navigator?.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  if (typeof window !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch {}
  }
  return false;
}

export function toggleMic(): void { /* TODO: implement mic toggle */ }
export function toggleCam(): void { /* TODO: implement cam toggle */ }
export function endBroadcast(): void { /* TODO: implement end broadcast */ }
export function handlePeekRefresh(): void { /* TODO: implement peek refresh */ }

/**
 * Returns a user-facing connection tip or null.
 */
export function showConnectionTip(isReconnecting: boolean, attempts: number, maxAttempts: number): string | null {
  if (!isReconnecting) return null;
  if (attempts < maxAttempts) return `Reconnecting… (attempt ${attempts} of ${maxAttempts})`;
  return "Connection unstable. Please check your network.";
}
