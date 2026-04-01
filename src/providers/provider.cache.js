/**
 * MANI BET PRO — provider.cache.js
 *
 * Responsabilité unique : cache localStorage avec TTL et version tag.
 *
 * Version tag : purge automatique si le cache vient d'une version antérieure.
 * Règle absolue : jamais de données vides mises en cache.
 */

import { API_CONFIG } from '../config/api.config.js';
import { Logger }     from '../utils/utils.logger.js';

const CACHE_PREFIX   = 'mbp_cache_';
const QUOTA_PREFIX   = 'mbp_quota_';
const CACHE_VERSION  = 'v5'; // Incrémenter à chaque déploiement majeur
const VERSION_KEY    = 'mbp_cache_version';

export class ProviderCache {

  /**
   * À appeler au démarrage de l'app.
   * Purge le cache si la version a changé.
   * Nettoie les entrées expirées.
   */
  static init() {
    this._purgeIfVersionChanged();
    this._cleanupExpired();
  }

  // ── LECTURE ────────────────────────────────────────────────────────────

  /**
   * Lire une entrée du cache.
   * @param {string} key
   * @returns {*|null} — null si absent, expiré ou vide
   */
  static get(key) {
    try {
      const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
      if (!raw) return null;

      const entry = JSON.parse(raw);

      if (Date.now() > entry.expires_at) {
        localStorage.removeItem(`${CACHE_PREFIX}${key}`);
        return null;
      }

      return entry.data;

    } catch {
      localStorage.removeItem(`${CACHE_PREFIX}${key}`);
      return null;
    }
  }

  // ── ÉCRITURE ───────────────────────────────────────────────────────────

  /**
   * Écrire une entrée dans le cache.
   * Refuse les données null/undefined/vides.
   * @param {string} key
   * @param {*} data
   * @param {string} ttlType — clé de API_CONFIG.CACHE_TTL
   * @returns {boolean}
   */
  static set(key, data, ttlType) {
    // Refus des données vides
    if (data === null || data === undefined) return false;

    try {
      const ttl        = API_CONFIG.CACHE_TTL[ttlType] ?? 3600;
      const expires_at = ttl === 0
        ? Number.MAX_SAFE_INTEGER
        : Date.now() + ttl * 1000;

      localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify({
        data,
        expires_at,
        cached_at:   new Date().toISOString(),
        ttl_type:    ttlType,
        version:     CACHE_VERSION,
      }));

      return true;

    } catch (err) {
      Logger.warn('CACHE_WRITE_ERROR', { key, message: err.message });
      return false;
    }
  }

  // ── INVALIDATION ───────────────────────────────────────────────────────

  /** Invalide une clé spécifique */
  static invalidate(key) {
    localStorage.removeItem(`${CACHE_PREFIX}${key}`);
  }

  /** Invalide toutes les clés d'un préfixe */
  static invalidateByPrefix(prefix) {
    const fullPrefix = `${CACHE_PREFIX}${prefix}`;
    const toRemove   = [];

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(fullPrefix)) toRemove.push(k);
    }

    toRemove.forEach(k => localStorage.removeItem(k));
    Logger.debug('CACHE_INVALIDATED_PREFIX', { prefix, count: toRemove.length });
  }

  /** Invalide toutes les entrées du cache (garde les quotas) */
  static invalidateAll() {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    Logger.info('CACHE_INVALIDATED_ALL', { count: toRemove.length });
  }

  // ── UTILITAIRES ────────────────────────────────────────────────────────

  /** Vérifie si une clé est en cache valide */
  static has(key) {
    return this.get(key) !== null;
  }

  /**
   * Génère une clé de cache normalisée et stable.
   * @param {string} provider
   * @param {string} resource
   * @param {object} [params]
   * @returns {string}
   */
  static buildKey(provider, resource, params = {}) {
    const paramStr = Object.entries(params)
      .filter(([, v]) => v !== null && v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    return `${provider}_${resource}${paramStr ? `_${paramStr}` : ''}`;
  }

  // ── QUOTAS ────────────────────────────────────────────────────────────

  static getQuota(provider) {
    try {
      const raw = localStorage.getItem(`${QUOTA_PREFIX}${provider}`);
      if (!raw) return { used: 0, limit: null, reset_at: null, degraded: false };
      return JSON.parse(raw);
    } catch {
      return { used: 0, limit: null, reset_at: null, degraded: false };
    }
  }

  static incrementQuota(provider) {
    const quota = this.getQuota(provider);
    quota.used += 1;
    localStorage.setItem(`${QUOTA_PREFIX}${provider}`, JSON.stringify(quota));

    if (quota.limit === null) return { allowed: true, degraded: false };

    const ratio = quota.used / quota.limit;

    if (ratio >= API_CONFIG.QUOTA_CUTOFF_THRESHOLD) {
      quota.degraded = true;
      localStorage.setItem(`${QUOTA_PREFIX}${provider}`, JSON.stringify(quota));
      Logger.warn('QUOTA_DEGRADED_MODE', { provider, ratio: Math.round(ratio * 100) });
      return { allowed: false, degraded: true };
    }

    if (ratio >= API_CONFIG.QUOTA_ALERT_THRESHOLD) {
      Logger.warn('QUOTA_ALERT', { provider, used: quota.used, limit: quota.limit });
    }

    return { allowed: true, degraded: false };
  }

  static resetQuota(provider) {
    const quota = this.getQuota(provider);
    quota.used     = 0;
    quota.degraded = false;
    localStorage.setItem(`${QUOTA_PREFIX}${provider}`, JSON.stringify(quota));
  }

  // ── PRIVÉ ─────────────────────────────────────────────────────────────

  /** Purge le cache si la version a changé depuis le dernier déploiement */
  static _purgeIfVersionChanged() {
    const stored = localStorage.getItem(VERSION_KEY);
    if (stored !== CACHE_VERSION) {
      this.invalidateAll();
      localStorage.setItem(VERSION_KEY, CACHE_VERSION);
      Logger.info('CACHE_VERSION_PURGE', { from: stored, to: CACHE_VERSION });
    }
  }

  /** Supprime les entrées expirées */
  static _cleanupExpired() {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(CACHE_PREFIX)) continue;
      try {
        const entry = JSON.parse(localStorage.getItem(k));
        if (Date.now() > entry.expires_at) toRemove.push(k);
      } catch {
        toRemove.push(k);
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    if (toRemove.length > 0) {
      Logger.debug('CACHE_CLEANUP', { cleaned: toRemove.length });
    }
  }
}
