/**
 * MANI BET PRO — engine.nba.js
 *
 * Moteur analytique NBA.
 * Calcul déterministe pur — aucune donnée inventée.
 * Si une variable est null → déclarée manquante, jamais imputée.
 *
 * Toutes les pondérations null = non calibrées.
 * Le moteur refuse de calculer un score sur des poids non définis.
 */

import { SPORTS_CONFIG } from '../config/sports.config.js';
import { Logger } from '../utils/utils.logger.js';

const CONFIG = SPORTS_CONFIG.NBA;

export class EngineNBA {

  /**
   * Point d'entrée principal du moteur NBA.
   *
   * @param {NBAMatchData} matchData — données brutes normalisées du provider
   * @param {object|null} customWeights — pondérations personnalisées (simulateur)
   * @returns {NBAEngineResult}
   */
  static compute(matchData, customWeights = null) {
    const weights = customWeights ?? CONFIG.default_weights;

    // 1. Extraire et valider les variables
    const variables = this._extractVariables(matchData);

    // 2. Identifier les données manquantes
    const { missing, missingCritical } = this._assessMissing(variables);

    // 3. Vérifier si les poids sont calibrés
    const uncalibratedWeights = Object.entries(weights)
      .filter(([, v]) => v === null)
      .map(([k]) => k);

    // 4. Calculer le score si possible
    let score = null;
    let signals = [];
    let volatility = null;
    let scoreMethod = null;

    if (uncalibratedWeights.length === Object.keys(weights).length) {
      // Aucun poids calibré — impossible de scorer
      scoreMethod = 'UNCALIBRATED';
    } else if (missingCritical.length > 0) {
      // Données critiques manquantes — impossible de scorer
      scoreMethod = 'MISSING_CRITICAL';
    } else {
      const computed = this._computeScore(variables, weights);
      score        = computed.score;
      signals      = computed.signals;
      volatility   = computed.volatility;
      scoreMethod  = 'WEIGHTED_SUM';
    }

    const result = {
      sport:            'NBA',
      score,
      score_method:     scoreMethod,
      signals,
      volatility,
      missing_variables: missing,
      missing_critical:  missingCritical,
      uncalibrated_weights: uncalibratedWeights,
      variables_used:    variables,
      computed_at:       new Date().toISOString(),
    };

    Logger.debug('ENGINE_NBA_RESULT', {
      score,
      method: scoreMethod,
      missing_count: missing.length,
      critical_missing: missingCritical.length,
    });

    return result;
  }

  // ── EXTRACTION DES VARIABLES ─────────────────────────────────────────

  /**
   * Extrait et normalise les variables à partir des données brutes.
   * Toute valeur absente → null avec source tracée.
   *
   * @param {NBAMatchData} data
   * @returns {NBAVariables}
   */
  static _extractVariables(data) {
    const home = data?.home_team_stats;
    const away = data?.away_team_stats;
    const homeRecent = data?.home_team_recent;
    const awayRecent = data?.away_team_recent;
    const injuries = data?.injuries;
    const context = data?.context;

    return {

      // ── Net Rating différentiel ──────────────────────────────────────
      // Différence entre le net rating domicile et extérieur.
      // Positif = avantage équipe domicile.
      net_rating_diff: this._safeDiff(
        home?.stats?.net_rating,
        away?.stats?.net_rating,
        'net_rating_diff',
        home?.source,
        away?.source
      ),

      // ── Forme récente (EMA) ──────────────────────────────────────────
      // Moyenne exponentielle pondérée des résultats récents.
      // Calculée séparément, différentiel exprimé ici.
      recent_form_ema: this._safeEMADiff(
        homeRecent,
        awayRecent,
        CONFIG.ema_lambda
      ),

      // ── Avantage repos ───────────────────────────────────────────────
      // Différence en jours de repos depuis le dernier match.
      // Positif = équipe domicile plus reposée.
      rest_advantage: this._computeRestAdvantage(
        context?.home_days_rest,
        context?.away_days_rest
      ),

      // ── Impact absences ──────────────────────────────────────────────
      // Score d'impact estimé des absences sur chaque équipe.
      // Basé sur minutes perdues (USG% concerné si disponible).
      absences_impact: this._computeAbsencesImpact(
        injuries?.home,
        injuries?.away
      ),

      // ── Split domicile / extérieur ───────────────────────────────────
      // Net rating de l'équipe dans son contexte (dom/ext) spécifique.
      home_away_split: this._safeDiff(
        data?.home_team_home_stats?.stats?.net_rating,
        data?.away_team_away_stats?.stats?.net_rating,
        'home_away_split',
        data?.home_team_home_stats?.source,
        data?.away_team_away_stats?.source
      ),

      // ── H2H récent ───────────────────────────────────────────────────
      // Bilan des N dernières confrontations directes.
      // Ignoré si sample < min_games_sample config.
      h2h_recent: this._computeH2H(data?.h2h),

      // ── Pace différentiel ────────────────────────────────────────────
      // Contextuellement pertinent pour les totaux (O/U).
      pace_diff: this._safeDiff(
        home?.stats?.pace,
        away?.stats?.pace,
        'pace_diff',
        home?.source,
        away?.source
      ),

    };
  }

