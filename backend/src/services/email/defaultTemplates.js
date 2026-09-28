/**
 * Default Email Templates
 * 
 * Each template has:
 *  - subject: Email subject line (supports {{variables}})
 *  - body:    Inner HTML body (supports {{variables}}) — gets wrapped in the layout
 * 
 * Available variables for ALL templates:
 *   {{userName}}, {{userEmail}}, {{siteName}}, {{logoUrl}},
 *   {{primaryColor}}, {{secondaryColor}}, {{supportEmail}}, {{year}}
 * 
 * Per-template variables:
 *   verification:   {{verificationLink}}
 *   welcome:        {{loginLink}}
 *   passwordReset:  {{resetLink}}
 */

const defaults = {
  verification: {
    subject: 'Verify your email – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">Verify your email address</h2>
      <p>Hi {{userName}},</p>
      <p>Thanks for signing up for <strong>{{siteName}}</strong>! Please click the button below to verify your email address and activate your account.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{verificationLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Verify Email Address
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">Or copy and paste this link into your browser:</p>
      <p style="color: {{primaryColor}}; font-size: 13px; word-break: break-all;">{{verificationLink}}</p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
      </p>
    `,
  },
  welcome: {
    subject: 'Welcome to {{siteName}}!',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">Welcome aboard, {{userName}}! 🎉</h2>
      <p>Your account on <strong>{{siteName}}</strong> has been created and verified successfully.</p>
      <p>Here's what you can do next:</p>
      <ul style="line-height: 2; color: #374151;">
        <li>Explore your dashboard and tools</li>
        <li>Top up your credit balance to deploy a model</li>
        <li>Browse the model catalog for what's available</li>
      </ul>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{loginLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Go to Dashboard
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        You're receiving this because you signed up for {{siteName}}.
      </p>
    `,
  },
  passwordReset: {
    subject: 'Reset your password – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">Reset your password</h2>
      <p>Hi {{userName}},</p>
      <p>We received a request to reset the password for your <strong>{{siteName}}</strong> account.</p>
      <p>Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{resetLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Reset Password
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">Or copy and paste this link into your browser:</p>
      <p style="color: {{primaryColor}}; font-size: 13px; word-break: break-all;">{{resetLink}}</p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        If you didn't request a password reset, you can safely ignore this email. Your password will not change.
      </p>
    `,
  },
  /* ── Deployment lifecycle ── */

  deploymentApproved: {
    subject: 'Your {{modelName}} deployment is being set up – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">Your deployment has been approved</h2>
      <p>Hi {{userName}},</p>
      <p>Good news — your request for <strong>{{modelName}}</strong> has been approved and our team has started provisioning it.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Deployment</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{deploymentName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Model</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{modelName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Hardware</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{tierName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Rate</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{pricePerHour}}/hour</td></tr>
      </table>

      <p>We'll email you again as soon as your endpoint is live. Billing only starts once the deployment is running.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{deploymentUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          View Deployment
        </a>
      </div>
    `,
  },

  deploymentReady: {
    subject: '{{modelName}} is live – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">Your model is ready 🚀</h2>
      <p>Hi {{userName}},</p>
      <p><strong>{{deploymentName}}</strong> is now running and ready to accept requests.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Model</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{modelName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Hardware</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{tierName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Endpoint</td><td style="padding: 6px 12px; text-align: right; font-weight: 600; word-break: break-all;">{{endpointUrl}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Rate</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{pricePerHour}}/hour</td></tr>
      </table>

      <p style="color: #b45309; background: #fffbeb; border-left: 3px solid #f59e0b; padding: 12px 16px; border-radius: 6px; font-size: 14px;">
        For security, your API key is not included in this email. Open your deployment in the dashboard to copy it.
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{deploymentUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Get API Key
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        Hourly billing started when the deployment went live. Pause or stop it any time from the dashboard to stop charges.
      </p>
    `,
  },

  deploymentRejected: {
    subject: 'About your {{modelName}} request – {{siteName}}',
    body: `
      <h2 style="color: #ff4d4f; margin: 0 0 16px;">We couldn't proceed with this request</h2>
      <p>Hi {{userName}},</p>
      <p>Unfortunately we weren't able to provision <strong>{{deploymentName}}</strong> ({{modelName}}) at this time.</p>

      <p style="background: #fff1f0; border-left: 3px solid #ff4d4f; padding: 12px 16px; border-radius: 6px; color: #a8071a;">
        <strong>Reason:</strong> {{rejectionReason}}
      </p>

      <p>You have not been charged for this request. If you'd like help finding a configuration that works, just reply to this email or contact us at {{supportEmail}}.</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{catalogUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Browse Models
        </a>
      </div>
    `,
  },

  deploymentSuspended: {
    subject: 'Deployment paused – out of credit – {{siteName}}',
    body: `
      <h2 style="color: #faad14; margin: 0 0 16px;">Your deployment has been paused</h2>
      <p>Hi {{userName}},</p>
      <p>We paused <strong>{{deploymentName}}</strong> ({{modelName}}) because your credit balance ran out. Your configuration and data are safe — topping up will let you resume it.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Current balance</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{balance}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Rate</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{pricePerHour}}/hour</td></tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Add Credit
        </a>
      </div>
    `,
  },

  /* ── Credits / wallet ── */

  creditTopUp: {
    subject: 'Credit added – {{currency}} {{amount}} – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">Your credit has been added</h2>
      <p>Hi {{userName}},</p>
      <p>We've added <strong>{{currency}} {{amount}}</strong> to your account.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Amount added</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{amount}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">New balance</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{balance}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Date</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{paymentDate}}</td></tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          View Wallet
        </a>
      </div>
    `,
  },

  lowBalance: {
    subject: 'Low credit balance – {{siteName}}',
    body: `
      <h2 style="color: #faad14; margin: 0 0 16px;">Your balance is running low</h2>
      <p>Hi {{userName}},</p>
      <p>Your credit balance is <strong>{{currency}} {{balance}}</strong>. At your current usage of {{currency}} {{burnRatePerDay}}/day, that's about <strong>{{runwayDays}} day(s)</strong> of runway left.</p>
      <p>Top up now to keep your deployments running without interruption — they are paused automatically when the balance runs out.</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Add Credit
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        You can enable auto top-up in your wallet settings so this never happens.
      </p>
    `,
  },
  teamNotification: {
    subject: '{{title}} · {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">{{title}}</h2>
      <p>Hi {{name}},</p>
      <p>{{message}}</p>
      {{actionBlock}}
      <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
        You are receiving this because of your membership of an organization on {{siteName}}.
      </p>
`,
  },
  teamInvite: {
    subject: '{{inviterName}} invited you to {{teamName}} on {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">Join {{teamName}}</h2>
      <p>Hi,</p>
      <p><strong>{{inviterName}}</strong> has invited you to join <strong>{{teamName}}</strong> on {{siteName}} as <strong>{{roleName}}</strong>.</p>
      <p>Accept with the account for this email address. If you do not have one yet, you can create it from the invitation page.</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{acceptUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Accept invitation
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">This invitation expires in {{expiresDays}} day(s). If you were not expecting it, you can ignore this email.</p>
    `,
  },
};

/** List of all template keys — used for validation */
/**
 * The layout's own wording — the footer strip every template is wrapped in.
 *
 * Kept here rather than inline in `_wrapInLayout` so it can be translated like
 * anything else; it was three hardcoded English strings sitting underneath
 * nine translatable ones.
 *
 * Deliberately NOT in TEMPLATE_KEYS: it is not a template an admin sends or
 * overrides, so it must not appear in the admin's template list.
 */
defaults.layout = {
  rights: '&copy; {{year}} {{siteName}}. All rights reserved.',
  needHelp: 'Need help?',
  logoAlt: '{{siteName}}',
};

/**
 * Role names as they appear in a sentence (the team invitation). Like
 * `layout`, travelling with each language pack, and not a template.
 */
defaults.teamRoles = {
  owner: 'Owner', admin: 'Admin', billing: 'Billing', developer: 'Developer', viewer: 'Viewer',
};

const TEMPLATE_KEYS = Object.keys(defaults).filter((k) => k !== 'layout' && k !== 'teamRoles');

/**
 * The shipped templates for a language, with English filling any gap.
 *
 * Translations live one file per language in `./locales/`, and a language pack
 * may be partial — an operator who has had three of the nine translated should
 * get those three, not a blocked send. So the merge is per key, the same way
 * the frontend falls back per key.
 *
 * `require` inside the function is deliberate and safe here: this is CommonJS
 * running on a server with no bundler, so a computed path resolves at call
 * time. That is what lets a new language's emails ship as one file drop into
 * `./locales/` with no code change — the same promise the frontend makes.
 *
 * Nothing is cached beyond Node's own module cache, which already holds each
 * pack after its first use.
 */
const getDefaults = (lang) => {
  if (!lang || lang === 'en') return defaults;
  let pack = {};
  try {
    pack = require(`./locales/${lang}`);
  } catch {
    // No pack for this language yet — English is the whole answer.
    return defaults;
  }
  const merged = {};
  TEMPLATE_KEYS.forEach((key) => {
    const en = defaults[key];
    const tr = pack[key];
    merged[key] = {
      subject: (tr && tr.subject && tr.subject.trim()) ? tr.subject : en.subject,
      body: (tr && tr.body && tr.body.trim()) ? tr.body : en.body,
    };
  });
  // The layout's own wording (footer, "need help") travels with the pack.
  merged.layout = pack.layout || defaults.layout;
  merged.teamRoles = { ...defaults.teamRoles, ...(pack.teamRoles || {}) };
  return merged;
};

/** Variables available per template type */
const TEMPLATE_VARIABLES = {
  verification: ['userName', 'userEmail', 'siteName', 'logoUrl', 'primaryColor', 'secondaryColor', 'supportEmail', 'year', 'verificationLink'],
  welcome: ['userName', 'userEmail', 'siteName', 'logoUrl', 'primaryColor', 'secondaryColor', 'supportEmail', 'year', 'loginLink'],
  passwordReset: ['userName', 'userEmail', 'siteName', 'logoUrl', 'primaryColor', 'secondaryColor', 'supportEmail', 'year', 'resetLink'],
  deploymentApproved: ['userName', 'userEmail', 'siteName', 'logoUrl', 'primaryColor', 'secondaryColor', 'supportEmail', 'year', 'deploymentName', 'modelName', 'tierName', 'pricePerHour', 'currency', 'deploymentUrl'],
  deploymentReady: ['userName', 'userEmail', 'siteName', 'logoUrl', 'primaryColor', 'secondaryColor', 'supportEmail', 'year', 'deploymentName', 'modelName', 'tierName', 'endpointUrl', 'pricePerHour', 'currency', 'deploymentUrl'],
  deploymentRejected: ['userName', 'userEmail', 'siteName', 'logoUrl', 'primaryColor', 'secondaryColor', 'supportEmail', 'year', 'deploymentName', 'modelName', 'rejectionReason', 'catalogUrl'],
  deploymentSuspended: ['userName', 'userEmail', 'siteName', 'logoUrl', 'primaryColor', 'secondaryColor', 'supportEmail', 'year', 'deploymentName', 'modelName', 'balance', 'pricePerHour', 'currency', 'walletUrl'],
  creditTopUp: ['userName', 'userEmail', 'siteName', 'logoUrl', 'primaryColor', 'secondaryColor', 'supportEmail', 'year', 'amount', 'balance', 'currency', 'paymentDate', 'walletUrl'],
  lowBalance: ['userName', 'userEmail', 'siteName', 'logoUrl', 'primaryColor', 'secondaryColor', 'supportEmail', 'year', 'balance', 'currency', 'burnRatePerDay', 'runwayDays', 'walletUrl'],
  teamInvite: ['siteName', 'logoUrl', 'primaryColor', 'secondaryColor', 'supportEmail', 'year', 'teamName', 'inviterName', 'roleName', 'acceptUrl', 'expiresDays'],
  teamNotification: ['siteName', 'logoUrl', 'primaryColor', 'secondaryColor', 'supportEmail', 'year', 'name', 'title', 'message', 'actionBlock'],
};

module.exports = { defaults, getDefaults, TEMPLATE_KEYS, TEMPLATE_VARIABLES };
