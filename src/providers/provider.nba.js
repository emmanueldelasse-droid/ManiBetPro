/**
 * MANI BET PRO — provider.nba.js v2
 *
 * Provider NBA — deux sources :
 * Source A : BallDontLie  — matchs du jour, wins/losses basiques
 * Source B : stats.nba.com — stats avancées (net rating, pace, eFG%, TS%)
 *
 * Toutes les requêtes transitent par le Cloudflare Worker.
 * Aucune clé API côté front.
 * Si une donnée est indisponible → null explicite, jamais inventé.
 */

import { API_CONFIG }   from '../config/api.config.js';
import { ProviderCache } from './provider.cache.js';
import { Logger }        from '../utils/utils.logger.js';

const WORKER     = API_CONFIG.WORKER_BASE_URL;
const TIMEOUT    = API_CONFIG.TIMEOUTS.DEFAULT;
const PROVIDER_A = 'BALLDONTLIE';
const PROVIDER_B = 'NBA_STATS';

export class ProviderNBA {

  // ── MATCHS DU JOUR ────────────────────────────────────────────────────

  static async getMatchesToday(date) {
    const cacheKey = ProviderCache.buildKey('nba', 'matches', { date });
    const cached   = ProviderCache.get(cacheKey);
    if (cached) return cached;

    const data = await this._fetch(
      `${WORKER}/nba/matches?date=${date}`,
      PROVIDER_A, '/nba/matches'
    );

    if (!data) return null;

    const result = this._normalizeMatches(data, date);
    if (result) ProviderCache.set(cacheKey, result, 'RECENT_FORM');
    return result;
  }

  // ── STATS BASIQUES (wins/losses) — BallDontLie ───────────────────────

  static async getTeamStats(teamId, statType, season) {
    const cacheKey = ProviderCache.buildKey('nba', 'stats', { teamId, statType, season });
    const cached   = ProviderCache.get(cacheKey);
    if (cached) return cached;

    const ttl  = statType === 'SEASON' ? 'SEASON_STATS' : 'RECENT_FORM';
    const data = await this._fetch(
      `${WORKER}/nba/team/${teamId}/stats?type=${statType}&season=${season}`,
      PROVIDER_A, `/nba/team/${teamId}/stats`
    );

    if (!data) return null;

    const result = {
      team_id:      teamId,
      stat_type:    statType,
      source:       PROVIDER_A,
      fetched_at:   new Date().toISOString(),
      games_sample: data.games_played ?? null,
      stats: {
        net_rating:        null,   // Pas disponible BallDontLie gratuit
        offensive_rating:  null,
        defensive_rating:  null,
        pace:              null,
        efg_pct:           null,
        ts_pct:            null,
        tov_pct:           null,
        orb_pct:           null,
        wins:              data.wins    ?? null,
        losses:            data.losses  ?? null,
        win_pct:           data.win_pct ?? null,
      },
      matches: data.matches ?? null,
    };

    ProviderCache.set(cacheKey, result, ttl);
    return result;
  }

  // ── STATS AVANCÉES — stats.nba.com ────────────────────────────────────

  /**
   * Récupère les stats avancées depuis stats.nba.com via le Worker.
   * Net rating, pace, eFG%, TS%, TOV%, ORB%, PIE.
   *
   * @param {string} teamId — ID BallDontLie (à mapper vers ID NBA Stats)
   * @param {string} season — ex: "2025"
   * @returns {Promise<NBAAdvancedStats|null>}
   */
  static async getTeamAdvancedStats(teamId, season) {
    // Convertir l'ID BallDontLie vers l'ID stats.nba.com
    const nbaStatsId = this._mapTeamId(teamId);
    if (!nbaStatsId) {
      Logger.warn('NBA_TEAM_ID_NOT_MAPPED', { teamId });
      return this._buildEmptyAdvanced(teamId);
    }

    const cacheKey = ProviderCache.buildKey('nba', 'advanced', { teamId: nbaStatsId, season });
    const cached   = ProviderCache.get(cacheKey);
    if (cached) return cached;

    const data = await this._fetch(
      `${WORKER}/nba/team/${nbaStatsId}/advanced?season=${season}`,
      PROVIDER_B, `/nba/team/${nbaStatsId}/advanced`
    );

    if (!data) return this._buildEmptyAdvanced(teamId);

    const result = {
      team_id:      teamId,
      nba_stats_id: nbaStatsId,
      source:       PROVIDER_B,
      fetched_at:   new Date().toISOString(),
      available:    data.available ?? false,
      games_sample: data.games_played ?? null,
      stats: {
        net_rating:        data.net_rating       ?? null,
        offensive_rating:  data.offensive_rating ?? null,
        defensive_rating:  data.defensive_rating ?? null,
        pace:              data.pace             ?? null,
        efg_pct:           data.efg_pct          ?? null,
        ts_pct:            data.ts_pct           ?? null,
        tov_pct:           data.tov_pct          ?? null,
        orb_pct:           data.orb_pct          ?? null,
        wins:              data.wins             ?? null,
        losses:            data.losses           ?? null,
        win_pct:           data.win_pct          ?? null,
        pie:               data.pie              ?? null,
      },
    };

    if (data.available) {
      ProviderCache.set(cacheKey, result, 'SEASON_STATS');
    }

    return result;
  }

  // ── FORME RÉCENTE (derniers matchs) ──────────────────────────────────

