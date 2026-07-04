const { db } = require('../../config/db');
const { id } = require('../../utils/helpers');

const DEFAULT_RULES = [
  { rule_key: 'ticketing_fee', label: 'Ticketing service fee', applies_to: 'ticket', rate_percent: 8, flat_fee_cents: 0 },
  { rule_key: 'flight_commission', label: 'Flight booking commission', applies_to: 'flight', rate_percent: 5, flat_fee_cents: 0 },
  { rule_key: 'stay_commission', label: 'Accommodation commission', applies_to: 'stay', rate_percent: 12, flat_fee_cents: 0 },
];

function seedRules() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM commission_rules').get();
  if (existing.n > 0) return;
  const insert = db.prepare(
    'INSERT INTO commission_rules (rule_key, label, applies_to, rate_percent, flat_fee_cents, active, updated_at) VALUES (?,?,?,?,?,1,datetime(\'now\'))'
  );
  DEFAULT_RULES.forEach((r) => insert.run(r.rule_key, r.label, r.applies_to, r.rate_percent, r.flat_fee_cents));
}

function getRuleForType(orderType) {
  return db
    .prepare('SELECT * FROM commission_rules WHERE applies_to = ? AND active = 1 LIMIT 1')
    .get(orderType);
}

function listRules() {
  return db.prepare('SELECT * FROM commission_rules ORDER BY applies_to').all();
}

/** Admin lever: raise, lower, or waive commission per revenue line without a code deploy. */
function updateRule(ruleKey, { rate_percent, flat_fee_cents, active }) {
  const rule = db.prepare('SELECT * FROM commission_rules WHERE rule_key = ?').get(ruleKey);
  if (!rule) throw Object.assign(new Error('Unknown commission rule'), { status: 404 });

  const next = {
    rate_percent: rate_percent !== undefined ? rate_percent : rule.rate_percent,
    flat_fee_cents: flat_fee_cents !== undefined ? flat_fee_cents : rule.flat_fee_cents,
    active: active !== undefined ? (active ? 1 : 0) : rule.active,
  };
  db.prepare(
    'UPDATE commission_rules SET rate_percent = ?, flat_fee_cents = ?, active = ?, updated_at = datetime(\'now\') WHERE rule_key = ?'
  ).run(next.rate_percent, next.flat_fee_cents, next.active, ruleKey);
  return db.prepare('SELECT * FROM commission_rules WHERE rule_key = ?').get(ruleKey);
}

/** Computes commission for a subtotal given the order type. Returns 0 if the rule is inactive (fully waived). */
function computeCommission(orderType, subtotalCents) {
  const rule = getRuleForType(orderType);
  if (!rule) return { amountCents: 0, ruleKey: null };
  const amountCents = Math.round((subtotalCents * rule.rate_percent) / 100) + rule.flat_fee_cents;
  return { amountCents, ruleKey: rule.rule_key };
}

function recordLedgerEntry(orderId, ruleKey, amountCents) {
  if (!ruleKey || amountCents === 0) return;
  db.prepare(
    'INSERT INTO revenue_ledger (id, order_id, rule_key, amount_cents, created_at) VALUES (?,?,?,?,datetime(\'now\'))'
  ).run(id('rev'), orderId, ruleKey, amountCents);
}

function summary() {
  const rows = db
    .prepare(
      `SELECT rule_key, COUNT(*) AS transactions, SUM(amount_cents) AS total_cents
       FROM revenue_ledger GROUP BY rule_key`
    )
    .all();
  const totalCents = rows.reduce((s, r) => s + r.total_cents, 0);
  return { byLine: rows, totalCents };
}

module.exports = { seedRules, getRuleForType, listRules, updateRule, computeCommission, recordLedgerEntry, summary };
