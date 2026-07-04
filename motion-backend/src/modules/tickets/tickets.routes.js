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
router.use(requireAuth);

const checkoutSchema = z.object({
  eventId: z.string(),
  items: z.array(z.object({ tierId: z.string(), quantity: z.number().int().positive() })).min(1),
  paymentMethod: z.enum(['mpesa', 'card', 'wallet']),
  payerRef: z.string().min(1),
});

router.post('/checkout', idempotent, validate(checkoutSchema), async (req, res, next) => {
  try {
    if (req.idempotentReplay) {
      return res.json({ order: req.idempotentReplay, replay: true });
    }
    const { eventId, items, paymentMethod, payerRef } = req.body;

    // --- 1. Inventory hold + price calculation happens inside one write
    //     transaction so two simultaneous buyers can never oversell a tier
    //     (classic double-booking race condition). ---
    const built = transaction(() => {
      const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
      if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });

      let subtotalCents = 0;
      const lineItems = [];
      for (const it of items) {
        const tier = db.prepare('SELECT * FROM ticket_tiers WHERE id = ? AND event_id = ?').get(it.tierId, eventId);
        if (!tier) throw Object.assign(new Error(`Ticket category ${it.tierId} not found`), { status: 404 });
        const remaining = tier.quantity_total - tier.quantity_sold;
        if (it.quantity > remaining) {
          throw Object.assign(new Error(`Only ${remaining} left for "${tier.name}"`), { status: 409 });
        }
        // reserve immediately — this IS the inventory lock, not a separate step
        db.prepare('UPDATE ticket_tiers SET quantity_sold = quantity_sold + ? WHERE id = ?').run(it.quantity, tier.id);
        const lineTotal = tier.price_cents * it.quantity;
        subtotalCents += lineTotal;
        lineItems.push({ ref_type: 'ticket_tier', ref_id: tier.id, description: `${event.name} — ${tier.name}`, unit_price_cents: tier.price_cents, quantity: it.quantity, line_total_cents: lineTotal });
      }

      const { amountCents: commissionCents, ruleKey } = revenue.computeCommission('ticket', subtotalCents);
      const totalCents = subtotalCents; // buyer pays subtotal; commission is deducted from organizer payout, not added on top
      const orderId = id('ord');
      db.prepare(
        `INSERT INTO orders (id, user_id, order_type, status, subtotal_cents, commission_cents, fees_cents, total_cents, idempotency_key, created_at)
         VALUES (?,?, 'ticket', 'pending', ?, ?, 0, ?, ?, datetime('now'))`
      ).run(orderId, req.user.id, subtotalCents, commissionCents, totalCents, req.idempotencyKey || null);

      const insertItem = db.prepare(
        'INSERT INTO order_items (id, order_id, ref_type, ref_id, description, unit_price_cents, quantity, line_total_cents) VALUES (?,?,?,?,?,?,?,?)'
      );
      lineItems.forEach((li) => insertItem.run(id('item'), orderId, li.ref_type, li.ref_id, li.description, li.unit_price_cents, li.quantity, li.line_total_cents));

      return { orderId, totalCents, ruleKey, commissionCents, event, organizerId: event.organizer_id };
    });

    // --- 2. Charge the payment rail OUTSIDE the DB transaction (external
    //     I/O should never hold a DB lock open). If it fails, we release
    //     the inventory we reserved above. ---
    const paymentResult = await charge({ method: paymentMethod, amountCents: built.totalCents, payerRef, description: `Motion ticket — ${built.event.name}` });

    if (paymentResult.status !== 'success') {
      transaction(() => {
        // release held inventory
        const rows = db.prepare('SELECT ref_id, quantity FROM order_items WHERE order_id = ?').all(built.orderId);
        rows.forEach((r) => db.prepare('UPDATE ticket_tiers SET quantity_sold = quantity_sold - ? WHERE id = ?').run(r.quantity, r.ref_id));
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('failed', built.orderId);
      });
      return res.status(402).json({ error: 'Payment failed', detail: paymentResult.raw });
    }

    // --- 3. Mark paid, record payment, record commission in the revenue ledger, generate documents. ---
    transaction(() => {
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('paid', built.orderId);
      db.prepare(
        'INSERT INTO payments (id, order_id, provider, provider_ref, status, amount_cents, created_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))'
      ).run(id('pay'), built.orderId, paymentMethod, paymentResult.providerRef, 'success', built.totalCents);
      revenue.recordLedgerEntry(built.orderId, built.ruleKey, built.commissionCents);
    });

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(built.orderId);
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(built.orderId);
    const payment = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(built.orderId);
    const buyer = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const organizer = db.prepare('SELECT * FROM users WHERE id = ?').get(built.organizerId);

    const receipt = documents.generateReceipt(order, orderItems, payment, buyer);
    const invoice = documents.generateInvoice(
      order, orderItems,
      [{ label: revenue.listRules().find((r) => r.rule_key === built.ruleKey)?.label || 'Platform commission', rule_key: built.ruleKey, amount_cents: built.commissionCents }],
      built.totalCents - built.commissionCents,
      organizer
    );

    audit(req, req.user.id, 'ticket.purchase', { orderId: built.orderId, totalCents: built.totalCents });

    res.status(201).json({ order, items: orderItems, payment, receiptId: receipt.id, invoiceId: invoice.id });
  } catch (err) { next(err); }
});

module.exports = router;
