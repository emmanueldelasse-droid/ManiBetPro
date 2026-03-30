/**
 * MANI BET PRO — provider.nba.js
 *
 * Provider NBA avec deux sources et fallback automatique.
 *
 * Source A : BallDontLie API (v1) — gratuite, non officielle
 *   Doc : https://www.balldontlie.io/
 *   Toutes les requêtes transitent par le Cloudflare Worker.
 *
 * Source B : NBA Stats (stats.nba.com) — non officielle, instable
 *   Headers spécifiques requis — gérés côté Worker.
 *
 * Aucune clé API côté front.
 * Aucune donnée fictive retournée.
 * Si une donnée est indisponible, le champ est null avec flag source.
 */

import { API_CONFIG } from '../config/api.config.js';
import { ProviderCache } from './provider.cache.js';
import { Logger } from '../utils/utils.logger.js';

const WORKER = API_CONFIG.WORKER_BASE_URL;
const TIMEOUT = API_CONFIG.TIMEOUTS.DEFAULT;

// Identifiants providers pour logs et quotas
const PROVIDER_A = 'BALLDONTLIE';
const PROVIDER_B = 'NBA_STATS';

export class ProviderNBA {

  // ── MATCHS DU JOUR ────────────────────────────────────────────────────

  /**
   * Récupère les matchs NBA d'une date donnée.
   * @param {string} date — format YYYY-MM-DD
   * @returns {Promise<NBAMatchList|null>}
   */
  static async getMatchesToday(date) {
    const cacheKey = ProviderCache.buildKey('nba', 'matches', { date });
    const cached = ProviderCache.get(cacheKey);
    if (cached) {
      Logger.apiCall({ provider: PROVIDER_A, endpoint: '/nba/matches', statusCode: 200, cached: true });
      return cached;
    }

    // Tentative source A
    let result = await this._fetchMatchesSourceA(date);

    // Fallback source B si A échoue
    if (!result) {
      Logger.warn('NBA_FALLBACK_SOURCE_B', { date, reason: 'Source A failed' });
      result = await this._fetchMatchesSourceB(date);
    }

    if (result) {
      ProviderCache.set(cacheKey, result, 'RECENT_FORM');
    }

    return result;
  }

  // ── STATS ÉQUIPE ──────────────────────────────────────────────────────

  /**
   * Récupère les stats d'une équipe.
   * @param {string} teamId
   * @param {'SEASON'|'LAST_5'|'LAST_10'|'HOME'|'AWAY'} statType
   * @param {string} season — ex: '2024-25'
   * @returns {Promise<NBATeamStats|null>}
   */
  static async getTeamStats(teamId, statType, season) {
    const cacheKey = ProviderCache.buildKey('nba', 'team_stats', { teamId, statType, season });
    const cached = ProviderCache.get(cacheKey);
    if (cached) {
      Logger.apiCall({ provider: PROVIDER_A, endpoint: `/nba/team/${teamId}/stats`, statusCode: 200, cached: true });
      return cached;
    }

    const ttlType = statType === 'SEASON' ? 'SEASON_STATS' : 'RECENT_FORM';

    let result = await this._fetchTeamStatsSourceA(teamId, statType, season);
    if (!result) {
      result = await this._fetchTeamStatsSourceB(teamId, statType, season);
    }

    if (result) {
      ProviderCache.set(cacheKey, result, ttlType);
    }

    return result;
  }

  // ── BLESSURES / ABSENCES ──────────────────────────────────────────────

  /**
   * Récupère les blessures et absences connues.
   * @param {string} teamId
   * @returns {Promise<NBAInjuries|null>}
   */
  static async getInjuries(teamId) {
    const cacheKey = ProviderCache.buildKey('nba', 'injuries', { teamId });
    const cached = ProviderCache.get(cacheKey);
    if (cached) return cached;

    let result = await this._fetchInjuriesSourceA(teamId);
    if (!result) {
      result = await this._fetchInjuriesSourceB(teamId);
    }

    if (result) {
      ProviderCache.set(cacheKey, result, 'INJURIES');
    }

    return result;
  }

  // ── SOURCE A : BALLDONTLIE ────────────────────────────────────────────

  static async _fetchMatchesSourceA(date) {
    try {
      const quota = ProviderCache.incrementQuota(PROVIDER_A);
      if (!quota.allowed) {
        Logger.warn('NBA_QUOTA_EXCEEDED', { provider: PROVIDER_A });
        return null;
      }

      const url = `${WORKER}${API_CONFIG.ROUTES.NBA.MATCHES_TODAY}?date=${date}&source=balldontlie`;
      const data = await this._fetch(url, PROVIDER_A, '/nba/matches');

      if (!data) return null;

      return this._normalizeMatchesSourceA(data, date);

    } catch (err) {
      Logger.error('NBA_SOURCE_A_MATCHES_ERROR', { message: err.message, date });
      return null;
    }
  }

