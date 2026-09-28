/**
 * Ticket vocabulary, shared by the list and the reply screen.
 *
 * Holds translation *keys*, not labels. These are module-level constants, so
 * there is no `t` in scope here, and a label resolved at import time would
 * keep whatever language the app first loaded in. Call sites translate:
 * `t(TICKET_STATUS_META[s].labelKey)`.
 *
 * `tone` stays as data — it is a visual fact about the status, not text.
 */
export const TICKET_STATUS_META = {
  open: { tone: 'info', labelKey: 'support:status.open' },
  pending: { tone: 'warning', labelKey: 'support:status.pending' },
  solved: { tone: 'success', labelKey: 'support:status.solved' },
};

export const CATEGORY_OPTIONS = [
  { value: 'general', labelKey: 'support:category.general' },
  { value: 'billing', labelKey: 'support:category.billing' },
  { value: 'technical', labelKey: 'support:category.technical' },
  { value: 'deployment', labelKey: 'support:category.deployment' },
];

export const CATEGORY_LABEL_KEYS = CATEGORY_OPTIONS.reduce(
  (acc, { value, labelKey }) => ({ ...acc, [value]: labelKey }),
  {}
);
