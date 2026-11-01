import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './types';
import { admin } from './routes/admin';
import { auth } from './routes/auth';

const app = new Hono<AppEnv>();

app.use('*', secureHeaders());

// Cookies are SameSite=Lax; also require JSON bodies on writes, which a cross-site HTML form cannot send.
app.use('/api/*', async (c, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    if (!(c.req.header('content-type') ?? '').includes('application/json')) return c.json({ error: 'json_required' }, 415);
  }
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/auth', auth);
app.route('/api/admin', admin);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'server_error' }, 500);
});

export default app;
