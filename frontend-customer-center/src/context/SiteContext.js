import React, { createContext, useContext, useState, useEffect } from 'react';
import { useTeam } from './TeamContext';
import config from '../config';

const defaultSite = {
  googleSSO: { enabled: false, clientId: '' },
  enableCustomerSignup: true,
  enableLogin: true,
  enableModelCatalog: true,
  enableDeployments: true,
  enablePlayground: false,
  // Credit-wallet parameters — set by the admin
  billing: {
    currency: 'USD',
    topUpPresets: [25, 50, 100, 250],
    minTopUp: 10,
    maxTopUp: 5000,
    lowBalanceThreshold: 10,
    // Whether the deploy flow offers the "build your own machine" builder.
    customBuildEnabled: true,
  },
  maintenance: { enabled: false, message: '' },
  payments: { activeGateway: 'stripe', cardGateAvailable: false, stripePublishableKey: '' },
};

const SiteContext = createContext({ siteConfig: defaultSite, loaded: false, authoritative: false });

export const SiteProvider = ({ children }) => {
  const [siteConfig, setSiteConfig] = useState(defaultSite);
  const [loaded, setLoaded] = useState(false);
  /**
   * Did this config actually come from the server?
   *
   * `loaded` only means the request finished — it is set even when the fetch
   * failed and `siteConfig` is still the built-in defaults. Consumers that
   * merely render from the config can treat those two states alike, but
   * anything that takes something AWAY from the customer based on the config
   * must not act on a guess: the defaults list no languages, so a single
   * failed request read as "the admin turned your language off" and dropped
   * Spanish customers back to English mid-session.
   */
  const [authoritative, setAuthoritative] = useState(false);

  useEffect(() => {
    fetch(`${config.apiUrl}/api/v1/public/site`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.site) {
          setSiteConfig({ ...defaultSite, ...data.site });
          setAuthoritative(true);
        }
      })
      .catch(() => {
        // Use defaults silently on network error
      })
      .finally(() => setLoaded(true));
  }, []);

  return (
    <SiteContext.Provider value={{ siteConfig, loaded, authoritative }}>
      {children}
    </SiteContext.Provider>
  );
};

export const useSite = () => useContext(SiteContext);

/** Whether saving a card on file is possible right now — see the backend
 * comment in routes/v1/public/marketing.routes.js for why this can be false
 * (LemonSqueezy as the active gateway, or Stripe not yet configured). */
export const usePayments = () => {
  const { siteConfig } = useSite();
  return siteConfig?.payments || defaultSite.payments;
};

/**
 * Convenience hook for the credit-wallet parameters every billing page needs.
 */
/**
 * Billing parameters for the UI — and whether this viewer may see money at
 * all. In a team, Developer and Viewer see no money (the server strips it
 * too), so for them `creditsEnabled` is false and every wallet / balance /
 * top-up element keyed on it disappears. `canSeeMoney` is the same answer for
 * code that shows money without going through `creditsEnabled`.
 */
export const useBilling = () => {
  const { siteConfig, loaded } = useSite();
  const { canSeeMoney } = useTeam();
  const billing = siteConfig?.billing || defaultSite.billing;

  return {
    ...billing,
    loaded,
    canSeeMoney,
    creditsEnabled: canSeeMoney,
  };
};
