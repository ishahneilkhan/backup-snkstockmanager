# apps/api: Cloudflare Worker (ধাপ ১)

লগইন, সুপার-অ্যাডমিন, ক্লায়েন্ট খোলা, আর পুরো কোর স্কিমা (D1)।

## প্রথমবার চালানো

```
cd apps/api
npm install
npx wrangler login
npx wrangler d1 create inventory-main        # যে database_id দেবে, সেটা wrangler.toml-এ বসান
npm run db:local                             # লোকাল ডাটাবেসে মাইগ্রেশন
echo "JWT_SECRET=এখানে-অনেক-লম্বা-এলোমেলো-লেখা" > .dev.vars   # কমিট হবে না (.gitignore-এ আছে)
ADMIN_PASSWORD='১২+ অক্ষরের পাসওয়ার্ড' node scripts/make-super-admin-sql.mjs আপনার@ইমেইল "আপনার নাম" > admin.local.sql
npx wrangler d1 execute inventory-main --local --file=admin.local.sql
npm run dev
```

## ঠিক আছে কি না দেখা

```
python3 tests/migration_check.py     # স্কিমা ও স্টক নিয়ম (শুধু Python লাগে)
npm test                             # পাসওয়ার্ড ও আইডি
npm run typecheck
```

## API

| পথ | কে | কাজ |
|---|---|---|
| `POST /api/auth/login` | সবাই | `{username, password}` |
| `POST /api/auth/logout` | সবাই | |
| `GET /api/auth/me` | লগইন করা | |
| `POST /api/auth/change-password` | লগইন করা | `{current, next}` |
| `GET /api/admin/shops` | super_admin | ক্লায়েন্ট তালিকা |
| `POST /api/admin/shops` | super_admin | নতুন ক্লায়েন্ট ও মালিক খোলা, অস্থায়ী পাসওয়ার্ড একবারই দেখায় |
| `PATCH /api/admin/shops/:id` | super_admin | বন্ধ/চালু, মেয়াদ, মডিউল |
| `POST /api/admin/shops/:id/reset-owner-password` | super_admin | |

সব লেখার অনুরোধে `Content-Type: application/json` লাগে।
