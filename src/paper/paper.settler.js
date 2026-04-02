/**
 * MANI BET PRO — paper.settler.js v2
 *
 * Responsabilité unique : clôturer automatiquement les paris en attente
 * en récupérant les scores finaux ESPN après chaque match.
 *
 * CORRECTION v2 :
 *   - SPREAD : utilisait odds_line (cote américaine ex: -110) comme ligne de points.
 *     Désormais lit spread_line (ligne de points ex: -5.5) stockée au moment du placement.
 *     Sans spread_line, le SPREAD est ignoré plutôt que mal clôturé.
 */

import { PaperEngine } from './paper.engine.js';
import { API_CONFIG }  from '../config/api.config.js';
import { Logger }      from '../utils/utils.logger.js';

const WORKER = API_CONFIG.WORKER_BASE_URL;

export class PaperSettler {

  /**
   * Point d'entrée — appelé au démarrage depuis app.js.
   * Vérifie les paris en attente et tente de les clôturer.
   * @param {Store} store
   */
  static async settle(store) {
    const state       = await PaperEngine.loadAsync();
    const pendingBets = state.bets.filter(b => b.result === 'PENDING');

    if (pendingBets.length === 0) return;

    // Grouper par date
    const byDate = {};
    pendingBets.forEach(bet => {
      const date = _normalizeDate(bet.date);
      if (!date) return;
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(bet);
    });

    let settled = 0;

    for (const [date, bets] of Object.entries(byDate)) {
      // Ne pas chercher les résultats pour aujourd'hui
      if (date >= _getTodayDate()) continue;

      try {
        const results = await _fetchResults(date);
        if (!results?.results?.length) continue;

        for (const bet of bets) {
          const result = _matchBetToResult(bet, results.results);
          if (!result) continue;

          const outcome = _determineOutcome(bet, result);
          if (!outcome) continue;

          await PaperEngine.settleBet(bet.bet_id, outcome, null);
          settled++;

          Logger.info('PAPER_AUTO_SETTLED', {
            bet_id:  bet.bet_id,
            outcome,
            market:  bet.market,
            match:   `${bet.home} vs ${bet.away}`,
          });
        }
      } catch (err) {
        Logger.warn('PAPER_SETTLER_ERROR', { date, message: err.message });
      }
    }

    if (settled > 0) {
      Logger.info('PAPER_SETTLER_DONE', { settled });
      store.set({ paperTradingVersion: (store.get('paperTradingVersion') ?? 0) + 1 });
    }
  }
}

// ── FONCTIONS PRIVÉES ─────────────────────────────────────────────────────

async function _fetchResults(date) {
  try {
    const dateESPN = date.replace(/-/g, '');
    const response = await fetch(`${WORKER}/nba/results?date=${dateESPN}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function _matchBetToResult(bet, results) {
  return results.find(r =>
    (r.home_team?.name === bet.home && r.away_team?.name === bet.away) ||
    (r.home_team?.name === bet.away && r.away_team?.name === bet.home)
  ) ?? null;
}

/**
 * Détermine le résultat d'un pari depuis le score final ESPN.
 *
 * CORRECTION SPREAD :
 *   bet.spread_line = ligne de points stockée au placement (ex: -5.5)
 *   bet.odds_line   = cote américaine (ex: -110) — NE PAS utiliser pour le calcul spread
 *
 * Si spread_line est absent (paris placés avant la correction), le SPREAD
 * est retourné null (ignoré) plutôt que mal calculé.
 *
 * @returns {'WIN'|'LOSS'|'PUSH'|null}
 */
function _determineOutcome(bet, result) {
  const homeScore = result.home_team?.score ?? 0;
  const awayScore = result.away_team?.score ?? 0;
  const total     = homeScore + awayScore;

  // Identifier si bet.home correspond à l'équipe à domicile dans ESPN
  const betHomeIsResultHome = result.home_team?.name === bet.home;

  switch (bet.market) {

    case 'MONEYLINE': {
      const betOnHome = bet.side === 'HOME';
      const homeWon   = homeScore > awayScore;

      if (betHomeIsResultHome) {
        return betOnHome ? (homeWon ? 'WIN' : 'LOSS') : (homeWon ? 'LOSS' : 'WIN');
      } else {
        return betOnHome ? (homeWon ? 'LOSS' : 'WIN') : (homeWon ? 'WIN' : 'LOSS');
      }
    }

    case 'SPREAD': {
      // CORRECTION : lire spread_line (ligne de points), pas odds_line (cote américaine)
      if (bet.spread_line === null || bet.spread_line === undefined) {
        // Paris placé avant la correction v2 — impossible à clôturer automatiquement
        Logger.warn('PAPER_SETTLER_SPREAD_NO_LINE', {
          bet_id: bet.bet_id,
          match:  `${bet.home} vs ${bet.away}`,
          note:   'spread_line absent — clôture manuelle requise',
        });
        return null;
      }

      const spreadLine = Number(bet.spread_line);
      const betOnHome  = bet.side === 'HOME';

      let scoreDiff;
      if (betHomeIsResultHome) {
        scoreDiff = betOnHome ? homeScore - awayScore : awayScore - homeScore;
      } else {
        scoreDiff = betOnHome ? awayScore - homeScore : homeScore - awayScore;
      }

      const covered = scoreDiff + spreadLine;
      if (covered > 0) return 'WIN';
      if (covered < 0) return 'LOSS';
      return 'PUSH';
    }

    case 'OVER_UNDER': {
      const line = Number(bet.odds_line);  // Pour O/U, odds_line = ligne de total (correct)
      if (total > line) return bet.side === 'OVER'  ? 'WIN' : 'LOSS';
      if (total < line) return bet.side === 'UNDER' ? 'WIN' : 'LOSS';
      return 'PUSH';
    }

    default:
      return null;
  }
}

function _normalizeDate(date) {
  if (!date) return null;
  if (date.length === 8) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  }
  return date;
}

function _getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}
