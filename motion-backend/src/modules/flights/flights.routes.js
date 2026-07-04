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
  const flights = db.prepare('SELECT * FROM flights ORDER BY airline').all();
  res.json({ flights });
});

router.get('/:id/seats', (req, res) => {
  const flight = db.prepare('SELECT * FROM flights WHERE id = ?').get(req.params.id);
  if (!flight) return res.status(404).json({ error: 'Flight not found' });
  const seats = db.prepare('SELECT id, row_no, letter, cabin_class, status FROM flight_seats WHERE flight_id = ? ORDER BY row_no, letter').all(flight.id);
  res.json({ flight, seats });
});

const bookSchema = z.object({
  flightId: z.string(),
  seatIds: z.array(z.string()).min(1).max(9),
  paymentMethod: z.enum(['mpesa', 'card', 'wallet']),
  payerRef: z.string().min(1),
});

router.post('/checkout', requireAuth, idempotent, validate(bookSchema), async (req, res, next) => {
  try {
    if (req.idempotentReplay) return res.json({ order: req.idempotentReplay, replay: true });
    const { flightId, seatIds, paymentMethod, payerRef } = req.body;

    const built = transaction(() => {
      const flight = db.prepare('SELECT * FROM flights WHERE id = ?').get(flightId);
      if (!flight) throw Object.assign(new Error('Flight not found'), { status: 404 });

      let subtotalCents = 0;
      const lineItems = [];
      for (const seatId of seatIds) {
        const seat = db.prepare('SELECT * FROM flight_seats WHERE id = ? AND flight_id = ?').get(seatId, flightId);
        if (!seat) throw Object.assign(new Error(`Seat ${seatId} not found`), { status: 404 });
        if (seat.status !== 'available') throw Object.assign(new Error(`Seat ${seat.row_no}${seat.letter} is no longer available`), { status: 409 });

        db.prepare('UPDATE flight_seats SET status = ? WHERE id = ?').run('booked', seat.id);
        const fare = seat.cabin_class === 'business' ? flight.business_fare_cents : flight.economy_fare_cents;
        subtotalCents += fare;
        lineItems.push({ ref_type: 'flight_seat', ref_id: seat.id, description: `${flight.airline} ${flight.flight_no} — Seat ${seat.row_no}${seat.letter} (${seat.cabin_class})`, unit_price_cents: fare, quantity: 1, line_total_cents: fare });
      }
      const taxesCents = seatIds.length * 120000; // KES 1,200 pass-through tax per passenger, not platform revenue
      const { amountCents: commissionCents, ruleKey } = revenue.computeCommission('flight', subtotalCents);
      const totalCents = subtotalCents + taxesCents;

      const orderId = id('ord');
      db.prepare(
        `INSERT INTO orders (id, user_id, order_type, status, subtotal_cents, commission_cents, fees_cents, total_cents, idempotency_key, created_at)
         VALUES (?,?, 'flight', 'pending', ?, ?, ?, ?, ?, datetime('now'))`
      ).run(orderId, req.user.id, subtotalCents, commissionCents, taxesCents, totalCents, req.idempotencyKey || null);

      const insertItem = db.prepare('INSERT INTO order_items (id, order_id, ref_type, ref_id, description, unit_price_cents, quantity, line_total_cents) VALUES (?,?,?,?,?,?,?,?)');
      lineItems.forEach((li) => insertItem.run(id('item'), orderId, li.ref_type, li.ref_id, li.description, li.unit_price_cents, li.quantity, li.line_total_cents));
      insertItem.run(id('item'), orderId, 'tax', null, 'Airport taxes & fees', taxesCents, 1, taxesCents);

      return { orderId, totalCents, ruleKey, commissionCents, flight, seatIds };
    });

    const paymentResult = await charge({ method: paymentMethod, amountCents: built.totalCents, payerRef, description: `Motion flight — ${built.flight.airline} ${built.flight.flight_no}` });

    if (paymentResult.status !== 'success') {
      transaction(() => {
        built.seatIds.forEach((sid) => db.prepare('UPDATE flight_seats SET status = ? WHERE id = ?').run('available', sid));
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

    audit(req, req.user.id, 'flight.book', { orderId: built.orderId, totalCents: built.totalCents });
    res.status(201).json({ order, items: orderItems, payment, receiptId: receipt.id });
  } catch (err) { next(err); }
});

module.exports = router;
