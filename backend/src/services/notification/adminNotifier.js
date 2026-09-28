/**
 * Admin Notifier Service
 * 
 * Sends in-app (and optionally email) notifications to admin users
 * based on the notification settings in AdminSettings.
 * 
 * Checks:
 *  - notifyAdminOnNewcustomer  → new customer signup
 *  - enableEmailNotifications  → gate email delivery
 */
const userService = require('../user/userService');
const adminSettingsService = require('../admin/adminSettingsService');
const notificationService = require('./notificationService');
const emailService = require('../email/emailService');

/**
 * Fetch current notification settings from AdminSettings singleton.
 */
async function getNotificationSettings() {
  const settings = await adminSettingsService.getSettings();
  return settings.notificationSettings || {};
}

/**
 * Get all admin/super_admin user IDs.
 */
async function getAdminIds() {
  return userService.listActiveAdmins();
}

/**
 * Get super admin(s).
 */
async function getSuperAdmins() {
  return userService.listActiveAdmins({ role: 'super_admin' });
}

/**
 * Internal helper: send in-app + optional email to a set of admins.
 */
async function _notifyAdmins(admins, { type, title, message: msg, priority, metadata, emailSubject, emailHtml, emailText }, ns) {
  if (!admins.length) return;

  // In-app notifications
  const notifPromises = admins.map((admin) =>
    notificationService.createNotification({
      recipientId: admin.id,
      recipientType: 'admin',
      type: type || 'system_alert',
      title,
      message: msg,
      priority: priority || 'medium',
      senderName: 'System',
      metadata: metadata || {},
    })
  );
  await Promise.all(notifPromises);

  // Email if enabled
  if (ns.enableEmailNotifications && emailSubject) {
    const emailPromises = admins.map((admin) =>
      emailService
        .sendEmail({
          to: admin.email,
          subject: emailSubject,
          html: emailHtml || `<p>${msg}</p>`,
          text: emailText || msg,
        })
        .catch((err) =>
          console.error(`[AdminNotifier] Email to ${admin.email} failed:`, err.message)
        )
    );
    await Promise.all(emailPromises);
  }
}

/**
 * Notify admins about a new customer registration.
 * Respects `notifyAdminOnNewcustomer` and `enableEmailNotifications`.
 *
 * @param {Object} customer - The newly registered customer document
 */
async function notifyNewCustomer(customer) {
  try {
    const ns = await getNotificationSettings();
    if (!ns.notifyAdminOnNewcustomer) return;

    const admins = await getAdminIds();
    const msg = `${customer.name || customer.email} (${customer.email}) just signed up.`;

    await _notifyAdmins(admins, {
      type: 'system_alert',
      title: 'New Customer Registered',
      message: msg,
      priority: 'medium',
      metadata: {
        customerId: customer.id,
        customerEmail: customer.email,
      },
      emailSubject: `New Customer Signup: ${customer.name || customer.email}`,
      emailHtml: `
        <h3>New Customer Registered</h3>
        <p><strong>Name:</strong> ${customer.name || 'N/A'}</p>
        <p><strong>Email:</strong> ${customer.email}</p>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
      `,
      emailText: `New customer registered: ${customer.name} (${customer.email}).`,
    }, ns);

    console.log(`[AdminNotifier] Notified ${admins.length} admin(s) about new customer: ${customer.email}`);
  } catch (err) {
    console.error('[AdminNotifier] notifyNewCustomer error:', err.message);
  }
}

/**
 * Notify super admin(s) about an admin password reset request.
 * Always sends — this is a security-critical event.
 *
 * @param {Object} opts
 * @param {Object} opts.requestUser - The user requesting the reset
 * @param {string} opts.method      - 'forgot_password' | 'request_reset'
 */
