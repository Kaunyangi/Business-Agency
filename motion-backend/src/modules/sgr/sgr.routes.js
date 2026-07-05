const express = require('express');
const { z } = require('zod');
const { db, transaction } = require('../../config/db');
const { id } = require('../../utils/helpers');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { idempotent } = require('../../middleware/idempotency');
const { charge } = require('../payments/providers');
const revenue = require('../revenue/revenue.service');
const documents = require('../documents/documents.service');
const { audit } = require('../../utils/audit');

const router = express.Router();

router.get('/', (req, res) => {
  const { origin, destination, date } = req.query;
  const clauses = [];
  const params = [];
  if (origin) { clauses.push('origin LIKE ?'); params.push(`%${origin}%`); }
  if (destination) { clauses.push('destination LIKE ?'); params.push(`%${destination}%`); }
  if (date) { clauses.push('trip_date = ?'); params.push(date); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const trips = db.prepare(`SELECT * FROM sgr_trips ${where} ORDER BY trip_date, departs_at`).all(...params);
  res.json({ trips });
});

router.get('/:id/seats', (req, res) => {
  const trip = db.prepare('SELECT * FROM sgr_trips WHERE id = ?').get(req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  const seats = db.prepare('SELECT id, row_no, letter, cabin_class, status FROM sgr_seats WHERE trip_id = ? ORDER BY row_no, letter').all(trip.id);
  res.json({ trip, seats });
});

const bookSchema = z.object({
  tripId: z.string(),
  seatIds: z.array(z.string()).min(1).max(9),
  paymentMethod: z.enum(['mpesa', 'card', 'wallet']),
  payerRef: z.string().min(1),
  buyerName: z.string().min(2).max(100),
  buyerPhone: z.string().min(7).max(20),
  buyerEmail: z.string().email(),
  buyerIdNumber: z.string().max(40).optional(),
});

router.post('/checkout', requireAuth, idempotent, validate(bookSchema), async (req, res, next) => {
  try {
    if (req.idempotentReplay) return res.json({ order: req.idempotentReplay, replay: true });
    const { tripId, seatIds, paymentMethod, payerRef, buyerName, buyerPhone, buyerEmail, buyerIdNumber } = req.body;

    const built = transaction(() => {
      const trip = db.prepare('SELECT * FROM sgr_trips WHERE id = ?').get(tripId);
      if (!trip) throw Object.assign(new Error('Trip not found'), { status: 404 });

      let subtotalCents = 0;
      const lineItems = [];
      for (const seatId of seatIds) {
        const seat = db.prepare('SELECT * FROM sgr_seats WHERE id = ? AND trip_id = ?').get(seatId, tripId);
        if (!seat) throw Object.assign(new Error(`Seat ${seatId} not found`), { status: 404 });
        if (seat.status !== 'available') throw Object.assign(new Error(`Seat ${seat.row_no}${seat.letter} is no longer available`), { status: 409 });

        db.prepare('UPDATE sgr_seats SET status = ? WHERE id = ?').run('booked', seat.id);
        const fare = seat.cabin_class === 'business' ? trip.first_class_fare_cents : trip.economy_fare_cents;
        subtotalCents += fare;
        lineItems.push({ ref_type: 'sgr_seat', ref_id: seat.id, description: `${trip.train_no} · ${trip.trip_date} ${trip.departs_at} — Seat ${seat.row_no}${seat.letter} (${seat.cabin_class === 'business' ? 'First Class' : 'Economy'})`, unit_price_cents: fare, quantity: 1, line_total_cents: fare });
      }
      const { amountCents: commissionCents, ruleKey } = revenue.computeCommission('sgr', subtotalCents);
      const totalCents = subtotalCents; // commission absorbed on payout side, invisible to buyer — same model as flights

      const orderId = id('ord');
      db.prepare(
        `INSERT INTO orders (id, user_id, order_type, status, subtotal_cents, commission_cents, fees_cents, total_cents, idempotency_key, buyer_name, buyer_phone, buyer_email, buyer_id_number, created_at)
         VALUES (?,?, 'sgr', 'pending', ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(orderId, req.user.id, subtotalCents, commissionCents, totalCents, req.idempotencyKey || null, buyerName, buyerPhone, buyerEmail, buyerIdNumber || null);

      const insertItem = db.prepare('INSERT INTO order_items (id, order_id, ref_type, ref_id, description, unit_price_cents, quantity, line_total_cents) VALUES (?,?,?,?,?,?,?,?)');
      lineItems.forEach((li) => insertItem.run(id('item'), orderId, li.ref_type, li.ref_id, li.description, li.unit_price_cents, li.quantity, li.line_total_cents));

      return { orderId, totalCents, ruleKey, commissionCents, trip, seatIds };
    });

    const paymentResult = await charge({ method: paymentMethod, amountCents: built.totalCents, payerRef, description: `Motion SGR — ${built.trip.train_no}` });

    if (paymentResult.status !== 'success') {
      transaction(() => {
        built.seatIds.forEach((sid) => db.prepare('UPDATE sgr_seats SET status = ? WHERE id = ?').run('available', sid));
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('failed', built.orderId);
      });
      return res.status(402).json({ error: 'Payment failed', detail: paymentResult.raw });
    }

    transaction(() => {
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('paid', built.orderId);
      db.prepare('INSERT INTO payments (id, order_id, provider, provider_ref, status, amount_cents, created_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))').run(id('pay'), built.orderId, paymentMethod, paymentResult.providerRef, 'success', built.totalCents);
      revenue.recordLedgerEntry(built.orderId, built.ruleKey, built.commissionCents);
    });

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(built.orderId);
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(built.orderId);
    const payment = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(built.orderId);
    const buyer = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    const receipt = documents.generateReceipt(order, orderItems, payment, buyer);

    audit(req, req.user.id, 'sgr.book', { orderId: built.orderId, totalCents: built.totalCents });
    res.status(201).json({ order, items: orderItems, payment, receiptId: receipt.id });
  } catch (err) { next(err); }
});

module.exports = router;
