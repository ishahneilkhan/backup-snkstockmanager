import { newId } from './ids';

export function auditStmt(
  db: D1Database,
  a: { shopId: string | null; userId: string | null; action: string; detail?: unknown },
): D1PreparedStatement {
  return db
    .prepare('INSERT INTO audit_log (id, shop_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(newId(), a.shopId, a.userId, a.action, a.detail === undefined ? null : JSON.stringify(a.detail), Date.now());
}
