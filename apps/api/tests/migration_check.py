"""Runs the migration in a real SQLite and checks the ledger rules. Run: python3 tests/migration_check.py"""
import sqlite3, pathlib, sys

here = pathlib.Path(__file__).resolve().parent.parent
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
for f in sorted((here / "migrations").glob("*.sql")):
    db.executescript(f.read_text())

def ok(cond, msg):
    print(("PASS  " if cond else "FAIL  ") + msg)
    if not cond:
        sys.exit(1)

def fails(sql, args=(), contains=""):
    try:
        db.execute(sql, args); return False
    except sqlite3.Error as e:
        return contains in str(e)

now = 1_700_000_000_000
db.execute("INSERT INTO shops (id,name,business_type,created_at) VALUES ('s1','Shop','pharmacy',?)", (now,))
db.execute("INSERT INTO users (id,shop_id,name,username,password_hash,role,created_at) VALUES ('u1','s1','O','o@x.com','h','owner',?)", (now,))
db.execute("INSERT INTO products (id,shop_id,name,base_unit,pack_size,updated_at) VALUES ('p1','s1','Napa','piece',10,?)", (now,))
db.execute("INSERT INTO batches (id,shop_id,product_id,batch_no,expiry_date,cost_e4,sell_e4,received_at,updated_at) VALUES ('b1','s1','p1','A','2030-01-01',8000,10000,?,?)", (now, now))

def move(i, qty, kind, allow=0):
    db.execute("INSERT INTO stock_movements (id,shop_id,product_id,batch_id,qty,kind,user_id,allow_negative,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
               (i, 's1', 'p1', 'b1', qty, kind, 'u1', allow, now))

stock = lambda: (db.execute("SELECT qty FROM batch_stock WHERE batch_id='b1'").fetchone() or [None])[0]

move('m1', 100, 'purchase');            ok(stock() == 100, "purchase of 100 -> stock 100 (trigger made the row)")
move('m2', -30, 'sale');                ok(stock() == 70,  "sale of 30 -> stock 70 (trigger updated the row)")
ok(fails("INSERT INTO stock_movements (id,shop_id,product_id,batch_id,qty,kind,user_id,created_at) VALUES ('m3','s1','p1','b1',-71,'sale','u1',1)", contains="insufficient stock"),
   "selling 71 when 70 are left is refused")
ok(stock() == 70,                       "refused sale left stock at 70")
move('m4', -80, 'sale', allow=1);       ok(stock() == -10, "offline sale (allow_negative=1) is accepted and goes to -10")
ok(fails("UPDATE stock_movements SET qty = 1 WHERE id='m1'", contains="append-only"), "ledger rows cannot be edited")
ok(fails("DELETE FROM stock_movements WHERE id='m1'", contains="append-only"),       "ledger rows cannot be deleted")
ok(fails("INSERT INTO stock_movements (id,shop_id,product_id,batch_id,qty,kind,user_id,created_at) VALUES ('m5','s1','p1','b1',5,'sale','u1',1)", contains="CHECK"),
   "a sale with a positive quantity is refused (sign rule)")
ok(fails("INSERT INTO batches (id,shop_id,product_id,batch_no,expiry_date,cost_e4,sell_e4,received_at,updated_at) VALUES ('b2','s1','p1','A','2030-01-01',1,1,1,1)", contains="UNIQUE"),
   "same batch number + expiry twice is refused")
ok(fails("INSERT INTO batches (id,shop_id,product_id,batch_no,expiry_date,cost_e4,sell_e4,received_at,updated_at) VALUES ('b3','s1','p1','N',NULL,1,1,1,1)") is False and
   fails("INSERT INTO batches (id,shop_id,product_id,batch_no,expiry_date,cost_e4,sell_e4,received_at,updated_at) VALUES ('b4','s1','p1','N',NULL,1,1,1,1)", contains="UNIQUE"),
   "batch with no expiry date: a duplicate is also refused")
