"use client";

/* eslint-disable @typescript-eslint/no-unused-vars */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import * as LK from "livekit-client";
import { CopyLinkChip } from "@/components/tournament/CopyLinkChip";
import { formatBoardLabel } from "@/lib/boardContext";
import { buildBoardPaths } from "@/lib/paths";
import { getTournamentBoardIds } from "@/lib/tournamentBoards";
import {
  abs,
  readProcessingSetting,
  readVideoPreset,
  ecKeyBoard,
  ecKeyGlobal,
  nsKeyBoard,
  nsKeyGlobal,
  agcKeyBoard,
  agcKeyGlobal,
  videoPresetKeyBoard,
  videoPresetKeyGlobal,
  type QualityLevel,
  type VideoPreset,
  attachLocalPreview,
  detachMeter,
  readMicDevice,
  readCamDevice,
} from "@/lib/mediaHelpers";
import {
  preflightStatus,
  getCode,
  handleAdminLogout,
  mmss,
  handleCamSelection,
  handleVideoPresetChange,
  handleMicSelection,
  handleEchoCancellationToggle,
  handleNoiseSuppressionToggle,
  handleAutoGainToggle,
  handleDetectDevices,
  connectPublisher,
  connectDisabled,
  toggleManualLowBandwidth,
  RECONNECT_MAX_ATTEMPTS,
  qualityBadgeClassName,
  qualityLabel,
  formattedUplinkKbps,
  formattedUplinkLoss,
  viewersLabel,
  hostsLabel,
  handlePeekRefresh,
  showConnectionTip,
  copy,
  toggleMic,
  toggleCam,
  endBroadcast
} from "@/lib/organizerHelpers";

