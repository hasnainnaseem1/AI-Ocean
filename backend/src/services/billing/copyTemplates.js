/**
 * Billing Copy Templates
 *
 * Substitutes `{placeholder}` tokens in the admin-editable customer-facing
 * messages under AdminSettings.billingSettings.copy — the exact same rule
 * the recommendation engine's own reason templates already follow (see
 * services/recommendation/policyDefaults.js's `render`): an unrecognised
 * placeholder is left visible as `{typo}` rather than silently blanked,
 * because a visible placeholder is a bug report and a blanked one produces a
 * sentence that reads fine and says something false.
 *
 * Kept as its own small file rather than importing the recommendation
 * engine's copy — billing has no other reason to depend on that module, and
 * this is six lines of generic string substitution, not policy logic.
 */
const render = (template, context = {}) => String(template || '').replace(
  /\{(\w+)\}/g,
  (match, key) => (
    context[key] === undefined || context[key] === null ? match : String(context[key])
  )
);

/**
 * Read one billing copy template from settings and substitute its context.
 *
 * `settings` is the object `billingModeService.getBillingSettings()`
 * returns; `fallback` is used only if the admin has never saved a value for
 * this key (should not normally happen, since the schema default fills it,
 * but a call site should never crash over it).
 */
const billingCopy = (settings, key, context = {}, fallback = '') => {
  const template = settings?.copy?.[key] ?? fallback;
  return render(template, context);
};

module.exports = { render, billingCopy };
