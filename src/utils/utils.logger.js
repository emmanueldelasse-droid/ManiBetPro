/**
 * MANI BET PRO — utils.logger.js v2
 *
 * Logger centralisé.
 * Niveaux : DEBUG | INFO | WARN | ERROR
 *
 * CORRECTIONS v2 :
 *   - _log() : entry construit et persisté pour WARN + ERROR
 *     (en v1, entry était construit mais jamais utilisé — code mort)
 *   - engineResult() : paramètre renommé decision (était confidenceLevel),
 *     les valeurs WARN correspondent à 'INSUFFISANT' et 'REJETÉ'
 *     (en v1, comparait à 'INCONCLUSIVE' — valeur du modèle v1 abandonné)
 *   - aiCall() : persiste dans store.push('aiLogs') pour l'UI Audit
 *     (en v1, uniquement logué en console)
 *   - MIN_LEVEL protégé contre les valeurs inconnues
 *   - Alias renommés : logError/logWarn/logInfo pour éviter collision
 *     avec le built-in Error dans les modules importateurs
 */

import { store } from '../state/store.js';

const LOG_LEVELS = {
  DEBUG: 0,
  INFO:  1,
  WARN:  2,
  ERROR: 3,
};

const MIN_LEVEL_KEY = window.location.hostname === 'localhost' ? 'DEBUG' : 'INFO';

// CORRECTION : protégé contre les valeurs inconnues
const MIN_LEVEL_NUM = LOG_LEVELS[MIN_LEVEL_KEY] ?? LOG_LEVELS['INFO'];

const STYLES = {
  DEBUG: 'color: #6b7280; font-size: 11px;',
  INFO:  'color: #3b82f6;',
  WARN:  'color: #f59e0b; font-weight: bold;',
  ERROR: 'color: #ef4444; font-weight: bold;',
};

export class Logger {

  static info(event, data = {}) {
    this._log('INFO', event, data);
  }

  static debug(event, data = {}) {
    this._log('DEBUG', event, data);
  }

  static warn(event, data = {}) {
    this._log('WARN', event, data);
  }

  static error(event, errorOrData = {}) {
    const data = errorOrData instanceof Error
      ? { message: errorOrData.message, stack: errorOrData.stack }
      : errorOrData;
    this._log('ERROR', event, data);
  }

  /**
   * Log spécifique aux appels API.
   * Persiste dans store.push('apiLogs') — visible dans l'UI Audit.
   */
  static apiCall({ provider, endpoint, statusCode, cached, ttlRemaining = null, durationMs = null, error = null }) {
    const logEntry = {
      log_id:        crypto.randomUUID(),
      provider,
      endpoint,
      requested_at:  new Date().toISOString(),
      status_code:   statusCode,
      cached,
      ttl_remaining: ttlRemaining,
      duration_ms:   durationMs,   // CORRECTION : champ ajouté (manquait en v1)
      error,
    };

    // Persiste dans le store (limité à 100 entrées)
    store.push('apiLogs', logEntry, 100);

    const level = error ? 'WARN' : (cached ? 'DEBUG' : 'INFO');
    this._log(level, 'API_CALL', {
      provider,
      endpoint,
      status:  statusCode,
      cached,
      error:   error ?? undefined,
    });
  }

  /**
   * Log d'une analyse calculée par le moteur.
   *
   * CORRECTION :
   *   - Paramètre renommé 'decision' (était 'confidenceLevel' — modèle v1)
   *   - Valeurs WARN : 'INSUFFISANT' et 'REJETÉ' (étaient 'INCONCLUSIVE')
   *   - API maintenue compatible : accepte aussi l'ancien 'confidenceLevel'
   *     pour les appelants non encore migrés
   */
  static engineResult({ sport, analysisId, decision, confidenceLevel, rejectionReason }) {
    // Compatibilité : accepter l'ancien paramètre confidenceLevel
    const dec = decision ?? confidenceLevel;
    const WARN_DECISIONS = ['INSUFFISANT', 'REJETÉ', 'INCONCLUSIVE'];
    const level = WARN_DECISIONS.includes(dec) ? 'WARN' : 'INFO';

    this._log(level, 'ENGINE_RESULT', {
      sport,
      analysis_id:      analysisId,
      decision:         dec,
      rejection_reason: rejectionReason ?? null,
    });
  }

  /**
   * Log d'un appel IA.
   *
   * CORRECTION : persiste dans store.push('aiLogs') pour l'UI Audit.
   * En v1, uniquement logué en console — inaccessible dans l'interface.
   */
  static aiCall({ analysisId, task, tokensUsed, flags = [] }) {
    const logEntry = {
      log_id:       crypto.randomUUID(),
      analysis_id:  analysisId,
      task,
      tokens_used:  tokensUsed,
      flags,
      has_flags:    flags.length > 0,
      logged_at:    new Date().toISOString(),
    };

    // Limité à 50 entrées — les appels IA sont rares et coûteux
    store.push('aiLogs', logEntry, 50);

    this._log('INFO', 'AI_CALL', {
      analysis_id:  analysisId,
      task,
      tokens_used:  tokensUsed,
      flags_count:  flags.length,
      has_flags:    flags.length > 0,
    });
  }

  // ── PRIVÉ ──────────────────────────────────────────────────────────────

  static _log(level, event, data = {}) {
    if ((LOG_LEVELS[level] ?? 0) < MIN_LEVEL_NUM) return;

    // CORRECTION : entry construit et utilisé (en v1 : construit mais ignoré)
    const entry = {
      log_id:    crypto.randomUUID(),
      level,
      event,
      data,
      timestamp: new Date().toISOString(),
    };

    const prefix = `[MBP/${level}] ${event}`;

    if (level === 'ERROR') {
      console.error(`%c${prefix}`, STYLES[level], data);
      // Persiste les erreurs dans le store
      store.addError({ message: `${event}: ${data.message ?? JSON.stringify(data)}` });
    } else if (level === 'WARN') {
      console.warn(`%c${prefix}`, STYLES[level], data);
      // Persiste aussi les WARN dans appLogs pour l'UI Audit
      store.push('appLogs', entry, 200);
    } else {
      console.log(`%c${prefix}`, STYLES[level], data);
    }
  }
}

// ── ALIASES ───────────────────────────────────────────────────────────────
// CORRECTION : renommés pour éviter la collision avec le built-in Error
// dans les modules qui font `import { logError } from '...'`
export const logInfo  = (event, data) => Logger.info(event, data);
export const logWarn  = (event, data) => Logger.warn(event, data);
export const logError = (event, data) => Logger.error(event, data);

// Alias courts maintenus pour compatibilité (sans collision avec Error)
export const log  = logInfo;
export const warn = logWarn;
