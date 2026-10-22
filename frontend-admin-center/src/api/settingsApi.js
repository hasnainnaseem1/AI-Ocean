import axiosInstance from './axiosInstance';

const settingsApi = {
  /**
   * GET /api/v1/admin/settings
   */
  getSettings: () =>
    axiosInstance.get('/api/v1/admin/settings').then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/general
   */
  updateGeneral: (data) =>
    axiosInstance.put('/api/v1/admin/settings/general', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/email
   */
  updateEmail: (data) =>
    axiosInstance.put('/api/v1/admin/settings/email', data).then((r) => r.data),

  /**
   * POST /api/v1/admin/settings/email/test
   * Send a test email to verify SMTP configuration
   */
  testEmail: (recipientEmail) =>
    axiosInstance.post('/api/v1/admin/settings/email/test', { recipientEmail }).then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/customer
   */
  updateCustomer: (data) =>
    axiosInstance.put('/api/v1/admin/settings/customer', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/security
   */
  updateSecurity: (data) =>
    axiosInstance.put('/api/v1/admin/settings/security', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/notification
   */
  updateNotification: (data) =>
    axiosInstance.put('/api/v1/admin/settings/notification', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/maintenance
   */
  updateMaintenance: (data) =>
    axiosInstance.put('/api/v1/admin/settings/maintenance', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/features
   */
  updateFeatures: (data) =>
    axiosInstance.put('/api/v1/admin/settings/features', data).then((r) => r.data),

  /**
   * GET /api/v1/admin/settings/billing
   */
  getBilling: () =>
    axiosInstance.get('/api/v1/admin/settings/billing').then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/billing
   * Sets the credit-wallet parameters (top-up amounts, card gate, storage debt policy, etc).
   */
  updateBilling: (data) =>
    axiosInstance.put('/api/v1/admin/settings/billing', data).then((r) => r.data),

  /**
   * GET /api/v1/admin/settings/theme
   */
  getTheme: () =>
    axiosInstance.get('/api/v1/admin/settings/theme').then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/theme
   */
  updateTheme: (data) =>
    axiosInstance.put('/api/v1/admin/settings/theme', data).then((r) => r.data),

  /**
   * GET /api/v1/admin/settings/email-blocking/domains
   * Get list of blocked temporary email domains
   */
  getBlockedDomains: () =>
    axiosInstance.get('/api/v1/admin/settings/email-blocking/domains').then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/email-blocking/domains
   * Update the entire list of blocked temporary email domains
   */
  updateBlockedDomains: (domains) =>
    axiosInstance.put('/api/v1/admin/settings/email-blocking/domains', { domains }).then((r) => r.data),

  /**
   * POST /api/v1/admin/settings/email-blocking/domains/:domain
   * Add a single domain to the blocked list
   */
  addBlockedDomain: (domain) =>
    axiosInstance.post(`/api/v1/admin/settings/email-blocking/domains/${domain}`).then((r) => r.data),

  /**
   * DELETE /api/v1/admin/settings/email-blocking/domains/:domain
   * Remove a domain from the blocked list
   */
  removeBlockedDomain: (domain) =>
    axiosInstance.delete(`/api/v1/admin/settings/email-blocking/domains/${domain}`).then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/google-sso
   * Update Google SSO configuration (super_admin only)
   */
  updateGoogleSSO: (data) =>
    axiosInstance.put('/api/v1/admin/settings/google-sso', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/stripe
   * Update Stripe integration settings (super_admin only)
   */
  updateStripe: (data) =>
    axiosInstance.put('/api/v1/admin/settings/stripe', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/lemonsqueezy
   * Update LemonSqueezy integration settings (super_admin only)
   */
  updateLemonSqueezy: (data) =>
    axiosInstance.put('/api/v1/admin/settings/lemonsqueezy', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/polar
   * Update Polar integration settings (super_admin only)
   */
  updatePolar: (data) =>
    axiosInstance.put('/api/v1/admin/settings/polar', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/aws
   * Update AWS provisioning settings (super_admin only).
   *
   * The secret access key is write-only: the server never sends it back, so
   * omit the field entirely to keep whatever is stored.
   */
  updateAws: (data) =>
    axiosInstance.put('/api/v1/admin/settings/aws', data).then((r) => r.data),

  /**
   * POST /api/v1/admin/settings/aws/test
   * Verify the stored credentials reach AWS. Creates nothing.
   */
  testAws: () =>
    axiosInstance.post('/api/v1/admin/settings/aws/test').then((r) => r.data),

  /**
   * GET /api/v1/admin/settings/cloud-regions
   *
   * Where a tier may be sold, and where a machine can actually be built.
   * `common` is the regions every cloud can serve — the only safe set to offer
   * in the catalogue, because a model can be moved between clouds at any time.
   * `ready` is the subset whose infrastructure exists and whose cloud is on.
   */
  getCloudRegions: () =>
    axiosInstance.get('/api/v1/admin/settings/cloud-regions').then((r) => r.data),

  /**
   * GET /api/v1/admin/settings/region-costs
   *
   * What each region costs to keep open before a customer machine runs in it —
   * chiefly NAT, which AWS bills per availability zone whether anything uses
   * it or not. Comes back with the recovery and the spread ladder.
   */
  getRegionCosts: () =>
    axiosInstance.get('/api/v1/admin/settings/region-costs').then((r) => r.data),

  /** PUT — set the assumed machine count, or record a cost by hand. */
  updateRegionCost: (data) =>
    axiosInstance.put('/api/v1/admin/settings/region-costs', data).then((r) => r.data),

  /**
   * GET /api/v1/admin/settings/alerts
   *
   * Every system alert, who currently hears about it, and which groups it
   * could be pointed at instead. The audiences come from the database, so a
   * role created this morning is selectable this morning.
   */
  getAlerts: () =>
    axiosInstance.get('/api/v1/admin/settings/alerts').then((r) => r.data),

  /** POST — ask both clouds now instead of waiting for the hourly job. */
  refreshRegionCosts: () =>
    axiosInstance.post('/api/v1/admin/settings/region-costs/refresh').then((r) => r.data),

  /**
   * GET /api/v1/admin/settings/region-builds
   *
   * Which regions have a network and which do not — and which ones have
   * customer orders waiting on them right now.
   *
   * Deliberately separate from `getRegionCosts`. A region is costed before it
   * is built, so that its standing cost is inside every price from the start;
   * "what does it cost" and "can a machine start there" are two facts that
   * come apart, and an admin needs both.
   */
  getRegionBuilds: () =>
    axiosInstance.get('/api/v1/admin/settings/region-builds').then((r) => r.data),

  /**
   * POST — ask for a region's network to be built.
   *
   * Records the request and returns the commands to run. It does NOT run them:
   * the platform's own AWS key can start and stop machines and nothing else,
   * which is what keeps one customer's machine from ever reaching another's.
   */
  buildRegion: (region) =>
    axiosInstance.post(`/api/v1/admin/settings/region-builds/${region}/build`).then((r) => r.data),

  /** POST — record that an apply did not finish, so it can be tried again. */
  failRegionBuild: (region, error) =>
    axiosInstance
      .post(`/api/v1/admin/settings/region-builds/${region}/failed`, { error })
      .then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/cloud-routing
   * Which cloud wins when more than one is on and a model is unassigned.
   */
  updateCloudRouting: (data) =>
    axiosInstance.put('/api/v1/admin/settings/cloud-routing', data).then((r) => r.data),
  /**
   * PUT /api/v1/admin/settings/cloud-pricing
   * Overhead, tax and the margin the platform needs — the four numbers that
   * set the price floor under every tier.
   */
  updateCloudPricing: (data) =>
    axiosInstance.put('/api/v1/admin/settings/cloud-pricing', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/gcp
   * Update Google Cloud provisioning settings (super_admin only).
   *
   * The service-account key is write-only: the server never sends it back, so
   * omit the field entirely to keep whatever is stored. Sending an empty string
   * does the same thing, but omitting it says so.
   */
  updateGcp: (data) =>
    axiosInstance.put('/api/v1/admin/settings/gcp', data).then((r) => r.data),

  /**
   * POST /api/v1/admin/settings/gcp/test
   * Verify the stored credentials can reach the project. Creates nothing.
   */
  testGcp: () =>
    axiosInstance.post('/api/v1/admin/settings/gcp/test').then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/payment-gateway
   * Set the active payment gateway (super_admin only)
   */
  updatePaymentGateway: (data) =>
    axiosInstance.put('/api/v1/admin/settings/payment-gateway', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/integrations/:type/toggle
   * Enable or disable an integration card (stripe/lemonsqueezy/polar/email/google-sso, super_admin only)
   */
  toggleIntegration: (type, enabled) =>
    axiosInstance.put(`/api/v1/admin/settings/integrations/${type}/toggle`, { enabled }).then((r) => r.data),

  // ── Cron Jobs ──

  /**
   * GET /api/v1/admin/cron
   * Get all cron job statuses
   */
  getCronJobs: () =>
    axiosInstance.get('/api/v1/admin/cron').then((r) => r.data),

  /**
   * POST /api/v1/admin/cron
   * Create a new custom cron job
   */
  createCronJob: (data) =>
    axiosInstance.post('/api/v1/admin/cron', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/cron/:key
   * Update a custom cron job
   */
  updateCronJob: (key, data) =>
    axiosInstance.put(`/api/v1/admin/cron/${key}`, data).then((r) => r.data),

  /**
   * DELETE /api/v1/admin/cron/:key
   * Delete a custom cron job
   */
  deleteCronJob: (key) =>
    axiosInstance.delete(`/api/v1/admin/cron/${key}`).then((r) => r.data),

  /**
   * PUT /api/v1/admin/cron/:key/toggle
   * Toggle a cron job on/off
   */
  toggleCronJob: (key) =>
    axiosInstance.put(`/api/v1/admin/cron/${key}/toggle`).then((r) => r.data),

  /**
   * POST /api/v1/admin/cron/:key/trigger
   * Manually trigger a cron job
   */
  triggerCronJob: (key) =>
    axiosInstance.post(`/api/v1/admin/cron/${key}/trigger`).then((r) => r.data),

  // ── Email Templates ──

  /**
   * All four email-template calls take the language being edited. It defaults
   * to English on the server, so omitting it behaves exactly as before.
   */

  /**
   * GET /api/v1/admin/settings/email-templates
   * Get all email templates (custom + defaults) for one language
   */
  getEmailTemplates: (lang = 'en') =>
    axiosInstance.get('/api/v1/admin/settings/email-templates', { params: { lang } }).then((r) => r.data),

  /**
   * PUT /api/v1/admin/settings/email-templates/:key
   * Update a single email template in one language
   */
  updateEmailTemplate: (key, data, lang = 'en') =>
    axiosInstance.put(`/api/v1/admin/settings/email-templates/${key}`, data, { params: { lang } }).then((r) => r.data),

  /**
   * DELETE /api/v1/admin/settings/email-templates/:key
   * Reset a template to default in one language (other languages untouched)
   */
  resetEmailTemplate: (key, lang = 'en') =>
    axiosInstance.delete(`/api/v1/admin/settings/email-templates/${key}`, { params: { lang } }).then((r) => r.data),

  /**
   * POST /api/v1/admin/settings/email-templates/:key/preview
   * Preview a rendered email template in one language
   */
  previewEmailTemplate: (key, data, lang = 'en') =>
    axiosInstance.post(`/api/v1/admin/settings/email-templates/${key}/preview`, data, { params: { lang } }).then((r) => r.data),
};

export default settingsApi;
