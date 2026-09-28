/**
 * Billing Controller
 *
 * Handles payment history and invoice downloads — shared by every payment
 * type (wallet top-ups), gateway-aware (Stripe, LemonSqueezy or Polar).
 */
const jwt = require('jsonwebtoken');
const { failure } = require('../../utils/helpers/apiError');
const { meta } = require('../../utils/helpers/pagination');
const paymentService = require('../../services/billing/paymentService');
const userService = require('../../services/user/userService');
const deploymentUsageService = require('../../services/deployment/deploymentUsageService');
const creditService = require('../../services/billing/creditService');
const statementService = require('../../services/billing/statementService');
const billingModeService = require('../../services/billing/billingModeService');
const languageSettingsService = require('../../services/i18n/languageSettingsService');

/**
 * GET /api/v1/customer/billing/usage
 *
 * What this month has actually cost, per deployment, split into what the
 * machine was charged for: compute while it was running, and storage while it
 * was stopped.
 *
 * The billing page used to derive that split itself, by dividing a
 * deployment's cost by its hourly rate — which quietly assumed every charge was
 * compute. A stopped deployment still pays for its disk, at a much lower rate,
 * so the page could report "7.5 hours at USD 2.39/hr" for a machine that had
 * run for zero hours and had really accrued 72 hours of storage at USD 0.246.
 * The totals matched; nothing else did.
 *
 * `?month=YYYY-MM` selects a period; the default is the current month. Dates
 * are resolved in UTC, matching how the billing job writes usage rows.
 */
const getUsageSummary = async (req, res) => {
  try {
    const { month, from: fromQ, to: toQ } = req.query;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const DATE = /^\d{4}-\d{2}-\d{2}$/;

    /*
     * Either an explicit date range — `?from=YYYY-MM-DD&to=YYYY-MM-DD`, both
     * days inclusive, which is what the page's day / month / year filter
     * sends — or the older `?month=YYYY-MM`. Resolved in UTC, matching how
     * the billing job writes usage rows.
     */
    let from;
    let to;
    if (fromQ || toQ) {
      if (!DATE.test(fromQ || '') || !DATE.test(toQ || '')) {
        return res.status(400).json({ success: false, message: 'from and to must be YYYY-MM-DD dates' });
      }
      from = new Date(`${fromQ}T00:00:00Z`);
      to = new Date(new Date(`${toQ}T00:00:00Z`).getTime() + DAY_MS);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
        return res.status(400).json({ success: false, message: 'Invalid date range' });
      }
      if (to - from > 366 * 3 * DAY_MS) {
        return res.status(400).json({ success: false, message: 'Date range is too long' });
      }
    } else if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number);
      from = new Date(Date.UTC(y, m - 1, 1));
      to = new Date(Date.UTC(y, m, 1));
    } else {
      const now = new Date();
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    }

    /**
     * Only a period that contains the present can have usage still accruing,
     * and only there is it worth showing: a closed period has been fully
     * billed, so an "un-billed so far" line on it would always read zero and
     * just add noise to a settled statement.
     */
    const today = new Date();
    const isCurrentMonth = from <= today && today < to;

    const debtService = require('../../services/billing/debtService');
    const settings = await billingModeService.getBillingSettings();
    const debt = await debtService.status(req.team.id, { settings });

    const [usage, debtMovement] = await Promise.all([
      deploymentUsageService.summariseForTeam(req.team.id, from, to, {
        includeAccruing: isCurrentMonth,
      }),
      // How the outstanding balance moved over the same window: what it
      // opened at, what these charges added, what was paid off and when.
      // Without it the statement says how much debt the period created and
      // the page separately shows a much smaller balance, with nothing
      // between the two. See creditService.debtMovement.
      creditService.debtMovement(req.team.id, from, to),
    ]);

    // How much of THIS period's bill is paid — including debt paid off after
    // the fact by a top-up, which the usage rows alone cannot see. For a
    // calendar month it matches what the Invoices tab shows for that
    // statement. See statementService.settlementForRange.
    const settlement = await statementService.settlementForRange(req.team.id, usage, {
      outstanding: debt.outstanding, to, now: today,
    });

    res.json({
      success: true,
      periodStart: from,
      periodEnd: to,
      debtMovement,
      settlement,
      // The live balance read in this same request, so the billing page can
      // show every "outstanding" figure from one moment in time instead of
      // mixing this response with the wallet endpoint's, fetched separately.
      outstanding: debt.outstanding,
      ...usage,
    });
  } catch (error) {
    console.error('Get usage summary error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch usage summary' });
  }
};

