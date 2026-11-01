import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { sign } from 'hono/jwt';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { DUMMY_HASH, hashPassword, iterationsFrom, verifyPassword } from '../lib/password';
import { clearAuthCache, COOKIE, requireAuth } from '../middleware';

export const auth = new Hono<AppEnv>();

const SESSION_SECONDS = 30 * 24 * 3600; // long sessions = fewer password checks (saves CPU)
const loginSchema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) });
const changeSchema = z.object({ current: z.string().min(1).max(200), next: z.string().min(8).max(200) });

type LoginRow = {
  id: string; shop_id: string | null; name: string; role: string; active: number;
  password_hash: string; token_version: number; must_change_password: number;
  shop_status: string | null; plan_until: number | null;
};

async function issueCookie(c: Context<AppEnv>, userId: string, tokenVersion: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = await sign({ sub: userId, tv: tokenVersion, iat: now, exp: now + SESSION_SECONDS }, c.env.JWT_SECRET, 'HS256');
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_SECONDS });
}

auth.post('/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid' }, 400);
  const username = parsed.data.username.trim().toLowerCase();
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const db = c.env.DB;

  // Slow down guessing: at most 5 failures per username and 20 per IP in 15 minutes.
  const since = Date.now() - 15 * 60 * 1000;
  const rl = await db
    .prepare(
      `SELECT COALESCE(SUM(username = ?), 0) AS u, COALESCE(SUM(ip = ?), 0) AS i
         FROM login_attempts WHERE ts > ? AND (username = ? OR ip = ?)`,
    )
    .bind(username, ip, since, username, ip)
    .first<{ u: number; i: number }>();
  if ((rl?.u ?? 0) >= 5 || (rl?.i ?? 0) >= 20) return c.json({ error: 'too_many_attempts' }, 429);

  const row = await db
    .prepare(
      `SELECT u.id, u.shop_id, u.name, u.role, u.active, u.password_hash, u.token_version, u.must_change_password,
              s.status AS shop_status, s.plan_until
         FROM users u LEFT JOIN shops s ON s.id = u.shop_id
        WHERE u.username = ?`,
    )
    .bind(username)
    .first<LoginRow>();

  const passwordOk = await verifyPassword(parsed.data.password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !row.active || !passwordOk) {
    await db.prepare('INSERT INTO login_attempts (username, ip, ts) VALUES (?, ?, ?)').bind(username, ip, Date.now()).run();
    return c.json({ error: 'wrong_username_or_password' }, 401);
  }
  if (row.role !== 'super_admin') {
    if (row.shop_status !== 'active') return c.json({ error: 'shop_suspended' }, 403);
    if (row.plan_until !== null && row.plan_until < Date.now()) return c.json({ error: 'plan_expired' }, 403);
  }

  await db.batch([
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(Date.now(), row.id),
    db.prepare('DELETE FROM login_attempts WHERE username = ?').bind(username),
  ]);
  await issueCookie(c, row.id, row.token_version);
  return c.json({
    user: { id: row.id, name: row.name, role: row.role, shopId: row.shop_id, mustChangePassword: row.must_change_password === 1 },
  });
});

auth.post('/logout', (c) => {
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

auth.get('/me', requireAuth, (c) => c.json({ user: c.get('user') }));

auth.post('/change-password', requireAuth, async (c) => {
  const parsed = changeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid', hint: 'new password needs at least 8 characters' }, 400);
  const me = c.get('user');
  const db = c.env.DB;
  const row = await db.prepare('SELECT password_hash, token_version FROM users WHERE id = ?').bind(me.id).first<{ password_hash: string; token_version: number }>();
  if (!row || !(await verifyPassword(parsed.data.current, row.password_hash))) return c.json({ error: 'wrong_password' }, 401);
  const hash = await hashPassword(parsed.data.next, iterationsFrom(c.env.PBKDF2_ITERATIONS));
  const tv = row.token_version + 1; // signs out every other device
  await db.prepare('UPDATE users SET password_hash = ?, token_version = ?, must_change_password = 0 WHERE id = ?').bind(hash, tv, me.id).run();
  clearAuthCache();
  await issueCookie(c, me.id, tv);
  return c.json({ ok: true });
});
