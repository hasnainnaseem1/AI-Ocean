import React, { createContext, useContext, useState, useEffect } from 'react';
import axiosInstance from '../api/axiosInstance';

const DEFAULT_FEATURES = {
  enableCustomerSignup: true,
  enableLogin: true,
  enableModelCatalog: true,
  enableDeployments: true,
  enablePlayground: false,
  enableCustomRoles: true,
  enableActivityLogs: true,
};

const FeatureContext = createContext({
  features: DEFAULT_FEATURES,
  loaded: false,
});

export const FeatureProvider = ({ children }) => {
  const [features, setFeatures] = useState(DEFAULT_FEATURES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const fetchFeatures = async () => {
      try {
        const token = localStorage.getItem('admin_token');
        if (!token) { setLoaded(true); return; }

        /*
         * The narrow endpoint, not the whole settings document.
         *
         * This used to fetch `/admin/settings`, which needs `settings.view` —
         * so a moderator or viewer, who has no business reading the platform's
         * configuration, got a 403 toast on every single page. All this
         * provider ever wanted was the feature flags, and those are readable
         * by any admin because the navigation already reveals them.
         */
        const { data } = await axiosInstance.get('/api/v1/admin/settings/features');
        if (data.success) {
          setFeatures((prev) => ({ ...prev, ...(data.features || {}) }));
        }
      } catch {
        // Use defaults silently on error — axiosInstance's own interceptor
        // already handles a 401 (redirect to login) or 403 (toast) globally.
      } finally {
        setLoaded(true);
      }
    };
    fetchFeatures();
  }, []);

  return (
    <FeatureContext.Provider value={{ features, loaded }}>
      {children}
    </FeatureContext.Provider>
  );
};

export const useFeatures = () => useContext(FeatureContext);
