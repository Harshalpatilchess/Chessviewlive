import { NextRequest, NextResponse } from "next/server";
import { WebhookReceiver, WebhookEvent } from "livekit-server-sdk";
import S3 from "aws-sdk/clients/s3";
import { RecordingManifest, manifestKey, stampNow } from "@/lib/recordingManifest";

// TODO: Migrate to AWS SDK v3 later.

type ManifestState = {
  key: string;
  boardId: string;
  stamp: string;
  startedAt: string;
};

type FileResult = {
  file?: {
    filename?: string;
    filepath?: string;
    size?: number;
  };
  filepath?: string;
  size?: number;
};

declare global {
  var __cv_recording__: Set<string> | undefined;
  var __cv_manifest_state__: Map<string, ManifestState> | undefined;
}

const key = process.env.LIVEKIT_WEBHOOK_API_KEY!;
const secret = process.env.LIVEKIT_WEBHOOK_API_SECRET!;
const receiver = new WebhookReceiver(key, secret);
export const runtime = "nodejs";

const recordingRooms = globalThis.__cv_recording__ ?? new Set<string>();
if (!globalThis.__cv_recording__) globalThis.__cv_recording__ = recordingRooms;

const manifestState = globalThis.__cv_manifest_state__ ?? new Map<string, ManifestState>();
if (!globalThis.__cv_manifest_state__) globalThis.__cv_manifest_state__ = manifestState;

const s3Enabled =
  process.env.S3_BUCKET &&
  (process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID) &&
  (process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY);

const s3 =
  s3Enabled &&
  new S3({
    region: process.env.S3_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || "",
    },
  });

function resolveBase(req: NextRequest) {
  const env = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

function log(...args: unknown[]) {
  console.log("[lk-webhook]", ...args);
}

async function startEgress(room: string, base: string, event?: WebhookEvent) {
  if (recordingRooms.has(room)) return;
  try {
    await fetch(`${base}/api/egress/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ room }),
    });
    recordingRooms.add(room);
    log("egress_start_requested", { room });
    if (event) {
      await ensureManifestStart(event);
    }
  } catch (error) {
    log("egress_start_failed", String(error));
    if (event) {
      manifestState.delete(room);
    }
  }
}

async function stopEgress(room: string, base: string) {
  if (!recordingRooms.has(room)) return;
  try {
    await fetch(`${base}/api/egress/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ room }),
    });
    recordingRooms.delete(room);
    log("egress_stop_requested", { room });
  } catch (error) {
    log("egress_stop_failed", String(error));
  }
}

async function writeManifest(keyStr: string, manifest: RecordingManifest, tagging?: string) {
  if (!s3 || !process.env.S3_BUCKET) return;
  const body = JSON.stringify(manifest, null, 2);
  try {
    await s3
      .putObject({
        Bucket: process.env.S3_BUCKET,
        Key: keyStr,
        Body: body,
        ContentType: "application/json",
        Tagging: tagging,
      })
      .promise();
    if (process.env.NODE_ENV !== "production") {
      console.info("[lk-webhook] manifest:write", { key: keyStr });
    }
  } catch (err) {
    console.warn("[lk-webhook] manifest_write_failed", keyStr, err);
  }
}

async function readManifest(keyStr: string) {
  if (!s3 || !process.env.S3_BUCKET) return null;
  try {
    const obj = await s3
      .getObject({
        Bucket: process.env.S3_BUCKET,
        Key: keyStr,
      })
      .promise();
    const text = obj.Body?.toString("utf-8") || "";
    if (!text) return null;
    const parsed = JSON.parse(text) as RecordingManifest;
    return parsed;
  } catch (err) {
    console.warn("[lk-webhook] manifest_read_failed", keyStr, err);
    return null;
  }
}

function extractBoardInfo(event: WebhookEvent) {
  const roomId = event.room?.name || "";
  let boardId = roomId;
  let tournamentId: string | undefined;
  const metadata = event.room?.metadata;
  if (metadata) {
    try {
      const parsed = JSON.parse(metadata);
      if (typeof parsed?.boardId === "string") {
        boardId = parsed.boardId;
      }
      if (typeof parsed?.tournamentId === "string") {
        tournamentId = parsed.tournamentId;
      }
    } catch (err) {
      console.warn("[lk-webhook] metadata_parse_failed", err);
    }
  }
  return { boardId, tournamentId };
}

function normalizeFileResult(entry: unknown): FileResult | null {
  if (!entry || typeof entry !== "object") return null;
  const base = entry as Record<string, unknown>;
  const fileValue = base.file;
  let file: FileResult["file"];
  if (fileValue && typeof fileValue === "object") {
    const fileObj = fileValue as Record<string, unknown>;
    file = {
      filename: typeof fileObj.filename === "string" ? fileObj.filename : undefined,
      filepath: typeof fileObj.filepath === "string" ? fileObj.filepath : undefined,
      size: typeof fileObj.size === "number" ? fileObj.size : undefined,
    };
  }
  return {
    file,
    filepath: typeof base.filepath === "string" ? base.filepath : undefined,
    size: typeof base.size === "number" ? base.size : undefined,
  };
}

