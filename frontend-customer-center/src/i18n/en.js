/**
 * The English catalogue, bundled into the app.
 *
 * English is the only language that lives under `src/` rather than
 * `public/locales/`, and the split is deliberate: English is the fallback every
 * missing key resolves to, so it must be impossible for a network failure to
 * leave the UI with no text at all. Every other language is fetched at runtime
 * (see `src/i18n/index.js`), which is what lets a new one ship as a file drop.
 *
 * So each language lives in exactly one place — there is no copy of English in
 * `public/locales/en/` to drift out of sync.
 *
 * `scripts/checkLocales.js` compares these files against every language under
 * `public/locales/` and fails the build on a missing key.
 */
import common from './locales/en/common.json';
import nav from './locales/en/nav.json';
import notifications from './locales/en/notifications.json';
import auth from './locales/en/auth.json';
import dashboard from './locales/en/dashboard.json';
import billing from './locales/en/billing.json';
import deployments from './locales/en/deployments.json';
import deploy from './locales/en/deploy.json';
import catalog from './locales/en/catalog.json';
import account from './locales/en/account.json';
import support from './locales/en/support.json';
import teams from './locales/en/teams.json';

const en = {
  common,
  nav,
  notifications,
  auth,
  dashboard,
  billing,
  deployments,
  deploy,
  catalog,
  account,
  support,
  teams,
};

export default en;