  /**
   * Récupère les N derniers matchs pour calculer l'EMA de forme.
   * @param {string} teamId
   * @param {string} season
   * @param {number} n — 5 ou 10
   */
  static async getRecentForm(teamId, season, n = 10) {
    const statType = n <= 5 ? 'LAST_5' : 'LAST_10';
    const cacheKey = ProviderCache.buildKey('nba', 'recent', { teamId, season, n });
    const cached   = ProviderCache.get(cacheKey);
    if (cached) return cached;

    const data = await this._fetch(
      `${WORKER}/nba/team/${teamId}/stats?type=${statType}&season=${season}`,
      PROVIDER_A, `/nba/team/${teamId}/stats`
    );

    if (!data) return null;

    // Transformer les matchs en série won/lost pour l'EMA
    const matches = (data.matches ?? []).map(game => {
      const isHome    = String(game.home_team?.id) === String(teamId);
      const teamScore = isHome ? game.home_team_score    : game.visitor_team_score;
      const oppScore  = isHome ? game.visitor_team_score : game.home_team_score;
      return {
        date:    game.date,
        won:     teamScore > oppScore,
        margin:  teamScore - oppScore,
      };
    });

    const result = {
      team_id:    teamId,
      source:     PROVIDER_A,
      fetched_at: new Date().toISOString(),
      matches,
    };

    ProviderCache.set(cacheKey, result, 'RECENT_FORM');
    return result;
  }

  // ── BLESSURES ─────────────────────────────────────────────────────────

  static async getInjuries(teamId) {
    const cacheKey = ProviderCache.buildKey('nba', 'injuries', { teamId });
    const cached   = ProviderCache.get(cacheKey);
    if (cached) return cached;

    const data = await this._fetch(
      `${WORKER}/nba/injuries?teamId=${teamId}`,
      PROVIDER_A, '/nba/injuries'
    );

    if (!data) return { team_id: teamId, players: [], available: false };

    ProviderCache.set(cacheKey, data, 'INJURIES');
    return data;
  }

  // ── MAPPING IDs BALLDONTLIE → NBA STATS ──────────────────────────────
  //
  // BallDontLie et stats.nba.com utilisent des IDs différents.
  // Ce mapping est basé sur la saison 2024-25 — à vérifier si des équipes
  // changent d'ID entre saisons.

  static _mapTeamId(bdlId) {
    const MAP = {
      '1':  '1610612737',   // Atlanta Hawks
      '2':  '1610612738',   // Boston Celtics
      '3':  '1610612751',   // Brooklyn Nets
      '4':  '1610612766',   // Charlotte Hornets
      '5':  '1610612741',   // Chicago Bulls
      '6':  '1610612739',   // Cleveland Cavaliers
      '7':  '1610612742',   // Dallas Mavericks
      '8':  '1610612743',   // Denver Nuggets
      '9':  '1610612765',   // Detroit Pistons
      '10': '1610612744',   // Golden State Warriors
      '11': '1610612745',   // Houston Rockets
      '12': '1610612754',   // Indiana Pacers
      '13': '1610612746',   // LA Clippers
      '14': '1610612747',   // Los Angeles Lakers
      '15': '1610612763',   // Memphis Grizzlies
      '16': '1610612748',   // Miami Heat
      '17': '1610612749',   // Milwaukee Bucks
      '18': '1610612750',   // Minnesota Timberwolves
      '19': '1610612740',   // New Orleans Pelicans
      '20': '1610612752',   // New York Knicks
      '21': '1610612760',   // Oklahoma City Thunder
      '22': '1610612753',   // Orlando Magic
      '23': '1610612755',   // Philadelphia 76ers
      '24': '1610612756',   // Phoenix Suns
      '25': '1610612757',   // Portland Trail Blazers
      '26': '1610612758',   // Sacramento Kings
      '27': '1610612759',   // San Antonio Spurs
      '28': '1610612761',   // Toronto Raptors
      '29': '1610612762',   // Utah Jazz
      '30': '1610612764',   // Washington Wizards
    };

    return MAP[String(bdlId)] ?? null;
  }

  // ── NORMALISATEURS ────────────────────────────────────────────────────

  static _normalizeMatches(data, date) {
    if (!data?.data || !Array.isArray(data.data)) return null;

    return {
      date,
      source:     PROVIDER_A,
      fetched_at: new Date().toISOString(),
      matches: data.data.map(game => ({
        id:     String(game.id ?? ''),
        date:   game.date ?? date,
        status: game.status ?? null,
        time:   game.time ?? null,
        period: game.period ?? null,
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
        source:     PROVIDER_A,
        fetched_at: new Date().toISOString(),
      })),
    };
  }

  static _buildEmptyAdvanced(teamId) {
    return {
      team_id:    teamId,
      source:     PROVIDER_B,
      fetched_at: new Date().toISOString(),
      available:  false,
      games_sample: null,
      stats: {
        net_rating: null, offensive_rating: null, defensive_rating: null,
        pace: null, efg_pct: null, ts_pct: null, tov_pct: null,
        orb_pct: null, wins: null, losses: null, win_pct: null, pie: null,
      },
    };
  }

  // ── FETCH UTILITAIRE ─────────────────────────────────────────────────

  static async _fetch(url, provider, endpoint) {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TIMEOUT);

    try {
      const response = await fetch(url, {
        signal:  controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(timer);

      Logger.apiCall({
        provider, endpoint,
        statusCode: response.status,
        cached:     false,
        error:      response.ok ? null : `HTTP ${response.status}`,
      });

      if (!response.ok) return null;
      return await response.json();

    } catch (err) {
      clearTimeout(timer);
      Logger.apiCall({
        provider, endpoint,
        statusCode: 0, cached: false,
        error: err.name === 'AbortError' ? 'TIMEOUT' : err.message,
      });
      return null;
    }
  }
}
