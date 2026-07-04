const express = require('express');
const { z } = require('zod');
const { db, transaction } = require('../../config/db');
const { id } = require('../../utils/helpers');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { audit } = require('../../utils/audit');

const router = express.Router();

const tierSchema = z.object({
  name: z.string().min(1).max(60),
  price_cents: z.number().int().nonnegative(),
  quantity_total: z.number().int().positive(),
});

const eventSchema = z.object({
  name: z.string().min(2).max(120),
  category: z.string().max(40).default('Music'),
  venue: z.string().min(2).max(120),
  city: z.string().max(80).default(''),
  event_date: z.string().min(4),
  gate_time: z.string().max(10).default(''),
  description: z.string().max(2000).default(''),
  poster_data_url: z.string().max(6_000_000).optional(), // base64 data URL, size-capped
  tiers: z.array(tierSchema).min(1, 'At least one ticket category is required'),
});

// Public — buyers need to see published events without logging in.
router.get('/', (req, res) => {
  const events = db.prepare('SELECT * FROM events WHERE status = ? ORDER BY created_at DESC').all('published');
  const withTiers = events.map((e) => ({
    ...e,
    tiers: db.prepare('SELECT * FROM ticket_tiers WHERE event_id = ?').all(e.id),
  }));
  res.json({ events: withTiers });
});

router.get('/:id', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  event.tiers = db.prepare('SELECT * FROM ticket_tiers WHERE event_id = ?').all(event.id);
  res.json({ event });
});

// Organizer-only — publishing an event and its ticket categories in one call.
router.post('/', requireAuth, requireRole('organizer', 'admin'), validate(eventSchema), (req, res, next) => {
  try {
    const body = req.body;
    const eventId = id('evt');

    transaction(() => {
      db.prepare(
        `INSERT INTO events (id, organizer_id, name, category, venue, city, event_date, gate_time, description, poster_data_url, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'published', datetime('now'))`
      ).run(eventId, req.user.id, body.name, body.category, body.venue, body.city, body.event_date, body.gate_time, body.description, body.poster_data_url || null);

      const insertTier = db.prepare(
        'INSERT INTO ticket_tiers (id, event_id, name, price_cents, quantity_total, quantity_sold) VALUES (?,?,?,?,?,0)'
      );
      body.tiers.forEach((t) => insertTier.run(id('tier'), eventId, t.name, t.price_cents, t.quantity_total));
    });

    audit(req, req.user.id, 'event.publish', { eventId, tiers: body.tiers.length });
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    event.tiers = db.prepare('SELECT * FROM ticket_tiers WHERE event_id = ?').all(eventId);
    res.status(201).json({ event });
  } catch (err) { next(err); }
});

// Organizer dashboard — their own events + sales-to-date.
router.get('/mine/dashboard', requireAuth, requireRole('organizer', 'admin'), (req, res) => {
  const events = db.prepare('SELECT * FROM events WHERE organizer_id = ? ORDER BY created_at DESC').all(req.user.id);
  const withTiers = events.map((e) => {
    const tiers = db.prepare('SELECT * FROM ticket_tiers WHERE event_id = ?').all(e.id);
    const grossCents = tiers.reduce((s, t) => s + t.quantity_sold * t.price_cents, 0);
    return { ...e, tiers, grossCents };
  });
  res.json({ events: withTiers });
});

module.exports = router;