async function notifyPasswordResetRequest({ requestUser, method = 'forgot_password' }) {
  try {
    const ns = await getNotificationSettings();
    const superAdmins = await getSuperAdmins();
    if (!superAdmins.length) return;

    const msg = `${requestUser.name} (${requestUser.email}) has requested a password reset via ${method === 'forgot_password' ? 'Forgot Password' : 'Request Reset'}.`;

    await _notifyAdmins(superAdmins, {
      type: 'password_reset',
      title: 'Password Reset Request',
      message: msg,
      priority: 'high',
      metadata: {
        requestUserId: requestUser.id,
        requestUserName: requestUser.name,
        requestUserEmail: requestUser.email,
        role: requestUser.role,
        method,
      },
      emailSubject: `Password Reset Request: ${requestUser.name}`,
      emailHtml: `
        <h3>Password Reset Request</h3>
        <p><strong>User:</strong> ${requestUser.name}</p>
        <p><strong>Email:</strong> ${requestUser.email}</p>
        <p><strong>Role:</strong> ${(requestUser.role || '').replace(/_/g, ' ').toUpperCase()}</p>
        <p><strong>Method:</strong> ${method === 'forgot_password' ? 'Forgot Password (public)' : 'Request Reset (logged-in)'}</p>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        <p style="color: #e53e3e;"><em>Please review and reset this user's password from the Admin Panel → Users section.</em></p>
      `,
      emailText: msg,
    }, ns);

    console.log(`[AdminNotifier] Notified ${superAdmins.length} super admin(s) about password reset request: ${requestUser.email}`);
  } catch (err) {
    console.error('[AdminNotifier] notifyPasswordResetRequest error:', err.message);
  }
}

/**
 * Notify admins about a customer password reset.
 * Respects notification settings.
 *
 * @param {Object} customer - The customer who reset their password
 * @param {string} action   - 'requested' | 'completed'
 */
async function notifyCustomerPasswordReset(customer, action = 'completed') {
  try {
    const ns = await getNotificationSettings();
    if (!ns.enableEmailNotifications && !ns.notifyAdminOnNewcustomer) return;

    const admins = await getAdminIds();
    const verb = action === 'requested' ? 'requested a password reset' : 'reset their password';
    const msg = `${customer.name || customer.email} (${customer.email}) has ${verb}.`;

    await _notifyAdmins(admins, {
      type: 'security_alert',
      title: `Customer Password ${action === 'requested' ? 'Reset Requested' : 'Reset Completed'}`,
      message: msg,
      priority: 'low',
      metadata: {
        customerId: customer.id,
        customerEmail: customer.email,
        action,
      },
      emailSubject: `Customer Password ${action === 'requested' ? 'Reset Request' : 'Reset'}: ${customer.email}`,
      emailHtml: `
        <h3>Customer Password ${action === 'requested' ? 'Reset Request' : 'Reset'}</h3>
        <p><strong>Customer:</strong> ${customer.name || 'N/A'} (${customer.email})</p>
        <p><strong>Action:</strong> ${verb}</p>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
      `,
      emailText: msg,
    }, ns);

    console.log(`[AdminNotifier] Notified ${admins.length} admin(s) about customer password ${action}: ${customer.email}`);
  } catch (err) {
    console.error('[AdminNotifier] notifyCustomerPasswordReset error:', err.message);
  }
}

/**
 * Notify admins about a customer status change (suspend/activate).
 * Always sends — this is an operational event.
 *
 * @param {Object} opts
 * @param {Object} opts.customer   - The customer document
 * @param {string} opts.oldStatus  - Previous status
 * @param {string} opts.newStatus  - New status
 * @param {string} opts.changedBy  - Name of admin who made the change
 * @param {string} [opts.reason]   - Optional reason
 */
async function notifyCustomerStatusChange({ customer, oldStatus, newStatus, changedBy, reason }) {
  try {
    const ns = await getNotificationSettings();
    const admins = await getAdminIds();
    const msg = `${customer.name || customer.email} status changed: ${oldStatus} → ${newStatus} by ${changedBy}.${reason ? ` Reason: ${reason}` : ''}`;

    await _notifyAdmins(admins, {
      type: 'system_alert',
      title: `Customer ${newStatus === 'suspended' ? 'Suspended' : 'Activated'}`,
      message: msg,
      priority: newStatus === 'suspended' ? 'high' : 'medium',
      metadata: {
        customerId: customer.id,
        customerEmail: customer.email,
        oldStatus,
        newStatus,
        changedBy,
        reason,
      },
      emailSubject: `Customer ${newStatus === 'suspended' ? 'Suspended' : 'Activated'}: ${customer.email}`,
      emailHtml: `
        <h3>Customer Status Changed</h3>
        <p><strong>Customer:</strong> ${customer.name} (${customer.email})</p>
        <p><strong>Status:</strong> ${oldStatus} → ${newStatus}</p>
        <p><strong>Changed by:</strong> ${changedBy}</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
      `,
      emailText: msg,
    }, ns);

    console.log(`[AdminNotifier] Notified ${admins.length} admin(s) about customer status change: ${customer.email}`);
  } catch (err) {
    console.error('[AdminNotifier] notifyCustomerStatusChange error:', err.message);
  }
}

