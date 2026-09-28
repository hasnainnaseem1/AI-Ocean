const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const userService = require('../../../services/user/userService');
const activityLogService = require('../../../services/admin/activityLogService');
const adminSettingsService = require('../../../services/admin/adminSettingsService');
const notificationService = require('../../../services/notification/notificationService');
const { auth } = require('../../../middleware/auth');
const { validateEmail, validate } = require('../../../middleware/validation');
const schemas = require('../../../middleware/validation/schemas');
const { getWelcomeNotification } = require('../../../utils/helpers');
const { getClientIP } = require('../../../utils/helpers/ipHelper');
const { customerSessionUser } = require('../../../utils/helpers/customerSession');
const languageSettingsService = require('../../../services/i18n/languageSettingsService');
const emailService = require('../../../services/email/emailService');
const { notifyNewCustomer, notifyCustomerPasswordReset } = require('../../../services/notification/adminNotifier');
const { getSecuritySettings, msToJwtExpiry, validatePassword } = require('../../../utils/helpers/securityHelper');
const { provisionWallet } = require('../../../services/billing/walletProvisioning');
const teamSettingsService = require('../../../services/team/teamSettingsService');

/**
 * Signup asks "just me / my team or company". Choosing a team only marks the
 * account for the post-signup onboarding (name the organization, invite
 * people) — it creates nothing yet and closes no door: an individual can
 * create a team later, and a team founder keeps their personal account.
 * Ignored when teams are switched off.
 */
const wantsTeamOnboarding = async (intent) => intent === 'team'
  && (await teamSettingsService.getTeamSettings()).enabled;

/**
 * One message for every failed sign-in, whatever the cause. Anything that
 * distinguishes "no such account" from "wrong password" turns the login
 * endpoint into an account-enumeration oracle.
 */
const INVALID_CREDENTIALS_MESSAGE = 'Incorrect email or password.';


// Generate JWT token with dynamic session timeout
const generateToken = (userId, sessionTimeoutMs) => {
  const expiresIn = sessionTimeoutMs ? msToJwtExpiry(sessionTimeoutMs) : '7d';
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn }
  );
};

// Generate email verification token
const generateVerificationToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Hash a raw token for safe DB storage (SHA-256)
const hashToken = (rawToken) => {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
};

// Google OAuth2 client — accepts a clientId param so we can pass DB-driven value
const getGoogleClient = (clientId) => new OAuth2Client(clientId);

