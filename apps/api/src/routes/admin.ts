import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { auditStmt } from '../lib/audit';
import { newId, tempPassword } from '../lib/ids';
import { hashPassword, iterationsFrom } from '../lib/password';
import { clearAuthCache, requireAuth, requireRole } from '../middleware';

export const admin = new Hono<AppEnv>();
admin.use('*', requireAuth, requireRole('super_admin'));

const DAY = 86_400_000;
const businessTypes = ['pharmacy', 'grocery', 'restaurant'] as const;
const defaultModules = (t: (typeof businessTypes)[number]): string[] =>
  t === 'pharmacy' ? ['batches', 'expiry', 'pack_units'] : t === 'grocery' ? ['batches', 'weight', 'barcode'] : ['recipes', 'waste'];

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  business_type: z.enum(businessTypes),
  owner_name: z.string().trim().min(2).max(100),
  owner_username: z.string().trim().toLowerCase().regex(/^[a-z0-9._@+-]{3,64}$/, 'use a phone number or email'),
  plan_days: z.number().int().min(1).max(3650).optional(),
  modules: z.array(z.string().max(40)).max(20).optional(),
});
const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    status: z.enum(['active', 'suspended']),
    plan_until: z.number().int().nullable(),
    modules: z.array(z.string().max(40)).max(20),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');

admin.get('/shops', async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT s.id, s.name, s.business_type, s.status, s.plan_until, s.modules, s.created_at,
              (SELECT COUNT(*) FROM users u WHERE u.shop_id = s.id) AS user_count,
              (SELECT MAX(u.last_login_at) FROM users u WHERE u.shop_id = s.id) AS last_login_at,
              (SELECT COUNT(*) FROM sales x WHERE x.shop_id = s.id AND x.created_at > ?) AS sales_30d
         FROM shops s ORDER BY s.created_at DESC`,
    )
    .bind(Date.now() - 30 * DAY)
    .all();
  return c.json({ shops: results });
});

// Opens a new client: a shop and its owner. The temporary password is shown ONCE, here.
admin.post('/shops', async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid', details: parsed.error.flatten() }, 400);
  const b = parsed.data;
  const me = c.get('user');
  const db = c.env.DB;
  const now = Date.now();
  const shopId = newId();
  const ownerId = newId();
  const temp = tempPassword();
  const hash = await hashPassword(temp, iterationsFrom(c.env.PBKDF2_ITERATIONS));
  const modules = b.modules ?? defaultModules(b.business_type);
  const planUntil = b.plan_days ? now + b.plan_days * DAY : null;
  try {
    // one batch = all or nothing: if the username is taken, the shop is not created either
    await db.batch([
      db.prepare('INSERT INTO shops (id, name, business_type, status, plan_until, modules, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(shopId, b.name, b.business_type, 'active', planUntil, JSON.stringify(modules), now),
      db.prepare('INSERT INTO users (id, shop_id, name, username, password_hash, role, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
        .bind(ownerId, shopId, b.owner_name, b.owner_username, hash, 'owner', now),
      auditStmt(db, { shopId, userId: me.id, action: 'shop_created', detail: { name: b.name, type: b.business_type } }),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ error: 'username_taken' }, 409);
    throw e;
  }
  return c.json(
    {
      shop: { id: shopId, name: b.name, business_type: b.business_type, modules, plan_until: planUntil },
      owner: { id: ownerId, username: b.owner_username, temp_password: temp },
      note: 'Give the temporary password to the owner now. It is not stored and cannot be shown again.',
    },
    201,
  );
});

admin.patch('/shops/:id', async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid', details: parsed.error.flatten() }, 400);
  const b = parsed.data;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.name !== undefined) { sets.push('name = ?'); vals.push(b.name); }
  if (b.status !== undefined) { sets.push('status = ?'); vals.push(b.status); }
  if (b.plan_until !== undefined) { sets.push('plan_until = ?'); vals.push(b.plan_until); }
  if (b.modules !== undefined) { sets.push('modules = ?'); vals.push(JSON.stringify(b.modules)); }
  const id = c.req.param('id');
  const db = c.env.DB;
  const [res] = await db.batch([
    db.prepare(`UPDATE shops SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id),
    auditStmt(db, { shopId: id, userId: c.get('user').id, action: 'shop_updated', detail: b }),
  ]);
  if (res.meta.changes === 0) return c.json({ error: 'not_found' }, 404);
  clearAuthCache();
  return c.json({ ok: true });
});

admin.post('/shops/:id/reset-owner-password', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const owner = await db.prepare("SELECT id, username FROM users WHERE shop_id = ? AND role = 'owner' ORDER BY created_at LIMIT 1").bind(id).first<{ id: string; username: string }>();
  if (!owner) return c.json({ error: 'not_found' }, 404);
  const temp = tempPassword();
  const hash = await hashPassword(temp, iterationsFrom(c.env.PBKDF2_ITERATIONS));
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?').bind(hash, owner.id),
    auditStmt(db, { shopId: id, userId: c.get('user').id, action: 'owner_password_reset' }),
  ]);
  clearAuthCache();
  return c.json({ owner: { username: owner.username, temp_password: temp } });
});
