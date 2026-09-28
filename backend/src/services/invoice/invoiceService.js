/**
 * Invoice PDF Generation Service
 *
 * Generates branded, downloadable PDF invoices using PDFKit.
 * Pulls branding (company name, colors, logo) from AdminSettings.
 */
const PDFDocument = require('pdfkit');
const adminSettingsService = require('../admin/adminSettingsService');

/**
 * Generate a PDF invoice and pipe it to the given writable stream (typically `res`).
 *
 * @param {Object} payment  – Payment document (lean)
 * @param {Object} user     – User document (lean)
 * @param {WritableStream} stream – e.g. Express `res`
 * @returns {Promise<void>}
 */
async function generateInvoicePDF(payment, user, stream) {
  const settings = await adminSettingsService.getSettings();
  const theme = settings.themeSettings || {};
  const companyName = theme.companyName || settings.siteName || 'Our Platform';
  const supportEmail = settings.supportEmail || '';
  const primaryHex = theme.primaryColor || '#6C63FF';

  // Use autoFirstPage:false so we can control page size precisely
  const PAGE_H = 500; // compact custom page height (pts) — fits all content on one page
  const PAGE_W = 595; // A4 width
  const M = 40;       // margin
  const contentW = PAGE_W - M * 2;

  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margin: M,
    autoFirstPage: true,
    bufferPages: false,
  });
  doc.pipe(stream);

  const W = PAGE_W;

  // ═══════ TOP COLOUR BAR ═══════
  doc.rect(0, 0, W, 5).fill(primaryHex);

  // ═══════ HEADER: Company name + INVOICE badge ═══════
  doc.fontSize(18).fillColor(primaryHex).font('Helvetica-Bold').text(companyName, M, 18);
  doc.fontSize(22).fillColor(primaryHex).font('Helvetica-Bold').text('INVOICE', M, 18, { align: 'right' });

  // Divider
  doc.moveTo(M, 50).lineTo(W - M, 50).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

  // ═══════ INVOICE META (FROM + INVOICE DETAILS) ═══════
  const metaY = 60;
  const invoiceNo = payment.metadata?.lemonSqueezyOrderId
    ? 'LS-' + payment.metadata.lemonSqueezyOrderId
    : payment.metadata?.lemonSqueezyInvoiceId
      ? 'LS-' + payment.metadata.lemonSqueezyInvoiceId
      : payment.stripeInvoiceId
        ? 'STR-' + payment.stripeInvoiceId
        : 'INV-' + payment.id.toString().slice(-8).toUpperCase();

  const paidDate = payment.paidAt ? new Date(payment.paidAt) : new Date(payment.createdAt);
  const dateStr = paidDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Left — FROM
  doc.fontSize(7.5).fillColor('#9ca3af').font('Helvetica').text('FROM', M, metaY);
  doc.fontSize(10).fillColor('#1f2937').font('Helvetica-Bold').text(companyName, M, metaY + 12);
  if (supportEmail) {
    doc.fontSize(8.5).fillColor('#6b7280').font('Helvetica').text(supportEmail, M, metaY + 25);
  }

  // Right — Invoice details
  const rightX = W - M - 190;
  doc.fontSize(7.5).fillColor('#9ca3af').font('Helvetica').text('INVOICE DETAILS', rightX, metaY, { width: 190, align: 'right' });
  const labels = ['Invoice No:', 'Date:', 'Status:'];
  const values = [invoiceNo, dateStr, (payment.status || 'succeeded').toUpperCase()];
  labels.forEach((lbl, i) => {
    const y = metaY + 13 + i * 14;
    doc.fontSize(8).fillColor('#6b7280').font('Helvetica').text(lbl, rightX, y, { width: 88, align: 'right' });
    doc.fontSize(8).fillColor('#1f2937').font('Helvetica-Bold').text(values[i], rightX + 92, y, { width: 98, align: 'right' });
  });

  // ═══════ BILL TO ═══════
  const billY = metaY + 60;
  doc.fontSize(7.5).fillColor('#9ca3af').font('Helvetica').text('BILL TO', M, billY);
  doc.fontSize(10).fillColor('#1f2937').font('Helvetica-Bold').text(user.name || 'Customer', M, billY + 12);
  doc.fontSize(8.5).fillColor('#6b7280').font('Helvetica').text(user.email || '', M, billY + 25);

  // ═══════ ITEMS TABLE ═══════
  const tableY = billY + 50;
  const colWidths = [contentW * 0.6, contentW * 0.14, contentW * 0.26];
  const colX = [M, M + colWidths[0], M + colWidths[0] + colWidths[1]];

  // Table header
  doc.rect(M, tableY, contentW, 24).fill(primaryHex);
  ['Description', 'Qty', 'Amount'].forEach((h, i) => {
    doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold')
      .text(h, colX[i] + 6, tableY + 7, { width: colWidths[i] - 12, align: i === 2 ? 'right' : 'left' });
  });

  // Table data row
  const rowY = tableY + 24;
  doc.rect(M, rowY, contentW, 28).fill('#f9fafb');
  doc.moveTo(M, rowY).lineTo(W - M, rowY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  doc.moveTo(M, rowY + 28).lineTo(W - M, rowY + 28).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

  const amount = '$' + (payment.amount || 0).toFixed(2);
  const currency = (payment.currency || 'USD').toUpperCase();
  const itemDesc = payment.description || 'Account credit top-up';

  [itemDesc, '1', `${amount} ${currency}`].forEach((val, i) => {
    doc.fontSize(9).fillColor('#1f2937').font('Helvetica')
      .text(val, colX[i] + 6, rowY + 8, { width: colWidths[i] - 12, align: i === 2 ? 'right' : 'left' });
  });

  // ═══════ TOTALS ═══════
  const totY = rowY + 38;
  const totLabelX = colX[1];
  const totValX   = colX[2];
  const totLW = colWidths[1] - 6;
  const totVW = colWidths[2] - 6;

  doc.fontSize(9).fillColor('#6b7280').font('Helvetica').text('Subtotal:', totLabelX, totY, { width: totLW, align: 'right' });
  doc.fontSize(9).fillColor('#1f2937').font('Helvetica').text(`${amount} ${currency}`, totValX + 6, totY, { width: totVW, align: 'right' });

  doc.fontSize(9).fillColor('#6b7280').font('Helvetica').text('Tax:', totLabelX, totY + 16, { width: totLW, align: 'right' });
  doc.fontSize(9).fillColor('#1f2937').font('Helvetica').text('$0.00', totValX + 6, totY + 16, { width: totVW, align: 'right' });

  doc.moveTo(totLabelX, totY + 34).lineTo(W - M, totY + 34).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

  doc.fontSize(11).fillColor(primaryHex).font('Helvetica-Bold').text('Total:', totLabelX, totY + 40, { width: totLW, align: 'right' });
  doc.fontSize(11).fillColor(primaryHex).font('Helvetica-Bold').text(`${amount} ${currency}`, totValX + 6, totY + 40, { width: totVW, align: 'right' });

  // ═══════ PAID BADGE + DATE ═══════
  const badgeY = totY + 68;
  const isPaid = payment.status === 'succeeded';
  const badgeColor = isPaid ? '#059669' : '#dc2626';
  const badgeText  = isPaid ? 'PAID' : (payment.status || 'PENDING').toUpperCase();

  doc.roundedRect(M, badgeY, 64, 22, 5).fill(badgeColor);
  doc.fontSize(9.5).fillColor('#ffffff').font('Helvetica-Bold').text(badgeText, M, badgeY + 6, { width: 64, align: 'center' });
  if (isPaid) {
    doc.fontSize(8.5).fillColor('#6b7280').font('Helvetica').text(`Paid on ${dateStr}`, M + 74, badgeY + 7);
  }

  // ═══════ THANK-YOU NOTE ═══════
  const noteY = badgeY + 36;
  doc.fontSize(8).fillColor('#6b7280').font('Helvetica')
    .text(`Thank you for your payment. This invoice was generated by ${companyName}.`, M, noteY, { width: contentW });
  if (payment.metadata?.gateway) {
    doc.fontSize(7.5).fillColor('#9ca3af').font('Helvetica')
      .text(`Payment processed via ${payment.metadata.gateway === 'lemonsqueezy' ? 'Lemon Squeezy' : 'Stripe'}.`, M, noteY + 14);
  }

  // ═══════ BOTTOM COLOUR BAR + COPYRIGHT ═══════
  // Place these at true bottom of the custom-height page, always within bounds
  const footerBarY = PAGE_H - 22;
  doc.fontSize(7.5).fillColor('#9ca3af').font('Helvetica')
    .text(`© ${new Date().getFullYear()} ${companyName}. All rights reserved.`, M, footerBarY - 14, { width: contentW, align: 'center' });
  doc.rect(0, footerBarY, W, 5).fill(primaryHex);

  doc.end();
}

module.exports = { generateInvoicePDF };
