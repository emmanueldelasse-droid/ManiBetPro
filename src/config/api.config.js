/**
 * MANI BET PRO — api.config.js
 *
 * Toutes les clés API transitent par le Cloudflare Worker.
 * Aucune clé n'est stockée côté front.
 * Les endpoints sont des routes exposées par le Worker.
 *
 * Cloudflare Worker base URL :
 * https://manibetpro.emmanueldelasse.workers.dev
 */

export const API_CONFIG = {

  /**
   * Base URL du Cloudflare Worker.
   * Toutes les requêtes API passent par ici.
   */
  WORKER_BASE_URL: 'https://manibetpro.emmanueldelasse.workers.dev',

  /**
   * Routes exposées par le Worker.
   * Le Worker se charge du proxy vers les providers réels
   * et de l'injection des clés API secrètes.
   */
  ROUTES: {

    // ── ANTHROPIC (IA) ──────────────────────────────────────
    AI: {
      MESSAGES: '/ai/messages',
    },

    // ── NBA ──────────────────────────────────────────────────
    NBA: {
      MATCHES_TODAY:  '/nba/matches',         // ?date=YYYY-MM-DD
      TEAM_STATS:     '/nba/team/:id/stats',  // ?type=SEASON|LAST_5|LAST_10|HOME|AWAY
      PLAYER_STATS:   '/nba/player/:id/stats',
      STANDINGS:      '/nba/standings',
      INJURIES:       '/nba/injuries',
    },

    // ── TENNIS ───────────────────────────────────────────────
    TENNIS: {
      MATCHES_TODAY:  '/tennis/matches',      // ?date=YYYY-MM-DD&tour=ATP|WTA
      PLAYER_STATS:   '/tennis/player/:id/stats',
      H2H:            '/tennis/h2h',          // ?p1=:id&p2=:id
      RANKINGS:       '/tennis/rankings',     // ?tour=ATP|WTA
    },

    // ── MLB ───────────────────────────────────────────────────
    MLB: {
      MATCHES_TODAY:  '/mlb/matches',         // ?date=YYYY-MM-DD
      PITCHER_STATS:  '/mlb/pitcher/:id/stats',
      LINEUP:         '/mlb/lineup/:gameId',
      BULLPEN:        '/mlb/bullpen/:teamId', // ?days=7
      PARK_FACTORS:   '/mlb/parks',
    },

    // ── COTES ─────────────────────────────────────────────────
    ODDS: {
      BY_SPORT:       '/odds/:sport',         // ?region=eu&markets=h2h,totals
      BY_EVENT:       '/odds/event/:eventId',
    },

  },

  /**
   * Timeouts par type de requête (ms).
   * À ajuster selon les latences observées.
   */
  TIMEOUTS: {
    DEFAULT:  8000,
    AI:      20000,   // L'IA peut être plus lente
    ODDS:     5000,
  },

  /**
   * Quotas estimatifs par provider.
   * Ces valeurs sont indicatives — vérifier sur les dashboards providers.
   * Marqué "non garanti" — à mettre à jour selon les plans réels.
   */
  QUOTA_ESTIMATES: {
    ANTHROPIC:  { daily: null,  monthly: null,  note: 'non vérifié — voir dashboard Anthropic' },
    ODDS_API:   { daily: null,  monthly: 500,   note: 'tier gratuit estimé — non garanti' },
    NBA:        { daily: null,  monthly: null,  note: 'non vérifié — voir BallDontLie docs' },
    TENNIS:     { daily: null,  monthly: null,  note: 'non vérifié — voir provider actif' },
    MLB:        { daily: null,  monthly: null,  note: 'API officielle MLB — gratuite non limitée officiellement' },
  },

  /**
   * TTL cache par type de donnée (secondes).
   * Utilisé par provider.cache.js
   */
  CACHE_TTL: {
    RANKINGS:       86400,   // 24h
    SEASON_STATS:   21600,   // 6h
    RECENT_FORM:     7200,   // 2h
    ODDS:            1800,   // 30min
    LINEUPS:         1800,   // 30min
    INJURIES:        1800,   // 30min
    WEATHER:         3600,   // 1h
    AI_EXPLANATION:     0,   // permanent (stocké indéfiniment dans localStorage)
  },

  /**
   * Seuils d'alerte quota (fraction du quota total).
   * Ex : 0.8 = alerte à 80% du quota consommé.
   */
  QUOTA_ALERT_THRESHOLD:  0.80,
  QUOTA_CUTOFF_THRESHOLD: 0.90,  // Mode dégradé au-delà

};