ok(fails("INSERT INTO sales (id,shop_id,client_uuid,payment_method,total,created_by,created_at,occurred_at) VALUES ('x','s1','c1','due',10,'u1',1,1)", contains="CHECK"),
   "a sale on credit without a customer is refused")
db.execute("INSERT INTO sales (id,shop_id,client_uuid,payment_method,total,created_by,created_at,occurred_at) VALUES ('x1','s1','c2','cash',10,'u1',1,1)")
ok(fails("INSERT INTO sales (id,shop_id,client_uuid,payment_method,total,created_by,created_at,occurred_at) VALUES ('x2','s1','c2','cash',10,'u1',1,1)", contains="UNIQUE"),
   "the same client_uuid twice is refused (no double sale)")
ok(fails("INSERT INTO users (id,shop_id,name,username,password_hash,role,created_at) VALUES ('u2','s1','S','o@x.com','h','salesman',1)", contains="UNIQUE"),
   "a username can be used only once")
ok(fails("INSERT INTO users (id,shop_id,name,username,password_hash,role,created_at) VALUES ('u3',NULL,'S','s@x.com','h','owner',1)", contains="CHECK"),
   "an owner without a shop is refused")
db.execute("INSERT INTO users (id,shop_id,name,username,password_hash,role,created_at) VALUES ('sa',NULL,'Admin','admin@x.com','h','super_admin',1)")
ok(True, "a super_admin without a shop is accepted")

# ---- 0002: plans and purchase requests ----
ok(db.execute("SELECT COUNT(*), SUM(price) FROM plans").fetchone() == (3, 0), "three starter plans exist, all with price 0 (you set the prices)")
def req(i, ref, trx, status="pending"):
    return db.execute("INSERT INTO signup_requests (id,ref,status,plan_code,business_name,owner_name,phone,phone_norm,payment_method,trx_id,amount,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                      (i, ref, status, "pharmacy_year", "Shop", "Owner", "01711111111", "01711111111", "bkash", trx, 500000, now))
req("r1", "AAAA2222", "TRX123456")
ok(fails("INSERT INTO signup_requests (id,ref,plan_code,business_name,owner_name,phone,phone_norm,payment_method,trx_id,amount,created_at) VALUES ('r2','BBBB2222','pharmacy_year','S','O','1','1','bkash','TRX123456',1,1)", contains="UNIQUE"),
   "the same TrxID cannot be used for two live requests")
db.execute("UPDATE signup_requests SET status='rejected' WHERE id='r1'")
req("r3", "CCCC2222", "TRX123456")
ok(True, "after a rejection the same TrxID can be sent again")
ok(fails("INSERT INTO signup_requests (id,ref,plan_code,business_name,owner_name,phone,phone_norm,payment_method,trx_id,amount,created_at) VALUES ('r4','CCCC2222','pharmacy_year','S','O','1','1','bkash','OTHER12345',1,1)", contains="UNIQUE"),
   "a request code (ref) is unique")
ok(fails("INSERT INTO signup_requests (id,ref,status,plan_code,business_name,owner_name,phone,phone_norm,payment_method,trx_id,amount,created_at) VALUES ('r5','DDDD2222','weird','pharmacy_year','S','O','1','1','bkash','TRX999999',1,1)", contains="CHECK"),
   "an unknown request status is refused")
ok(fails("INSERT INTO signup_requests (id,ref,plan_code,business_name,owner_name,phone,phone_norm,payment_method,trx_id,amount,created_at) VALUES ('r6','EEEE2222','no_such_plan','S','O','1','1','bkash','TRX888888',1,1)", contains="FOREIGN KEY"),
   "a request for a plan that does not exist is refused")
db.execute("UPDATE signup_requests SET claim_hash='abc' WHERE id='r3'")
ok(fails("UPDATE signup_requests SET claim_hash='abc' WHERE id='r1'", contains="UNIQUE"), "a claim link hash can belong to only one request")
print("ALL MIGRATION CHECKS PASSED")
