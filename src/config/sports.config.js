/**
 * MANI BET PRO — sports.config.js
 *
 * Configuration analytique par sport.
 * Toutes les pondérations et seuils sont null par défaut.
 * Ils doivent être calibrés empiriquement par l'utilisateur.
 * Aucune valeur inventée.
 */

export const APP_CONFIG = {
  VERSION: '0.1.0',
  NAME: 'Mani Bet Pro',
  GITHUB_PAGES_URL: 'https://emmanueldelasse-droid.github.io/mani-bet-pro',
};

export const SPORTS_CONFIG = {

  // ── NBA ─────────────────────────────────────────────────────────────────
  NBA: {
    label: 'NBA',
    enabled: true,
    sport_tag_class: 'sport-tag--nba',

    /**
     * Variables utilisées par le moteur.
     * Ordre = ordre de traitement.
     * critical: true = rejet si donnée absente
     */
    variables: [
      { id: 'net_rating_diff',   label: 'Net Rating différentiel',    critical: true  },
      { id: 'recent_form_ema',   label: 'Forme récente (EMA)',         critical: true  },
      { id: 'rest_advantage',    label: 'Avantage repos',              critical: false },
      { id: 'absences_impact',   label: 'Impact absences',             critical: true  },
      { id: 'home_away_split',   label: 'Domicile / Extérieur',        critical: false },
      { id: 'h2h_recent',        label: 'H2H récent',                  critical: false },
      { id: 'pace_diff',         label: 'Différentiel de Pace',        critical: false },
    ],

    /**
     * Pondérations par défaut — null = non calibré.
     * La somme doit être égale à 1.0 une fois définies.
     */
    default_weights: {
      net_rating_diff:  null,
      recent_form_ema:  null,
      rest_advantage:   null,
      absences_impact:  null,
      home_away_split:  null,
      h2h_recent:       null,
      pace_diff:        null,
    },

    /**
     * Paramètres du modèle forme récente.
     * ema_lambda : facteur de décroissance exponentielle [0.5, 0.99]
     * Proche de 1 = matchs récents très dominants
     * Proche de 0.5 = pondération plus plate
     */
    ema_lambda: null,

    /**
     * Seuils de rejet — null = non défini, rejet désactivé pour cette règle.
     */
    rejection_thresholds: {
      min_robustness:       null,  // Score robustesse minimum
      min_data_quality:     null,  // Score qualité données minimum
      min_games_sample:     5,     // Nombre minimum de matchs pour calculer les stats
      require_absences_confirmed: true,  // Rejet si absences non confirmées
    },

    /**
     * Seuils de perturbation pour l'analyse de robustesse.
     * Définit l'amplitude des perturbations appliquées aux variables.
     */
    sensitivity_steps: [-0.20, -0.10, 0.10, 0.20],

    /**
     * Niveau de bruit intrinsèque du sport (informatif, non calculé).
     * LOW | MEDIUM | HIGH | VERY_HIGH
     */
    intrinsic_noise: 'LOW',

    /**
     * Modélisabilité estimée du sport.
     * LOW | MEDIUM | HIGH
     */
    modelisability: 'HIGH',

    /**
     * Variables à désactiver par défaut dans le simulateur.
     */
    simulator_defaults: {
      use_h2h:        true,
      use_pace:       true,
      use_rest:       true,
      use_absences:   true,
    },
  },

  // ── TENNIS ──────────────────────────────────────────────────────────────
  TENNIS: {
    label: 'Tennis ATP/WTA',
    enabled: true,
    sport_tag_class: 'sport-tag--tennis',

    variables: [
      { id: 'surface_winrate_diff', label: 'Win rate surface',          critical: true  },
      { id: 'recent_form_ema',      label: 'Forme récente (EMA)',        critical: true  },
      { id: 'h2h_surface',          label: 'H2H sur même surface',       critical: false },
      { id: 'service_dominance',    label: 'Dominance au service',       critical: false },
      { id: 'fatigue_index',        label: 'Indice de fatigue',          critical: false },
      { id: 'ranking_elo_diff',     label: 'Différentiel Elo / Ranking', critical: false },
    ],

    default_weights: {
      surface_winrate_diff: null,
      recent_form_ema:      null,
      h2h_surface:          null,
      service_dominance:    null,
      fatigue_index:        null,
      ranking_elo_diff:     null,
    },

    ema_lambda: null,

    rejection_thresholds: {
      min_robustness:        null,
      min_data_quality:      null,
      min_games_sample:      8,
      min_h2h_same_surface:  2,  // H2H ignoré si < 2 matchs sur la surface
    },

    sensitivity_steps: [-0.20, -0.10, 0.10, 0.20],
    intrinsic_noise: 'MEDIUM',
    modelisability: 'HIGH',

    simulator_defaults: {
      use_h2h:            true,
      use_fatigue:        true,
      use_service_stats:  true,
    },
  },

  // ── MLB ─────────────────────────────────────────────────────────────────
  MLB: {
    label: 'MLB',
    enabled: true,
    sport_tag_class: 'sport-tag--mlb',

    variables: [
      { id: 'pitcher_fip_diff',  label: 'FIP différentiel pitchers',   critical: true  },
      { id: 'lineup_wrc_diff',   label: 'wRC+ différentiel lineups',   critical: true  },
      { id: 'bullpen_era_7d',    label: 'ERA Bullpen 7 derniers jours', critical: false },
      { id: 'park_factor',       label: 'Park factor stade',            critical: false },
      { id: 'home_away_split',   label: 'Domicile / Extérieur',         critical: false },
      { id: 'rest_pitcher',      label: 'Repos pitcher titulaire',      critical: false },
    ],

    default_weights: {
      pitcher_fip_diff: null,
      lineup_wrc_diff:  null,
      bullpen_era_7d:   null,
      park_factor:      null,
      home_away_split:  null,
      rest_pitcher:     null,
    },

    ema_lambda: null,

    rejection_thresholds: {
      min_robustness:            null,
      min_data_quality:          null,
      min_games_sample:          10,
      require_pitcher_confirmed: true,  // Rejet immédiat si pitcher non confirmé
      max_bullpen_data_age_days: 7,     // Warning si données bullpen > 7 jours
    },

    sensitivity_steps: [-0.20, -0.10, 0.10, 0.20],
    intrinsic_noise: 'MEDIUM',
    modelisability: 'HIGH',

    simulator_defaults: {
      use_park_factor:  true,
      use_bullpen:      true,
      use_rest:         true,
    },
  },

  // ── FOOTBALL (V2 — désactivé en V1) ─────────────────────────────────────
  FOOTBALL: {
    label: 'Football (EPL / La Liga)',
    enabled: false,  // Activé en V2
    sport_tag_class: 'sport-tag--football',

    variables: [
      { id: 'xg_diff',           label: 'xG différentiel',             critical: true  },
      { id: 'xga_diff',          label: 'xGA différentiel',            critical: true  },
      { id: 'recent_form_ema',   label: 'Forme récente (EMA)',          critical: true  },
      { id: 'home_away_split',   label: 'Domicile / Extérieur',         critical: true  },
      { id: 'absences_impact',   label: 'Impact absences',              critical: false },
      { id: 'calendar_fatigue',  label: 'Fatigue calendrier',           critical: false },
    ],

    default_weights: {
      xg_diff:          null,
      xga_diff:         null,
      recent_form_ema:  null,
      home_away_split:  null,
      absences_impact:  null,
      calendar_fatigue: null,
    },

    ema_lambda: null,

    rejection_thresholds: {
      min_robustness:    null,
      min_data_quality:  null,
      min_games_sample:  4,
    },

    sensitivity_steps: [-0.25, -0.10, 0.10, 0.25],

    /**
     * Avertissement obligatoire : le football est structurellement
     * plus bruité que les autres sports couverts.
     * Ce flag force l'affichage d'un disclaimer dans l'UI.
     */
    high_noise_disclaimer: true,
    intrinsic_noise: 'HIGH',
    modelisability: 'MEDIUM',

    simulator_defaults: {
      use_h2h:           false,  // H2H peu fiable en football
      use_xg:            true,
      use_home_away:     true,
    },
  },

};

/**
 * Retourne la config d'un sport ou null si non trouvé / désactivé.
 * @param {string} sport — clé sport (NBA, TENNIS, MLB, FOOTBALL)
 * @returns {object|null}
 */
export function getSportConfig(sport) {
  const config = SPORTS_CONFIG[sport];
  if (!config) return null;
  if (!config.enabled) return null;
  return config;
}

/**
 * Retourne la liste des sports activés.
 * @returns {string[]}
 */
export function getEnabledSports() {
  return Object.entries(SPORTS_CONFIG)
    .filter(([, cfg]) => cfg.enabled)
    .map(([key]) => key);
}