export default function OrganizerBoardPage(props: { params: Promise<{ boardId: string }> }) {
  // --- State and refs ---
  const { boardId } = use(props.params);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const autoRetryEnabled = useMemo(() => {
    const raw = searchParams?.get("autoretry");
    if (raw === null || raw === undefined) return true;
    return !["0", "false"].includes(raw.toLowerCase());
  }, [searchParams]);
  const tournamentId = useMemo(() => {
    if (!pathname) return undefined;
    const match = pathname.match(/^\/t\/([^/]+)/);
    if (!match) return undefined;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }, [pathname]);
  const tournamentBoardIds = useMemo(() => {
    if (!tournamentId) return null;
    return getTournamentBoardIds(tournamentId);
  }, [tournamentId]);
  const organizerBoardOptions = useMemo(() => {
    if (!tournamentId || !tournamentBoardIds || tournamentBoardIds.length === 0) return null;
    return tournamentBoardIds.map(id => {
      const trimmed = id.trim();
      const paths = buildBoardPaths(trimmed, tournamentId);
      return {
        boardId: trimmed,
        label: formatBoardLabel(trimmed),
        href: paths.organizer,
      };
    });
  }, [tournamentId, tournamentBoardIds]);
  const isTournamentBoardConfigured = useMemo(() => {
    if (!tournamentId) return true;
    if (!tournamentBoardIds || tournamentBoardIds.length === 0) return false;
    const normalized = boardId.trim().toLowerCase();
    return tournamentBoardIds.some(id => id.trim().toLowerCase() === normalized);
  }, [tournamentBoardIds, tournamentId, boardId]);
  const boardPaths = useMemo(() => buildBoardPaths(boardId, tournamentId), [boardId, tournamentId]);
  const tournamentHref = useMemo(() => {
    if (!tournamentId) return undefined;
    try {
      return `/t/${encodeURIComponent(tournamentId)}`;
    } catch {
      return `/t/${tournamentId}`;
    }
  }, [tournamentId]);
  const liveUrl = useMemo(() => abs(boardPaths.live), [boardPaths.live]);
  const replayUrl = useMemo(() => abs(boardPaths.replay), [boardPaths.replay]);
  const allowStatsOverlay =
    (typeof searchParams?.get === "function" && searchParams.get("debug") === "1") ||
    (typeof process !== "undefined" && process.env.ALLOW_DEV_STATS_OVERLAY === "true");
  const [adminPassword, setAdminPassword] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [exp, setExp] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [enterCode, setEnterCode] = useState("");
  const [pubStatus, setPubStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const roomRef = useRef<LK.Room | null>(null);
  const localPreviewRef = useRef<HTMLDivElement | null>(null);
  const detachLocal = useRef<(() => void) | null>(null);
  const audioTrackRef = useRef<LK.LocalAudioTrack | null>(null);
  const videoTrackRef = useRef<LK.LocalVideoTrack | null>(null);
  const audioPubRef = useRef<LK.LocalTrackPublication | null>(null);
  const videoPubRef = useRef<LK.LocalTrackPublication | null>(null);
  const lastWorkingMicRef = useRef<string>("");
  const lastWorkingCamRef = useRef<string>("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [recording, setRecording] = useState<"off" | "starting" | "on" | "stopping">("off");
  const stoppingRef = useRef(false);
  const [copied, setCopied] = useState<"" | "live" | "replay">("");
  const [qrLive, setQrLive] = useState<string>("");
  const [qrReplay, setQrReplay] = useState<string>("");
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [selCam, setSelCam] = useState<string>("");
  const [selMic, setSelMic] = useState<string>("");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [isSelectedMicMissing, setIsSelectedMicMissing] = useState(false);
  const [isSelectedCamMissing, setIsSelectedCamMissing] = useState(false);
  const [isRefreshingDevices, setIsRefreshingDevices] = useState(false);
  const [isSwitchingMic, setIsSwitchingMic] = useState(false);
  const [isSwitchingCam, setIsSwitchingCam] = useState(false);
  const [micSwitchStatus, setMicSwitchStatus] = useState<"fallback" | "error" | null>(null);
  const [camSwitchStatus, setCamSwitchStatus] = useState<"fallback" | "error" | null>(null);
  const loadDevicesRef = useRef<(options?: { fallbackOnMissing?: boolean }) => Promise<void>>(undefined);
  const pubStatusRef = useRef(pubStatus);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const meterRAFRef = useRef<number | null>(null);
  const meterLastSampleRef = useRef<number>(0);
  const meterPreviewTrackRef = useRef<MediaStreamTrack | null>(null);
  const previewTimeoutRef = useRef<number | null>(null);
  const [meterLevel, setMeterLevel] = useState(0);
  const [useEC, setUseEC] = useState<boolean>(() => readProcessingSetting(ecKeyBoard(boardId), ecKeyGlobal()));
  const [useNS, setUseNS] = useState<boolean>(() => readProcessingSetting(nsKeyBoard(boardId), nsKeyGlobal()));
  const [useAGC, setUseAGC] = useState<boolean>(() => readProcessingSetting(agcKeyBoard(boardId), agcKeyGlobal()));
  const processingDirtyRef = useRef(false);
  const [videoPreset, setVideoPreset] = useState<VideoPreset>(() =>
    readVideoPreset(videoPresetKeyBoard(boardId), videoPresetKeyGlobal())
  );
  const videoPresetDirtyRef = useRef(false);
  const [appliedVideoSettings, setAppliedVideoSettings] = useState<{
    width?: number;
    height?: number;
    frameRate?: number;
  } | null>(null);
  const appliedVideoWidth = appliedVideoSettings?.width;
  const appliedVideoHeight = appliedVideoSettings?.height;
  const appliedVideoFrameRate = appliedVideoSettings?.frameRate;
  const appliedVideoSummary =
    typeof appliedVideoWidth === "number" && typeof appliedVideoHeight === "number" && typeof appliedVideoFrameRate === "number"
      ? ` · ${appliedVideoWidth}×${appliedVideoHeight}@${Math.round(appliedVideoFrameRate)}`
      : "";
  const [connQuality, setConnQuality] = useState<QualityLevel>("unknown");
  const [uplinkKbps, setUplinkKbps] = useState<number | null>(null);
  const [uplinkLoss, setUplinkLoss] = useState<number | null>(null);
  const statsIntervalRef = useRef<number | null>(null);
  const prevStatsRef = useRef<
    Record<string, { bytesSent: number; timestamp: number; packetsSent: number; packetsLost: number }>
  >({});
  const qualityParticipantRef = useRef<LK.LocalParticipant | null>(null);
  const qualityHandlerRef = useRef<((quality: LK.ConnectionQuality) => void) | null>(null);
  const [viewerCount, setViewerCount] = useState<number | null>(null);
  const [publisherCount, setPublisherCount] = useState<number | null>(null);
  const [hasPublisher, setHasPublisher] = useState<boolean | null>(null);
  const [isPeekRefreshing, setIsPeekRefreshing] = useState(false);
  const peekIntervalRef = useRef<number | null>(null);
  const peekBackoffMsRef = useRef(0);
  const peekFetchBusyRef = useRef(false);
  const peekAbortControllerRef = useRef<AbortController | null>(null);
  const manualPeekControllersRef = useRef<Set<AbortController>>(new Set());
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [rememberAdmin, setRememberAdmin] = useState(false);
  const [endStatus, setEndStatus] = useState<"idle" | "ending" | "ended">("idle");
  const [endError, setEndError] = useState<string | null>(null);
  const endStatusTimeoutRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const autoRetryEnabledRef = useRef(autoRetryEnabled);
  const reconnectAttemptRef = useRef(0);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const manualDisconnectRef = useRef(false);
  const userEndedRef = useRef(false);
  const autoReconnectActiveRef = useRef(false);
  const connectingRef = useRef(false);
  const connectPublisherRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const desiredMicOnRef = useRef(micOn);
  const desiredCamOnRef = useRef(camOn);
  const manualLowBwKey = `cv:lowbw:org:${boardId}`;
  const [manualLowBandwidth, setManualLowBandwidth] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(manualLowBwKey) === "1";
    } catch {
      return false;
    }
  });
  const manualLowBandwidthRef = useRef(manualLowBandwidth);
  const autoLowBandwidthRef = useRef(false);
  const [lowBandwidthActive, setLowBandwidthActive] = useState(manualLowBandwidth);
  const lowBandwidthActiveRef = useRef(lowBandwidthActive);
  const poorQualityTimeoutRef = useRef<number | null>(null);
  const qualityRecoveryTimeoutRef = useRef<number | null>(null);
  const lowBitrateTimeoutRef = useRef<number | null>(null);
  const bitrateRecoveryTimeoutRef = useRef<number | null>(null);
  const [debugStats, setDebugStats] = useState<{
    bitrateKbps: number | null;
    packetLossPct: number | null;
    rttMs: number | null;
    quality: QualityLevel;
  }>({
    bitrateKbps: null,
    packetLossPct: null,
    rttMs: null,
    quality: "unknown",
  });
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );
  const isOfflineRef = useRef(isOffline);
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => { setIsHydrated(true); }, []);

  const connectButtonDisabled = connectDisabled();
  const qualityBadgeLevel: "low" | "medium" | "high" =
    connQuality === "unknown" ? "low" : connQuality;
  const qualityLabelText = qualityLabel(qualityBadgeLevel);
  const uplinkKbpsLabel = formattedUplinkKbps(uplinkKbps);
  const uplinkLossLabel = formattedUplinkLoss(uplinkLoss);
  const hasUplinkKbpsLabel = uplinkKbpsLabel !== "—";
  const hasUplinkLossLabel = uplinkLossLabel !== "—";
  const viewersLabelText =
    typeof viewerCount === "number" ? viewersLabel(viewerCount) : null;
  const hostsLabelText =
    typeof publisherCount === "number" ? hostsLabel(publisherCount) : null;
  const connectionTip = showConnectionTip(
    reconnectAttempt > 0,
    reconnectAttempt,
    RECONNECT_MAX_ATTEMPTS
  );

  // --- Component JSX ---
  if (tournamentId && !isTournamentBoardConfigured) {
    return (
      <main className="container mx-auto p-4">
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-700 space-y-3">
          <h1 className="text-lg font-semibold text-neutral-900">This board is not configured for this tournament.</h1>
          <p>Update your tournament board settings or choose another board below.</p>
          {tournamentHref && (
            <Link
              href={tournamentHref}
              className="inline-flex items-center gap-1 rounded border border-blue-200 px-3 py-1 text-blue-700 transition hover:bg-blue-50"
            >
              ← Go to the tournament hub
            </Link>
          )}
          {organizerBoardOptions && (
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Available boards</div>
              <div className="flex flex-wrap gap-2">
                {organizerBoardOptions.map(option => (
                  <Link
                    key={option.boardId}
                    href={option.href}
                    className="rounded border border-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100"
                  >
                    Organizer for {option.label}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto p-4">
      <div className="text-sm opacity-70">Organizer</div>
      <h1 className="text-2xl font-semibold mb-2">/organizer/{boardId}</h1>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
        <span className={`rounded px-2 py-1 font-semibold ${preflightStatus.className}`}>
          {preflightStatus.label}
        </span>
        <CopyLinkChip
          label="Copy viewer link"
          href={boardPaths.live}
          tone="neutral"
          className="font-semibold"
        />
        <Link
          href={boardPaths.replay}
          className="rounded px-2 py-1 border border-neutral-400/70 font-semibold hover:bg-neutral-100 transition"
        >
          Past replays
        </Link>
      </div>
      <div className="rounded-xl border p-4 space-y-3">
        <div className="text-sm">Enter admin password to mint a 6-digit join code (valid 10 min).</div>
        <div className="flex gap-2 flex-wrap items-start">
          {isAdmin === true ? null : (
            <div className="flex flex-col">
              <input
                className="border rounded px-3 py-2 w-64"
                type="password"
                placeholder="Admin password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm text-neutral-500 mt-1">
                <input
                  type="checkbox"
                  checked={rememberAdmin}
                  onChange={(e) => setRememberAdmin(e.target.checked)}
                />
                <span>Remember me (12h)</span>
              </label>
            </div>
          )}
          <button className="border rounded px-3 py-2 h-fit" onClick={getCode}>
            Get join code
          </button>
        </div>
        {isAdmin === true && (
          <div className="flex items-center gap-3 text-xs text-neutral-500 mt-1">
            <span>Admin session active</span>
            <button
              type="button"
              className="text-neutral-500 underline decoration-dotted hover:text-neutral-700"
              onClick={() => {
                void handleAdminLogout();
              }}
            >
              Sign out admin
            </button>
          </div>
        )}
        {error && <div className="text-red-600 text-sm">Error: {error}</div>}
        {code && (
          <div className="mt-2">
            <div className="text-sm opacity-70">Give this code to the publisher device:</div>
            <div className="text-4xl font-mono tracking-widest">{code}</div>
            <div className="text-xs opacity-70 mt-1">Expires in {mmss(left)}</div>
          </div>
        )}
      </div>
      {allowStatsOverlay && (
        <div className="fixed bottom-2 left-2 bg-black/70 text-white text-[10px] font-mono px-2 py-1 rounded pointer-events-none select-none opacity-70">
          <div>Q: {debugStats.quality}</div>
          <div>Bitrate: {debugStats.bitrateKbps ? Math.round(debugStats.bitrateKbps) : "-"} kbps</div>
          <div>Loss: {debugStats.packetLossPct != null ? Math.round(debugStats.packetLossPct) : "-"}%</div>
          <div>RTT: {debugStats.rttMs != null ? debugStats.rttMs : "-"} ms</div>
        </div>
      )}

      <div className="rounded-xl border p-4 space-y-3 mt-4">
        <div className="text-sm">Devices</div>
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex flex-col">
            <label className="text-xs opacity-70 mb-1">Camera</label>
            <select
              className="border rounded px-3 py-2 min-w-56"
              value={selCam}
              onChange={(e) => handleCamSelection(e.target.value)}
            >
              <option value="">{cams.length ? "Default camera" : "No cameras detected"}</option>
              {cams.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "Camera"}
                </option>
              ))}
            </select>
            {cams.length === 0 && <div className="text-xs opacity-70 mt-1">No cameras found.</div>}
            {isSelectedCamMissing && (
              <p className="text-xs text-amber-600 mt-1">Previously selected camera is unavailable. Pick another.</p>
            )}
            {isSwitchingCam && <span className="text-xs text-neutral-500 mt-1">Switching camera…</span>}
            {camSwitchStatus === "fallback" && (
              <span className="text-xs text-neutral-500 mt-1">Switched camera after a quick restart.</span>
            )}
            {camSwitchStatus === "error" && (
              <span className="text-xs text-amber-600 mt-1">Couldn&rsquo;t switch. Check permissions or try Detect devices.</span>
            )}
            <div className="mt-2 flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="cv-video-preset"
                  value="low"
                  checked={videoPreset === "low"}
                  onChange={() => handleVideoPresetChange("low")}
                />
                <span title="640×360 ~15fps · lowest data">Low</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="cv-video-preset"
                  value="standard"
                  checked={videoPreset === "standard"}
                  onChange={() => handleVideoPresetChange("standard")}
                />
                <span title="1280×720 ~30fps · balanced">Standard</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="cv-video-preset"
                  value="high"
                  checked={videoPreset === "high"}
                  onChange={() => handleVideoPresetChange("high")}
                />
                <span title="1920×1080 ~30fps · highest data">High</span>
              </label>
            </div>
            <p className="text-[10px] text-neutral-500 mt-1">
              Preset: {videoPreset}
              {appliedVideoSummary}
            </p>
          </div>
          <div className="flex flex-col">
            <label className="text-xs opacity-70 mb-1">Microphone</label>
            <select
              className="border rounded px-3 py-2 min-w-56"
              value={selMic}
              onChange={(e) => handleMicSelection(e.target.value)}
            >
              <option value="">{mics.length ? "Default microphone" : "No microphones detected"}</option>
              {mics.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "Microphone"}
                </option>
              ))}
            </select>
            {mics.length === 0 && <div className="text-xs opacity-70 mt-1">No microphones found.</div>}
            {isSelectedMicMissing && (
              <p className="text-xs text-amber-600 mt-1">Previously selected microphone is unavailable. Pick another.</p>
            )}
            {isSwitchingMic && <span className="text-xs text-neutral-500 mt-1">Switching mic…</span>}
            {micSwitchStatus === "fallback" && (
              <span className="text-xs text-neutral-500 mt-1">Switched microphone after a quick restart.</span>
            )}
            {micSwitchStatus === "error" && (
              <span className="text-xs text-amber-600 mt-1">Couldn&rsquo;t switch. Check permissions or try Detect devices.</span>
            )}
            <div className="mt-1 h-1.5 w-full bg-neutral-200 rounded">
              <div
                className="h-1.5 bg-emerald-500 rounded transition-[width] duration-100"
                style={{ width: `${meterLevel}%` }}
                aria-label="Mic level"
              />
            </div>
            <p className="text-[10px] text-neutral-500 mt-1">Test mic level</p>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useEC}
                  onChange={(e) => handleEchoCancellationToggle(e.target.checked)}
                />
                <span title="Reduce echo from speakers">Echo cancellation</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useNS}
                  onChange={(e) => handleNoiseSuppressionToggle(e.target.checked)}
                />
                <span title="Filter steady background noise">Noise suppression</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useAGC}
                  onChange={(e) => handleAutoGainToggle(e.target.checked)}
                />
                <span title="Automatic microphone volume">Auto gain</span>
              </label>
            </div>
          </div>
          <button className="border rounded px-3 py-2" onClick={handleDetectDevices}>
            Detect devices
          </button>
          {isRefreshingDevices && <span className="text-xs text-neutral-500 ml-2">Refreshing devices…</span>}
        </div>
        <div className="text-xs opacity-70">Tip: click &quot;Detect devices&quot; once to allow permissions and see device names.</div>
        {permissionDenied && (
          <div className="text-xs opacity-70">
            Permission denied. Tap &quot;Detect devices&quot; and allow mic/camera.
          </div>
        )}
      </div>

      <div className="rounded-xl border p-4 space-y-3 mt-4">
        <div className="text-sm">Enter the 6-digit join code on the publishing device and connect:</div>
        <div className="flex gap-2 flex-wrap">
          <input
            className="border rounded px-3 py-2 w-40"
            placeholder="Join code"
            value={enterCode}
            onChange={(e) => setEnterCode(e.target.value)}
          />
          <button
            className="border rounded px-3 py-2"
            onClick={connectPublisher}
            disabled={connectButtonDisabled}
            aria-disabled={connectButtonDisabled}
            title={connectButtonDisabled ? "Connect disabled until devices are available" : undefined}
          >
            Connect as publisher
          </button>
          <button
            type="button"
            className="border rounded px-3 py-2 text-xs"
            onClick={toggleManualLowBandwidth}
            aria-pressed={manualLowBandwidth}
            title="Toggle Low Bandwidth Mode"
          >
            Low BW
          </button>
        </div>
        <div className="text-sm opacity-70" suppressHydrationWarning>
          {isHydrated ? <>Status: <b>{pubStatus}</b></> : 'Status: …'}
        </div>
        {isHydrated && isOffline && (
          <div className="text-xs text-neutral-500">Offline — waiting for network…</div>
        )}
        {isHydrated && reconnectAttempt > 0 && reconnectAttempt <= RECONNECT_MAX_ATTEMPTS && pubStatus !== "connected" && (
          <div className="text-xs text-neutral-500">
            Reconnecting… (attempt {Math.min(reconnectAttempt, RECONNECT_MAX_ATTEMPTS)}/{RECONNECT_MAX_ATTEMPTS})
          </div>
        )}
        <div className="text-sm opacity-70" suppressHydrationWarning>
          {isHydrated ? <>Recording: <b>{recording}</b></> : 'Recording: …'}
        </div>
        <div className="mt-1 text-xs inline-flex items-center gap-2 flex-wrap" suppressHydrationWarning>
          {isHydrated ? (
            <>
              <span className={qualityBadgeClassName(qualityBadgeLevel)}>{qualityLabelText}</span>
              {hasUplinkKbpsLabel && (
                <span className="text-neutral-500">↑ {uplinkKbpsLabel}</span>
              )}
              {hasUplinkLossLabel && (
                <span className="text-neutral-500">loss {uplinkLossLabel}</span>
              )}
              {lowBandwidthActive && (
                <span className="px-2 py-0.5 rounded bg-neutral-200 text-neutral-600">
                  Low Bandwidth Mode (360p)
                </span>
              )}
            </>
          ) : null}
        </div>
        <div className="mt-1 text-xs flex flex-wrap items-center gap-2" suppressHydrationWarning>
          {isHydrated ? (
            <>
              {viewersLabelText && (
                <span className="px-2 py-0.5 rounded bg-neutral-200 text-neutral-700">
                  {viewersLabelText}
                </span>
              )}
              {hostsLabelText && (
                <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-600">
                  {hostsLabelText}
                </span>
              )}
              {hasPublisher === false && (
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700">No publisher</span>
              )}
              {isPeekRefreshing && <span className="text-neutral-500">refreshing…</span>}
              <button
                type="button"
                className="text-[10px] text-neutral-500 underline decoration-dotted disabled:opacity-50"
                onClick={handlePeekRefresh}
                disabled={isPeekRefreshing}
              >
                Refresh
              </button>
            </>
          ) : null}
        </div>
        {isHydrated && connectionTip && (
          <p className="text-[10px] text-amber-600 mt-1">{connectionTip}</p>
        )}
      </div>

      <div className="rounded-xl border p-2 mt-4">
        <div className="text-sm opacity-70 mb-2">Share</div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="border rounded px-3 py-2"
            onClick={() => copy(liveUrl)}
          >
            {copied === "live" ? "Copied Live Link" : "Copy Live Link"}
          </button>
          <button
            className="border rounded px-3 py-2"
            onClick={() => copy(replayUrl)}
          >
            {copied === "replay" ? "Copied Replay Link" : "Copy Replay Link"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border p-2 mt-4">
        <div className="text-sm opacity-70 mb-2">Share via QR</div>
        <div className="flex gap-6 flex-wrap items-start">
          <div className="flex flex-col items-center gap-2">
            <div className="text-xs opacity-70">Live</div>
            {qrLive && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrLive} alt="Live QR" className="border rounded p-2" width={200} height={200} />
              </>
            )}
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="text-xs opacity-70">Replay</div>
            {qrReplay && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrReplay} alt="Replay QR" className="border rounded p-2" width={200} height={200} />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border p-2 mt-4">
        <div className="text-sm opacity-70 mb-2">Local preview</div>
        <div ref={localPreviewRef} className="flex flex-col gap-2" />
        <div className="flex gap-2 mt-2">
          <button className="border rounded px-3 py-2" onClick={toggleMic}>
            {micOn ? "Mute mic" : "Unmute mic"}
          </button>
          <button className="border rounded px-3 py-2" onClick={toggleCam}>
            {camOn ? "Turn camera off" : "Turn camera on"}
          </button>
        </div>
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <button
              className="border rounded px-3 py-2"
              onClick={endBroadcast}
              disabled={pubStatus !== "connected" || endStatus === "ending"}
              aria-disabled={pubStatus !== "connected" || endStatus === "ending"}
              title={pubStatus === "connected" ? "End broadcast" : "Not connected"}
            >
              {endStatus === "ending"
                ? "Ending…"
                : pubStatus === "connected"
                  ? "End Broadcast"
                  : "End Broadcast (not connected)"}
            </button>
            {endStatus === "ending" && <span className="text-xs text-neutral-500">Ending…</span>}
            {endStatus === "ended" && <span className="text-xs text-neutral-500">Ended</span>}
            {endError && <span className="text-xs text-red-600">Failed: {endError}</span>}
          </div>
        </div>
      </div>
    </main>
  );
}
