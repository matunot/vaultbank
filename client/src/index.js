import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // CRITICAL!
import App from './App';
// Suppress alert pop-ups when debug mode is disabled
if (process.env.REACT_APP_DEBUG_MODE !== 'true') {
  // Override window.alert to a no-op function
  window.alert = () => { };
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