// @route   POST /api/v1/auth/customer/google
// @desc    Sign in / sign up via Google (accepts ID token credential OR access_token)
// @access  Public
router.post('/google', async (req, res) => {
  try {
    const { credential, access_token, intent } = req.body;

    if (!credential && !access_token) {
      return res.status(400).json({ success: false, message: 'Google credential is required' });
    }

    // --- Read Google SSO config from DB (fall back to .env) ---
    const siteSettings = await adminSettingsService.getSettings();
    const googleSSO = siteSettings.googleSSOSettings || {};
    if (!googleSSO.enabled) {
      return res.status(503).json({ success: false, message: 'Google sign-in is currently disabled.' });
    }
    const googleClientId = (googleSSO.clientId && googleSSO.clientId.trim()) || process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
      return res.status(503).json({ success: false, message: 'Google OAuth is not configured on this server' });
    }

    let email, name, picture, googleId, email_verified;

    if (credential) {
      // --- ID token flow (GoogleLogin component / One Tap) ---
      const client = getGoogleClient(googleClientId);
      try {
        const ticket = await client.verifyIdToken({
          idToken: credential,
          audience: googleClientId,
        });
        const p = ticket.getPayload();
        ({ email, name, picture, sub: googleId, email_verified } = p);
      } catch (verifyErr) {
        console.error('Google ID token verification failed:', verifyErr.message);
        return res.status(401).json({ success: false, message: 'Invalid Google credential. Please try again.' });
      }
    } else {
      // --- Access token flow (useGoogleLogin implicit flow) ---
      try {
        const oauthClient = getGoogleClient(googleClientId);
        oauthClient.setCredentials({ access_token });
        const { data } = await oauthClient.request({
          url: 'https://www.googleapis.com/oauth2/v2/userinfo',
        });
        email = data.email;
        name = data.name;
        picture = data.picture;
        googleId = data.id;
        email_verified = data.verified_email;
      } catch (fetchErr) {
        console.error('Google userinfo fetch failed:', fetchErr.message);
        return res.status(401).json({ success: false, message: 'Could not verify Google account. Please try again.' });
      }
    }

    if (!email_verified) {
      return res.status(400).json({ success: false, message: 'Google account email is not verified.' });
    }

    // --- Check feature flags for login / signup ---
    const featureFlags = siteSettings.features || {};
    const clientIP = getClientIP(req);
    let user = await userService.findByEmail(email);
    let isNewUser = false;

    if (user) {
      // Existing user → this is a login — check enableLogin
      if (featureFlags.enableLogin === false) {
        return res.status(403).json({
          success: false,
          message: 'Customer login is currently disabled. Please contact the administrator.',
        });
      }

      // Existing user — must be a customer account
      if (user.accountType !== 'customer') {
        return res.status(403).json({
          success: false,
          message: 'This email is registered as an admin account. Please use a different login.',
        });
      }

      // If account was suspended / banned, block
      if (['suspended', 'banned'].includes(user.status)) {
        return res.status(403).json({
          success: false,
          message: 'Your account has been suspended. Please contact support.',
        });
      }

      // Promote to active & verified if they were pending; store Google
      // details if not already stored; update login watermarks.
      const updates = { lastLogin: new Date(), lastLoginIP: clientIP };
      if (!user.isEmailVerified) {
        updates.isEmailVerified = true;
        updates.emailVerificationToken = null;
        updates.emailVerificationExpires = null;
      }
      if (user.status === 'pending_verification') {
        updates.status = 'active';
      }
      if (!user.googleId) updates.googleId = googleId;
      if (!user.avatar && picture) updates.avatar = picture;

      user = await userService.updateUser(user, updates);

    } else {
      // New user → this is a signup — check enableCustomerSignup
      if (featureFlags.enableCustomerSignup === false) {
        return res.status(403).json({
          success: false,
          message: 'Customer signup is currently disabled. Please contact the administrator.',
        });
      }

      // New user — create account (no email verification needed for Google)
      isNewUser = true;

      user = await userService.createUser({
        name,
        email,
        // Google users have no local password — set a random unguessable one
        password: crypto.randomBytes(32).toString('hex'),
        accountType: 'customer',
        role: 'customer',
        status: 'active',
        isEmailVerified: true,
        googleId,
        avatar: picture || null,
        lastLogin: new Date(),
        lastLoginIP: clientIP,
        teamOnboardingPending: await wantsTeamOnboarding(intent),
      });

      await provisionWallet(user);
      // Google hands us an address that is already verified, so a company
      // domain rule applies from the first sign-in.
      await require('../../../services/team/domainJoinService').applyForUser(user);

      // Send welcome email asynchronously (don't block login)
      emailService.sendWelcomeEmail?.(user).catch(() => {});

      // Notify admins about new customer (Google SSO signup)
      notifyNewCustomer(user).catch(() => {});
    }

    await activityLogService.logActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
      action: isNewUser ? 'signup' : 'login',
      actionType: 'auth',
      description: `Google SSO ${isNewUser ? 'signup' : 'login'}: ${user.email}`,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    const ssoSecSettings = await getSecuritySettings();
    const token = generateToken(user.id, ssoSecSettings.sessionTimeout);

    res.json({
      success: true,
      message: isNewUser ? 'Account created successfully!' : 'Login successful',
      token,
      isNewUser,
      user: customerSessionUser(user),
    });

  } catch (error) {
    console.error('Google SSO error:', error);
    res.status(500).json({ success: false, message: 'Google sign-in failed. Please try again.' });
  }
});

