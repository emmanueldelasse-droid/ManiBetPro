/**
 * MANI BET PRO — data.orchestrator.js v2
 *
 * AJOUTS v2 :
 *   - _loadAdvancedStats() : charge Net Rating + Pace depuis NBA Stats API
 *     en parallele avec BDL et injuries. Transmis au moteur via advanced_stats.
 *   - buildRawData() accepte advancedStats en parametre
 *   - BATCH_SIZE passe de 3 a 6, BATCH_DELAY de 500ms a 200ms
 */

import { ProviderNBA }      from '../providers/provider.nba.js';
import { ProviderInjuries } from '../providers/provider.injuries.js';
import { EngineCore }       from '../engine/engine.core.js';
import { Logger }           from '../utils/utils.logger.js';
import { LoadingUI }        from '../ui/ui.loading.js';
import { API_CONFIG }       from '../config/api.config.js';

// Mapping nom equipe ESPN vers ID BallDontLie (officiel NBA 1-30)
const TEAM_NAME_TO_BDL_ID = {
  'Atlanta Hawks':           '1',
  'Boston Celtics':          '2',
  'Brooklyn Nets':           '3',
  'Charlotte Hornets':       '4',
  'Chicago Bulls':           '5',
  'Cleveland Cavaliers':     '6',
  'Dallas Mavericks':        '7',
  'Denver Nuggets':          '8',
  'Detroit Pistons':         '9',
  'Golden State Warriors':   '10',
  'Houston Rockets':         '11',
  'Indiana Pacers':          '12',
  'LA Clippers':             '13',
  'Los Angeles Lakers':      '14',
  'Memphis Grizzlies':       '15',
  'Miami Heat':              '16',
  'Milwaukee Bucks':         '17',
  'Minnesota Timberwolves':  '18',
  'New Orleans Pelicans':    '19',
  'New York Knicks':         '20',
  'Oklahoma City Thunder':   '21',
  'Orlando Magic':           '22',
  'Philadelphia 76ers':      '23',
  'Phoenix Suns':            '24',
  'Portland Trail Blazers':  '25',
  'Sacramento Kings':        '26',
  'San Antonio Spurs':       '27',
  'Toronto Raptors':         '28',
  'Utah Jazz':               '29',
  'Washington Wizards':      '30',
};

export class DataOrchestrator {

  /**
   * Point d'entree unique. Charge toutes les donnees puis analyse.
   * @param {string} date - YYYY-MM-DD
   * @param {Store} store
   * @returns {Promise<{ matches: Array, analyses: object }|null>}
   */
  static async loadAndAnalyze(date, store) {
    try {
      // ETAPE 1 : ESPN matches (obligatoire)
      LoadingUI.update('ESPN matches...', 0);
      const espnData = await ProviderNBA.getMatchesToday(date);

      if (!espnData || !espnData.matches || !espnData.matches.length) {
        Logger.warn('ORCHESTRATOR_NO_MATCHES', { date });
        return null;
      }

      const matches = espnData.matches;

      // Vider les analyses precedentes si on change de date
      const prevDate = store.get('dashboardFilters') && store.get('dashboardFilters').selectedDate;
      if (prevDate && prevDate !== date) {
        store.set({ matches: {}, analyses: {} });
      }

      // Stocker les matchs dans le store immediatement
      matches.forEach(function(match) {
        store.upsert('matches', match.id, Object.assign({}, match, { sport: 'NBA' }));
      });

      // ETAPE 2 : Injuries + BDL + Odds + Stats avancees en parallele
      LoadingUI.update('Blessures + forme recente + cotes + Net Rating...', 20);

      const season  = _getCurrentNBASeason();
      const teamIds = _extractTeamIds(matches);

      const [injuryReport, recentForms, oddsComparison, advancedStats] = await Promise.all([
        _loadInjuries(date),
        _loadRecentForms(teamIds, season),
        _loadOddsComparison(),
        _loadAdvancedStats(),
      ]);

      // ETAPE 3 : Analyser tous les matchs
      LoadingUI.update('Analyse en cours...', 70);

      const analyses = await _analyzeMatches(
        matches,
        recentForms,
        injuryReport,
        oddsComparison,
        advancedStats,
        date,
        store
      );

      LoadingUI.update('Pret', 100);
      LoadingUI.hide();

      return { matches, analyses };

    } catch (err) {
      Logger.error('ORCHESTRATOR_ERROR', { message: err.message });
      LoadingUI.hide();
      return null;
    }
  }

  /**
   * Construit les donnees brutes pour le moteur NBA.
   * @param {object} match
   * @param {object} recentForms - { [bdlId]: NBARecentForm }
   * @param {object|null} injuryReport
   * @param {object|null} advancedStats - { [teamName]: { net_rating, pace, ... } }
   * @returns {object} rawData
   */
  static buildRawData(match, recentForms, injuryReport, advancedStats) {
    const homeBDLId    = _getBDLId(match.home_team && match.home_team.name);
    const awayBDLId    = _getBDLId(match.away_team && match.away_team.name);
    const homeTeamName = match.home_team && match.home_team.name;
    const awayTeamName = match.away_team && match.away_team.name;

    const homeRecent = homeBDLId ? (recentForms[homeBDLId] || null) : null;
    const awayRecent = awayBDLId ? (recentForms[awayBDLId] || null) : null;

    const homeInjuries = injuryReport && homeTeamName
      ? ProviderInjuries.getForTeam(injuryReport, homeTeamName)
      : null;
    const awayInjuries = injuryReport && awayTeamName
      ? ProviderInjuries.getForTeam(injuryReport, awayTeamName)
      : null;

    return {
      match_id:           match.id,
      home_season_stats:  Object.assign({}, match.home_season_stats || {}, { name: homeTeamName }),
      away_season_stats:  Object.assign({}, match.away_season_stats || {}, { name: awayTeamName }),
      home_recent:        homeRecent,
      away_recent:        awayRecent,
      home_injuries:      homeInjuries && homeInjuries.length > 0 ? homeInjuries : null,
      away_injuries:      awayInjuries && awayInjuries.length > 0 ? awayInjuries : null,
      odds:               match.odds || null,
      absences_confirmed: injuryReport !== null,
      advanced_stats:     advancedStats || null,
      market_odds:        null, // injecte par _analyzeMatches
    };
  }

