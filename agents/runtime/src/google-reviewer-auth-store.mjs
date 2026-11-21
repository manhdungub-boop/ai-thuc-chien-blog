import { DurableObject } from "cloudflare:workers";

const TX_TTL_SECONDS = 300;

export class AgentReviewerAuthStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS reviewer_auth_transactions (state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, nonce TEXT NOT NULL, code_verifier TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)");
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS reviewer_auth_transactions_expiry ON reviewer_auth_transactions(expires_at)");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS reviewer_auth_start_rate_limit (id INTEGER PRIMARY KEY CHECK (id = 1), window_started_at INTEGER NOT NULL, attempts INTEGER NOT NULL)");
  }
  consumeStartRateLimit(nowSeconds) {
    if (!Number.isInteger(nowSeconds) || nowSeconds < 0) return { allowed: false, retry_after_seconds: 60 };
    const row = this.ctx.storage.sql.exec("SELECT window_started_at, attempts FROM reviewer_auth_start_rate_limit WHERE id = 1").toArray()[0];
    if (!row || nowSeconds >= row.window_started_at + 60) {
      this.ctx.storage.sql.exec("INSERT INTO reviewer_auth_start_rate_limit (id, window_started_at, attempts) VALUES (1, ?, 1) ON CONFLICT(id) DO UPDATE SET window_started_at = excluded.window_started_at, attempts = 1", nowSeconds);
      return { allowed: true, remaining: 9 };
    }
    if (row.attempts >= 10) return { allowed: false, retry_after_seconds: Math.max(1, row.window_started_at + 60 - nowSeconds) };
    this.ctx.storage.sql.exec("UPDATE reviewer_auth_start_rate_limit SET attempts = attempts + 1 WHERE id = 1");
    return { allowed: true, remaining: 9 - row.attempts };
  }
  createTransaction(stateHash, browserHash, nonce, codeVerifier, nowSeconds) {
    if (![stateHash, browserHash, nonce, codeVerifier].every(x => typeof x === "string" && x.length >= 32 && x.length <= 128) || !Number.isInteger(nowSeconds)) return { created: false };
    this.ctx.storage.sql.exec("DELETE FROM reviewer_auth_transactions WHERE expires_at <= ?", nowSeconds);
    const active = this.ctx.storage.sql.exec("SELECT COUNT(*) AS total FROM reviewer_auth_transactions WHERE expires_at > ?", nowSeconds).toArray()[0]?.total || 0;
    if (active >= 100) return { created: false, reason: "login_transaction_capacity_reached" };
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO reviewer_auth_transactions (state_hash,browser_hash,nonce,code_verifier,created_at,expires_at) VALUES (?,?,?,?,?,?)", stateHash, browserHash, nonce, codeVerifier, nowSeconds, nowSeconds + TX_TTL_SECONDS);
    const insertedRows = this.ctx.storage.sql.exec("SELECT changes() AS total").toArray()[0]?.total;
    return { created: Number(insertedRows) === 1 };
  }
  consumeTransaction(stateHash, browserHash, nowSeconds) {
    const row = this.ctx.storage.sql.exec("SELECT * FROM reviewer_auth_transactions WHERE state_hash = ? AND browser_hash = ? AND expires_at > ?", stateHash, browserHash, nowSeconds).toArray()[0];
    this.ctx.storage.sql.exec("DELETE FROM reviewer_auth_transactions WHERE state_hash = ? AND browser_hash = ? AND expires_at > ?", stateHash, browserHash, nowSeconds);
    if (!row) return null;
    return { nonce: row.nonce, code_verifier: row.code_verifier, created_at: row.created_at, expires_at: row.expires_at };
  }
}