// @route   POST /api/v1/auth/customer/signup
// @desc    Register new customer
// @access  Public
router.post('/signup', validate(schemas.signup), validateEmail, async (req, res) => {
  try {
    const { name, email, password, intent } = req.body;
    const clientIP = getClientIP(req);

    // Check if customer signup is enabled
    const featureSettings = await adminSettingsService.getSettings();
    if (featureSettings.features?.enableCustomerSignup === false) {
      return res.status(403).json({
        success: false,
        message: 'Customer signup is currently disabled. Please contact the administrator.',
        action: 'disabled'
      });
    }

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields',
        action: 'retry'
      });
    }

    // Validate password against security settings
    const secSettings = await getSecuritySettings();
    const pwdCheck = await validatePassword(password, secSettings);
    if (!pwdCheck.valid) {
      return res.status(400).json({
        success: false,
        message: pwdCheck.message,
        action: 'retry'
      });
    }

    // Check if user already exists
    const existingUser = await userService.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered. Please login instead.',
        action: 'login',
        loginUrl: '/api/v1/auth/customer/login'
      });
    }

    // Read admin settings to determine verification behaviour
    const settings = await adminSettingsService.getSettings();
    const requireEmailVerification = settings.customerSettings?.requireEmailVerification !== false;

    // Generate email verification token (always create it; used only if verification is required)
    const rawVerificationToken = generateVerificationToken();
    const verificationToken = hashToken(rawVerificationToken); // store hash, send raw
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Create new customer
    const user = await userService.createUser({
      name,
      email,
      password,
      accountType: 'customer',
      role: 'customer',
      status: requireEmailVerification ? 'pending_verification' : 'active',
      isEmailVerified: !requireEmailVerification,
      emailVerificationToken: requireEmailVerification ? verificationToken : undefined,
      emailVerificationExpires: requireEmailVerification ? verificationExpiry : undefined,
      teamOnboardingPending: await wantsTeamOnboarding(intent),
    });

    await provisionWallet(user);

    // Send raw token in URL; DB stores the hash
    const verificationLink = `${process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002'}/verify-email/${rawVerificationToken}`;

    // Send verification email ASYNCHRONOUSLY — never block the signup response.
    // The user goes to the "check your inbox" page immediately; the email
    // arrives in the background.  If it fails, "Resend verification" still works.
    if (requireEmailVerification) {
      emailService.sendVerificationEmail(user, verificationLink)
        .then(result => {
          if (result?.success) {
            console.log(`[SIGNUP] Verification email sent to ${email} (${result.messageId})`);
          } else {
            console.warn(`[SIGNUP] Verification email failed for ${email}: ${result?.error || 'unknown'}`);
          }
        })
        .catch(err => {
          console.error(`[SIGNUP] Verification email error for ${email}:`, err.message);
        });
    }

    // Log activity
    await activityLogService.logActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
      action: 'signup',
      actionType: 'auth',
      description: `New customer registered: ${user.email}`,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    // Create welcome notification — branded from Admin Center settings, not
    // from the .env APP_NAME the rest of the app stopped using.
    //
    // Deliberately carries no `contentKey`: this wording is the operator's own
    // (themeSettings.welcomeTitle / welcomeMessage), so there is nothing for a
    // translator to translate. It stays in whatever language the operator wrote
    // it in — a known mixed-language spot, recorded in notificationCopy.js.
    const welcomeNotification = getWelcomeNotification(await adminSettingsService.getSettings());
    await notificationService.createNotification({
      recipientId: user.id,
      ...welcomeNotification
    });

    // Notify admins about new customer (respects notification settings)
    notifyNewCustomer(user).catch(() => {});

    // If email verification is NOT required, log the user in immediately
    if (!requireEmailVerification) {
      // Send welcome email (fire-and-forget)
      emailService.sendWelcomeEmail(user).catch((err) => {
        console.error(`[SIGNUP] Welcome email failed for ${user.email}:`, err.message);
      });

      const signupSecSettings = await getSecuritySettings();
      const token = generateToken(user.id, signupSecSettings.sessionTimeout);
      return res.status(201).json({
        success: true,
        message: 'Account created successfully!',
        verificationRequired: false,
        token,
        user: customerSessionUser(user)
      });
    }

    res.status(201).json({
      success: true,
      message: 'Account created successfully! Please check your email to verify your account.',
      nextStep: 'Please check your email to verify your account.',
      verificationRequired: true,
      verificationLink: process.env.NODE_ENV === 'development' ? verificationLink : undefined
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating account. Please try again later.',
      action: 'retry'
    });
  }
});