/**
 * GET /api/v1/customer/billing/invoices
 *
 * The "Invoices & receipts" list — real data, replacing what used to be a
 * frontend-only localStorage mock (`utils/billingMock.js`) that showed the
 * same seeded fake documents to every customer regardless of who they were.
 *
 * Two document types, matching how money actually moves on this platform:
 *   - receipt — a completed top-up `Payment` row (money in).
 *   - usage   — one per calendar month that has any charged
 *               `DeploymentUsage`, built from the same summary the Overview
 *               tab uses (money out). Usage is taken from the wallet as it
 *               accrues; whatever the wallet could not cover went onto the
 *               outstanding balance, so a statement is paid, partially paid
 *               or unpaid according to how much of that is still owed (see
 *               statementService).
 *
 * Also returns `ledger` — all-time totals per ledger entry type — which the
 * Invoices tab shows as "where your money went".
 */
const getInvoices = async (req, res) => {
  try {
    const settings = await billingModeService.getBillingSettings();
    const currency = (settings.currency || 'usd').toUpperCase();

    /*
     * The statement's period label is a formatted date, not prose, so unlike
     * the API's error messages it CAN follow the reader — and it has to. It
     * was hardcoded to 'en-US', so an Urdu invoice carried "September 2026"
     * as its only English line, directly under a fully translated heading.
     */
    const periodLocale = languageSettingsService.intlLocale(
      await languageSettingsService.resolveLanguage(req.user),
    );

    const { payments } = await paymentService.listForTeam(req.team.id, { page: 1, limit: 100 });
    const topUps = payments.filter((p) => p.type === 'topup' && p.status === 'succeeded');
    const r4 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 10000) / 10000;

    // Where each top-up's money went: part paid off the outstanding balance
    // the moment it landed, the rest became spendable balance.
    const settledByPayment = await creditService.debtSettledByReference(
      req.team.id, topUps.map((p) => p.id),
    );

    const receipts = topUps
      .map((p) => ({
        // A short, display-friendly id — matches the USG-2026-09 style
        // usage-statement ids so the Document column never has to wrap. The
        // full payment id underneath is a UUID; this row is looked up by id
        // from this same endpoint's own list (see InvoiceDetailPage.js), so
        // this shortened form only needs to stay unique within one
        // customer's receipts, not globally.
        id: `RCP-${p.id.replace(/-/g, '').slice(-8).toUpperCase()}`,
        type: 'receipt',
        period: null,
        issuedAt: p.paidAt || p.createdAt,
        dueAt: null,
        status: 'paid',
        currency: (p.currency || currency).toUpperCase(),
        taxRate: 0,
        settledDebt: r4(Math.min(settledByPayment.get(p.id) || 0, p.amount)),
        addedToBalance: r4(p.amount - Math.min(settledByPayment.get(p.id) || 0, p.amount)),
        lines: [{
          description: p.description || 'Account credit top-up',
          sublabel: 'Credit added to prepaid balance',
          quantity: 1,
          unit: '',
          unitCost: p.amount,
          // See the usage lines below — `amount` is always the authority for
          // what this line is worth, never quantity × unitCost.
          amount: p.amount,
        }],
      }));

    /**
     * ── Whether a usage statement is actually settled ──
     *
     * Every statement used to be stamped `paid`, which made the list's "Unpaid"
     * filter permanently empty — a control that could never match anything.
     * It was true enough when usage was only ever drawn from a funded wallet;
     * it stopped being true once a shortfall started going onto the customer's
     * outstanding balance instead.
     *
     * A statement is paid when the wallet covered all of it. When part of it
     * went to debt, whether it is still owed depends on what has been settled
     * since — and debt is a single account-level number, not tagged per month.
     * So the current outstanding balance is allocated across the months that
     * produced debt, newest first, on the reasoning that older debt is paid off
     * first. Anything the allocation does not reach has since been settled.
     */
    const debtService = require('../../services/billing/debtService');
    const debt = await debtService.status(req.team.id, { settings });

    // Walk back one calendar month at a time and only keep months that
    // actually had charged usage — most accounts will have far fewer than
    // 12 populated months, and summariseForTeam is cheap on an empty one.
    // The walk and the paid/unpaid split live in statementService, shared with
    // the Overview tab, so the two can never report different figures.
    const now = new Date();
    const statements = await statementService.monthlyStatements(req.team.id, {
      outstanding: debt.outstanding, monthsBack: 12, now,
    });
    const usageStatements = [];
    for (const { from, to, summary, settlement } of statements) {
      if (!summary.total) continue;

      /**
       * `amount` is the money that was really taken for this line — the sum of
       * the hourly charges as they were written — and it is what the invoice
       * totals from. It is NOT quantity × unitCost, and must not be recomputed
       * as such: hours are a rounded 4-decimal figure and `unitCost` is the
       * highest rate seen in the month, so multiplying them back out drifts.
       * On a real statement here it produced a USD 3.70 invoice for USD 3.69
       * of charges — an invoice that did not match the customer's own ledger.
       */
      /*
       * `kind` says which of the two things the line charges for. The client
       * labels it (translated, with the same icon and colour the Overview
       * uses) — it used to be English text appended to the sublabel, which
       * could be neither translated nor styled.
       */
      const lines = [];
      for (const d of summary.deployments) {
        const sublabel = [d.model, d.tier].filter(Boolean).join(' · ') || null;
        if (d.running.hours > 0) {
          lines.push({
            kind: 'compute', deploymentId: d.deploymentId || null,
            description: d.name, sublabel,
            quantity: d.running.hours, unit: 'hrs', unitCost: d.running.rate,
            amount: d.running.cost,
          });
        }
        if (d.storage.hours > 0) {
          lines.push({
            kind: 'disk', deploymentId: d.deploymentId || null,
            description: d.name, sublabel,
            quantity: d.storage.hours, unit: 'hrs', unitCost: d.storage.rate,
            amount: d.storage.cost,
          });
        }
      }

      usageStatements.push({
        id: `USG-${from.toISOString().slice(0, 7)}`,
        type: 'usage',
        period: from.toLocaleDateString(periodLocale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
        issuedAt: to <= now ? to : now,
        dueAt: null,
        // Three states, not two: a statement with some of it paid is not the
        // same thing as one nobody has paid a cent of.
        status: settlement.stillOwed <= 0 ? 'paid' : (settlement.paid > 0 ? 'partial' : 'unpaid'),
        periodStart: from,
        periodEnd: new Date(to.getTime() - 24 * 60 * 60 * 1000),
        // The month still in progress is a running statement, not a final one.
        isCurrent: from <= now && now < to,
        // Machines, not lines — each deployment has a compute line and a disk
        // line, and counting lines reported 3 deployments as "6 deployments".
        deploymentCount: summary.deployments.filter((d) => d.total > 0).length,
        computeTotal: r4(summary.running.cost),
        diskTotal: r4(summary.storage.cost),
        // What the customer still has to pay on this statement, so the list can
        // say so rather than just colouring a badge.
        amountDue: settlement.stillOwed,
        // Everything paid toward it — at the time of charge AND afterwards.
        // This used to send only the at-the-time part, labelled as if it were
        // the whole payment. See statementService.
        amountPaid: settlement.paid,
        paidAtCharge: settlement.paidAtCharge,
        paidLater: settlement.paidLater,
        currency,
        taxRate: 0,
        lines,
      });
    }

    const invoices = [...receipts, ...usageStatements]
      .sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));

    // Every credit in and every way it was used, for the page's "where your
    // money went" statement. All-time, from the ledger.
    const ledger = await creditService.ledgerTotals(req.team.id);

    res.json({ success: true, invoices, ledger });
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch invoices' });
  }
};

