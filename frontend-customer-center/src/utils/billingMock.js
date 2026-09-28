/**
 * Local-only billing data — invoices, billing address and spending limits.
 * Saved cards used to live here too; they are now real, backed by
 * paymentMethodsApi (see pages/billing/tabs/PaymentMethodsTab.js). There's no
 * backend for what remains in this file yet, so it lives in localStorage with
 * a seeded set of samples. Swap these functions for real API calls later
 * without touching the pages that call them.
 *
 * Two document types exist here, because pay-as-you-go moves money in two
 * directions:
 *   receipt — money in, one line, created when a wallet top-up clears.
 *   usage   — money out, itemised per deployment (hours × rate), one per
 *             billing period.
 */
const KEY = {
  invoices: 'aio_billing_invoices',
  info: 'aio_billing_info',
  limits: 'aio_billing_limits',
};

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore — worst case the change just doesn't persist.
  }
};

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

const SEED_INVOICES = [
  {
    id: 'INV-0014',
    type: 'usage',
    period: 'This billing period',
    issuedAt: daysAgo(2),
    dueAt: daysAgo(-12),
    status: 'unpaid',
    currency: 'USD',
    taxRate: 0.1,
    lines: [
      { description: 'mistral-prod', sublabel: 'Mistral Small 3 · RTX 4090 24GB', quantity: 60.2, unit: 'hrs', unitCost: 0.69 },
      { description: 'kimi-research', sublabel: 'Kimi K2 · H100 80GB x2', quantity: 4.0, unit: 'hrs', unitCost: 8.24 },
    ],
  },
  {
    id: 'RCP-0089',
    type: 'receipt',
    period: null,
    issuedAt: daysAgo(3),
    dueAt: null,
    status: 'paid',
    currency: 'USD',
    taxRate: 0,
    lines: [
      { description: 'Wallet top-up', sublabel: 'Credit added to prepaid balance', quantity: 1, unit: '', unitCost: 250 },
    ],
  },
  {
    id: 'INV-0013',
    type: 'usage',
    period: 'Previous billing period',
    issuedAt: daysAgo(34),
    dueAt: daysAgo(20),
    status: 'paid',
    currency: 'USD',
    taxRate: 0.1,
    lines: [
      { description: 'mistral-prod', sublabel: 'Mistral Small 3 · RTX 4090 24GB', quantity: 720.0, unit: 'hrs', unitCost: 0.69 },
    ],
  },
];

/** Money maths lives in one place so the list and the detail page always agree. */
export const invoiceTotals = (invoice) => {
  const subtotal = (invoice.lines || []).reduce(
    (sum, l) => sum + l.quantity * l.unitCost,
    0
  );
  const tax = subtotal * (invoice.taxRate || 0);
  return { subtotal, tax, total: subtotal + tax };
};

export const lineTotal = (line) => line.quantity * line.unitCost;

const seedInvoices = () => {
  write(KEY.invoices, SEED_INVOICES);
  return SEED_INVOICES;
};

export const listInvoices = () => {
  const stored = read(KEY.invoices, null);
  const invoices = stored || seedInvoices();
  return [...invoices].sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
};

export const getInvoice = (id) => listInvoices().find((i) => i.id === id) || null;

export const markInvoicePaid = (id) => {
  const invoices = listInvoices();
  const idx = invoices.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  invoices[idx] = { ...invoices[idx], status: 'paid' };
  write(KEY.invoices, invoices);
  return invoices[idx];
};

/* ── Billing address / tax identity (printed on every invoice) ──────────── */

const DEFAULT_INFO = {
  name: '', company: '', street: '', city: '', postalCode: '', country: '', vatId: '',
};

export const getBillingInfo = () => ({ ...DEFAULT_INFO, ...read(KEY.info, {}) });
export const saveBillingInfo = (patch) => {
  const next = { ...getBillingInfo(), ...patch };
  write(KEY.info, next);
  return next;
};

/* ── Spending limits & controls ─────────────────────────────────────────── */

const DEFAULT_LIMITS = {
  monthlySpendCap: null,      // null = uncapped
  pauseAtCap: true,
  lowBalanceAlert: 25,
  maxConcurrentDeployments: null,
  maxHourlyRate: null,
};

export const getLimits = () => ({ ...DEFAULT_LIMITS, ...read(KEY.limits, {}) });
export const saveLimits = (patch) => {
  const next = { ...getLimits(), ...patch };
  write(KEY.limits, next);
  return next;
};