// @route   POST /api/v1/auth/customer/login
// @desc    Login customer
// @access  Public
router.post('/login', validate(schemas.login), async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientIP = getClientIP(req);

    // Check if customer login is enabled
    const loginFeatureSettings = await adminSettingsService.getSettings();
    if (loginFeatureSettings.features?.enableLogin === false) {
      return res.status(403).json({
        success: false,
        message: 'Customer login is currently disabled. Please contact the administrator.',
        action: 'disabled'
      });
    }

    // Validation. The type check matters: a non-string `email` (an object or
    // an array) used to reach the query layer and come back as a 500.
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
        action: 'retry'
      });
    }

    // Find user
    let user = await userService.findByEmail(email, { accountType: 'customer' });

    /**
     * An unknown email and a wrong password must be indistinguishable.
     *
     * This used to answer 404 "No account found with this email. Please sign
     * up first." for one and 401 "Incorrect password. N attempts remaining."
     * for the other, which let anyone test an address list against the
     * endpoint and learn exactly which ones are customers — and told them how
     * many guesses were left before lockout.
     */
    if (!user) {
      return res.status(401).json({
        success: false,
        message: INVALID_CREDENTIALS_MESSAGE,
        action: 'retry'
      });
    }

    // Fetch dynamic security settings
    const secSettings = await getSecuritySettings();

    // Account locked
    if (user.isLocked()) {
      const lockMinutes = Math.ceil((new Date(user.lockUntil) - Date.now()) / (60 * 1000));
      return res.status(423).json({
        success: false,
        message: `Account temporarily locked. Please try again in ${lockMinutes} minutes.`,
        action: 'wait',
        lockedUntil: user.lockUntil,
        contactSupport: process.env.SUPPORT_EMAIL || 'support@example.com'
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      const updatedUser = await userService.incLoginAttempts(user, secSettings.maxLoginAttempts, secSettings.lockoutDuration);
      const attemptsRemaining = Math.max(0, secSettings.maxLoginAttempts - updatedUser.loginAttempts);

      await activityLogService.logActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        action: 'login',
        actionType: 'auth',
        description: 'Failed login attempt - incorrect password',
        ipAddress: clientIP,
        userAgent: req.get('user-agent'),
        status: 'failed',
        errorMessage: 'Incorrect password'
      });

      /**
       * Same wording and status as the unknown-email branch above, and the
       * remaining-attempts count is no longer disclosed — it told an attacker
       * exactly how many guesses they had left on this address before they
       * should rotate to another one. The count is still tracked and still
       * locks the account; it is simply not narrated to the caller.
       */
      return res.status(401).json({
        success: false,
        message: INVALID_CREDENTIALS_MESSAGE,
        action: 'retry'
      });
    }

    // Email not verified
    if (!user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in.',
        action: 'verify_email',
        emailVerificationRequired: true,
        resendUrl: '/api/v1/auth/customer/resend-verification',
        hint: 'Check your email inbox for verification link.'
      });
    }

    // Account not active
    if (user.status !== 'active') {
      const statusMessages = {
        pending_verification: 'Your account is pending verification.',
        suspended: 'Your account has been suspended. Please contact support.',
        banned: 'Your account has been banned. Please contact support.',
        inactive: 'Your account is inactive. Please contact support.'
      };

      return res.status(403).json({
        success: false,
        message: statusMessages[user.status] || 'Your account is not active.',
        action: 'contact_support',
        accountStatus: user.status,
        contactSupport: process.env.SUPPORT_EMAIL || 'support@example.com'
      });
    }

    // Success - reset attempts and login
    user = await userService.updateUser(user, {
      loginAttempts: 0,
      lockUntil: null,
      lastLogin: new Date(),
      lastLoginIP: clientIP,
    });

    await activityLogService.logActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
      action: 'login',
      actionType: 'auth',
      description: 'Successful login',
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    const token = generateToken(user.id, secSettings.sessionTimeout);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: customerSessionUser(user)
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging in. Please try again later.',
      action: 'retry'
    });
  }
});

