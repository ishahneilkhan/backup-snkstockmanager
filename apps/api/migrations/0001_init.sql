-- Core schema for Cloudflare D1 (SQLite). Run: npm run db:local   /   npm run db:remote
-- Conventions
--   ids: text (ULID made in the app)           time: integer, milliseconds since 1970 (UTC)
--   money totals: integer POISHA (1 taka = 100)
--   unit prices/costs: integer in 1/10000 taka PER BASE UNIT (columns ending _e4)
--   quantities: integer in BASE units (piece, gram, ml)
--   every business table has shop_id; every query must filter by the shop of the logged-in user.

CREATE TABLE shops (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  business_type TEXT NOT NULL CHECK (business_type IN ('pharmacy','grocery','restaurant')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  plan_until    INTEGER,                              -- NULL = no end date
  modules       TEXT NOT NULL DEFAULT '[]',           -- JSON array, e.g. ["batches","expiry"]
  db_key        TEXT NOT NULL DEFAULT 'main',         -- which D1 database holds this shop (for splitting later)
  created_at    INTEGER NOT NULL
);

CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  shop_id              TEXT REFERENCES shops(id),
  name                 TEXT NOT NULL,
  username             TEXT NOT NULL UNIQUE,          -- phone number or email, lower case
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('super_admin','owner','salesman')),
  active               INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  token_version        INTEGER NOT NULL DEFAULT 0,    -- raise it to sign the user out everywhere
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
  last_login_at        INTEGER,
  created_at           INTEGER NOT NULL,
  CHECK ((role = 'super_admin' AND shop_id IS NULL) OR (role <> 'super_admin' AND shop_id IS NOT NULL))
);
CREATE INDEX users_shop_idx ON users (shop_id);

CREATE TABLE login_attempts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  ip       TEXT NOT NULL,
  ts       INTEGER NOT NULL
);
CREATE INDEX la_user_idx ON login_attempts (username, ts);
CREATE INDEX la_ip_idx   ON login_attempts (ip, ts);

CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  shop_id    TEXT,
  user_id    TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,                                    -- JSON
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_shop_idx ON audit_log (shop_id, created_at);

CREATE TABLE products (
  id           TEXT PRIMARY KEY,
  shop_id      TEXT NOT NULL REFERENCES shops(id),
  name         TEXT NOT NULL,
  generic_name TEXT,
  company      TEXT,
  category     TEXT,
  barcode      TEXT,
  base_unit    TEXT NOT NULL CHECK (base_unit IN ('piece','gram','ml')),
  pack_unit    TEXT NOT NULL DEFAULT 'piece',         -- strip, box, kg, litre ...
  pack_size    INTEGER NOT NULL DEFAULT 1 CHECK (pack_size > 0),   -- base units per pack
  min_stock    INTEGER NOT NULL DEFAULT 0,            -- base units
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  updated_at   INTEGER NOT NULL                       -- for "what changed since" sync
);
CREATE UNIQUE INDEX products_barcode_uq ON products (shop_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX products_name_idx ON products (shop_id, name);
CREATE INDEX products_updated_idx ON products (shop_id, updated_at);

CREATE TABLE batches (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  product_id  TEXT NOT NULL REFERENCES products(id),
  batch_no    TEXT NOT NULL,
  expiry_date TEXT,                                   -- 'YYYY-MM-DD', NULL = no expiry
  cost_e4     INTEGER NOT NULL CHECK (cost_e4 >= 0),  -- per base unit
  sell_e4     INTEGER NOT NULL CHECK (sell_e4 >= 0),  -- per base unit
  received_at INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX batches_uq ON batches (product_id, batch_no, COALESCE(expiry_date, ''));
CREATE INDEX batches_product_idx ON batches (shop_id, product_id, expiry_date);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL, phone TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX suppliers_shop_idx ON suppliers (shop_id);

CREATE TABLE customers (
  id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shops(id),
  client_uuid TEXT UNIQUE,                            -- set when a device creates the customer offline
  name TEXT NOT NULL, phone TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX customers_shop_idx ON customers (shop_id);

CREATE TABLE purchases (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  invoice_no  TEXT,
  total       INTEGER NOT NULL CHECK (total >= 0),    -- poisha
  paid        INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0),
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL
);
CREATE INDEX purchases_shop_idx ON purchases (shop_id, created_at);

CREATE TABLE purchase_items (
  id          TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  batch_id    TEXT NOT NULL REFERENCES batches(id),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  cost_e4     INTEGER NOT NULL CHECK (cost_e4 >= 0)
);
CREATE INDEX purchase_items_idx ON purchase_items (purchase_id);

CREATE TABLE sales (
  id             TEXT PRIMARY KEY,
  shop_id        TEXT NOT NULL REFERENCES shops(id),
  client_uuid    TEXT NOT NULL UNIQUE,                -- made on the device; a retry never sells twice
  customer_id    TEXT REFERENCES customers(id),
  discount       INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),   -- poisha
  total          INTEGER NOT NULL CHECK (total >= 0),                -- poisha, after discount
  paid           INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bkash','nagad','card','due')),
  created_by     TEXT NOT NULL REFERENCES users(id),
  created_at     INTEGER NOT NULL,                    -- when the server saved it
  occurred_at    INTEGER NOT NULL,                    -- when the sale really happened (device clock)
  device_id      TEXT,
  local_no       TEXT,
  needs_review   INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0,1)),
  review_note    TEXT,
  CHECK (payment_method <> 'due' OR customer_id IS NOT NULL)
);
CREATE INDEX sales_shop_created_idx  ON sales (shop_id, created_at);
CREATE INDEX sales_shop_occurred_idx ON sales (shop_id, occurred_at);
CREATE INDEX sales_customer_idx      ON sales (customer_id);
CREATE INDEX sales_review_idx        ON sales (shop_id) WHERE needs_review = 1;

