const TTL_MS = 10 * 60 * 1000;

type Payload = {
  boardId: string;
  role: "publisher";
  exp: number;
};

type StoredJoinCode = {
  payload: Payload;
};

type VerifyResult = Payload & { payload: Payload };

const globalWithStore = globalThis as typeof globalThis & {
  __cv_joincodes__?: Map<string, StoredJoinCode>;
};
const _store: Map<string, StoredJoinCode> =
  globalWithStore.__cv_joincodes__ ?? new Map<string, StoredJoinCode>();

if (!globalWithStore.__cv_joincodes__) {
  globalWithStore.__cv_joincodes__ = _store;
}

function createPayload(boardId: string, exp: number): Payload {
  return { boardId, role: "publisher", exp };
}

export function genCode(): string {
  return Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
}

export function issueCode(boardId: string) {
  const exp = Date.now() + TTL_MS;
  const payload = createPayload(boardId, exp);
  let code = genCode();

  while (_store.has(code)) {
    code = genCode();
  }

  _store.set(code, { payload });
  setTimeout(() => _store.delete(code), TTL_MS).unref?.();
  return { code, exp };
}

export function storeCode(code: string, payload: { boardId: string }, ttlMs: number) {
  const exp = Date.now() + ttlMs;
  const storedPayload = createPayload(payload.boardId, exp);
  _store.set(code, { payload: storedPayload });
  setTimeout(() => _store.delete(code), ttlMs).unref?.();
  return { code, exp };
}

export function verifyCode(code: string): VerifyResult | null {
  const entry = _store.get(code);
  if (!entry) return null;

  if (Date.now() > entry.payload.exp) {
    _store.delete(code);
    return null;
  }

  const payload = entry.payload;
  return Object.assign({ payload }, payload);
}

export function invalidateCode(code: string) {
  _store.delete(code);
}