// @route   GET /api/v1/auth/customer/verify-email/:token
// @desc    Verify email address
// @access  Public
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const clientIP = getClientIP(req);

    // Hash the raw token from the URL to compare against stored hash
    const hashedToken = hashToken(token);

    // Look up user by token hash (ignore expiry for now — check separately)
    const user = await userService.findByToken('emailVerificationToken', hashedToken);

    if (!user) {
      // Token not found — could be already consumed or truly invalid
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token. If you already verified, try logging in.',
        action: 'resend',
        resendUrl: '/api/v1/auth/customer/resend-verification'
      });
    }

    // If the user is ALREADY verified (e.g. admin verified them), respond with success
    if (user.isEmailVerified) {
      return res.json({
        success: true,
        message: 'Email already verified! You can log in now.',
        action: 'login',
        loginUrl: '/api/v1/auth/customer/login'
      });
    }

    // Check if the token has expired
    if (user.emailVerificationExpires && new Date(user.emailVerificationExpires) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Verification link has expired. Please request a new one.',
        action: 'resend',
        resendUrl: '/api/v1/auth/customer/resend-verification'
      });
    }

    // Verify the user. Keep the token so re-clicks on the same link show
    // "already verified" instead of "invalid" — it's overwritten on resend.
    await userService.updateUser(user, { isEmailVerified: true, status: 'active' });

    /*
     * A verified address is the whole basis of a company-domain rule, so this
     * is the moment a team with `auto` join at this domain takes them in. It
     * never throws, and the verification stands either way.
     */
    await require('../../../services/team/domainJoinService')
      .applyForUser({ ...user, isEmailVerified: true, status: 'active' });

    // Send welcome email after successful verification (fire-and-forget)
    emailService.sendWelcomeEmail(user).catch((err) => {
      console.error(`[VERIFY] Welcome email failed for ${user.email}:`, err.message);
    });

    await activityLogService.logActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
      action: 'email_verification',
      actionType: 'auth',
      description: `Email verified for: ${user.email}`,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Email verified successfully! You can now log in.',
      action: 'login',
      loginUrl: '/api/v1/auth/customer/login'
    });

  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying email',
      action: 'retry'
    });
  }
});

// @route   POST /api/v1/auth/customer/resend-verification
// @desc    Resend verification email
// @access  Public
router.post('/resend-verification', validate(schemas.resendVerification), async (req, res) => {
  try {
    const { email } = req.body;
    const clientIP = getClientIP(req);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
        action: 'retry'
      });
    }

    const user = await userService.findByEmail(email, { accountType: 'customer' });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email',
        action: 'signup',
        signupUrl: '/api/v1/auth/customer/signup'
      });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email already verified. You can login now.',
        action: 'login',
        loginUrl: '/api/v1/auth/customer/login'
      });
    }

    const rawVerifToken = generateVerificationToken();
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await userService.updateUser(user, {
      emailVerificationToken: hashToken(rawVerifToken), // store hash
      emailVerificationExpires: verificationExpiry,
    });

    const verificationLink = `${process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002'}/verify-email/${rawVerifToken}`;

    // Send verification email — use a timeout so the resend button doesn't hang
    let emailResult;
    try {
      emailResult = await Promise.race([
        emailService.sendVerificationEmail(user, verificationLink),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Email send timed out')), 15_000)),
      ]);
    } catch (emailErr) {
      console.warn(`[RESEND] Email send issue for ${email}: ${emailErr.message}`);
      emailResult = { success: false, error: emailErr.message };
    }

    if (!emailResult?.success) {
      console.warn(`[RESEND] Verification email failed for ${email}: ${emailResult?.error || 'unknown'}`);
    }

    await activityLogService.logActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
      action: 'resend_verification',
      actionType: 'auth',
      description: `Verification email resent to: ${user.email}`,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Verification email sent! Please check your inbox.',
      verificationLink: process.env.NODE_ENV === 'development' ? verificationLink : undefined
    });

  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending verification email',
      action: 'retry'
    });
  }
});

