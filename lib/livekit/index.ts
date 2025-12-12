// Plain server-side helper for minting LiveKit tokens.
// IMPORTANT: Do NOT add "use server" here — this is NOT a Server Action.
import { AccessToken } from "livekit-server-sdk";

type TokenParams = {
  room: string;
  identity: string;
  ttlSeconds?: number; // optional token TTL
};

const apiKey = process.env.LIVEKIT_API_KEY!;
const apiSecret = process.env.LIVEKIT_API_SECRET!;

async function mintToken(params: TokenParams, canPublish: boolean): Promise<string> {
  if (!apiKey || !apiSecret) throw new Error("missing_livekit_keys");
  const at = new AccessToken(apiKey, apiSecret, {
    identity: params.identity,
    ttl: params.ttlSeconds, // optional
  });
  at.addGrant({
    roomJoin: true,
    room: params.room,
    canSubscribe: true,
    canPublish,
  });
  return at.toJwt();
}

export function mintViewerToken(params: TokenParams): Promise<string> {
  return mintToken(params, false);
}

export function mintPublisherToken(params: TokenParams): Promise<string> {
  return mintToken(params, true);
}
