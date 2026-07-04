const express = require('express');
const { z } = require('zod');
const { db } = require('../../config/db');
const { id } = require('../../utils/helpers');
const { hashPassword, comparePassword, signToken } = require('../../utils/auth-crypto');
const { validate } = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const { audit } = require('../../utils/audit');

const router = express.Router();

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['buyer', 'organizer']).default('buyer'),
});

router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const passwordHash = await hashPassword(password);
    const userId = id('usr');
    db.prepare(
      'INSERT INTO users (id, name, email, password_hash, role, wallet_balance_cents, created_at) VALUES (?,?,?,?,?,0,datetime(\'now\'))'
    ).run(userId, name, email, passwordHash, role);

    audit(req, userId, 'user.register', { role });

    const user = { id: userId, name, email, role, wallet_balance_cents: 0 };
    res.status(201).json({ token: signToken(user), user });
  } catch (err) { next(err); }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    // Deliberately generic error — do not reveal whether the email exists.
    if (!row) return res.status(401).json({ error: 'Invalid email or password' });

    const ok = await comparePassword(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    audit(req, row.id, 'user.login', {});
    const user = { id: row.id, name: row.name, email: row.email, role: row.role, wallet_balance_cents: row.wallet_balance_cents };
    res.json({ token: signToken(user), user });
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