/**
 * Notify admins the moment a deployment is auto-paused for running out of
 * credit.
 *
 * The customer already gets their own notification and email from
 * deploymentService.transition() — this is the admin's copy, sent at the same
 * moment, so a human can act immediately (reach out to the customer, decide
 * whether the machine needs shutting down sooner than the storage-grace
 * schedule would, or just be aware) instead of only finding out when the
 * customer complains or the fulfilment queue is next reviewed.
 *
 * Respects `notifyAdminOnAutoSuspend` — an admin who finds the volume too high
 * can turn it off without a code change.
 *
 * @param {Object} opts
 * @param {Object} opts.deployment    the deployment that was paused
 * @param {Object} opts.customer      the owning customer (name/email)
 * @param {number} opts.balance       wallet balance at the moment of suspension
 * @param {string} [opts.cause]       'credit_exhausted' | 'billing_failed'
 */
async function notifyDeploymentAutoSuspended({ deployment, customer, balance, cause = 'credit_exhausted' }) {
  try {
    const ns = await getNotificationSettings();
    if (!ns.notifyAdminOnAutoSuspend) return;

    const admins = await getAdminIds();
    if (!admins.length) return;

    const customerLabel = customer?.name || customer?.email || String(deployment.userId);
    const title = cause === 'billing_failed'
      ? 'Deployment paused — billing could not complete'
      : 'Deployment auto-paused — out of credit';
    const msg = cause === 'billing_failed'
      ? `"${deployment.deploymentName}" (${customerLabel}) was paused because it could not be billed. It may need manual attention.`
      : `"${deployment.deploymentName}" (${customerLabel}) was auto-paused — the wallet balance ran out `
        + `at ${deployment.currency || 'USD'} ${Number(balance ?? 0).toFixed(2)}.`;

    await _notifyAdmins(admins, {
      type: 'system_alert',
      title,
      message: msg,
      priority: 'high',
      metadata: {
        deploymentId: deployment.id,
        deploymentName: deployment.deploymentName,
        customerId: deployment.userId,
        customerEmail: customer?.email,
        balance,
        cause,
      },
      emailSubject: `${title}: ${deployment.deploymentName}`,
      emailHtml: `
        <h3>${title}</h3>
        <p><strong>Deployment:</strong> ${deployment.deploymentName}</p>
        <p><strong>Customer:</strong> ${customerLabel}</p>
        ${cause === 'billing_failed' ? '' : `<p><strong>Wallet balance:</strong> ${deployment.currency || 'USD'} ${Number(balance ?? 0).toFixed(2)}</p>`}
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        <p><em>Review this deployment in the fulfilment queue if it needs manual action.</em></p>
      `,
      emailText: msg,
    }, ns);

    console.log(`[AdminNotifier] Notified ${admins.length} admin(s) about auto-suspended deployment: ${deployment.deploymentName}`);
  } catch (err) {
    console.error('[AdminNotifier] notifyDeploymentAutoSuspended error:', err.message);
  }
}

/**
 * Delivered compute that could not be charged for, on a deployment that is now
 * closed and can never be billed again.
 *
 * This is the very last resort in the settlement chain: the wallet charge
 * failed, and so did putting the amount on the customer's outstanding balance.
 * Nothing automatic is left to try, so a person is told instead — with the
 * customer, the exact hours, the rate and the exact amount, which is
 * everything needed to raise it by hand from the admin center.
 *
 * Deliberately not gated on any notification setting. Every other alert here
 * is informational and can reasonably be switched off; this one is money the
 * platform has already delivered and is about to lose track of, and silencing
 * it by accident would defeat the point of having it.
 */
