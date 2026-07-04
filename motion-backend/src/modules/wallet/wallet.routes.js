const express = require('express');
const { z } = require('zod');
const { db, transaction } = require('../../config/db');
const { id, toCents } = require('../../utils/helpers');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { charge } = require('../payments/providers');
const { audit } = require('../../utils/audit');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const user = db.prepare('SELECT wallet_balance_cents FROM users WHERE id = ?').get(req.user.id);
  const history = db
    .prepare('SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 25')
    .all(req.user.id);
  res.json({ balanceCents: user.wallet_balance_cents, history });
});

const topupSchema = z.object({
  amountKES: z.number().positive().max(1_000_000),
  method: z.enum(['mpesa', 'card']),
  payerRef: z.string().min(3), // phone number for mpesa, masked card ref for card
});

router.post('/topup', validate(topupSchema), async (req, res, next) => {
  try {
    const { amountKES, method, payerRef } = req.body;
    const amountCents = toCents(amountKES);

    // Charge the external rail first (money must actually arrive before we credit the wallet).
    const result = await charge({ method, amountCents, payerRef, description: 'Motion Pay top-up' });
    if (result.status !== 'success') {
      return res.status(402).json({ error: 'Top-up failed at payment provider', detail: result.raw });
    }

    const newBalance = transaction(() => {
      const user = db.prepare('SELECT wallet_balance_cents FROM users WHERE id = ?').get(req.user.id);
      const next = user.wallet_balance_cents + amountCents;
      db.prepare('UPDATE users SET wallet_balance_cents = ? WHERE id = ?').run(next, req.user.id);
      db.prepare(
        'INSERT INTO wallet_transactions (id, user_id, type, amount_cents, balance_after_cents, reference, created_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))'
      ).run(id('wtx'), req.user.id, 'topup', amountCents, next, result.providerRef);
      return next;
    });

    audit(req, req.user.id, 'wallet.topup', { amountCents, method, providerRef: result.providerRef });
    res.json({ balanceCents: newBalance, providerRef: result.providerRef });
  } catch (err) { next(err); }
});

module.exports = router;