  // ── CALCUL DU SCORE ───────────────────────────────────────────────────

  /**
   * Calcule le score prédictif par somme pondérée.
   * N'utilise que les variables disponibles (non null).
   * Ajuste les poids en conséquence (renormalisation).
   *
   * @param {NBAVariables} variables
   * @param {object} weights
   * @returns {{ score: number, signals: Signal[], volatility: number|null }}
   */
  static _computeScore(variables, weights) {
    let weightedSum  = 0;
    let totalWeight  = 0;
    const signals    = [];

    // Normaliser chaque variable sur [-1, +1] avant pondération
    const normalizedVars = this._normalizeVariables(variables);

    for (const [varId, normalizedValue] of Object.entries(normalizedVars)) {
      if (normalizedValue === null) continue;

      const weight = weights[varId];
      if (weight === null || weight === undefined) continue;

      const contribution = normalizedValue * weight;
      weightedSum  += contribution;
      totalWeight  += weight;

      const varConfig = CONFIG.variables.find(v => v.id === varId);

      signals.push({
        variable:     varId,
        label:        varConfig?.label ?? varId,
        raw_value:    variables[varId]?.value ?? null,
        normalized:   normalizedValue,
        weight,
        contribution,
        direction:    contribution > 0 ? 'POSITIVE' : contribution < 0 ? 'NEGATIVE' : 'NEUTRAL',
        data_source:  variables[varId]?.source ?? null,
        data_quality: variables[varId]?.quality ?? null,
        why_signal:   this._explainSignal(varId, normalizedValue, contribution),
      });
    }

    // Renormalisation si des poids ont été exclus (variables manquantes)
    const score = totalWeight > 0
      ? (weightedSum / totalWeight + 1) / 2   // Ramené sur [0, 1]
      : null;

    // Trier les signaux par contribution absolue décroissante
    signals.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    return {
      score: score !== null ? Math.round(score * 1000) / 1000 : null,
      signals,
      volatility: this._estimateVolatility(variables),
    };
  }

  // ── NORMALISATION ─────────────────────────────────────────────────────

  /**
   * Normalise les variables brutes sur [-1, +1].
   * Les plages de normalisation sont des références empiriques à calibrer.
   * Marqué "non garanti" — ajuster selon les données réelles observées.
   *
   * Valeur positive = avantage équipe domicile (convention).
   */
  static _normalizeVariables(variables) {
    return {
      // Net rating diff : plage typique NBA [-15, +15] — non garanti
      net_rating_diff: this._clampNormalize(
        variables.net_rating_diff?.value, -15, 15
      ),

      // Forme récente EMA : déjà sur [-1, +1] si correctement calculé
      recent_form_ema: variables.recent_form_ema?.value ?? null,

      // Rest advantage : plage [-3, +3] jours — non garanti
      rest_advantage: this._clampNormalize(
        variables.rest_advantage?.value, -3, 3
      ),

      // Absences impact : sur [-1, 0] (pénalité)
      // Valeur positive = l'équipe adverse est plus touchée
      absences_impact: variables.absences_impact?.value ?? null,

      // Home/away split : même plage que net rating
      home_away_split: this._clampNormalize(
        variables.home_away_split?.value, -15, 15
      ),

      // H2H : déjà normalisé sur [-1, +1] par _computeH2H
      h2h_recent: variables.h2h_recent?.value ?? null,

      // Pace diff : peu pertinent pour résultat, plus pour totaux
      pace_diff: this._clampNormalize(
        variables.pace_diff?.value, -10, 10
      ),
    };
  }

