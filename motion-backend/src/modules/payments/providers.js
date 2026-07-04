// -----------------------------------------------------------------------
// PAYMENT PROVIDER INTERFACE
// -----------------------------------------------------------------------
// Every provider exposes: async charge({ amountCents, payerRef, description })
//   -> { status: 'success' | 'failed', providerRef, raw }
//
// This is the seam described in the Motion architecture doc's "Payments
// Orchestrator" (§7.3): booking/order code never talks to a rail directly,
// only to `charge(orderId, method, amountCents, payerRef)` below.
//
// IMPORTANT — HONEST LIMITATION:
// This sandbox has no network egress to Safaricom's Daraja API or a card
// network, and no live merchant credentials. MpesaMockProvider and
// CardMockProvider below simulate the real request/response shape
// (STK push confirmation, provider_ref, latency) but do not move real
// money. To go live, implement DarejaMpesaProvider / StripeCardProvider
// against this same interface and swap them in PROVIDERS below — no other
// file in the codebase needs to change.
// -----------------------------------------------------------------------

const { db } = require('../../config/db');
const { id } = require('../../utils/helpers');

class MpesaMockProvider {
  async charge({ amountCents, payerRef, description }) {
    await new Promise((r) => setTimeout(r, 150)); // simulate STK push round-trip
    return {
      status: 'success',
      providerRef: 'MPESA-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
      raw: { method: 'stk_push', phone: payerRef, description, amountCents },
    };
  }
}

class CardMockProvider {
  async charge({ amountCents, payerRef, description }) {
    await new Promise((r) => setTimeout(r, 150)); // simulate 3DS + auth round-trip
    return {
      status: 'success',
      providerRef: 'CARD-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
      raw: { method: 'card_token', last4: (payerRef || '0000').slice(-4), description, amountCents },
    };
  }
}

class WalletProvider {
  /**
   * Debits the Motion Pay wallet balance directly. This is the only
   * provider that touches our own ledger rather than an external rail,
   * so it runs inside the same DB transaction as the order.
   */
  async charge({ amountCents, payerRef: userId, description }) {
    const user = db.prepare('SELECT wallet_balance_cents FROM users WHERE id = ?').get(userId);
    if (!user) return { status: 'failed', providerRef: null, raw: { reason: 'user_not_found' } };
    if (user.wallet_balance_cents < amountCents) {
      return { status: 'failed', providerRef: null, raw: { reason: 'insufficient_funds' } };
    }
    const newBalance = user.wallet_balance_cents - amountCents;
    db.prepare('UPDATE users SET wallet_balance_cents = ? WHERE id = ?').run(newBalance, userId);
    db.prepare(
      'INSERT INTO wallet_transactions (id, user_id, type, amount_cents, balance_after_cents, reference, created_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))'
    ).run(id('wtx'), userId, 'debit', -amountCents, newBalance, description);
    return { status: 'success', providerRef: 'WALLET-' + Date.now(), raw: { newBalance } };
  }
}

const PROVIDERS = {
  mpesa: new MpesaMockProvider(),
  card: new CardMockProvider(),
  wallet: new WalletProvider(),
};

async function charge({ method, amountCents, payerRef, description }) {
  const provider = PROVIDERS[method];
  if (!provider) throw Object.assign(new Error(`Unsupported payment method: ${method}`), { status: 400 });
  return provider.charge({ amountCents, payerRef, description });
}

module.exports = { charge, PROVIDERS };