// @route   GET /api/v1/auth/customer/me
// @desc    Get current customer
// @access  Private
router.get('/me', auth, async (req, res) => {
  try {
    const user = await userService.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: customerSessionUser(user)
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user data'
    });
  }
});

// @route   PUT /api/v1/auth/customer/me
// @desc    Update customer profile (name, phone)
// @access  Private
router.put('/me', auth, async (req, res) => {
  try {
    const { name, phone } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Name must be at least 2 characters' });
    }

    const existing = await userService.findById(req.userId);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = await userService.updateUser(existing, {
      name: name.trim(),
      ...(phone !== undefined && { phone: phone.trim() }),
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: customerSessionUser(user),
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Error updating profile' });
  }
});

/**
 * @route   PUT /api/v1/auth/customer/me/language
 * @desc    Set which language this customer reads the product in
 * @access  Private
 *
 * Its own endpoint rather than part of `PUT /me`, because that handler requires
 * `name` and rewrites `phone` — the language switcher holds neither, and
 * changing a language should not be a profile write.
 *
 * Setting a language always marks the preference as chosen, including when the
 * customer picks English. That flag is what stops the first-run prompt from
 * asking again, and "I chose English" has to be distinguishable from "nobody
 * ever asked me".
 */
// @route   PUT /api/v1/auth/customer/me/team-onboarding
// @desc    Finish or skip the post-signup team onboarding ("I'll do it later")
// @access  Private (Customer)
router.put('/me/team-onboarding', auth, async (req, res) => {
  try {
    const existing = await userService.findById(req.userId);
    if (!existing) return res.status(404).json({ success: false, message: 'User not found' });
    const user = existing.teamOnboardingPending
      ? await userService.updateUser(existing, { teamOnboardingPending: false })
      : existing;
    res.json({ success: true, user: customerSessionUser(user) });
  } catch (error) {
    console.error('Team onboarding error:', error);
    res.status(500).json({ success: false, message: 'Could not save that' });
  }
});

router.put('/me/language', auth, validate(schemas.setLanguage), async (req, res) => {
  try {
    const { language } = req.body;

    /*
     * The allowlist is checked here and not in the Zod schema on purpose. Which
     * languages are live is an admin setting, and this file's validation layer
     * deliberately asserts shape only, leaving operator-configurable limits to
     * the handler — the same split as password shape vs. the admin's strength
     * rules. A z.enum here would hardcode a list the operator owns.
     */
    const settings = await languageSettingsService.getLanguageSettings();
    if (!settings.enabled.includes(language)) {
      return res.status(400).json({
        success: false,
        code: 'LANGUAGE_UNAVAILABLE',
        message: 'That language is not available on this platform.',
      });
    }

    const existing = await userService.findById(req.userId);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = await userService.updateUser(existing, {
      language,
      languagePreferenceSet: true,
    });

    res.json({ success: true, user: customerSessionUser(user) });
  } catch (error) {
    console.error('Update language error:', error);
    res.status(500).json({ success: false, message: 'Error saving your language' });
  }
});

// @route   PUT /api/v1/auth/customer/me/password
// @desc    Change customer password
// @access  Private
router.put('/me/password', auth, validate(schemas.changePassword), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
    }
    // Validate password against security settings
    const secSettings = await getSecuritySettings();
    const pwdCheck = await validatePassword(newPassword, secSettings);
    if (!pwdCheck.valid) {
      return res.status(400).json({ success: false, message: pwdCheck.message });
    }

    const user = await userService.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    // userService.updateUser hashes a raw `password` value itself
    await userService.updateUser(user, { password: newPassword });

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: 'Error changing password' });
  }
});

