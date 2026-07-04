const express = require('express');
const fs = require('fs');
const { db } = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');
const { getDocument } = require('./documents.service');

const router = express.Router();
router.use(requireAuth);

router.get('/:id/download', (req, res) => {
  const doc = getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(doc.order_id);
  // Only the buyer, the organizer being paid out on an invoice, or an admin may fetch a document.
  const isOwner = order && order.user_id === req.user.id;
  const isAdmin = req.user.role === 'admin';

  let isPayeeOrganizer = false;
  if (doc.doc_type === 'invoice' && order.order_type === 'ticket') {
    const item = db.prepare('SELECT ref_id FROM order_items WHERE order_id = ? AND ref_type = ?').get(order.id, 'ticket_tier');
    if (item) {
      const tier = db.prepare('SELECT event_id FROM ticket_tiers WHERE id = ?').get(item.ref_id);
      const event = tier && db.prepare('SELECT organizer_id FROM events WHERE id = ?').get(tier.event_id);
      isPayeeOrganizer = !!event && event.organizer_id === req.user.id;
    }
  }

  if (!isOwner && !isAdmin && !isPayeeOrganizer) return res.status(403).json({ error: 'Not authorized to access this document' });

  if (!fs.existsSync(doc.file_path)) return res.status(410).json({ error: 'Document file no longer available' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="motion-${doc.doc_type}-${doc.id}.pdf"`);
  fs.createReadStream(doc.file_path).pipe(res);
});

module.exports = router;
