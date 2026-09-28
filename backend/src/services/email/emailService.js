const nodemailer = require('nodemailer');
const adminSettingsService = require('../admin/adminSettingsService');
const { defaults, getDefaults } = require('./defaultTemplates');
const languageSettingsService = require('../i18n/languageSettingsService');

class EmailService {
  constructor() {
    this.transporter = null;
    this._configHash = null;
  }

  /* 
   *  SMTP Transporter (pooled, cached, auto-rebuilds on change)
   *  */
  async getTransporter() {
    const settings = await adminSettingsService.getSettings();
    const ec = settings.emailSettings;

    if (!ec || !ec.smtpHost || !ec.smtpPort) {
      throw new Error('SMTP configuration is incomplete. Configure it in Admin > Integrations > Email.');
    }

    const hash = `${ec.smtpHost}|${ec.smtpPort}|${ec.smtpUser}|${ec.smtpPassword}|${!!ec.smtpSecure}`;

    if (this.transporter && this._configHash === hash) {
      return { transporter: this.transporter, settings };
    }

    if (this.transporter) {
      try { this.transporter.close(); } catch (_) { /* ignore */ }
    }

    const port = Number(ec.smtpPort);
    const useSecure = port === 465;

    this.transporter = nodemailer.createTransport({
      host: ec.smtpHost,
      port,
      secure: useSecure,
      auth: ec.smtpUser ? { user: ec.smtpUser, pass: ec.smtpPassword } : undefined,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
    });

    this._configHash = hash;
    console.log(`[EMAIL] SMTP transporter created > ${ec.smtpHost}:${port} (pool, secure=${useSecure})`);
    return { transporter: this.transporter, settings };
  }

  resetTransporter() {
    if (this.transporter) {
      try { this.transporter.close(); } catch (_) { /* ignore */ }
    }
    this.transporter = null;
    this._configHash = null;
  }

  /* 
   *  Template Engine
   *  */

  /**
   * Which wording to send, for this template and this language.
   *
   * Precedence, highest first:
   *
   *   1. the admin's override **for this language** — emailTemplates[key].i18n[lang]
   *   2. the admin's legacy flat override — but ONLY for English
   *   3. the shipped translation for this language
   *   4. English
   *
   * Step 2's English-only gate is the important one. If an operator rewrote the
   * welcome email in English, an Urdu customer must get the shipped **Urdu**
   * default, not the operator's English prose. Letting a flat override apply to
   * every language is the obvious implementation and the wrong one: it would
   * silently un-translate every email the moment an admin edited one.
   */
  _getTemplate(settings, templateKey, lang = 'en') {
    const custom = settings.emailTemplates && settings.emailTemplates[templateKey];
    const perLang = custom && custom.i18n && custom.i18n[lang];
    const flat = lang === 'en' ? custom : null;
    const shipped = getDefaults(lang)[templateKey] || defaults[templateKey];

    const pick = (field) => {
      if (perLang && perLang[field] && perLang[field].trim()) return perLang[field].trim();
      if (flat && flat[field] && flat[field].trim()) return flat[field].trim();
      return shipped[field];
    };

    return { subject: pick('subject'), body: pick('body') };
  }