CREATE TABLE sale_items (            -- one row per batch the sale took from
  id           TEXT PRIMARY KEY,
  sale_id      TEXT NOT NULL REFERENCES sales(id),
  product_id   TEXT NOT NULL REFERENCES products(id),
  batch_id     TEXT NOT NULL REFERENCES batches(id),
  qty          INTEGER NOT NULL CHECK (qty > 0),
  price_e4     INTEGER NOT NULL CHECK (price_e4 >= 0),
  cost_e4      INTEGER NOT NULL CHECK (cost_e4 >= 0)
);
CREATE INDEX sale_items_sale_idx ON sale_items (sale_id);

CREATE TABLE payments (             -- later payments only (a due collected, a supplier paid)
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  client_uuid TEXT UNIQUE,
  party_type  TEXT NOT NULL CHECK (party_type IN ('customer','supplier')),
  party_id    TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),    -- poisha
  method      TEXT NOT NULL DEFAULT 'cash',
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL
);
CREATE INDEX payments_party_idx ON payments (shop_id, party_type, party_id);

-- STOCK LEDGER: the only source of truth for stock. Rows are never edited or deleted.
CREATE TABLE stock_movements (
  id             TEXT PRIMARY KEY,
  shop_id        TEXT NOT NULL REFERENCES shops(id),
  product_id     TEXT NOT NULL REFERENCES products(id),
  batch_id       TEXT NOT NULL REFERENCES batches(id),
  qty            INTEGER NOT NULL,                    -- signed, base units
  kind           TEXT NOT NULL CHECK (kind IN ('purchase','sale','sale_return','adjustment','waste','supplier_return')),
  ref_type       TEXT,
  ref_id         TEXT,
  reason         TEXT,
  user_id        TEXT NOT NULL REFERENCES users(id),
  allow_negative INTEGER NOT NULL DEFAULT 0 CHECK (allow_negative IN (0,1)),  -- 1 only for offline sync
  created_at     INTEGER NOT NULL,
  CHECK (
    (kind IN ('purchase','sale_return') AND qty > 0) OR
    (kind IN ('sale','waste','supplier_return') AND qty < 0) OR
    (kind = 'adjustment' AND qty <> 0)
  )
);
CREATE INDEX sm_batch_idx   ON stock_movements (batch_id);
CREATE INDEX sm_product_idx ON stock_movements (shop_id, product_id, created_at);
CREATE INDEX sm_ref_idx     ON stock_movements (ref_type, ref_id);

-- Current stock per batch, kept in step with the ledger by a trigger (fast reads, no re-adding history).
CREATE TABLE batch_stock (
  batch_id   TEXT PRIMARY KEY REFERENCES batches(id),
  shop_id    TEXT NOT NULL,
  product_id TEXT NOT NULL,
  qty        INTEGER NOT NULL
);
CREATE INDEX batch_stock_product_idx ON batch_stock (shop_id, product_id);

-- Refuse a movement that would take a batch below zero (unless it is a flagged offline sale).
CREATE TRIGGER sm_guard BEFORE INSERT ON stock_movements
WHEN NEW.allow_negative = 0 AND NEW.qty < 0
 AND COALESCE((SELECT qty FROM batch_stock WHERE batch_id = NEW.batch_id), 0) + NEW.qty < 0
BEGIN
  SELECT RAISE(ABORT, 'insufficient stock');
END;

CREATE TRIGGER sm_apply AFTER INSERT ON stock_movements
BEGIN
  INSERT INTO batch_stock (batch_id, shop_id, product_id, qty)
  VALUES (NEW.batch_id, NEW.shop_id, NEW.product_id, NEW.qty)
  ON CONFLICT (batch_id) DO UPDATE SET qty = qty + NEW.qty;
END;

CREATE TRIGGER sm_no_update BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements is append-only');
END;

CREATE TRIGGER sm_no_delete BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements is append-only');
END;
