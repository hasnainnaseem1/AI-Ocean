/**
 * Money maths for an invoice/receipt, kept in one place so the list and the
 * detail page always agree — pulled out of `billingMock.js` when invoices
 * moved to real backend data; this part was already pure math, not mock data.
 */
/**
 * What a line is worth.
 *
 * `amount` is the money that was actually taken for it, sent by the server, and
 * it always wins. Multiplying quantity × unitCost back out is only a fallback
 * for a line that has no amount, and it is genuinely inexact for usage: hours
 * are stored rounded to four decimals and the unit cost is the highest rate
 * seen in the period, so the product drifts from the real charges. On a real
 * statement here that drift produced a USD 3.70 invoice for USD 3.69 of
 * charges — an invoice that disagreed with the customer's own credit ledger.
 */
export const lineTotal = (line) =>
  (line?.amount === undefined || line?.amount === null
    ? (line?.quantity || 0) * (line?.unitCost || 0)
    : Number(line.amount));

export const invoiceTotals = (invoice) => {
  const subtotal = (invoice.lines || []).reduce((sum, l) => sum + lineTotal(l), 0);
  const tax = subtotal * (invoice.taxRate || 0);
  return { subtotal, tax, total: subtotal + tax };
};
