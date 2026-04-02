/**
 * MANI BET PRO — paper.engine.js
 *
 * Responsabilité unique : logique du paper trading.
 * Calcul ROI, P&L, CLV, Brier Score, détection biais, stratégies A/B/C.
 *
 * Aucune donnée fictive. Toutes les valeurs sont calculées
 * depuis les paris enregistrés et les résultats réels ESPN.
 */

import { ProviderCache } from '../providers/provider.cache.js';
import { Logger }        from '../utils/utils.logger.js';

const WORKER = null; // Sera injecté depuis api.config.js au besoin

// ── CONSTANTES ────────────────────────────────────────────────────────────

const DEFAULT_BANKROLL = 1000; // EUR
const STORAGE_KEY      = 'mbp_paper_trading';

// Stratégies de validation automatique
export const STRATEGIES = {
  A: { id: 'A', label: 'Tous les edges > 5%',         fn: (bet) => bet.edge >= 5 },
  B: { id: 'B', label: 'Kelly + données complètes',   fn: (bet) => bet.edge >= 5 && bet.data_quality >= 0.80 },
  C: { id: 'C', label: 'Confidence HIGH uniquement',  fn: (bet) => bet.confidence_level === 'HIGH' && bet.edge >= 5 },
};

// ── PAPER ENGINE ──────────────────────────────────────────────────────────

export class PaperEngine {

  // ── INITIALISATION ────────────────────────────────────────────────────

