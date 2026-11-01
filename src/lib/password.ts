// Password hashing with PBKDF2 (Web Crypto, works in Workers and Node 20+).
// Stored format: pbkdf2$sha256$<iterations>$<salt b64>$<hash b64>
// The iteration count is stored with the hash, so it can be raised later without breaking old passwords.
// CHECK in Cloudflare's docs what the maximum PBKDF2 iterations is in Workers, and watch the
// CPU time of /api/auth/login in the dashboard (the free plan allows only 10 ms CPU per request).
const enc = new TextEncoder();

const toB64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

export const DEFAULT_ITERATIONS = 100_000;

export function iterationsFrom(value: string | undefined): number {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n)) return DEFAULT_ITERATIONS;
  return Math.min(Math.max(n, 1_000), 100_000);
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return `pbkdf2$sha256$${iterations}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false;
  const iterations = Number.parseInt(parts[2], 10);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const expected = fromB64(parts[4]);
  const actual = await derive(password, fromB64(parts[3]), iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i]; // constant-time compare
  return diff === 0;
}

// Used when the username does not exist, so a wrong username takes as long as a wrong password.
export const DUMMY_HASH =
  'pbkdf2$sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
