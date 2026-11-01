import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import type { AppEnv, Role } from './types';

export const COOKIE = 'sid';

type UserState = {
  id: string;
  shop_id: string | null;
  name: string;
  role: Role;
  active: number;
  token_version: number;
  must_change_password: number;
  shop_status: string | null;
  plan_until: number | null;
};

// One cheap read per request, remembered for 30 s inside the Worker instance. That keeps database use
// low, and still lets an admin suspend a shop or a user within about half a minute.
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; v: UserState | null }>();
export function clearAuthCache(): void {
  cache.clear();
}

async function loadUser(db: D1Database, id: string): Promise<UserState | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  const v = await db
    .prepare(
      `SELECT u.id, u.shop_id, u.name, u.role, u.active, u.token_version, u.must_change_password,
              s.status AS shop_status, s.plan_until
         FROM users u LEFT JOIN shops s ON s.id = u.shop_id
        WHERE u.id = ?`,
    )
    .bind(id)
    .first<UserState>();
  cache.set(id, { at: Date.now(), v: v ?? null });
  return v ?? null;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) return c.json({ error: 'not_logged_in' }, 401);
  let payload: Record<string, unknown>;
  try {
    payload = (await verify(token, c.env.JWT_SECRET, 'HS256')) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'not_logged_in' }, 401);
  }
  const u = await loadUser(c.env.DB, String(payload.sub));
  if (!u || !u.active || u.token_version !== payload.tv) return c.json({ error: 'not_logged_in' }, 401);
  if (u.role !== 'super_admin') {
    if (u.shop_status !== 'active') return c.json({ error: 'shop_suspended' }, 403);
    if (u.plan_until !== null && u.plan_until < Date.now()) return c.json({ error: 'plan_expired' }, 403);
  }
  c.set('user', {
    id: u.id,
    shopId: u.shop_id,
    role: u.role,
    name: u.name,
    mustChangePassword: u.must_change_password === 1,
  });
  await next();
};

export const requireRole =
  (...roles: Role[]): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if (!roles.includes(c.get('user').role)) return c.json({ error: 'forbidden' }, 403);
    await next();
  };