  /**
   * Charge l'état paper trading depuis localStorage.
   * @returns {PaperState}
   */
  static load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return this._defaultState();
      const state = JSON.parse(raw);
      // Migration : s'assurer que tous les champs existent
      return { ...this._defaultState(), ...state };
    } catch {
      return this._defaultState();
    }
  }

  /**
   * Sauvegarde l'état paper trading dans localStorage.
   * @param {PaperState} state
   */
  static save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      Logger.warn('PAPER_SAVE_ERROR', { message: err.message });
    }
  }

  /**
   * Réinitialise le paper trading.
   * @param {number} initialBankroll
   * @returns {PaperState}
   */
  static reset(initialBankroll = DEFAULT_BANKROLL) {
    const state = this._defaultState(initialBankroll);
    this.save(state);
    return state;
  }

  // ── PARIS ─────────────────────────────────────────────────────────────

  /**
   * Enregistre un nouveau pari.
   * @param {object} betData
   * @returns {PaperState}
   */
  static placeBet(betData) {
    const state = this.load();

    const bet = {
      bet_id:           crypto.randomUUID(),
      placed_at:        new Date().toISOString(),
      result:           'PENDING',
      pnl:              null,
      closing_odds:     null,
      clv:              null,

      // Données du match
      match_id:         betData.match_id ?? null,
      date:             betData.date ?? null,
      sport:            betData.sport ?? 'NBA',
      home:             betData.home ?? '—',
      away:             betData.away ?? '—',

      // Données du pari
      market:           betData.market,        // MONEYLINE | SPREAD | OVER_UNDER
      side:             betData.side,          // HOME | AWAY | OVER | UNDER
      side_label:       betData.side_label,    // Nom affiché
      odds_taken:       betData.odds_taken,    // Cote américaine prise
      stake:            betData.stake,         // Mise en EUR
      kelly_stake:      betData.kelly_stake,   // Mise Kelly recommandée %

      // Contexte moteur
      edge:             betData.edge,          // Edge en %
      motor_prob:       betData.motor_prob,    // Probabilité moteur %
      implied_prob:     betData.implied_prob,  // Probabilité implicite bookmaker %
      confidence_level: betData.confidence_level,
      data_quality:     betData.data_quality,

      // Stratégie
      strategy:         betData.strategy ?? this._detectStrategy(betData),

      // Journal
      decision_note:    betData.decision_note ?? null,
    };

    state.bets.push(bet);
    state.current_bankroll -= bet.stake;
    state.total_staked     += bet.stake;

    this.save(state);
    Logger.info('PAPER_BET_PLACED', { bet_id: bet.bet_id, stake: bet.stake, edge: bet.edge });
    return state;
  }

  /**
   * Enregistre le résultat d'un pari.
   * @param {string} betId
   * @param {'WIN'|'LOSS'|'PUSH'} result
   * @param {number|null} closingOdds — cote de fermeture pour CLV
   * @returns {PaperState}
   */
  static settleBet(betId, result, closingOdds = null) {
    const state = this.load();
    const bet   = state.bets.find(b => b.bet_id === betId);
    if (!bet || bet.result !== 'PENDING') return state;

    bet.result       = result;
    bet.settled_at   = new Date().toISOString();
    bet.closing_odds = closingOdds;

    // Calcul P&L
    if (result === 'WIN') {
      const decimalOdds = this._americanToDecimal(bet.odds_taken);
      bet.pnl            = Math.round((bet.stake * decimalOdds - bet.stake) * 100) / 100;
    } else if (result === 'LOSS') {
      bet.pnl = -bet.stake;
    } else if (result === 'PUSH') {
      bet.pnl = 0;
    }

    // CLV — Closing Line Value
    if (closingOdds !== null) {
      const takenProb   = this._americanToProb(bet.odds_taken);
      const closingProb = this._americanToProb(closingOdds);
      bet.clv = Math.round((takenProb - closingProb) * 100 * 100) / 100; // en %
    }

    // Mise à jour bankroll
    state.current_bankroll += bet.stake + (bet.pnl ?? 0);
    state.total_pnl        = Math.round((state.total_pnl + (bet.pnl ?? 0)) * 100) / 100;

    // Recalculer les métriques
    state.metrics = this.computeMetrics(state.bets);

    this.save(state);
    return state;
  }

  // ── MÉTRIQUES ─────────────────────────────────────────────────────────

  /**
   * Calcule toutes les métriques depuis l'historique des paris.
   * @param {Array} bets
   * @returns {PaperMetrics}
   */
  static computeMetrics(bets) {
    const settled = bets.filter(b => b.result !== 'PENDING');
    const won     = settled.filter(b => b.result === 'WIN');
    const total   = settled.length;

    if (total === 0) return this._emptyMetrics();

    const totalStaked = settled.reduce((s, b) => s + b.stake, 0);
    const totalPnl    = settled.reduce((s, b) => s + (b.pnl ?? 0), 0);
    const roi         = totalStaked > 0
      ? Math.round((totalPnl / totalStaked) * 10000) / 100
      : null;

    // Hit rate global
    const hitRate = Math.round((won.length / total) * 1000) / 10;

    // Hit rate par bucket d'edge
    const hitByEdge = this._computeHitRateByEdge(settled);

    // CLV moyen
    const clvBets  = settled.filter(b => b.clv !== null);
    const avgClv   = clvBets.length > 0
      ? Math.round(clvBets.reduce((s, b) => s + b.clv, 0) / clvBets.length * 100) / 100
      : null;

    // Brier Score
    const brierScore = this._computeBrierScore(settled);

    // Détection biais
    const biasDetection = this._detectBias(settled);

    // Métriques par stratégie
    const byStrategy = this._computeByStrategy(settled);

    // Streak detection
    const streak = this._computeStreak(bets);

    return {
      total_bets:    total,
      won:           won.length,
      lost:          settled.filter(b => b.result === 'LOSS').length,
      push:          settled.filter(b => b.result === 'PUSH').length,
      hit_rate:      hitRate,
      total_staked:  Math.round(totalStaked * 100) / 100,
      total_pnl:     Math.round(totalPnl * 100) / 100,
      roi,
      avg_clv:       avgClv,
      brier_score:   brierScore,
      hit_by_edge:   hitByEdge,
      bias:          biasDetection,
      by_strategy:   byStrategy,
      streak,
    };
  }

  // ── MÉTRIQUES PRIVÉES ─────────────────────────────────────────────────

  static _computeHitRateByEdge(settled) {
    const buckets = {
      '5-8%':   { won: 0, total: 0 },
      '8-12%':  { won: 0, total: 0 },
      '>12%':   { won: 0, total: 0 },
    };

    settled.forEach(b => {
      const e = b.edge;
      let key = null;
      if (e >= 5  && e < 8)  key = '5-8%';
      else if (e >= 8  && e < 12) key = '8-12%';
      else if (e >= 12) key = '>12%';
      if (!key) return;

      buckets[key].total++;
      if (b.result === 'WIN') buckets[key].won++;
    });

    return Object.entries(buckets).reduce((acc, [k, v]) => {
      acc[k] = v.total > 0
        ? { hit_rate: Math.round(v.won / v.total * 1000) / 10, total: v.total, won: v.won }
        : { hit_rate: null, total: 0, won: 0 };
      return acc;
    }, {});
  }

  static _computeBrierScore(settled) {
    // Brier Score = moyenne de (prob_moteur - résultat)²
    // Résultat = 1 si WIN, 0 si LOSS
    const valid = settled.filter(b => b.motor_prob !== null && b.result !== 'PUSH');
    if (valid.length === 0) return null;

    const sum = valid.reduce((s, b) => {
      const p = b.motor_prob / 100;
      const o = b.result === 'WIN' ? 1 : 0;
      return s + Math.pow(p - o, 2);
    }, 0);

    return Math.round((sum / valid.length) * 10000) / 10000;
  }

  static _detectBias(settled) {
    if (settled.length < 10) return { insufficient_data: true, min_required: 10 };

    // Biais domicile/extérieur
    const homeBets = settled.filter(b => b.side === 'HOME');
    const awayBets = settled.filter(b => b.side === 'AWAY');
    const homeHR   = homeBets.length > 0
      ? homeBets.filter(b => b.result === 'WIN').length / homeBets.length
      : null;
    const awayHR   = awayBets.length > 0
      ? awayBets.filter(b => b.result === 'WIN').length / awayBets.length
      : null;

    // Biais O/U
    const overBets  = settled.filter(b => b.side === 'OVER');
    const underBets = settled.filter(b => b.side === 'UNDER');
    const overHR    = overBets.length > 0
      ? overBets.filter(b => b.result === 'WIN').length / overBets.length
      : null;
    const underHR   = underBets.length > 0
      ? underBets.filter(b => b.result === 'WIN').length / underBets.length
      : null;

    // Biais spread
    const spreadBets = settled.filter(b => b.market === 'SPREAD');
    const spreadHR   = spreadBets.length > 0
      ? spreadBets.filter(b => b.result === 'WIN').length / spreadBets.length
      : null;

    return {
      insufficient_data: false,
      home_hit_rate:   homeHR !== null ? Math.round(homeHR * 1000) / 10 : null,
      away_hit_rate:   awayHR !== null ? Math.round(awayHR * 1000) / 10 : null,
      over_hit_rate:   overHR !== null ? Math.round(overHR * 1000) / 10 : null,
      under_hit_rate:  underHR !== null ? Math.round(underHR * 1000) / 10 : null,
      spread_hit_rate: spreadHR !== null ? Math.round(spreadHR * 1000) / 10 : null,
      home_bets:       homeBets.length,
      away_bets:       awayBets.length,
    };
  }

  static _computeByStrategy(settled) {
    return Object.keys(STRATEGIES).reduce((acc, key) => {
      const stratBets = settled.filter(b => b.strategy === key);
      if (stratBets.length === 0) { acc[key] = null; return acc; }

      const won       = stratBets.filter(b => b.result === 'WIN').length;
      const staked    = stratBets.reduce((s, b) => s + b.stake, 0);
      const pnl       = stratBets.reduce((s, b) => s + (b.pnl ?? 0), 0);
      acc[key] = {
        total:    stratBets.length,
        won,
        hit_rate: Math.round(won / stratBets.length * 1000) / 10,
        roi:      staked > 0 ? Math.round(pnl / staked * 10000) / 100 : null,
        pnl:      Math.round(pnl * 100) / 100,
      };
      return acc;
    }, {});
  }

  static _computeStreak(bets) {
    const settled = [...bets].filter(b => b.result !== 'PENDING').reverse();
    if (!settled.length) return { current: 0, type: null, max_loss: 0 };

    let current = 0;
    let type    = settled[0]?.result === 'WIN' ? 'WIN' : 'LOSS';

    for (const b of settled) {
      if (b.result === type) current++;
      else break;
    }

    // Max streak de pertes
    let maxLoss = 0, tempLoss = 0;
    for (const b of bets.filter(b => b.result !== 'PENDING')) {
      if (b.result === 'LOSS') { tempLoss++; maxLoss = Math.max(maxLoss, tempLoss); }
      else tempLoss = 0;
    }

    return { current, type, max_loss: maxLoss };
  }

  // ── UTILITAIRES ───────────────────────────────────────────────────────

  static _detectStrategy(betData) {
    for (const [key, strat] of Object.entries(STRATEGIES)) {
      if (strat.fn(betData)) return key;
    }
    return 'MANUAL';
  }

  static _americanToDecimal(american) {
    if (american > 0) return american / 100 + 1;
    return 100 / Math.abs(american) + 1;
  }

  static _americanToProb(american) {
    if (american > 0) return 100 / (american + 100);
    return Math.abs(american) / (Math.abs(american) + 100);
  }

  static _defaultState(initialBankroll = DEFAULT_BANKROLL) {
    return {
      initial_bankroll: initialBankroll,
      current_bankroll: initialBankroll,
      total_staked:     0,
      total_pnl:        0,
      bets:             [],
      metrics:          this._emptyMetrics(),
      created_at:       new Date().toISOString(),
      mode:             'PAPER', // PAPER | MICRO | KELLY
    };
  }

  static _emptyMetrics() {
    return {
      total_bets: 0, won: 0, lost: 0, push: 0,
      hit_rate: null, total_staked: 0, total_pnl: 0, roi: null,
      avg_clv: null, brier_score: null,
      hit_by_edge: { '5-8%': null, '8-12%': null, '>12%': null },
      bias: { insufficient_data: true, min_required: 10 },
      by_strategy: { A: null, B: null, C: null },
      streak: { current: 0, type: null, max_loss: 0 },
    };
  }
}
