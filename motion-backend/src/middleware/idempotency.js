// Prevents double-charging on retried requests (flaky mobile networks are
// the norm for the target market — a checkout button double-tap or a retried
// POST must never create two orders). The client sends an Idempotency-Key
// header; if we've already produced an order for that key, we return the
// stored result instead of re-running the charge.
const { db } = require('../config/db');

function idempotent(req, res, next) {
  const key = req.headers['idempotency-key'];
  if (!key) return next(); // optional — caller can still proceed without one, but should not in production clients

  const existing = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(key);
  if (existing) {
    req.idempotentReplay = existing;
  }
  req.idempotencyKey = key;
  next();
}

module.exports = { idempotent };