  static async _fetchTeamStatsSourceA(teamId, statType, season) {
    try {
      const quota = ProviderCache.incrementQuota(PROVIDER_A);
      if (!quota.allowed) return null;

      const endpoint = API_CONFIG.ROUTES.NBA.TEAM_STATS
        .replace(':id', teamId);
      const url = `${WORKER}${endpoint}?type=${statType}&season=${season}&source=balldontlie`;
      const data = await this._fetch(url, PROVIDER_A, endpoint);

      if (!data) return null;
      return this._normalizeTeamStatsSourceA(data, teamId, statType);

    } catch (err) {
      Logger.error('NBA_SOURCE_A_STATS_ERROR', { message: err.message, teamId });
      return null;
    }
  }

  static async _fetchInjuriesSourceA(teamId) {
    try {
      const quota = ProviderCache.incrementQuota(PROVIDER_A);
      if (!quota.allowed) return null;

      const url = `${WORKER}${API_CONFIG.ROUTES.NBA.INJURIES}?teamId=${teamId}&source=balldontlie`;
      const data = await this._fetch(url, PROVIDER_A, '/nba/injuries');

      if (!data) return null;
      return this._normalizeInjuriesSourceA(data, teamId);

    } catch (err) {
      Logger.error('NBA_SOURCE_A_INJURIES_ERROR', { message: err.message, teamId });
      return null;
    }
  }

  // ── SOURCE B : NBA STATS ──────────────────────────────────────────────

  static async _fetchMatchesSourceB(date) {
    try {
      const quota = ProviderCache.incrementQuota(PROVIDER_B);
      if (!quota.allowed) return null;

      const url = `${WORKER}${API_CONFIG.ROUTES.NBA.MATCHES_TODAY}?date=${date}&source=nbastats`;
      const data = await this._fetch(url, PROVIDER_B, '/nba/matches');

      if (!data) return null;
      return this._normalizeMatchesSourceB(data, date);

    } catch (err) {
      Logger.error('NBA_SOURCE_B_MATCHES_ERROR', { message: err.message, date });
      return null;
    }
  }

  static async _fetchTeamStatsSourceB(teamId, statType, season) {
    try {
      const quota = ProviderCache.incrementQuota(PROVIDER_B);
      if (!quota.allowed) return null;

      const endpoint = API_CONFIG.ROUTES.NBA.TEAM_STATS.replace(':id', teamId);
      const url = `${WORKER}${endpoint}?type=${statType}&season=${season}&source=nbastats`;
      const data = await this._fetch(url, PROVIDER_B, endpoint);

      if (!data) return null;
      return this._normalizeTeamStatsSourceB(data, teamId, statType);

    } catch (err) {
      Logger.error('NBA_SOURCE_B_STATS_ERROR', { message: err.message, teamId });
      return null;
    }
  }

  static async _fetchInjuriesSourceB(teamId) {
    try {
      const quota = ProviderCache.incrementQuota(PROVIDER_B);
      if (!quota.allowed) return null;

      const url = `${WORKER}${API_CONFIG.ROUTES.NBA.INJURIES}?teamId=${teamId}&source=nbastats`;
      const data = await this._fetch(url, PROVIDER_B, '/nba/injuries');

      if (!data) return null;
      return this._normalizeInjuriesSourceB(data, teamId);

    } catch (err) {
      Logger.error('NBA_SOURCE_B_INJURIES_ERROR', { message: err.message, teamId });
      return null;
    }
  }

  // ── NORMALISATEURS ────────────────────────────────────────────────────
  //
  // Chaque source retourne un format différent.
  // Les normalisateurs produisent un format unifié.
  // Si un champ est absent dans la source → null explicite.
  // Jamais de valeur inventée.

  /**
   * Format unifié d'un match NBA.
   * @typedef {object} NBAMatch
   * @property {string} id
   * @property {string} date
   * @property {string} status
   * @property {object} home_team
   * @property {object} away_team
   * @property {string} source
   * @property {string} fetched_at
   */

  static _normalizeMatchesSourceA(data, date) {
    if (!data?.data || !Array.isArray(data.data)) return null;

    return {
      date,
      source: PROVIDER_A,
      fetched_at: new Date().toISOString(),
      matches: data.data.map(game => ({
        id:            String(game.id ?? ''),
        date:          game.date ?? date,
        status:        game.status ?? null,
        time:          game.time ?? null,
        period:        game.period ?? null,
        home_team: {
          id:           String(game.home_team?.id ?? ''),
          name:         game.home_team?.full_name ?? null,
          abbreviation: game.home_team?.abbreviation ?? null,
          score:        game.home_team_score ?? null,
        },
        away_team: {
          id:           String(game.visitor_team?.id ?? ''),
          name:         game.visitor_team?.full_name ?? null,
          abbreviation: game.visitor_team?.abbreviation ?? null,
          score:        game.visitor_team_score ?? null,
        },
        source: PROVIDER_A,
        fetched_at: new Date().toISOString(),
      })),
    };
  }

