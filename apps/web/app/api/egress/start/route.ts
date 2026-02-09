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

function utcStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
function buildPath(prefix: string, tournament: string, board: string) {
  return `${prefix}/${tournament}/${board}/${utcStamp()}.mp4`;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const secret = url.searchParams.get('secret') || '';
    const adminSecret = reqEnv('ADMIN_SECRET');
    if (secret !== adminSecret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const livekitUrl = reqEnv('NEXT_PUBLIC_LIVEKIT_URL').replace(/^wss?:\/\//, 'https://');
    const livekitApiKey = reqEnv('LIVEKIT_API_KEY');
    const livekitApiSecret = reqEnv('LIVEKIT_API_SECRET');
    const s3Region = reqEnv('S3_REGION');
    const s3Bucket = reqEnv('S3_BUCKET');
    const s3Prefix = process.env.S3_PREFIX || 'recordings';
    const s3AccessKeyId = reqEnv('S3_ACCESS_KEY_ID');
    const s3SecretAccessKey = reqEnv('S3_SECRET_ACCESS_KEY');

    const room = url.searchParams.get('room') || reqEnv('NEXT_PUBLIC_LIVEKIT_ROOM');
    const tournament = url.searchParams.get('tournament') || 'misc';
    const board = url.searchParams.get('board') || 'b1-1';

    const outputs = {
      file: new EncodedFileOutput({
        filepath: buildPath(s3Prefix, tournament, board),
        output: {
          case: 's3',
          value: new S3Upload({
            accessKey: s3AccessKeyId,
            secret: s3SecretAccessKey,
            region: s3Region,
            bucket: s3Bucket,
          }),
        },
      }),
    };

    const ec = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);

    const info = await ec.startRoomCompositeEgress(room, outputs, {
      layout: 'grid',
      encodingOptions: EncodingOptionsPreset.H264_720P_30,
    });

    return NextResponse.json({ ok: true, info });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