function collectFileResults(event: WebhookEvent): FileResult[] {
  const info = event.egressInfo as
    | { fileResults?: unknown; fileResult?: unknown }
    | undefined
    | null;
  if (!info) return [] as FileResult[];
  const results: FileResult[] = [];
  if (Array.isArray(info.fileResults)) {
    for (const entry of info.fileResults) {
      const normalized = normalizeFileResult(entry);
      if (normalized) results.push(normalized);
    }
  }
  if (info.fileResult) {
    const normalized = normalizeFileResult(info.fileResult);
    if (normalized) results.push(normalized);
  }
  return results;
}

async function ensureManifestStart(event: WebhookEvent): Promise<void> {
  if (!s3 || !process.env.S3_BUCKET) return;
  const roomId = event.room?.name || "";
  if (!roomId) return;
  if (manifestState.has(roomId)) return;

  const { boardId, tournamentId } = extractBoardInfo(event);
  const prefix = process.env.S3_PREFIX || "recordings";
  const stamp = stampNow();
  const keyStr = manifestKey(prefix, boardId, stamp);
  const startedAt = new Date().toISOString();
  const manifest: RecordingManifest = {
    version: 1,
    boardId,
    roomId,
    egressId: event.egressInfo?.egressId,
    startedAt,
    tournamentId,
    publisherIdentity: event.participant?.identity,
  };

  const tagging = `type=recording-manifest&board=${encodeURIComponent(boardId)}`;
  await writeManifest(keyStr, manifest, tagging);
  manifestState.set(roomId, { key: keyStr, boardId, stamp, startedAt });
}

async function finalizeManifest(event: WebhookEvent): Promise<void> {
  if (!s3 || !process.env.S3_BUCKET) return;
  const roomId = event.room?.name || "";
  if (!roomId) return;
  const state = manifestState.get(roomId);
  if (!state) {
    // Nothing tracked for this room; best-effort skip.
    return;
  }

  const { boardId } = state;
  let manifest = await readManifest(state.key);
  if (!manifest) {
    manifest = {
      version: 1,
      boardId,
      roomId,
      startedAt: state.startedAt,
    };
  } else {
    manifest.boardId = manifest.boardId || boardId;
    manifest.roomId = manifest.roomId || roomId;
    manifest.version = manifest.version || 1;
  }

  const endedAt = new Date().toISOString();
  manifest.endedAt = endedAt;
  if (!manifest.startedAt) {
    manifest.startedAt = state.startedAt;
  }
  if (manifest.startedAt) {
    const startMs = Date.parse(manifest.startedAt);
    const endMs = Date.parse(endedAt);
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
      manifest.durationSec = Math.max(1, Math.round((endMs - startMs) / 1000));
    }
  }

  if (event.egressInfo?.egressId && !manifest.egressId) {
    manifest.egressId = event.egressInfo.egressId;
  }
  const fileResults = collectFileResults(event);
  const fileInfo = fileResults.find((res) => res.file || res.filepath);
  const candidateKey = fileInfo?.file?.filename || fileInfo?.filepath || fileInfo?.file?.filepath;
  const candidateSize =
    typeof fileInfo?.file?.size === "number"
      ? fileInfo.file.size
      : typeof fileInfo?.size === "number"
        ? fileInfo.size
        : undefined;
  if (candidateKey) {
    manifest.mp4Key = candidateKey;
  }
  if (typeof candidateSize === "number") {
    manifest.mp4SizeBytes = candidateSize;
  }

  await writeManifest(state.key, manifest, `type=recording-manifest&board=${encodeURIComponent(boardId)}`);
  manifestState.delete(roomId);
  if (process.env.NODE_ENV !== "production") {
    console.info("[lk-webhook] manifest:update", {
      boardId,
      stamp: state.stamp,
      durationSec: manifest.durationSec,
    });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    if (!key || !secret) return NextResponse.json({ ok: false, error: "missing_webhook_keys" }, { status: 500 });
    const auth = req.headers.get("authorization") || "";
    const body = await req.text();
    const event: WebhookEvent = await receiver.receive(body, auth);

    const base = resolveBase(req);
    const evt = event.event || "";
    const room = event.room?.name || "";
    const identity = event.participant?.identity || "";
    log("event", { evt, room, identity, id: event.id, at: event.createdAt, base });

    if (room) {
      const isPublishEvent = evt === "track_published";
      const looksLikePublisher = identity.startsWith("publisher-");
      if (isPublishEvent && looksLikePublisher) {
        await startEgress(room, base, event);
      }
      if (evt === "egress_started") {
        await ensureManifestStart(event);
      }
      if (evt === "room_finished") {
        await stopEgress(room, base);
        await finalizeManifest(event);
      }
      if (evt === "egress_ended") {
        await finalizeManifest(event);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log("verify_failed", message);
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }
}