  /**
   * Normalise une valeur dans une plage [min, max] vers [-1, +1].
   * @param {number|null} value
   * @param {number} min
   * @param {number} max
   * @returns {number|null}
   */
  static _clampNormalize(value, min, max) {
    if (value === null || value === undefined) return null;
    const clamped = Math.max(min, Math.min(max, value));
    return (clamped - (min + max) / 2) / ((max - min) / 2);
  }

  // ── CALCULS SPÉCIFIQUES ───────────────────────────────────────────────

  static _safeDiff(homeVal, awayVal, varId, homeSource, awaySource) {
    if (homeVal === null || homeVal === undefined ||
        awayVal === null || awayVal === undefined) {
      return {
        value:   null,
        source:  `${homeSource ?? 'non fournie'} / ${awaySource ?? 'non fournie'}`,
        quality: 'MISSING',
      };
    }

    return {
      value:   homeVal - awayVal,
      source:  homeSource ?? awaySource ?? 'non fournie',
      quality: homeSource && awaySource ? 'VERIFIED' : 'PARTIAL',
    };
  }

  /**
   * Calcule la différence EMA de forme récente entre deux équipes.
   * EMA = Exponential Moving Average sur les résultats (1=victoire, 0=défaite).
   * @param {object|null} homeRecent — { games: [{won: boolean}] }
   * @param {object|null} awayRecent
   * @param {number|null} lambda
   * @returns {VariableResult}
   */
  static _safeEMADiff(homeRecent, awayRecent, lambda) {
    if (!homeRecent?.matches || !awayRecent?.matches) {
      return { value: null, source: 'non fournie', quality: 'MISSING' };
    }

    if (lambda === null) {
      return { value: null, source: homeRecent.source ?? 'non fournie', quality: 'UNCALIBRATED' };
    }

    const homeEMA = this._computeEMA(homeRecent.matches, lambda);
    const awayEMA = this._computeEMA(awayRecent.matches, lambda);

    if (homeEMA === null || awayEMA === null) {
      return { value: null, source: 'non fournie', quality: 'INSUFFICIENT_SAMPLE' };
    }

    return {
      value:   homeEMA - awayEMA,   // Sur [-1, +1]
      source:  homeRecent.source ?? 'non fournie',
      quality: homeRecent.matches.length >= CONFIG.rejection_thresholds.min_games_sample
        ? 'VERIFIED' : 'LOW_SAMPLE',
    };
  }

  /**
   * Calcule l'EMA d'une série de résultats (1=victoire, 0=défaite).
   * Les matchs sont ordonnés du plus récent au plus ancien.
   * @param {Array<{won: boolean}>} matches
   * @param {number} lambda
   * @returns {number|null}
   */
  static _computeEMA(matches, lambda) {
    if (!matches || matches.length === 0) return null;

    let ema = null;
    let weight = 1;
    let totalWeight = 0;

    // Du plus récent au plus ancien
    for (const match of matches) {
      if (match.won === null || match.won === undefined) continue;
      const result = match.won ? 1 : 0;

      if (ema === null) {
        ema = result;
        totalWeight = weight;
      } else {
        ema = ema + weight * (result - ema) / (totalWeight + weight);
        totalWeight += weight;
      }

      weight *= (1 - lambda);
      if (weight < 0.001) break;   // Troncature : poids négligeable
    }

    return ema;   // Sur [0, 1], converti en [-1, +1] dans _clampNormalize
  }

  static _computeRestAdvantage(homeDaysRest, awayDaysRest) {
    if (homeDaysRest === null || homeDaysRest === undefined ||
        awayDaysRest === null || awayDaysRest === undefined) {
      return { value: null, source: 'non fournie', quality: 'MISSING' };
    }

    return {
      value:   homeDaysRest - awayDaysRest,
      source:  'context',
      quality: 'VERIFIED',
    };
  }

  /**
   * Estime l'impact des absences.
   * Méthode simple : nombre de joueurs absents pondéré par leur statut.
   * À affiner avec les minutes (USG%) quand disponibles.
   *
   * @param {Array|null} homeInjuries
   * @param {Array|null} awayInjuries
   * @returns {VariableResult}
   */
  static _computeAbsencesImpact(homeInjuries, awayInjuries) {
    if (!homeInjuries || !awayInjuries) {
      return { value: null, source: 'non fournie', quality: 'MISSING' };
    }

    const STATUS_WEIGHTS = {
      'Out':          1.0,
      'Doubtful':     0.75,
      'Questionable': 0.5,
      'Probable':     0.1,
    };

    const scoreTeam = (players) => players.reduce((acc, p) => {
      return acc + (STATUS_WEIGHTS[p.status] ?? 0);
    }, 0);

    const homeScore = scoreTeam(homeInjuries);
    const awayScore = scoreTeam(awayInjuries);

    // Positif = l'équipe extérieure est plus touchée (avantage domicile)
    // Normalisé approximativement sur [-1, +1] (plage [−5, +5] typique)
    const diff = awayScore - homeScore;
    const normalized = Math.max(-1, Math.min(1, diff / 5));

    return {
      value:   normalized,
      source:  'injuries_data',
      quality: 'ESTIMATED',   // Méthode simple sans USG%
      raw: { home_score: homeScore, away_score: awayScore },
    };
  }

