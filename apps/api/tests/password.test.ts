import { describe, expect, it } from 'vitest';
import { newId, tempPassword } from '../src/lib/ids';
import { DUMMY_HASH, hashPassword, iterationsFrom, verifyPassword } from '../src/lib/password';

describe('password', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const h = await hashPassword('correct horse', 1000);
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
  it('gives a different hash each time (random salt)', async () => {
    expect(await hashPassword('same', 1000)).not.toBe(await hashPassword('same', 1000));
  });
  it('rejects broken stored values and the dummy hash', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('anything', DUMMY_HASH)).toBe(false);
  });
  it('keeps iterations in a safe range', () => {
    expect(iterationsFrom(undefined)).toBe(100000);
    expect(iterationsFrom('5')).toBe(1000);
    expect(iterationsFrom('999999999')).toBe(100000);
  });
});

describe('ids', () => {
  it('makes unique, 26-character, time-sortable ids', async () => {
    const a = newId();
    await new Promise((r) => setTimeout(r, 3));
    const b = newId();
    expect(a).toHaveLength(26);
    expect(a).not.toBe(b);
    expect(a < b).toBe(true);
  });
  it('makes temporary passwords without look-alike characters', () => {
    const p = tempPassword();
    expect(p).toHaveLength(12);
    expect(p).not.toMatch(/[0O1lI]/);
  });
});
