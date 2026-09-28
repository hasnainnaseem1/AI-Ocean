// Centralized configuration for User App
const config = {
    // Backend API URL
    apiUrl: process.env.REACT_APP_API_URL || 'http://localhost:3001',

    // Marketing website URL (for logout redirect, etc.)
    marketingUrl: process.env.REACT_APP_MARKETING_URL || 'http://localhost:3000',

    // NOTE: Google OAuth Client ID is no longer read from .env here.
    // It is fetched dynamically from the backend (/api/v1/public/site)
    // and configured via the Admin Center settings page.
};

export default config;