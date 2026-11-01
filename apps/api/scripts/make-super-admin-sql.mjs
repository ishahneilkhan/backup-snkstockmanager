// Makes the SQL that creates YOUR super-admin account (the first account; nobody can sign up for it).
//   ADMIN_PASSWORD='a long password' node scripts/make-super-admin-sql.mjs you@example.com "Your Name" > admin.local.sql
//   npx wrangler d1 execute inventory-main --remote --file=admin.local.sql
// The password comes from an environment variable so it does not end up in your shell history as an argument.
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';

const [username, name] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;
if (!username || !name || !password || password.length < 12) {
  console.error('Usage: ADMIN_PASSWORD=<12+ chars> node scripts/make-super-admin-sql.mjs <username> "<Name>"');
  process.exit(1);
}
const iterations = 100000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
const stored = `pbkdf2$sha256$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
console.log(
  `INSERT INTO users (id, shop_id, name, username, password_hash, role, must_change_password, created_at) VALUES (` +
    `${q(randomUUID())}, NULL, ${q(name)}, ${q(username.trim().toLowerCase())}, ${q(stored)}, 'super_admin', 0, ${Date.now()});`,
);
