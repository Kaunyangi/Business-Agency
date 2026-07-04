const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { db } = require('../../config/db');
const { id, fmtKES } = require('../../utils/helpers');

const OUT_DIR = path.join(__dirname, '..', '..', '..', 'generated', 'receipts');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const TEAL = '#0b6e6e';
const INK = '#14181a';
const SOFT = '#5b6360';

function brandHeader(doc, title) {
  doc.rect(0, 0, doc.page.width, 70).fill(TEAL);
  doc.fillColor('#fffcf7').fontSize(18).font('Helvetica-Bold').text('MOTION', 40, 24);
  doc.fontSize(9).font('Helvetica').text('ALWAYS FEEL CONNECTED  ·  ISSUED VIA MOTION × TRYBE', 40, 46);
  doc.fillColor(INK).fontSize(16).font('Helvetica-Bold').text(title, 40, 90);
}

/**
 * Buyer-facing receipt: proof of payment for a single order.
 */
function generateReceipt(order, items, payment, user) {
  const docId = id('doc');
  const filePath = path.join(OUT_DIR, `${docId}.pdf`);
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(fs.createWriteStream(filePath));

  brandHeader(doc, 'Payment Receipt');

  doc.moveDown(2);
  doc.fillColor(SOFT).fontSize(10).font('Helvetica');
  doc.text(`Receipt No.  ${order.id}`, 40, 130);
  doc.text(`Date         ${new Date(order.created_at).toLocaleString('en-KE')}`, 40, 145);
  doc.text(`Billed to    ${user.name} <${user.email}>`, 40, 160);
  doc.text(`Paid via     ${payment.provider.toUpperCase()} · ${payment.provider_ref || '—'}`, 40, 175);

  let y = 210;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10);
  doc.text('Description', 40, y);
  doc.text('Qty', 340, y);
  doc.text('Unit price', 400, y);
  doc.text('Line total', 480, y);
  y += 16;
  doc.moveTo(40, y).lineTo(555, y).strokeColor('#dddddd').stroke();
  y += 10;

  doc.font('Helvetica').fontSize(10).fillColor(INK);
  items.forEach((it) => {
    doc.text(it.description, 40, y, { width: 280 });
    doc.text(String(it.quantity), 340, y);
    doc.text(fmtKES(it.unit_price_cents), 400, y);
    doc.text(fmtKES(it.line_total_cents), 480, y);
    y += 20;
  });

  y += 10;
  doc.moveTo(40, y).lineTo(555, y).strokeColor('#dddddd').stroke();
  y += 14;
  doc.font('Helvetica').text('Subtotal', 400, y);
  doc.text(fmtKES(order.subtotal_cents), 480, y);
  y += 16;
  doc.text('Fees', 400, y);
  doc.text(fmtKES(order.fees_cents), 480, y);
  y += 20;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(TEAL);
  doc.text('Total paid', 400, y);
  doc.text(fmtKES(order.total_cents), 480, y);

  doc.fontSize(8).fillColor(SOFT).font('Helvetica')
    .text('This receipt confirms payment only. It is not a VAT invoice. Motion Experiences Corporation Ltd / Nova Inc Africa Investment Corporation.', 40, 780, { width: 515 });

  doc.end();

  db.prepare(
    'INSERT INTO documents (id, order_id, doc_type, file_path, created_at) VALUES (?,?,?,?,datetime(\'now\'))'
  ).run(docId, order.id, 'receipt', filePath);

  return { id: docId, filePath };
}

/**
 * Organizer-facing invoice: shows the commission breakdown transparently
 * (gross sale, platform commission line, net payout) — this is what makes
 * a commission-rate change auditable rather than just a number changing
 * silently in the dashboard.
 */
function generateInvoice(order, items, commissionLines, netPayoutCents, payee) {
  const docId = id('doc');
  const filePath = path.join(OUT_DIR, `${docId}.pdf`);
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(fs.createWriteStream(filePath));

  brandHeader(doc, 'Settlement Invoice');

  doc.moveDown(2);
  doc.fillColor(SOFT).fontSize(10).font('Helvetica');
  doc.text(`Invoice No.  ${order.id}`, 40, 130);
  doc.text(`Date         ${new Date(order.created_at).toLocaleString('en-KE')}`, 40, 145);
  doc.text(`Payee        ${payee.name} <${payee.email}>`, 40, 160);

  let y = 195;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10);
  doc.text('Line item', 40, y);
  doc.text('Amount', 480, y);
  y += 16;
  doc.moveTo(40, y).lineTo(555, y).strokeColor('#dddddd').stroke();
  y += 10;

  doc.font('Helvetica').fontSize(10).fillColor(INK);
  doc.text('Gross sale (subtotal)', 40, y);
  doc.text(fmtKES(order.subtotal_cents), 480, y);
  y += 20;

  commissionLines.forEach((c) => {
    doc.fillColor(SOFT).text(`Less: ${c.label} (rule: ${c.rule_key})`, 40, y);
    doc.text('-' + fmtKES(c.amount_cents), 480, y);
    y += 18;
  });

  y += 8;
  doc.moveTo(40, y).lineTo(555, y).strokeColor('#dddddd').stroke();
  y += 14;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(TEAL);
  doc.text('Net payout to organizer', 40, y);
  doc.text(fmtKES(netPayoutCents), 480, y);

  doc.fontSize(8).fillColor(SOFT).font('Helvetica')
    .text('Commission rates are configured in Motion\'s revenue engine and may be adjusted per campaign or waived per agreement. This invoice reflects the rate active at time of sale.', 40, 780, { width: 515 });

  doc.end();

  db.prepare(
    'INSERT INTO documents (id, order_id, doc_type, file_path, created_at) VALUES (?,?,?,?,datetime(\'now\'))'
  ).run(docId, order.id, 'invoice', filePath);

  return { id: docId, filePath };
}

function getDocument(docId) {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
}

module.exports = { generateReceipt, generateInvoice, getDocument };
