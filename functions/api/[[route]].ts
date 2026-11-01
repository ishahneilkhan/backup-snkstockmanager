// Every request to /api/... on the Pages site is handled by the Hono app in apps/api/src.
import { handle } from 'hono/cloudflare-pages';
import app from '../../apps/api/src/index';

export const onRequest = handle(app);
