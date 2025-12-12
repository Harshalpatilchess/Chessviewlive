import { NextRequest, NextResponse } from "next/server";
import AWS from "aws-sdk";
import { hasAdminCookie } from "@/lib/adminSession";
import {
  RecordingManifest,
  manifestKeyForStamp,
  stampFromKey,
  isManifestKey,
  isMp4Key,
} from "@/lib/recordingManifest";

export const runtime = "nodejs";

const requiredEnv = [
  'S3_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'S3_BUCKET',
];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

const s3 = new AWS.S3({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

function buildPrefix(boardId: string, tournamentId?: string) {
  const base = (process.env.S3_PREFIX || "recordings").replace(/\/?$/, "/");
  const encodedBoard = encodeURIComponent(boardId).replace(/%2F/gi, "/");
  if (tournamentId) {
    const encodedTournament = encodeURIComponent(tournamentId).replace(/%2F/gi, "/");
    return `${base}${encodedTournament}/${encodedBoard}/`;
  }
  return `${base}${encodedBoard}/`;
}

function unauthorizedResponse(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: NextRequest) {
  if (process.env.ALLOW_DEV_MANIFEST_CHECK !== "true") {
    return unauthorizedResponse(403, "disabled");
  }

  const url = new URL(req.url);
  const boardId = (url.searchParams.get("boardId") || "").trim();
  const tournamentId = (url.searchParams.get("tournamentId") || "").trim() || undefined;
  const sampleRaw = url.searchParams.get("sample");
  const parsedSample = Number(sampleRaw);
  const sampleCount = Number.isFinite(parsedSample) ? parsedSample : 1;
  const effectiveSample = sampleCount > 0 ? sampleCount : 1;

  if (!boardId) {
    return NextResponse.json({ ok: false, error: "missing_boardId" }, { status: 400 });
  }
  if (!process.env.S3_BUCKET) {
    return NextResponse.json({ ok: false, error: "s3_unavailable" }, { status: 500 });
  }

  const headerSecret = req.headers.get("x-admin-secret") || "";
  const hasCookie = hasAdminCookie(req);
  if (!hasCookie) {
    if (!headerSecret) {
      return unauthorizedResponse(401, "unauthorized");
    }
    if (!process.env.ADMIN_SECRET || headerSecret !== process.env.ADMIN_SECRET) {
      return unauthorizedResponse(403, "forbidden");
    }
  } else if (headerSecret && process.env.ADMIN_SECRET && headerSecret !== process.env.ADMIN_SECRET) {
    return unauthorizedResponse(403, "forbidden");
  }

  const prefix = buildPrefix(boardId, tournamentId);

  let listed;
  try {
    listed = await s3
      .listObjectsV2({
        Bucket: process.env.S3_BUCKET,
        Prefix: prefix,
      })
      .promise();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "s3_list_failed" },
      {
        status: 502,
      }
    );
  }

  const mp4Stamps = new Map<string, string>();
  const manifestStamps = new Map<string, string>();

  for (const item of listed.Contents || []) {
    if (!item.Key) continue;
    const stamp = stampFromKey(item.Key);
    if (!stamp) continue;
    if (isMp4Key(item.Key)) {
      mp4Stamps.set(stamp, item.Key);
    } else if (isManifestKey(item.Key)) {
      manifestStamps.set(stamp, item.Key);
    }
  }

  const missingManifestForMp4 = Array.from(mp4Stamps.keys()).filter((stamp) => !manifestStamps.has(stamp));
  const orphanManifests = Array.from(manifestStamps.keys()).filter((stamp) => !mp4Stamps.has(stamp));

  const intersection = Array.from(mp4Stamps.keys()).filter((stamp) => manifestStamps.has(stamp));
  intersection.sort((a, b) => b.localeCompare(a));

  const warnings: string[] = [];
  const samples: Array<{
    stamp: string;
    mp4Key: string;
    manifestKey: string;
    manifest: RecordingManifest | null;
  }> = [];

  for (const stamp of intersection.slice(0, effectiveSample)) {
    const mp4Key = mp4Stamps.get(stamp)!;
    const manifestKey = manifestStamps.get(stamp) || `${prefix}${manifestKeyForStamp(boardId, stamp)}`;
    let manifest: RecordingManifest | null = null;
    try {
      const obj = await s3
        .getObject({
          Bucket: process.env.S3_BUCKET!,
          Key: manifestKey,
        })
        .promise();
      const text = obj.Body?.toString("utf-8") || "";
      manifest = text ? (JSON.parse(text) as RecordingManifest) : null;
    } catch (err) {
      warnings.push(`manifest_fetch_failed:${stamp}`);
      manifest = null;
    }
    samples.push({ stamp, mp4Key, manifestKey, manifest });
  }

  return NextResponse.json({
    ok: true,
    boardId,
    prefix,
    counts: {
      mp4: mp4Stamps.size,
      manifests: manifestStamps.size,
    },
    missingManifestForMp4: missingManifestForMp4.sort(),
    orphanManifests: orphanManifests.sort(),
    samples,
    warnings: warnings.length ? warnings : undefined,
  });
}
