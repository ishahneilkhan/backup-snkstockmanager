// Routes anyone can call (no login): the plans, a purchase request, its status, and claiming the account.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { auditStmt } from '../lib/audit';
import { sha256Hex } from '../lib/hash';
import { newId, shortRef } from '../lib/ids';
import { defaultModules, type BusinessType } from '../lib/modules';
import { hashPassword, iterationsFrom } from '../lib/password';
import { issueCookie } from './auth';

export const pub = new Hono<AppEnv>();
const DAY = 86_400_000;

pub.get('/plans', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT code, name, business_type, price, days FROM plans WHERE active = 1 ORDER BY sort, code')
    .all<{ code: string; name: string; business_type: string; price: number; days: number }>();
  return c.json({
    plans: results.map((p) => ({ code: p.code, name: p.name, business_type: p.business_type, days: p.days, price_taka: p.price / 100 })),
    payment: { bkash: c.env.PAYMENT_BKASH || null, nagad: c.env.PAYMENT_NAGAD || null },
    sales_open: c.env.SALES_OPEN === '1',
  });
});

const phoneRe = /^\+?[0-9]{8,15}$/;
const requestSchema = z.object({
  plan_code: z.string().min(1).max(40),
  business_name: z.string().trim().min(2).max(100),
  owner_name: z.string().trim().min(2).max(100),
  phone: z.string().trim().transform((s) => s.replace(/[\s-]/g, '')).refine((s) => phoneRe.test(s), 'phone'),
  payment_method: z.enum(['bkash', 'nagad', 'bank']),
  trx_id: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,40}$/),
  amount_taka: z.number().min(0).max(10_000_000),
  website: z.string().max(200).optional(), // hidden field: real people leave it empty, simple bots fill it
});

pub.post('/requests', async (c) => {
  if (c.env.SALES_OPEN !== '1') return c.json({ error: 'sales_closed' }, 403);
  const parsed = requestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid' }, 400);
  const b = parsed.data;
  if (b.website) return c.json({ ref: 'XXXXXXXX' }, 201); // pretend success to a bot, save nothing
  const db = c.env.DB;
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM signup_requests WHERE ip = ? AND created_at > ?').bind(ip, Date.now() - 3_600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 5) return c.json({ error: 'too_many_attempts' }, 429);
  const plan = await db.prepare('SELECT code FROM plans WHERE code = ? AND active = 1').bind(b.plan_code).first();
  if (!plan) return c.json({ error: 'unknown_plan' }, 400);
  const ref = shortRef();
  try {
    await db
      .prepare(
        `INSERT INTO signup_requests (id, ref, plan_code, business_name, owner_name, phone, phone_norm, payment_method, trx_id, amount, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(newId(), ref, b.plan_code, b.business_name, b.owner_name, b.phone, b.phone, b.payment_method, b.trx_id, Math.round(b.amount_taka * 100), ip, Date.now())
      .run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ error: 'trx_used' }, 409);
    throw e;
  }
  return c.json({ ref }, 201);
});

// Status only. The link to create the account is never returned here; it only comes from the admin.
pub.get('/requests/:ref', async (c) => {
  const phone = (c.req.query('phone') ?? '').replace(/[\s-]/g, '');
  const row = await c.env.DB.prepare('SELECT status FROM signup_requests WHERE ref = ? AND phone_norm = ?').bind(c.req.param('ref').toUpperCase(), phone).first<{ status: string }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ status: row.status });
});

const claimSchema = z.object({ token: z.string().min(20).max(80), password: z.string().min(8).max(200) });
pub.post('/claim', async (c) => {
  const parsed = claimSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid' }, 400);
  const db = c.env.DB;
  const hash = await sha256Hex(parsed.data.token);
  const req = await db
    .prepare(
      `SELECT r.id, r.business_name, r.owner_name, r.phone_norm, p.business_type, p.days
         FROM signup_requests r JOIN plans p ON p.code = r.plan_code
        WHERE r.claim_hash = ? AND r.status = 'approved' AND r.claimed_at IS NULL AND r.claim_expires > ?`,
    )
    .bind(hash, Date.now())
    .first<{ id: string; business_name: string; owner_name: string; phone_norm: string; business_type: BusinessType; days: number }>();
  if (!req) return c.json({ error: 'invalid_claim' }, 400);

  const now = Date.now();
  const shopId = newId();
  const ownerId = newId();
  const pw = await hashPassword(parsed.data.password, iterationsFrom(c.env.PBKDF2_ITERATIONS));
  try {
    // all or nothing; a second click on the same link fails on the username and saves nothing
    await db.batch([
      db.prepare("UPDATE signup_requests SET status = 'claimed', claimed_at = ?, shop_id = ? WHERE id = ? AND claimed_at IS NULL").bind(now, shopId, req.id),
      db.prepare('INSERT INTO shops (id, name, business_type, status, plan_until, modules, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(shopId, req.business_name, req.business_type, 'active', now + req.days * DAY, JSON.stringify(defaultModules(req.business_type)), now),
      db.prepare('INSERT INTO users (id, shop_id, name, username, password_hash, role, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
        .bind(ownerId, shopId, req.owner_name, req.phone_norm, pw, 'owner', now),
      auditStmt(db, { shopId, userId: ownerId, action: 'account_claimed', detail: { request: req.id } }),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ error: 'username_taken' }, 409);
    throw e;
  }
  await issueCookie(c, ownerId, 0);
  return c.json({ user: { id: ownerId, name: req.owner_name, role: 'owner', shopId, mustChangePassword: false } }, 201);
});
