import { NextRequest, NextResponse } from 'next/server';
import { EgressClient } from 'livekit-server-sdk';

function reqEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const LIVEKIT_URL = reqEnv('NEXT_PUBLIC_LIVEKIT_URL').replace(/^wss?:\/\//, 'https://');
const LIVEKIT_API_KEY = reqEnv('LIVEKIT_API_KEY');
const LIVEKIT_API_SECRET = reqEnv('LIVEKIT_API_SECRET');
const ADMIN_SECRET = reqEnv('ADMIN_SECRET');

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const secret = url.searchParams.get('secret') || '';
    if (secret !== ADMIN_SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const egressId = url.searchParams.get('egressId');
    if (!egressId) {
      return NextResponse.json({ error: 'missing egressId' }, { status: 400 });
    }

    const ec = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const info = await ec.stopEgress(egressId);

    return NextResponse.json({ ok: true, info });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