  static _computeH2H(h2hData) {
    if (!h2hData?.games || h2hData.games.length === 0) {
      return { value: null, source: 'non fournie', quality: 'MISSING' };
    }

    if (h2hData.games.length < 2) {
      return { value: null, source: h2hData.source, quality: 'INSUFFICIENT_SAMPLE' };
    }

    const homeWins = h2hData.games.filter(g => g.home_won).length;
    const total    = h2hData.games.length;

    // Sur [-1, +1] : 1 = toutes les victoires à domicile
    const value = (homeWins / total) * 2 - 1;

    return {
      value,
      source:  h2hData.source ?? 'non fournie',
      quality: total >= 5 ? 'VERIFIED' : 'LOW_SAMPLE',
      sample:  total,
    };
  }

  // ── VOLATILITÉ ────────────────────────────────────────────────────────

  /**
   * Estime l'indice de volatilité du match.
   * Facteurs : back-to-back, absences importantes, faible sample size.
   * Sur [0, 1] : 1 = très volatile.
   */
  static _estimateVolatility(variables) {
    let volatility = 0.2;   // Niveau de base NBA = relativement faible

    // Back-to-back d'une des deux équipes
    const rest = variables.rest_advantage?.value;
    if (rest !== null && Math.abs(rest) >= 1) {
      volatility += 0.15;
    }

    // Absences importantes
    const absences = variables.absences_impact?.value;
    if (absences !== null && Math.abs(absences) > 0.5) {
      volatility += 0.15;
    }

    // Faible qualité des données → incertitude accrue
    const hasLowQuality = Object.values(variables)
      .some(v => v?.quality === 'LOW_SAMPLE' || v?.quality === 'ESTIMATED');
    if (hasLowQuality) {
      volatility += 0.10;
    }

    return Math.min(1, Math.round(volatility * 100) / 100);
  }

  // ── ÉVALUATION DONNÉES MANQUANTES ────────────────────────────────────

  static _assessMissing(variables) {
    const missing = [];
    const missingCritical = [];

    for (const varConfig of CONFIG.variables) {
      const variable = variables[varConfig.id];
      const isMissing = !variable || variable.value === null ||
                        variable.quality === 'MISSING';

      if (isMissing) {
        missing.push(varConfig.id);
        if (varConfig.critical) {
          missingCritical.push(varConfig.id);
        }
      }
    }

    return { missing, missingCritical };
  }

  // ── EXPLICATIONS SIGNAUX ──────────────────────────────────────────────

  /**
   * Génère une explication textuelle courte du signal.
   * Utilisé pour préparer le contexte IA — aucune valeur inventée.
   */
  static _explainSignal(varId, normalized, contribution) {
    const direction = contribution > 0 ? 'en faveur de l\'équipe domicile'
                    : contribution < 0 ? 'en faveur de l\'équipe extérieure'
                    : 'neutre';

    const intensity = Math.abs(normalized) > 0.6 ? 'fort'
                    : Math.abs(normalized) > 0.3 ? 'modéré'
                    : 'faible';

    const labels = {
      net_rating_diff:  `Signal ${intensity} ${direction} basé sur le différentiel de Net Rating`,
      recent_form_ema:  `Forme récente (EMA) ${intensity} ${direction}`,
      rest_advantage:   `Avantage repos ${intensity} ${direction}`,
      absences_impact:  `Impact absences ${intensity} ${direction}`,
      home_away_split:  `Split domicile/extérieur ${intensity} ${direction}`,
      h2h_recent:       `Historique H2H ${intensity} ${direction}`,
      pace_diff:        `Différentiel de pace ${intensity} (contextuel)`,
    };

    return labels[varId] ?? `Variable ${varId} — signal ${intensity} ${direction}`;
  }
}