  static getBDLId(teamName) {
    return _getBDLId(teamName);
  }
}

// ── FONCTIONS PRIVEES ─────────────────────────────────────────────────────────

function _getBDLId(teamName) {
  return teamName ? (TEAM_NAME_TO_BDL_ID[teamName] || null) : null;
}

function _extractTeamIds(matches) {
  const ids = new Set();
  matches.forEach(function(m) {
    const homeId = _getBDLId(m.home_team && m.home_team.name);
    const awayId = _getBDLId(m.away_team && m.away_team.name);
    if (homeId) ids.add(homeId);
    if (awayId) ids.add(awayId);
  });
  return Array.from(ids);
}

async function _loadInjuries(date) {
  try {
    return await ProviderInjuries.getReport(date);
  } catch (err) {
    Logger.warn('ORCHESTRATOR_INJURIES_FAILED', { message: err.message });
    return null;
  }
}

async function _loadRecentForms(teamIds, season) {
  const forms = {};
  const BATCH_SIZE  = 6;
  const BATCH_DELAY = 200;

  for (let i = 0; i < teamIds.length; i += BATCH_SIZE) {
    const batch = teamIds.slice(i, i + BATCH_SIZE);

    LoadingUI.update(
      'Forme recente (' + Math.min(i + BATCH_SIZE, teamIds.length) + '/' + teamIds.length + ')...',
      20 + Math.round((i / teamIds.length) * 40)
    );

    await Promise.allSettled(
      batch.map(async function(bdlId) {
        const form = await ProviderNBA.getRecentForm(bdlId, season, 10);
        if (form && form.matches && form.matches.length > 0) {
          forms[bdlId] = form;
        }
      })
    );

    if (i + BATCH_SIZE < teamIds.length) {
      await new Promise(function(r) { setTimeout(r, BATCH_DELAY); });
    }
  }

  return forms;
}

async function _loadOddsComparison() {
  try {
    return await ProviderNBA.getOddsComparison();
  } catch (err) {
    Logger.warn('ORCHESTRATOR_ODDS_FAILED', { message: err.message });
    return null;
  }
}

/**
 * Charge les stats avancees NBA depuis le Worker.
 * Retourne { [teamName]: { net_rating, off_rating, def_rating, pace, ... } }
 * ou null si indisponible.
 * Non bloquant — le moteur fonctionne sans ces stats (quality=MISSING).
 */
async function _loadAdvancedStats() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(function() { controller.abort(); }, 15000);
    const response = await fetch(
      API_CONFIG.WORKER_BASE_URL + '/nba/stats/advanced',
      { signal: controller.signal, headers: { 'Accept': 'application/json' } }
    );
    clearTimeout(timer);
    if (!response.ok) {
      Logger.warn('ADVANCED_STATS_HTTP_ERROR', { status: response.status });
      return null;
    }
    const data = await response.json();
    if (!data || !data.available || !data.teams) {
      Logger.warn('ADVANCED_STATS_UNAVAILABLE', { note: data && data.note });
      return null;
    }
    Logger.info('ADVANCED_STATS_LOADED', { teams: Object.keys(data.teams).length, season: data.season });
    return data.teams;
  } catch (err) {
    Logger.warn('ADVANCED_STATS_FAILED', { message: err.message });
    return null;
  }
}

async function _analyzeMatches(matches, recentForms, injuryReport, oddsComparison, advancedStats, date, store) {
  const analyses = {};
  let conclusive = 0;
  let rejected   = 0;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    try {
      const rawData = DataOrchestrator.buildRawData(match, recentForms, injuryReport, advancedStats);

      // Injecter les vraies cotes multi-books si disponibles
      if (oddsComparison && oddsComparison.matches) {
        const matchOdds = ProviderNBA.findMatchOdds(
          oddsComparison,
          match.home_team && match.home_team.name,
          match.away_team && match.away_team.name
        );
        if (matchOdds) rawData.market_odds = matchOdds;
      }

      const analysis = EngineCore.compute('NBA', rawData);
      const enriched = Object.assign({}, analysis, { match_id: match.id });

      store.upsert('analyses', analysis.analysis_id, enriched);
      analyses[match.id] = enriched;

      if (analysis.confidence_level !== 'INCONCLUSIVE') {
        store.push('history', {
          analysis_id:      analysis.analysis_id,
          match_id:         match.id,
          date,
          home:             (match.home_team && match.home_team.name) || '-',
          away:             (match.away_team && match.away_team.name) || '-',
          sport:            'NBA',
          confidence_level: analysis.confidence_level,
          predictive_score: analysis.predictive_score,
          robustness_score: analysis.robustness_score,
          saved_at:         new Date().toISOString(),
        }, 100);
        conclusive++;
      } else {
        rejected++;
      }

    } catch (err) {
      Logger.warn('ORCHESTRATOR_MATCH_ERROR', { matchId: match.id, message: err.message });
    }
  }

  Logger.info('ORCHESTRATOR_DONE', { total: matches.length, conclusive, rejected });
  return analyses;
}

function _getCurrentNBASeason() {
  const now = new Date();
  return String(now.getMonth() + 1 >= 10 ? now.getFullYear() : now.getFullYear() - 1);
}
