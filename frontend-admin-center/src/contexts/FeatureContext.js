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

        const { data } = await axiosInstance.get('/api/v1/admin/settings');
        if (data.success && data.settings) {
          const f = data.settings.features || {};
          setFeatures((prev) => ({ ...prev, ...f }));
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
