const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { audit } = require('../../utils/audit');
const revenue = require('./revenue.service');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/rules', (req, res) => {
  res.json({ rules: revenue.listRules() });
});

const updateSchema = z.object({
  rate_percent: z.number().min(0).max(100).optional(),
  flat_fee_cents: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

// This is the "cut our commission" lever: change the rate (or set active:false
// to fully waive a revenue line) with no code deploy. Every future order
// picks up the new rate immediately; past orders/invoices are untouched.
router.patch('/rules/:ruleKey', validate(updateSchema), (req, res, next) => {
  try {
    const updated = revenue.updateRule(req.params.ruleKey, req.body);
    audit(req, req.user.id, 'revenue.rule_updated', { ruleKey: req.params.ruleKey, ...req.body });
    res.json({ rule: updated });
  } catch (err) { next(err); }
});

router.get('/summary', (req, res) => {
  res.json(revenue.summary());
});

module.exports = router;
