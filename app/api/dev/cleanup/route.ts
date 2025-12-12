import { NextRequest, NextResponse } from "next/server";
import AWS from "aws-sdk";
import { hasAdminCookie } from "@/lib/adminSession";
import { isManifestKey, isMp4Key, stampFromKey } from "@/lib/recordingManifest";

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

type StampEntry = {
  stamp: string;
  mp4Key?: string;
  manifestKey?: string;
  mp4Modified?: number | null;
  manifestModified?: number | null;
};

function unauthorized(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function buildPrefix(boardId: string, tournamentId?: string) {
  const base = (process.env.S3_PREFIX || "recordings").replace(/\/?$/, "/");
  const encodedBoard = encodeURIComponent(boardId).replace(/%2F/gi, "/");
  if (tournamentId) {
    const encodedTournament = encodeURIComponent(tournamentId).replace(/%2F/gi, "/");
    return `${base}${encodedTournament}/${encodedBoard}/`;
  }
  return `${base}${encodedBoard}/`;
}

function parseNumberParam(raw: string | null, fallback: number, minValue: number) {
  if (!raw) return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  if (num < minValue) return minValue;
  return num;
}

async function listObjectsRecursive(bucket: string, prefix: string) {
  const items: AWS.S3.Object[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await s3
      .listObjectsV2({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
      .promise();
    if (response.Contents) {
      items.push(...response.Contents);
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
  return items;
}

export async function GET(req: NextRequest) {
  if (process.env.ALLOW_DEV_CLEANUP !== "true") {
    return unauthorized(403, "disabled");
  }
  if (process.env.NODE_ENV === "production") {
    return unauthorized(403, "production_disabled");
  }

  const url = new URL(req.url);
  const boardId = (url.searchParams.get("boardId") || "").trim();
  const tournamentId = (url.searchParams.get("tournamentId") || "").trim() || undefined;

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
      return unauthorized(401, "unauthorized");
    }
    if (!process.env.ADMIN_SECRET || headerSecret !== process.env.ADMIN_SECRET) {
      return unauthorized(403, "forbidden");
    }
  } else if (headerSecret && process.env.ADMIN_SECRET && headerSecret !== process.env.ADMIN_SECRET) {
    return unauthorized(403, "forbidden");
  }

  const olderThanDays = parseNumberParam(url.searchParams.get("olderThanDays"), 30, 0);
  const keepLast = Math.floor(parseNumberParam(url.searchParams.get("keepLast"), 10, 0));
  const dryParam = url.searchParams.get("dryRun");
  const dryRun =
    dryParam === null
      ? true
      : !["0", "false", "no"].includes(dryParam.toLowerCase().trim());

  const bucket = process.env.S3_BUCKET;
  const prefix = buildPrefix(boardId, tournamentId);

  let contents: AWS.S3.Object[];
  try {
    contents = await listObjectsRecursive(bucket, prefix);
  } catch (err) {
    console.info("[cleanup] list_failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "s3_list_failed" }, { status: 502 });
  }

  const stampMap = new Map<string, StampEntry>();
  let mp4Count = 0;
  let manifestCount = 0;

  for (const item of contents) {
    if (!item.Key) continue;
    const stamp = stampFromKey(item.Key);
    if (!stamp) continue;
    const entry = stampMap.get(stamp) || { stamp };
    if (isMp4Key(item.Key)) {
      entry.mp4Key = item.Key;
      entry.mp4Modified = item.LastModified ? item.LastModified.getTime() : null;
      mp4Count += 1;
    } else if (isManifestKey(item.Key)) {
      entry.manifestKey = item.Key;
      entry.manifestModified = item.LastModified ? item.LastModified.getTime() : null;
      manifestCount += 1;
    } else {
      continue;
    }
    stampMap.set(stamp, entry);
  }

  const stamps = Array.from(stampMap.values());
  stamps.sort((a, b) => {
    const aTs = Math.max(
      a.mp4Modified ?? Number.NEGATIVE_INFINITY,
      a.manifestModified ?? Number.NEGATIVE_INFINITY
    );
    const bTs = Math.max(
      b.mp4Modified ?? Number.NEGATIVE_INFINITY,
      b.manifestModified ?? Number.NEGATIVE_INFINITY
    );
    if (Number.isFinite(aTs) && Number.isFinite(bTs)) {
      if (aTs === bTs) {
        return b.stamp.localeCompare(a.stamp);
      }
      return bTs - aTs;
    }
    if (Number.isFinite(bTs)) return 1;
    if (Number.isFinite(aTs)) return -1;
    return b.stamp.localeCompare(a.stamp);
  });

  const now = Date.now();
  const olderThanMs = olderThanDays * 24 * 60 * 60 * 1000;
  const candidates = stamps
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => index >= keepLast)
    .map(({ entry }) => entry)
    .filter((entry) => {
      const newestTs = Math.max(
        entry.mp4Modified ?? Number.NEGATIVE_INFINITY,
        entry.manifestModified ?? Number.NEGATIVE_INFINITY
      );
      if (!Number.isFinite(newestTs)) {
        return false;
      }
      return now - newestTs >= olderThanMs;
    });

  const totals = {
    mp4: mp4Count,
    manifests: manifestCount,
    stamps: stamps.length,
  };

  if (dryRun) {
    const toDelete = candidates.map(({ stamp, mp4Key, manifestKey }) => ({
      stamp,
      mp4Key,
      manifestKey,
    }));
    return NextResponse.json({
      ok: true,
      boardId,
      prefix,
      dryRun: true,
      olderThanDays,
      keepLast,
      totals,
      toDelete,
    });
  }

  const keyMeta = new Map<
    string,
    { stamp: string; type: "mp4" | "manifest"; key: string }
  >();
  const stampResults = new Map<string, { stamp: string; mp4Key?: string; manifestKey?: string }>();
  const deleteObjects: AWS.S3.ObjectIdentifierList = [];

  for (const candidate of candidates) {
    const record = { stamp: candidate.stamp };
    if (candidate.mp4Key) {
      deleteObjects.push({ Key: candidate.mp4Key });
      keyMeta.set(candidate.mp4Key, { stamp: candidate.stamp, type: "mp4", key: candidate.mp4Key });
    }
    if (candidate.manifestKey) {
      deleteObjects.push({ Key: candidate.manifestKey });
      keyMeta.set(candidate.manifestKey, {
        stamp: candidate.stamp,
        type: "manifest",
        key: candidate.manifestKey,
      });
    }
    stampResults.set(candidate.stamp, record);
  }

  const errors: Array<{ key: string; message: string }> = [];
  if (deleteObjects.length > 0) {
    const batchSize = 1000;
    for (let i = 0; i < deleteObjects.length; i += batchSize) {
      const batch = deleteObjects.slice(i, i + batchSize);
      try {
        const res = await s3
          .deleteObjects({
            Bucket: bucket,
            Delete: {
              Objects: batch,
              Quiet: false,
            },
          })
          .promise();
        if (res.Deleted) {
          for (const deleted of res.Deleted) {
            if (!deleted.Key) continue;
            const meta = keyMeta.get(deleted.Key);
            if (!meta) continue;
            const stampRecord = stampResults.get(meta.stamp);
            if (!stampRecord) continue;
            if (meta.type === "mp4") {
              stampRecord.mp4Key = deleted.Key;
            } else if (meta.type === "manifest") {
              stampRecord.manifestKey = deleted.Key;
            }
          }
        }
        if (res.Errors) {
          for (const err of res.Errors) {
            errors.push({
              key: err.Key || "unknown",
              message: err.Message || "delete_failed",
            });
          }
        }
      } catch (err) {
        console.info("[cleanup] delete_failed", err instanceof Error ? err.message : err);
        errors.push({
          key: "batch",
          message: "delete_exception",
        });
      }
    }
  }

  const deleted = Array.from(stampResults.values()).filter((record) => record.mp4Key || record.manifestKey);

  return NextResponse.json({
    ok: true,
    boardId,
    prefix,
    dryRun: false,
    olderThanDays,
    keepLast,
    totals,
    deleted,
    errors: errors.length ? errors : undefined,
  });
}
