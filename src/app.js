/**
 * MANI BET PRO — app.js
 *
 * Point d'entrée principal.
 * Ordre d'initialisation :
 *   1. Cache (purge si nouvelle version)
 *   2. Store (chargement état persisté)
 *   3. Router (toujours dashboard au démarrage)
 *
 * Aucune logique métier ici.
 */

import { store }          from './state/store.js';
import { router }         from './ui/ui.router.js';
import { ProviderCache }  from './providers/provider.cache.js';
import { Logger }         from './utils/utils.logger.js';
import { APP_CONFIG }     from './config/sports.config.js';

// ── INITIALISATION ────────────────────────────────────────────────────────

async function init() {
  Logger.info('APP_INIT_START', {
    version:   APP_CONFIG.VERSION,
    name:      APP_CONFIG.NAME,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
  });

  // 1. Initialiser le cache (purge si nouvelle version, nettoyage expirés)
  ProviderCache.init();

  // 2. Charger l'état persisté dans le store
  _loadPersistedState();

  // 3. Persister sur changement de route et avant fermeture
  store.subscribe('currentRoute', () => _persistState());
  window.addEventListener('beforeunload', () => _persistState());

  // 4. Écouter les erreurs globales
  window.addEventListener('error', (e) => {
    Logger.error('UNCAUGHT_ERROR', { message: e.message, filename: e.filename, lineno: e.lineno });
  });
  window.addEventListener('unhandledrejection', (e) => {
    Logger.error('UNHANDLED_REJECTION', { reason: e.reason?.message ?? String(e.reason) });
  });

  // 5. Démarrer le router (toujours sur dashboard)
  router.init(store);

  Logger.info('APP_INIT_DONE', { version: APP_CONFIG.VERSION });
}

// ── PERSISTANCE ───────────────────────────────────────────────────────────

function _loadPersistedState() {
  try {
    const raw = localStorage.getItem('mbp_state');
    if (!raw) return;
    store.load(JSON.parse(raw));
  } catch (err) {
    Logger.warn('STORAGE_LOAD_FAIL', { message: err.message });
  }
}

function _persistState() {
  try {
    const state = store.getState();
    localStorage.setItem('mbp_state', JSON.stringify({
      dashboardFilters: state.dashboardFilters,
      ui: { displayMode: state.ui?.displayMode },
      history: state.history,
    }));
  } catch (err) {
    Logger.warn('STORAGE_PERSIST_FAIL', { message: err.message });
  }
}

// ── TOAST ─────────────────────────────────────────────────────────────────

export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast       = document.createElement('div');
  toast.className   = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity    = '0';
    toast.style.transition = 'opacity 300ms ease';
    setTimeout(() => toast.remove(), 320);
  }, duration);
}

// ── LANCEMENT ─────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Exposé sur window pour usage debug
window.MBP = { store, router, showToast, version: APP_CONFIG.VERSION };
