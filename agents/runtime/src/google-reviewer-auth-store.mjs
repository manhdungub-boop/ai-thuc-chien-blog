
const TX_TTL_SECONDS = 300;

export class AgentReviewerAuthStore {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS reviewer_auth_transactions (state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, nonce TEXT NOT NULL, code_verifier TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, return_path TEXT NOT NULL DEFAULT '/')");
    const transactionColumns = this.ctx.storage.sql.exec("PRAGMA table_info(reviewer_auth_transactions)").toArray();
    if (!transactionColumns.some(column => column.name === "return_path")) {
      this.ctx.storage.sql.exec("ALTER TABLE reviewer_auth_transactions ADD COLUMN return_path TEXT NOT NULL DEFAULT '/'");
    }
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
  createTransaction(stateHash, browserHash, nonce, codeVerifier, nowSeconds, returnPath = "/") {
    if (![stateHash, browserHash, nonce, codeVerifier].every(x => typeof x === "string" && x.length >= 32 && x.length <= 128) ||
        !Number.isInteger(nowSeconds) || nowSeconds < 0 ||
        !["/", "/reviewer-console", "/operator-console"].includes(returnPath)) {
      return { created: false, reason: "invalid_login_transaction" };
    }
    this.ctx.storage.sql.exec("DELETE FROM reviewer_auth_transactions WHERE expires_at <= ?", nowSeconds);
    const active = this.ctx.storage.sql.exec("SELECT COUNT(*) AS total FROM reviewer_auth_transactions WHERE expires_at > ?", nowSeconds).toArray()[0]?.total || 0;
    if (active >= 100) return { created: false, reason: "login_transaction_capacity_reached" };
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO reviewer_auth_transactions (state_hash,browser_hash,nonce,code_verifier,created_at,expires_at,return_path) VALUES (?,?,?,?,?,?,?)", stateHash, browserHash, nonce, codeVerifier, nowSeconds, nowSeconds + TX_TTL_SECONDS, returnPath);
    const insertedRows = this.ctx.storage.sql.exec("SELECT changes() AS total").toArray()[0]?.total;
    return { created: Number(insertedRows) === 1 };
  }
  consumeTransaction(stateHash, browserHash, nowSeconds) {
    if (typeof stateHash !== "string" || stateHash.length < 32 || stateHash.length > 128 ||
        typeof browserHash !== "string" || browserHash.length < 32 || browserHash.length > 128 ||
        !Number.isInteger(nowSeconds) || nowSeconds < 0) return null;
    const row = this.ctx.storage.sql.exec(
      "SELECT * FROM reviewer_auth_transactions WHERE state_hash = ? AND expires_at > ?",
      stateHash,
      nowSeconds
    ).toArray()[0];
    // A callback attempt consumes its one-time state even when the browser binding
    // is wrong. This prevents retries from turning a stolen state value into a
    // reusable login transaction; the browser binding is still required to accept it.
    this.ctx.storage.sql.exec(
      "DELETE FROM reviewer_auth_transactions WHERE state_hash = ?",
      stateHash
    );
    if (!row || row.browser_hash !== browserHash) return null;
    return { nonce: row.nonce, code_verifier: row.code_verifier, created_at: row.created_at, expires_at: row.expires_at, return_path: row.return_path || "/" };
  }
}

