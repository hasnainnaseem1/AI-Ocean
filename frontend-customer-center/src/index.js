import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
// Side-effect import: initialises i18next before any component can call t().
// Must come before App so the first render already has the English bundle.
import './i18n';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