// @route   POST /api/v1/auth/customer/logout
// @desc    Logout customer
// @access  Private
router.post('/logout', auth, async (req, res) => {
  try {
    const clientIP = getClientIP(req);

    const user = await userService.findById(req.userId);

    await activityLogService.logActivity({
      userId: req.userId,
      userName: user?.name || 'Unknown',
      userEmail: user?.email || 'unknown@unknown.com',
      userRole: user?.role || 'customer',
      action: 'logout',
      actionType: 'auth',
      description: 'User logged out',
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging out'
    });
  }
});

// @route   POST /api/v1/auth/customer/forgot-password
// @desc    Send password reset email
// @access  Public
router.post('/forgot-password', validate(schemas.forgotPassword), async (req, res) => {
  try {
    const { email } = req.body;
    const clientIP = getClientIP(req);

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const user = await userService.findByEmail(email, { accountType: 'customer' });

    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    const rawResetToken = generateVerificationToken();
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await userService.updateUser(user, {
      passwordResetToken: hashToken(rawResetToken), // store hash, send raw
      passwordResetExpires: resetExpiry,
      resetPasswordRequestedAt: new Date(),
    });

    const resetLink = `${process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002'}/reset-password/${rawResetToken}`;

    // Send password reset email — use timeout so the request doesn't hang
    emailService.sendPasswordResetEmail(user, resetLink)
      .then(result => {
        if (result?.success) {
          console.log(`[FORGOT-PW] Reset email sent to ${email} (${result.messageId})`);
        } else {
          console.warn(`[FORGOT-PW] Reset email failed for ${email}: ${result?.error || 'unknown'}`);
        }
      })
      .catch(err => {
        console.error(`[FORGOT-PW] Reset email error for ${email}:`, err.message);
      });

    // Notify admins about customer password reset request
    notifyCustomerPasswordReset(user, 'requested').catch(() => {});

    await activityLogService.logActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
      action: 'password_reset',
      actionType: 'auth',
      description: `Password reset requested for: ${user.email}`,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
      resetLink: process.env.NODE_ENV === 'development' ? resetLink : undefined
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Error processing request. Please try again.' });
  }
});

// @route   POST /api/v1/auth/customer/reset-password/:token
// @desc    Reset password using token
// @access  Public
router.post('/reset-password/:token', validate(schemas.resetPassword), async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;
    const clientIP = getClientIP(req);

    if (!password) {
      return res.status(400).json({ success: false, message: 'New password is required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }
    // Validate password against security settings
    const secSettings2 = await getSecuritySettings();
    const pwdCheck2 = await validatePassword(password, secSettings2);
    if (!pwdCheck2.valid) {
      return res.status(400).json({ success: false, message: pwdCheck2.message });
    }

    // Hash the raw token from URL to compare against stored hash
    const hashedToken = hashToken(token);
    const user = await userService.findByToken('passwordResetToken', hashedToken, { requireFuture: true });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset link. Please request a new one.',
        action: 'forgot_password'
      });
    }

    await userService.updateUser(user, {
      password,
      passwordResetToken: null,
      passwordResetExpires: null,
      passwordChangeRequired: false,
    });

    // Notify admins about customer password reset completion
    notifyCustomerPasswordReset(user, 'completed').catch(() => {});

    await activityLogService.logActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
      action: 'password_reset',
      actionType: 'auth',
      description: `Password reset successfully for: ${user.email}`,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Password reset successfully! You can now log in with your new password.',
      action: 'login'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Error resetting password. Please try again.' });
  }
});

module.exports = router;
