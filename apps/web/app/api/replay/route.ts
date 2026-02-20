import { NextRequest, NextResponse } from "next/server";
import S3 from "aws-sdk/clients/s3";
import { MANIFEST_EXT, RecordingManifest } from "@/lib/recordingManifest";

type ReplayItem = {
  key: string;
  lastModified: string | null;
  size: number;
};

type ReplayUrl = {
  url: string;
  name: string;
  lastModified: string | null;
  size: number;
  startedAt?: string;
  endedAt?: string;
  durationSec?: number;
  tournamentId?: string;
  friendlyStartedAt?: string;
  friendlyDuration?: string;
};

// TODO: Migrate to AWS SDK v3 later.

const requiredEnv = [
  'S3_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'S3_BUCKET',
];
const getS3Client = () => {
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }
  return new S3({
    region: process.env.S3_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
};

function fallbackDuration(seconds: number): string | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function fallbackStartedAt(startedAt?: string | null): string | undefined {
  if (!startedAt) return undefined;
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.toISOString().replace("T", " ").replace("Z", " UTC")}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const s3 = getS3Client();
    const url = new URL(req.url);
    const boardId = url.searchParams.get("boardId") || "";
    if (!boardId) return NextResponse.json({ ok: false, error: "missing_boardId" }, { status: 400 });
    if (!process.env.S3_BUCKET) return NextResponse.json({ ok: false, error: "missing_bucket" }, { status: 500 });

    const prefix = `${process.env.S3_PREFIX || "recordings"}/${boardId}/`;
    const listed = await s3.listObjectsV2({ Bucket: process.env.S3_BUCKET, Prefix: prefix }).promise();

    const contents = listed.Contents || [];
    const mp4Items = contents.filter((f: S3.Object) => (f.Key || "").toLowerCase().endsWith(".mp4"));
    const manifestItems = contents.filter((f: S3.Object) => (f.Key || "").toLowerCase().endsWith(MANIFEST_EXT));

    const manifestEntries = await Promise.all(
      manifestItems.map(async (item: S3.Object): Promise<{ key: string; manifest: RecordingManifest; stamp: string } | null> => {
        if (!item.Key) return null;
        try {
          const obj = await s3
            .getObject({
              Bucket: process.env.S3_BUCKET!,
              Key: item.Key,
            })
            .promise();
          const text = obj.Body?.toString("utf-8") || "";
          if (!text) return null;
          const manifest = JSON.parse(text) as RecordingManifest;
          const stamp = (item.Key.split("/").pop() || "").replace(new RegExp(`${MANIFEST_EXT}$`), "");
          return { key: item.Key, manifest, stamp };
        } catch (err) {
          console.warn("[replay] manifest_parse_failed", item.Key, err);
          return null;
        }
      })
    );

    const manifestByStamp = new Map<string, { key: string; manifest: RecordingManifest }>();
    const manifestList: Array<{ key: string; manifest: RecordingManifest }> = [];
    for (const entry of manifestEntries) {
      if (!entry) continue;
      manifestByStamp.set(entry.stamp, { key: entry.key, manifest: entry.manifest });
      manifestList.push({ key: entry.key, manifest: entry.manifest });
    }

    const items: ReplayItem[] = mp4Items.map((f: S3.Object) => ({
      key: f.Key!,
      lastModified: f.LastModified ? new Date(f.LastModified).toISOString() : null,
      size: f.Size || 0,
    }));

    function findManifestForItem(item: ReplayItem): RecordingManifest | null {
      const filename = item.key.split("/").pop() || item.key;
      const stamp = filename.replace(/\.mp4$/i, "");
      const exact = manifestByStamp.get(stamp);
      if (exact) return exact.manifest;

      if (!item.lastModified) return null;
      const itemTs = Date.parse(item.lastModified);
      if (Number.isNaN(itemTs)) return null;

      let best: RecordingManifest | null = null;
      let bestDiff = Infinity;
      for (const candidate of manifestList) {
        const ref = candidate.manifest.endedAt || candidate.manifest.startedAt;
        if (!ref) continue;
        const refTs = Date.parse(ref);
        if (Number.isNaN(refTs)) continue;
        const diff = itemTs - refTs;
        if (diff < 0) continue;
        if (diff < bestDiff) {
          bestDiff = diff;
          best = candidate.manifest;
        }
      }
      return best;
    }

    const urls: ReplayUrl[] = await Promise.all(
      items.map(async (it: ReplayItem): Promise<ReplayUrl> => {
        const manifest = findManifestForItem(it);

        const url = s3.getSignedUrl("getObject", {
          Bucket: process.env.S3_BUCKET!,
          Key: it.key,
          Expires: 3600,
        });
        const name = it.key.split("/").pop() || it.key;
        return {
          url,
          name,
          lastModified: it.lastModified,
          size: it.size,
          startedAt: manifest?.startedAt,
          endedAt: manifest?.endedAt,
          durationSec: manifest?.durationSec,
          tournamentId: manifest?.tournamentId,
          friendlyStartedAt: fallbackStartedAt(manifest?.startedAt),
          friendlyDuration:
            typeof manifest?.durationSec === "number"
              ? fallbackDuration(manifest.durationSec)
              : undefined,
        };
      })
    );

    const sorted = urls.sort((a: ReplayUrl, b: ReplayUrl): number => {
      const aKey = a.endedAt || a.startedAt || a.lastModified || "";
      const bKey = b.endedAt || b.startedAt || b.lastModified || "";
      return bKey.localeCompare(aKey);
    });

    return NextResponse.json({ ok: true, urls: sorted });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
// TODO: Consider migrating to AWS SDK v3 for better Next.js compatibility.