  static _normalizeMatchesSourceB(data, date) {
    // NBA Stats retourne un format différent via le Worker
    // Le Worker normalise partiellement — structure attendue documentée ici
    if (!data?.games || !Array.isArray(data.games)) return null;

    return {
      date,
      source: PROVIDER_B,
      fetched_at: new Date().toISOString(),
      matches: data.games.map(game => ({
        id:            String(game.gameId ?? ''),
        date:          game.gameDate ?? date,
        status:        game.gameStatus ?? null,
        time:          game.gameStatusText ?? null,
        period:        game.period ?? null,
        home_team: {
          id:           String(game.homeTeam?.teamId ?? ''),
          name:         game.homeTeam?.teamName ?? null,
          abbreviation: game.homeTeam?.teamTricode ?? null,
          score:        game.homeTeam?.score ?? null,
        },
        away_team: {
          id:           String(game.awayTeam?.teamId ?? ''),
          name:         game.awayTeam?.teamName ?? null,
          abbreviation: game.awayTeam?.teamTricode ?? null,
          score:        game.awayTeam?.score ?? null,
        },
        source: PROVIDER_B,
        fetched_at: new Date().toISOString(),
      })),
    };
  }

  /**
   * Format unifié des stats équipe.
   * Tous les champs non trouvés → null (jamais inventés).
   */
  static _normalizeTeamStatsSourceA(data, teamId, statType) {
    if (!data) return null;

    return {
      team_id:      teamId,
      stat_type:    statType,
      source:       PROVIDER_A,
      fetched_at:   new Date().toISOString(),
      games_sample: data.games_played ?? null,
      stats: {
        net_rating:        data.net_rating        ?? null,
        offensive_rating:  data.offensive_rating  ?? null,
        defensive_rating:  data.defensive_rating  ?? null,
        pace:              data.pace              ?? null,
        efg_pct:           data.efg_pct           ?? null,
        ts_pct:            data.ts_pct            ?? null,
        tov_pct:           data.tov_pct           ?? null,
        orb_pct:           data.orb_pct           ?? null,
        wins:              data.wins              ?? null,
        losses:            data.losses            ?? null,
        win_pct:           data.win_pct           ?? null,
      },
    };
  }

  static _normalizeTeamStatsSourceB(data, teamId, statType) {
    if (!data) return null;

    return {
      team_id:      teamId,
      stat_type:    statType,
      source:       PROVIDER_B,
      fetched_at:   new Date().toISOString(),
      games_sample: data.gamesPlayed ?? null,
      stats: {
        net_rating:        data.netRating        ?? null,
        offensive_rating:  data.offRating        ?? null,
        defensive_rating:  data.defRating        ?? null,
        pace:              data.pace              ?? null,
        efg_pct:           data.efgPct           ?? null,
        ts_pct:            data.tsPct            ?? null,
        tov_pct:           data.tovPct           ?? null,
        orb_pct:           data.orebPct          ?? null,
        wins:              data.wins              ?? null,
        losses:            data.losses            ?? null,
        win_pct:           data.winPct           ?? null,
      },
    };
  }

  static _normalizeInjuriesSourceA(data, teamId) {
    if (!data?.data) return null;

    return {
      team_id:    teamId,
      source:     PROVIDER_A,
      fetched_at: new Date().toISOString(),
      players: (data.data ?? []).map(p => ({
        player_id:   String(p.player?.id ?? ''),
        name:        p.player?.first_name && p.player?.last_name
                       ? `${p.player.first_name} ${p.player.last_name}`
                       : null,
        status:      p.status ?? null,        // 'Out' | 'Questionable' | 'Probable'
        reason:      p.notes ?? null,
        updated_at:  p.updated_at ?? null,
      })),
    };
  }

  static _normalizeInjuriesSourceB(data, teamId) {
    if (!data?.injuries) return null;

    return {
      team_id:    teamId,
      source:     PROVIDER_B,
      fetched_at: new Date().toISOString(),
      players: (data.injuries ?? []).map(p => ({
        player_id:   String(p.personId ?? ''),
        name:        p.playerName ?? null,
        status:      p.status ?? null,
        reason:      p.description ?? null,
        updated_at:  null,   // NBA Stats ne fournit pas toujours ce champ
      })),
    };
  }

  // ── FETCH UTILITAIRE ─────────────────────────────────────────────────

  static async _fetch(url, provider, endpoint) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timer);

      Logger.apiCall({
        provider,
        endpoint,
        statusCode: response.status,
        cached: false,
        error: response.ok ? null : `HTTP ${response.status}`,
      });

      if (!response.ok) return null;

      return await response.json();

    } catch (err) {
      clearTimeout(timer);

      Logger.apiCall({
        provider,
        endpoint,
        statusCode: 0,
        cached: false,
        error: err.name === 'AbortError' ? 'TIMEOUT' : err.message,
      });

      return null;
    }
  }
}