/**
 * Get customer's payment history
 */
const getPayments = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const { payments, total } = await paymentService.listForTeam(req.team.id, { page, limit });

    res.json({
      success: true,
      payments,
      pagination: meta({ page, limit }, total),
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch payment history' });
  }
};

/**
 * Verify a completed Checkout session for a credit top-up and confirm the
 * wallet was credited. Called by the frontend success page as a fallback for
 * cases where the webhook has not yet been delivered (e.g. local dev).
 *
 * Covers Stripe and Polar — the two gateways that can produce a session id
 * this endpoint is ever called with (`CheckoutSuccessPage.js` only reads
 * `?session_id=` off the URL, which only Stripe's and Polar's success-url
 * templates populate; LemonSqueezy's redirect carries no id and has no
 * fallback here — it relies on its webhook alone). Which gateway a given id
 * belongs to is read off the id's own shape rather than "whichever gateway
 * is active right now", since the active gateway can be switched between a
 * checkout starting and the customer landing back on this page: Stripe
 * session ids always start with `cs_`; Polar checkout ids are bare UUIDs.
 */
const verifyCheckoutSession = async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId is required' });
    }

    if (sessionId.startsWith('cs_')) {
      const stripeService = require('../../services/stripe/stripeService');
      let session;
      try {
        session = await stripeService.retrieveCheckoutSession(sessionId);
      } catch (err) {
        return res.status(400).json({ success: false, message: 'Invalid or expired session ID' });
      }

      if (session.payment_status !== 'paid' || session.status !== 'complete') {
        return res.status(400).json({ success: false, message: 'Payment not completed' });
      }

      // Only the member who started a checkout may confirm it here.
      const { userId, teamId } = session.metadata || {};
      if (!userId) {
        return res.status(400).json({ success: false, message: 'Session metadata missing' });
      }
      if (req.user.id.toString() !== userId) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }

      // Reuses the webhook's handler, which is idempotent, so this path is
      // safe even if the webhook already processed the same session.
      const { handleCreditTopUp } = require('../../routes/v1/webhooks/stripe.routes');
      await handleCreditTopUp(session);

      const creditService = require('../../services/billing/creditService');
      const summary = await creditService.getWalletSummary(teamId || req.team.id);
      return res.json({ success: true, type: 'credit_topup', wallet: summary });
    }

    // Polar
    const polarService = require('../../services/polar/polarService');
    let checkout;
    try {
      checkout = await polarService.retrieveCheckoutSession(sessionId);
    } catch (err) {
      return res.status(400).json({ success: false, message: 'Invalid or expired session ID' });
    }

    if (checkout.status !== 'succeeded') {
      return res.status(400).json({ success: false, message: 'Payment not completed' });
    }

    const { userId, teamId } = checkout.metadata || {};
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Session metadata missing' });
    }
    if (req.user.id.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const order = await polarService.findOrderByCheckoutId(checkout.id);
    if (!order) {
      return res.status(400).json({ success: false, message: 'Payment not completed' });
    }

    // Reuses the webhook's handler (order.id-keyed idempotency), so this path
    // is safe even if the webhook already processed the same order.
    const { handleOrderPaid } = require('../../controllers/webhooks/polarWebhookController');
    await handleOrderPaid({ type: 'order.paid', data: order });

    const creditService = require('../../services/billing/creditService');
    const summary = await creditService.getWalletSummary(teamId || req.team.id);
    res.json({ success: true, type: 'credit_topup', wallet: summary });
  } catch (error) {
    console.error('verifyCheckoutSession error:', error);
    failure(res, error, 'Verification failed');
  }
};

