const dns = require('dns').promises;
const adminSettingsService = require('../../services/admin/adminSettingsService');

/**
 * Well-known, trusted email domains that should NEVER be blocked.
 * These bypass the blocked-domains list AND the MX-record check.
 */
const TRUSTED_DOMAINS = new Set([
  // Google
  'gmail.com', 'googlemail.com', 'google.com',
  // Microsoft
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'outlook.co.uk',
  'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.it', 'hotmail.es',
  'outlook.de', 'outlook.fr', 'outlook.es', 'outlook.it',
  // Yahoo
  'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'yahoo.it',
  'yahoo.es', 'yahoo.co.jp', 'yahoo.ca', 'yahoo.com.au', 'yahoo.co.in',
  'ymail.com', 'rocketmail.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // Zoho
  'zoho.com', 'zohomail.com',
  // ProtonMail
  'protonmail.com', 'proton.me', 'pm.me',
  // AOL
  'aol.com',
  // GMX
  'gmx.com', 'gmx.de', 'gmx.net',
  // Mail.com
  'mail.com', 'email.com',
  // Fastmail
  'fastmail.com', 'fastmail.fm',
  // Tutanota
  'tutanota.com', 'tutamail.com', 'tuta.io',
]);

/**
 * A deliberately conservative shape: exactly one "@", a non-empty local part,
 * a dotted domain, and a TLD of at least two letters. Not RFC-complete — no
 * practical regex is — but it rejects everything listed in the comment inside
 * the handler while accepting every address a real customer will type.
 */
const EMAIL_SHAPE = /^[^\s@]+@(?:[^\s@.]+\.)+[A-Za-z]{2,}$/;

/** Whitespace or any C0/C1 control character, anywhere in the address. */
const CONTROL_OR_SPACE = new RegExp(
  `[\\s${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`
);

/**
 * Validate email format, then check it isn't a disposable-domain address.
 */
const validateEmail = async (req, res, next) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return next(); // Let the route handler handle missing email
    }

    const invalidFormat = () => res.status(400).json({
      success: false,
      message: 'Please enter a valid email address'
    });

    /**
     * Shape check before anything else.
     *
     * The only test used to be "is there something after the @", which let
     * through a set of addresses that can never receive mail — and therefore
     * accounts that can never verify, reset a password, or be contacted:
     *   `@b.com`      no local part
     *   `a@b`         no TLD
     *   `a b@c.com`   contains a space
     *   `a@b.com\n`   trailing newline — also a mail-header-injection vector
     *   300-char local part, far over the RFC 5321 limit of 64
     */
    if (typeof email !== 'string') return invalidFormat();

    const trimmed = email.trim();
    // No whitespace or control characters anywhere, including inside
    if (trimmed !== email || CONTROL_OR_SPACE.test(trimmed)) return invalidFormat();
    if (trimmed.length > 254) return invalidFormat();
    if (!EMAIL_SHAPE.test(trimmed)) return invalidFormat();

    const [localPart] = trimmed.split('@');
    if (localPart.length > 64) return invalidFormat();

    // Extract domain from email
    const domain = trimmed.toLowerCase().split('@')[1];

    if (!domain) return invalidFormat();

    // Trusted domains always pass — no further checks needed
    if (TRUSTED_DOMAINS.has(domain)) {
      return next();
    }

    // Get blocked domains from settings
    const settings = await adminSettingsService.getSettings();
    const allowTemporaryEmails = settings.customerSettings?.allowTemporaryEmails === true;

    // If admin has enabled temporary emails, skip all blocking checks
    if (allowTemporaryEmails) {
      return next();
    }

    const blockedDomains = settings.customerSettings?.blockedTemporaryEmailDomains || [];

    // Check against temporary email domains list from settings
    if (blockedDomains.includes(domain)) {
      return res.status(400).json({
        success: false,
        message: 'Temporary or disposable email addresses are not allowed. Please use a permanent email address.',
        errorCode: 'TEMP_EMAIL_NOT_ALLOWED'
      });
    }

    // Verify domain has valid MX records (best-effort — don't block on DNS failure)
    try {
      await dns.resolveMx(domain);
    } catch (dnsError) {
      // DNS lookup failed — log a warning but allow the signup to proceed.
      // Blocking on DNS failure rejects legitimate domains when the server
      // has connectivity issues or restrictive DNS settings.
      console.warn(`[EMAIL-VALIDATOR] MX lookup failed for ${domain}: ${dnsError.message} — allowing anyway`);
    }

    next();
  } catch (error) {
    console.error('Email validation error:', error);
    // Don't block the request if validation fails
    // Let it proceed and handle errors downstream
    next();
  }
};

/*
 * Four more functions used to live here — isTemporaryEmail, addTempEmailDomain,
 * removeTempEmailDomain and getBlockedDomains — all operating on a
 * module-level `TEMP_EMAIL_DOMAINS` array.
 *
 * That array is gone: the blocklist became admin-controlled data
 * (`AdminSettings.customerSettings.blockedTemporaryEmailDomains`, read above),
 * which is the right place for it — an operator can edit it without a deploy.
 * The four helpers were left behind referencing a variable that no longer
 * existed, so every one of them threw a ReferenceError on call. Nothing called
 * them, which is the only reason it never surfaced; they were exported, so
 * anything that started using them would have broken immediately.
 *
 * Deleted rather than rewritten: the settings-driven path already does this
 * job, and a second in-memory copy of the same list is what caused the problem.
 */

module.exports = {
  validateEmail,
};
