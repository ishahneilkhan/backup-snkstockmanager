// ULID-style ids: 10 chars of time (sortable) + 16 random chars. Made in the app, so a
// db.batch() can refer to an id before it is stored, and offline devices can make ids too.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newId(): string {
  let t = Date.now();
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  let rand = '';
  for (const b of rnd) rand += ALPHABET[b % 32]; // 256 is a multiple of 32, so no bias
  return time + rand;
}

// Temporary password for a new owner: no look-alike characters (0/O, 1/l/I).
const PW_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function tempPassword(length = 12): string {
  const rnd = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of rnd) out += PW_ALPHABET[b % PW_ALPHABET.length];
  return out;
}

// Short code a customer can read out or write down (no look-alike characters).
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export function shortRef(length = 8): string {
  const rnd = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of rnd) out += REF_ALPHABET[b % REF_ALPHABET.length];
  return out;
}
