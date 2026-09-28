// Centralized configuration for the Marketing site (port 3000)
const config = {
    // Backend API — used for fetching site/branding/SEO/pages data
    apiUrl: process.env.REACT_APP_API_URL || 'http://localhost:3001',

    // Customer Center — where login, signup and dashboard live (port 3002)
    customerCenterUrl: process.env.REACT_APP_CUSTOMER_CENTER_URL || 'http://localhost:3002',
};

export default config;