async function notifyUnbilledOnClose({ deployment, hours, rate, amount, error }) {
  try {
    const ns = await getNotificationSettings();
    const admins = await getAdminIds();
    if (!admins.length) return;

    const currency = deployment.currency || 'USD';
    const customer = await userService.findById(deployment.userId).catch(() => null);
    const customerLabel = customer?.name || customer?.email || String(deployment.userId);
    const title = 'Usage could not be billed before a deployment closed';
    const msg = `"${deployment.deploymentName}" (${customerLabel}) ran ${hours}h at ${currency} ${rate}/hr `
      + `= ${currency} ${Number(amount).toFixed(2)} that could not be charged or added to their outstanding `
      + 'balance. The deployment is now closed, so this will not be retried — it needs a manual adjustment.';

    await _notifyAdmins(admins, {
      type: 'system_alert',
      title,
      message: msg,
      priority: 'high',
      metadata: {
        deploymentId: deployment.id,
        deploymentName: deployment.deploymentName,
        customerId: deployment.userId,
        customerEmail: customer?.email,
        hours,
        rate,
        amount,
        currency,
        reason: error?.message,
      },
      emailSubject: `${title}: ${deployment.deploymentName}`,
      emailHtml: `
        <h3>${title}</h3>
        <p><strong>Deployment:</strong> ${deployment.deploymentName}</p>
        <p><strong>Customer:</strong> ${customerLabel}</p>
        <p><strong>Unbilled usage:</strong> ${hours}h at ${currency} ${rate}/hr = <strong>${currency} ${Number(amount).toFixed(2)}</strong></p>
        <p><strong>Why it failed:</strong> ${error?.message || 'unknown'}</p>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        <p><em>Apply this as a manual balance adjustment on the customer — nothing will retry it.</em></p>
      `,
      emailText: msg,
    }, ns);

    console.error(`[AdminNotifier] Unbilled usage on close: ${deployment.deploymentName} — ${currency} ${amount}`);
  } catch (err) {
    console.error('[AdminNotifier] notifyUnbilledOnClose error:', err.message);
  }
}

/**
 * Tell admins a deployment has sat un-provisioned too long — stock can be
 * held and nothing billed for it while it waits, so this is exactly the kind
 * of thing someone needs to notice without having to remember to look.
 * Latched on the deployment itself (staleProvisioningNotifiedAt) so this
 * fires once, not on every run of the job that checks for it.
 */
async function notifyStaleProvisioning(deployment, days) {
  try {
    const ns = await getNotificationSettings();
    const admins = await getAdminIds();
    if (!admins.length) return;

    const msg = `"${deployment.deploymentName}" has been waiting ${days} day(s) in "${deployment.status}" `
      + 'without going live.';

    await _notifyAdmins(admins, {
      type: 'system_alert',
      title: 'Deployment stuck provisioning',
      message: msg,
      priority: 'medium',
      metadata: { deploymentId: deployment.id, deploymentName: deployment.deploymentName, days, status: deployment.status },
      emailSubject: `Deployment stuck provisioning: ${deployment.deploymentName}`,
      emailHtml: `<h3>Deployment stuck provisioning</h3><p>${msg}</p>`,
      emailText: msg,
    }, ns);

    console.log(`[AdminNotifier] Notified ${admins.length} admin(s) about stale provisioning: ${deployment.deploymentName}`);
  } catch (err) {
    console.error('[AdminNotifier] notifyStaleProvisioning error:', err.message);
  }
}

/** Tell admins a customer's payment dispute placed a hold on their account. */
async function notifyDisputeHold({ customer, amount, reason }) {
  try {
    const ns = await getNotificationSettings();
    const admins = await getAdminIds();
    if (!admins.length) return;

    const customerLabel = customer?.name || customer?.email || 'a customer';
    const msg = `A chargeback of ${amount} was filed by ${customerLabel} — their account is now on hold `
      + 'until an admin reviews it.';

    await _notifyAdmins(admins, {
      type: 'security_alert',
      title: 'Payment dispute — account on hold',
      message: msg,
      priority: 'urgent',
      metadata: { customerId: customer?.id, customerEmail: customer?.email, amount, reason },
      emailSubject: `Chargeback: ${customerLabel}`,
      emailHtml: `<h3>Payment dispute</h3><p>${msg}</p>${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}`,
      emailText: msg,
    }, ns);

    console.log(`[AdminNotifier] Notified ${admins.length} admin(s) about a dispute hold: ${customerLabel}`);
  } catch (err) {
    console.error('[AdminNotifier] notifyDisputeHold error:', err.message);
  }
}

module.exports = {
  notifyNewCustomer,
  notifyPasswordResetRequest,
  notifyCustomerPasswordReset,
  notifyCustomerStatusChange,
  notifyDeploymentAutoSuspended,
  notifyUnbilledOnClose,
  notifyStaleProvisioning,
  notifyDisputeHold,
};
