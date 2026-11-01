-- Public website: plans, and purchase requests (manual payment now, a payment gateway can fill the same table later).

CREATE TABLE plans (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  business_type TEXT NOT NULL CHECK (business_type IN ('pharmacy','grocery','restaurant')),
  price         INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),   -- poisha for the whole period; 0 = not set yet
  days          INTEGER NOT NULL DEFAULT 365 CHECK (days > 0),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort          INTEGER NOT NULL DEFAULT 0
);
INSERT INTO plans (code, name, business_type, price, days, sort) VALUES
  ('pharmacy_year',   'ফার্মেসি, বার্ষিক',     'pharmacy',   0, 365, 1),
  ('grocery_year',    'গ্রোসারি, বার্ষিক',     'grocery',    0, 365, 2),
  ('restaurant_year', 'রেস্টুরেন্ট, বার্ষিক', 'restaurant', 0, 365, 3);

CREATE TABLE signup_requests (
  id             TEXT PRIMARY KEY,
  ref            TEXT NOT NULL UNIQUE,                 -- short code the customer keeps
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','claimed')),
  plan_code      TEXT NOT NULL REFERENCES plans(code),
  business_name  TEXT NOT NULL,
  owner_name     TEXT NOT NULL,
  phone          TEXT NOT NULL,
  phone_norm     TEXT NOT NULL,                        -- becomes the owner's username
  payment_method TEXT NOT NULL CHECK (payment_method IN ('bkash','nagad','bank')),
  trx_id         TEXT NOT NULL,
  amount         INTEGER NOT NULL CHECK (amount >= 0), -- poisha the customer says they paid
  ip             TEXT,
  note           TEXT,
  created_at     INTEGER NOT NULL,
  reviewed_by    TEXT REFERENCES users(id),
  reviewed_at    INTEGER,
  claim_hash     TEXT UNIQUE,                          -- SHA-256 of the one-time link token (the token itself is never stored)
  claim_expires  INTEGER,
  claimed_at     INTEGER,
  shop_id        TEXT REFERENCES shops(id)
);
CREATE UNIQUE INDEX sr_trx_uq ON signup_requests (trx_id) WHERE status <> 'rejected';
CREATE INDEX sr_status_idx ON signup_requests (status, created_at);
CREATE INDEX sr_ip_idx ON signup_requests (ip, created_at);
