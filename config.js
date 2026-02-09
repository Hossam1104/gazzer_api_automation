/**
 * @file config.js
 * @description Static configuration fallback for Gazzer API Testing Dashboard
 *
 * This file provides static configuration values that can be overridden
 * by environment-specific settings or dynamic configuration.
 */

window.GAZZER_CONFIG = {
  // API endpoints (if needed for future backend integration)
  api: {
    baseUrl: window.location.origin,
    reportsPath: '/reports/'
  },

  // UI settings
  ui: {
    defaultTheme: 'light', // 'light' | 'dark'
    animationSpeed: 'normal', // 'slow' | 'normal' | 'fast'
    toastDuration: 3000 // milliseconds
  },

  // Report settings
  reports: {
    manifestPath: './reports/manifest.json',
    autoRefreshInterval: 0, // 0 = disabled, milliseconds for auto-refresh
    cacheEnabled: true
  },

  // Feature flags
  features: {
    darkModeEnabled: true,
    searchEnabled: true,
    adminPanelEnabled: true
  }
};

console.log('[Config] Static configuration loaded:', window.GAZZER_CONFIG);