  _interpolate(template, variables) {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] !== undefined ? variables[key] : match;
    });
  }

  _commonVars(settings, user) {
    user = user || {};
    const siteName = (settings.themeSettings && settings.themeSettings.companyName) || settings.siteName || 'Our Platform';
    return {
      userName: user.name || 'there',
      userEmail: user.email || '',
      siteName,
      logoUrl: (settings.themeSettings && settings.themeSettings.logoUrl) || '',
      primaryColor: (settings.themeSettings && settings.themeSettings.primaryColor) || '#7C3AED',
      secondaryColor: (settings.themeSettings && settings.themeSettings.secondaryColor) || '#3B82F6',
      supportEmail: settings.supportEmail || '',
      year: new Date().getFullYear().toString(),
    };
  }

  /**
   * The chrome every template is wrapped in.
   *
   * ── On fonts in RTL mail ──
   * Email clients do not load webfonts, so Nastaliq is simply unavailable here
   * — an Urdu email renders in whatever Arabic-script face the reader's client
   * has. Tahoma is the pragmatic first choice: it ships with Windows and Office
   * and covers Arabic script properly, which is more than Arial does. This is a
   * real limitation of the medium, not something to work around, and the
   * operator should know the app and the email will not look identical.
   */
  _wrapInLayout(innerHtml, vars, lang = 'en') {
    const dir = languageSettingsService.directionOf(lang);
    const rtl = dir === 'rtl';
    const layout = this._interpolate2(getDefaults(lang).layout || defaults.layout, vars);

    const fontStack = rtl
      ? "Tahoma, 'Segoe UI', Arial, sans-serif"
      : 'Arial, sans-serif';
    const align = rtl ? 'right' : 'left';

    const logoBlock = vars.logoUrl
      ? '<div style="text-align: center; margin-bottom: 24px;"><img src="' + vars.logoUrl + '" alt="' + layout.logoAlt + '" style="max-height: 48px; max-width: 200px;" /></div>'
      : '';

    return '<!DOCTYPE html><html lang="' + lang + '" dir="' + dir + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>' +
      '<body style="margin: 0; padding: 0; background-color: #f4f4f7; font-family: ' + fontStack + '; direction: ' + dir + ';">' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f7;" dir="' + dir + '"><tr><td style="padding: 32px 16px;">' +
      '<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">' +
      '<tr><td style="background: linear-gradient(to right, ' + vars.primaryColor + ', ' + vars.secondaryColor + '); height: 6px;"></td></tr>' +
      '<tr><td style="padding: 32px 32px 0 32px;">' + logoBlock + '</td></tr>' +
      '<tr><td style="padding: 0 32px 32px 32px; color: #1f2937; font-size: 15px; line-height: 1.6; direction: ' + dir + '; text-align: ' + align + ';">' + innerHtml + '</td></tr>' +
      '<tr><td style="padding: 16px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">' +
      '<p style="color: #9ca3af; font-size: 12px; margin: 0;">' + layout.rights + '</p>' +
      (vars.supportEmail ? '<p style="color: #9ca3af; font-size: 12px; margin: 4px 0 0;">' + layout.needHelp + ' <a href="mailto:' + vars.supportEmail + '" style="color: ' + vars.primaryColor + ';">' + vars.supportEmail + '</a></p>' : '') +
      '</td></tr></table></td></tr></table></body></html>';
  }

  /** `_interpolate` over every string in an object — used for the layout block. */
  _interpolate2(obj, vars) {
    const out = {};
    Object.entries(obj || {}).forEach(([k, v]) => {
      out[k] = typeof v === 'string' ? this._interpolate(v, vars) : v;
    });
    return out;
  }

  /**
   * The one place every outbound email is assembled — so the one place the
   * recipient's language has to be resolved.
   *
   * `user` was already a parameter here, which is why all nine send methods
   * become language-aware without a single one of them changing: they each
   * already hand the recipient down to this call.
   *
   * `lang` may also be passed explicitly (the admin's template preview does
   * that, where there is no recipient to read it from).
   */
  async _buildEmail(settings, templateKey, extraVars, user, lang) {
    extraVars = extraVars || {};
    user = user || {};
    const language = lang || await languageSettingsService.resolveLanguage(user);

    const template = this._getTemplate(settings, templateKey, language);
    const vars = Object.assign({}, this._commonVars(settings, user), extraVars);
    const subject = this._interpolate(template.subject, vars);
    const innerHtml = this._interpolate(template.body, vars);
    const html = this._wrapInLayout(innerHtml, vars, language);
    const text = innerHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return { subject, html, text, language };
  }

  /* 
   *  Send Methods (all template-driven)
   *  */

  async sendVerificationEmail(user, verificationLink) {
    try {
      const { transporter, settings } = await this.getTransporter();
      const ec = settings.emailSettings;
      const siteName = (settings.themeSettings && settings.themeSettings.companyName) || settings.siteName || 'Our Platform';
      const fromName = ec.fromName || siteName;
      const { subject, html, text } = await this._buildEmail(settings, 'verification', { verificationLink }, user);
      const info = await transporter.sendMail({ from: '"' + fromName + '" <' + ec.fromEmail + '>', to: user.email, subject, html, text });
      console.log('Verification email sent:', info.messageId, '>', user.email);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Failed to send verification email:', error.message);
      if (process.env.NODE_ENV === 'development') {
        console.log('\n[DEV] Verification link for', user.email, ':\n', verificationLink, '\n');
      }
      return { success: false, error: error.message };
    }
  }

  async sendWelcomeEmail(user, loginLink) {
    try {
      const { transporter, settings } = await this.getTransporter();
      const ec = settings.emailSettings;
      const siteName = (settings.themeSettings && settings.themeSettings.companyName) || settings.siteName || 'Our Platform';
      const fromName = ec.fromName || siteName;
      const effectiveLoginLink = loginLink || process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002';
      const { subject, html, text } = await this._buildEmail(settings, 'welcome', { loginLink: effectiveLoginLink }, user);
      const info = await transporter.sendMail({ from: '"' + fromName + '" <' + ec.fromEmail + '>', to: user.email, subject, html, text });
      console.log('Welcome email sent:', info.messageId, '>', user.email);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Failed to send welcome email:', error.message);
      return { success: false, error: error.message };
    }
  }

  async sendPasswordResetEmail(user, resetLink) {
    try {
      const { transporter, settings } = await this.getTransporter();
      const ec = settings.emailSettings;
      const siteName = (settings.themeSettings && settings.themeSettings.companyName) || settings.siteName || 'Our Platform';
      const fromName = ec.fromName || siteName;
      const { subject, html, text } = await this._buildEmail(settings, 'passwordReset', { resetLink }, user);
      const info = await transporter.sendMail({ from: '"' + fromName + '" <' + ec.fromEmail + '>', to: user.email, subject, html, text });
      console.log('Password reset email sent:', info.messageId, '>', user.email);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Failed to send password reset email:', error.message);
      if (process.env.NODE_ENV === 'development') {
        console.log('\n[DEV] Password reset link for', user.email, ':\n', resetLink, '\n');
      }
      return { success: false, error: error.message };
    }
  }

  /*
   *  Deployment & Credit Emails
   *
   *  All of these go through _buildEmail, so an admin can override any of them
   *  from Settings → Email Templates without a code change.
   *  */

  /**
   * Shared sender for the templates below — they only differ by key and vars.
   * Never throws: an email failure must not roll back a deployment change.
   */
  async _sendTemplate(templateKey, user, extraVars) {
    try {
      const { transporter, settings } = await this.getTransporter();
      const ec = settings.emailSettings;
      const siteName = (settings.themeSettings && settings.themeSettings.companyName) || settings.siteName || 'Our Platform';
      const fromName = ec.fromName || siteName;
      const { subject, html, text } = await this._buildEmail(settings, templateKey, extraVars || {}, user);
      const info = await transporter.sendMail({ from: '"' + fromName + '" <' + ec.fromEmail + '>', to: user.email, subject, html, text });
      console.log('[EMAIL] ' + templateKey + ' sent:', info.messageId, '>', user.email);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('[EMAIL] Failed to send ' + templateKey + ':', error.message);
      return { success: false, error: error.message };
    }
  }

  _customerUrl(path) {
    const base = process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002';
    return base.replace(/\/$/, '') + path;
  }

  async sendDeploymentApprovedEmail(user, deployment) {
    return this._sendTemplate('deploymentApproved', user, {
      deploymentName: deployment.deploymentName,
      modelName: deployment.model?.name || '',
      tierName: deployment.tier?.name || '',
      pricePerHour: (deployment.effectiveRate ? deployment.effectiveRate() : deployment.pricePerHour).toFixed(4),
      currency: deployment.currency || 'USD',
      deploymentUrl: this._customerUrl('/deployments/' + deployment.id),
    });
  }

  async sendDeploymentReadyEmail(user, deployment) {
    return this._sendTemplate('deploymentReady', user, {
      deploymentName: deployment.deploymentName,
      modelName: deployment.model?.name || '',
      tierName: deployment.tier?.name || '',
      endpointUrl: deployment.endpoint?.url || '',
      pricePerHour: (deployment.effectiveRate ? deployment.effectiveRate() : deployment.pricePerHour).toFixed(4),
      currency: deployment.currency || 'USD',
      deploymentUrl: this._customerUrl('/deployments/' + deployment.id),
    });
  }

  async sendDeploymentRejectedEmail(user, deployment) {
    return this._sendTemplate('deploymentRejected', user, {
      deploymentName: deployment.deploymentName,
      modelName: deployment.model?.name || '',
      rejectionReason: deployment.rejectionReason || 'No reason was provided.',
      catalogUrl: this._customerUrl('/models'),
    });
  }

  async sendDeploymentSuspendedEmail(user, deployment, balance) {
    return this._sendTemplate('deploymentSuspended', user, {
      deploymentName: deployment.deploymentName,
      modelName: deployment.model?.name || '',
      balance: Number(balance || 0).toFixed(2),
      pricePerHour: (deployment.effectiveRate ? deployment.effectiveRate() : deployment.pricePerHour).toFixed(4),
      currency: deployment.currency || 'USD',
      walletUrl: this._customerUrl('/wallet'),
    });
  }

  async sendCreditTopUpEmail(user, { amount, balance, currency }) {
    // The receipt date is read by the customer, so it is written in their
    // locale — not the server's, and not a hardcoded en-US.
    const lang = await languageSettingsService.resolveLanguage(user);
    return this._sendTemplate('creditTopUp', user, {
      amount: Number(amount || 0).toFixed(2),
      balance: Number(balance || 0).toFixed(2),
      currency: currency || 'USD',
      paymentDate: new Intl.DateTimeFormat(languageSettingsService.intlLocale(lang), {
        year: 'numeric', month: 'short', day: 'numeric',
      }).format(new Date()),
      walletUrl: this._customerUrl('/wallet'),
    });
  }

  async sendLowBalanceEmail(user, summary) {
    return this._sendTemplate('lowBalance', user, {
      balance: Number(summary.balance || 0).toFixed(2),
      currency: summary.currency || 'USD',
      burnRatePerDay: Number(summary.burnRatePerDay || 0).toFixed(2),
      runwayDays: summary.runwayDays == null ? 'many' : String(summary.runwayDays),
      walletUrl: this._customerUrl('/wallet'),
    });
  }

  /**
   * An invitation to join a team. `recipient` need not have an account yet —
   * it is `{ email, name, language }`, the language being their own if they
   * already have an account, else the inviter's (the best guess we have).
   * The role is written in the recipient's language (teamRoles in each pack).
   */
  async sendTeamInviteEmail(recipient, { teamName, inviterName, role, acceptUrl, expiresDays }) {
    const { getDefaults } = require('./defaultTemplates');
    const lang = await languageSettingsService.resolveLanguage(recipient);
    const roleName = (getDefaults(lang).teamRoles || {})[role] || role;
    return this._sendTemplate('teamInvite', recipient, {
      teamName, inviterName, roleName, acceptUrl, expiresDays: String(expiresDays),
    });
  }

  /**
   * One team event, as an email.
   *
   * The wording arrives already rendered in the recipient's language — it is
   * the same sentence their bell shows, asked of the same catalogue
   * (services/team/teamNotifier) — so this only wraps it. The button is built
   * here rather than in the template because most events have nowhere
   * particular to send anybody, and an empty button in a mail client is worse
   * than no button.
   */
  async sendTeamNotificationEmail(recipient, {
    title, message, actionLabel, actionUrl,
  }) {
    const actionBlock = actionUrl && actionLabel
      ? `<div style="text-align: center; margin: 28px 0;">
           <a href="${actionUrl}" target="_blank" rel="noopener noreferrer"
              style="background: #4f46e5; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
             ${actionLabel}
           </a>
         </div>`
      : '';
    return this._sendTemplate('teamNotification', recipient, {
      title: title || '',
      message: message || '',
      actionBlock,
    });
  }

  /*
   *  Utility Methods
   *  */

  async sendTestEmail(recipientEmail) {
    try {
      this.resetTransporter();
      const { transporter, settings } = await this.getTransporter();
      const ec = settings.emailSettings;
      const port = Number(ec.smtpPort);
      const actualSecure = port === 465;
      const tlsMode = actualSecure ? 'SSL/TLS (implicit)' : 'STARTTLS (upgrade)';
      const siteName = (settings.themeSettings && settings.themeSettings.companyName) || settings.siteName || 'Your SaaS Platform';
      const vars = this._commonVars(settings, { name: 'Admin', email: recipientEmail });
      const innerHtml = '<h2 style="color: ' + vars.primaryColor + '; margin: 0 0 16px;">Email Configuration Test</h2>' +
        '<p>Hello!</p>' +
        '<p>This is a test email sent from <strong>' + siteName + '</strong>.</p>' +
        '<p>If you received this email, your SMTP configuration is working correctly!</p>' +
        '<hr style="border: 1px solid #e5e7eb; margin: 20px 0;">' +
        '<p style="color: #6b7280; font-size: 14px;"><strong>SMTP Details:</strong><br>' +
        'Host: ' + ec.smtpHost + '<br>Port: ' + port + '<br>Encryption: ' + tlsMode + '<br>' +
        'User: ' + ec.smtpUser + '<br>From: "' + ec.fromName + '" &lt;' + ec.fromEmail + '&gt;</p>' +
        '<p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">Sent on ' + new Date().toLocaleString() + '</p>';
      const html = this._wrapInLayout(innerHtml, vars);
      const info = await transporter.sendMail({ from: '"' + (ec.fromName || 'Test') + '" <' + ec.fromEmail + '>', to: recipientEmail, subject: 'Test Email from ' + siteName, html });
      console.log('Test email sent successfully:', info.messageId);
      return { success: true, messageId: info.messageId, message: 'Test email sent to ' + recipientEmail };
    } catch (error) {
      console.error('Failed to send test email:', error);
      throw error;
    }
  }

  async sendEmail({ to, subject, html, text }) {
    try {
      const { transporter, settings } = await this.getTransporter();
      const ec = settings.emailSettings;
      const info = await transporter.sendMail({ from: '"' + (ec.fromName || 'Notification') + '" <' + ec.fromEmail + '>', to, subject, html, text });
      console.log('Email sent successfully:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Failed to send email:', error);
      throw error;
    }
  }

  async verifyConnection() {
    try {
      this.resetTransporter();
      const { transporter } = await this.getTransporter();
      await transporter.verify();
      return { success: true, message: 'SMTP connection verified successfully' };
    } catch (error) {
      console.error('SMTP verification failed:', error);
      return { success: false, message: error.message };
    }
  }

  async previewTemplate(templateKey, customTemplate, lang = 'en') {
    const settings = await adminSettingsService.getSettings();
    const sampleUser = { name: 'John Doe', email: 'john@example.com' };
    const customerUrl = process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002';
    // Sample values for every variable the nine templates actually use — see
    // TEMPLATE_VARIABLES. A variable missing from here renders in the preview
    // as a literal `{{name}}`, which is how the deployment and wallet previews
    // used to look: those six templates had no entries at all, and nobody
    // noticed because the admin screen only ever listed the first three.
    const sampleVars = {
      // Account
      verificationLink: customerUrl + '/verify-email/sample-token-123',
      loginLink: customerUrl,
      resetLink: customerUrl + '/reset-password?token=sample-token-123',
      // Deployments
      deploymentName: 'llama-3-8b-prod',
      modelName: 'Llama 3 8B Instruct',
      tierName: 'A100 40GB · 1×',
      endpointUrl: 'https://api.example.com/v1/d/sample-deployment-id',
      deploymentUrl: customerUrl + '/deployments/sample-deployment-id',
      catalogUrl: customerUrl + '/models',
      rejectionReason: 'The requested hardware is not available in your region right now.',
      // Teams
      teamName: 'Acme Research',
      inviterName: 'Jane Smith',
      roleName: 'Developer',
      acceptUrl: customerUrl + '/invite/sample-token-123',
      expiresDays: '7',
      pricePerHour: '1.85',
      // Wallet
      amount: '50.00',
      balance: '12.40',
      burnRatePerDay: '4.20',
      runwayDays: '3',
      currency: 'USD',
      walletUrl: customerUrl + '/billing',
      paymentDate: new Intl.DateTimeFormat(languageSettingsService.intlLocale(lang), {
        year: 'numeric', month: 'long', day: 'numeric',
      }).format(new Date()),
    };
    if (customTemplate) {
      var vars = Object.assign({}, this._commonVars(settings, sampleUser), sampleVars);
      var subject2 = this._interpolate(customTemplate.subject || '', vars);
      var innerHtml2 = this._interpolate(customTemplate.body || '', vars);
      var html2 = this._wrapInLayout(innerHtml2, vars, lang);
      return { subject: subject2, html: html2 };
    }
    var result = await this._buildEmail(settings, templateKey, sampleVars, sampleUser, lang);
    return { subject: result.subject, html: result.html };
  }
}

module.exports = new EmailService();
