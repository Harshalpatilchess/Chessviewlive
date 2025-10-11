import { NextRequest, NextResponse } from 'next/server';
import {
  EgressClient,
  EncodedFileOutput,
  S3Upload,
  EncodingOptionsPreset,
} from 'livekit-server-sdk';

function reqEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

// LiveKit auth + URL (convert wss:// to https:// for Egress endpoint)
const LIVEKIT_URL = reqEnv('NEXT_PUBLIC_LIVEKIT_URL').replace(/^wss?:\/\//, 'https://');
const LIVEKIT_API_KEY = reqEnv('LIVEKIT_API_KEY');
const LIVEKIT_API_SECRET = reqEnv('LIVEKIT_API_SECRET');
const ADMIN_SECRET = reqEnv('ADMIN_SECRET');

// S3 config
const S3_REGION = reqEnv('S3_REGION');
const S3_BUCKET = reqEnv('S3_BUCKET');
const S3_PREFIX = process.env.S3_PREFIX || 'recordings';
const S3_ACCESS_KEY_ID = reqEnv('S3_ACCESS_KEY_ID');
const S3_SECRET_ACCESS_KEY = reqEnv('S3_SECRET_ACCESS_KEY');

function utcStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
function buildPath(tournament: string, board: string) {
  return `${S3_PREFIX}/${tournament}/${board}/${utcStamp()}.mp4`;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const secret = url.searchParams.get('secret') || '';
    if (secret !== ADMIN_SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const room = url.searchParams.get('room') || reqEnv('NEXT_PUBLIC_LIVEKIT_ROOM');
    const tournament = url.searchParams.get('tournament') || 'misc';
    const board = url.searchParams.get('board') || 'b1-1';

    const outputs = {
      file: new EncodedFileOutput({
        filepath: buildPath(tournament, board),
        output: {
          case: 's3',
          value: new S3Upload({
            accessKey: S3_ACCESS_KEY_ID,
            secret: S3_SECRET_ACCESS_KEY,
            region: S3_REGION,
            bucket: S3_BUCKET,
          }),
        },
      }),
    };

    const ec = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

    const info = await ec.startRoomCompositeEgress(room, outputs, {
      layout: 'grid',
      encodingOptions: EncodingOptionsPreset.H264_720P_30,
    });

    return NextResponse.json({ ok: true, info });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 });
  }
}
