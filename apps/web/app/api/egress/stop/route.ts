import { NextRequest, NextResponse } from 'next/server';
import { EgressClient } from 'livekit-server-sdk';

function reqEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const secret = url.searchParams.get('secret') || '';
    const adminSecret = reqEnv('ADMIN_SECRET');
    if (secret !== adminSecret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const egressId = url.searchParams.get('egressId');
    if (!egressId) {
      return NextResponse.json({ error: 'missing egressId' }, { status: 400 });
    }

    const livekitUrl = reqEnv('NEXT_PUBLIC_LIVEKIT_URL').replace(/^wss?:\/\//, 'https://');
    const livekitApiKey = reqEnv('LIVEKIT_API_KEY');
    const livekitApiSecret = reqEnv('LIVEKIT_API_SECRET');
    const ec = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);
    const info = await ec.stopEgress(egressId);

    return NextResponse.json({ ok: true, info });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