/**
 * Download a branded PDF invoice for a payment (authenticated)
 */
const downloadInvoice = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const payment = await paymentService.findById(paymentId);
    // An invoice belongs to the account it was paid into. Another account's
    // is reported as not found, so an id cannot confirm a payment exists.
    if (!payment || String(payment.teamId) !== String(req.team.id)) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const user = req.user;

    const { generateInvoicePDF } = require('../../services/invoice/invoiceService');

    const invoiceNo = payment.metadata?.lemonSqueezyOrderId
      ? 'LS-' + payment.metadata.lemonSqueezyOrderId
      : payment.stripeInvoiceId
        ? 'STR-' + payment.stripeInvoiceId
        : 'INV-' + payment.id.toString().slice(-8).toUpperCase();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceNo}.pdf"`);

    await generateInvoicePDF(payment, user, res);
  } catch (error) {
    console.error('downloadInvoice error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to generate invoice' });
    }
  }
};

/**
 * Generate a signed invoice URL for use in emails (no login needed)
 * Token expires in 30 days.
 *
 * @param {string} paymentId  – Payment document _id
 * @param {string} userId     – User _id
 * @returns {string} public URL with ?token=<jwt>
 */
const generateSignedInvoiceUrl = (paymentId, userId) => {
  const secret = process.env.JWT_SECRET;
  const token = jwt.sign({ paymentId: paymentId.toString(), userId: userId.toString(), type: 'invoice' }, secret, { expiresIn: '30d' });
  const base = process.env.BACKEND_URL || process.env.API_URL || 'http://localhost:3001';
  return `${base}/api/v1/public/invoice/${paymentId}?token=${token}`;
};

/**
 * Download invoice using a signed token (public — no auth middleware needed).
 * Used by email "View Receipt" links.
 */
const downloadInvoicePublic = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { token } = req.query;

    if (!token) {
      return res.status(401).json({ success: false, message: 'Token required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    if (decoded.type !== 'invoice' || decoded.paymentId !== paymentId) {
      return res.status(403).json({ success: false, message: 'Token does not match' });
    }

    const payment = await paymentService.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const user = await userService.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { generateInvoicePDF } = require('../../services/invoice/invoiceService');

    const invoiceNo = payment.metadata?.lemonSqueezyOrderId
      ? 'LS-' + payment.metadata.lemonSqueezyOrderId
      : payment.stripeInvoiceId
        ? 'STR-' + payment.stripeInvoiceId
        : 'INV-' + payment.id.toString().slice(-8).toUpperCase();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${invoiceNo}.pdf"`);

    await generateInvoicePDF(payment, user, res);
  } catch (error) {
    console.error('downloadInvoicePublic error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to generate invoice' });
    }
  }
};

module.exports = {
  getUsageSummary,
  getInvoices,
  getPayments,
  verifyCheckoutSession,
  downloadInvoice,
  downloadInvoicePublic,
  generateSignedInvoiceUrl,
};
