/**
 * MANI BET PRO — ui.dashboard.js
 *
 * Vue Dashboard.
 * Affiche les matchs du jour par sport avec statuts analytiques.
 * Aucune donnée fictive — état vide si aucune donnée disponible.
 */

import { store }       from '../state/store.js';
import { router }      from './ui.router.js';
import { ProviderNBA } from '../providers/provider.nba.js';
import { EngineCore }  from '../engine/engine.core.js';
import { Logger }      from '../utils/utils.logger.js';

// Date du jour au format YYYY-MM-DD
function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

// ── RENDER (export requis par le router) ─────────────────────────────────

export async function render(container, storeInstance) {
  container.innerHTML = renderShell();
  bindFilterEvents(container, storeInstance);
  await loadMatches(container, storeInstance);

  return {
    destroy() {
      // Nettoyage si nécessaire (listeners, timers)
    },
  };
}

// ── SHELL HTML ────────────────────────────────────────────────────────────

function renderShell() {
  const today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return `
    <div class="dashboard">

      <!-- En-tête -->
      <div class="page-header">
        <div class="page-header__eyebrow">Mani Bet Pro</div>
        <div class="page-header__title">Dashboard</div>
        <div class="page-header__sub">${today}</div>
      </div>

      <!-- Résumé du jour -->
      <div class="dashboard__summary" id="day-summary">
        <div class="summary-card" id="summary-total">
          <div class="summary-card__value">—</div>
          <div class="summary-card__label">Matchs chargés</div>
        </div>
        <div class="summary-card summary-card--success" id="summary-conclusive">
          <div class="summary-card__value">—</div>
          <div class="summary-card__label">Concluants</div>
        </div>
        <div class="summary-card summary-card--muted" id="summary-rejected">
          <div class="summary-card__value">—</div>
          <div class="summary-card__label">Rejetés</div>
        </div>
      </div>

      <!-- Filtres -->
      <div class="dashboard__filters" id="dashboard-filters">
        <div class="filter-row">
          <span class="filter-label">Sport</span>
          <div class="filter-chips" id="filter-sports">
            <button class="chip chip--active" data-sport="ALL">Tous</button>
            <button class="chip" data-sport="NBA">NBA</button>
            <button class="chip" data-sport="TENNIS">Tennis</button>
            <button class="chip" data-sport="MLB">MLB</button>
          </div>
        </div>
        <div class="filter-row">
          <span class="filter-label">Statut</span>
          <div class="filter-chips" id="filter-status">
            <button class="chip chip--active" data-status="ALL">Tous</button>
            <button class="chip" data-status="CONCLUSIVE">Concluants</button>
            <button class="chip" data-status="INCONCLUSIVE">Inconclus</button>
          </div>
        </div>
      </div>

      <!-- Liste matchs -->
      <div class="dashboard__matches" id="matches-list">
        <div class="loading-state" id="matches-loader">
          <div class="loader__spinner"></div>
          <span class="text-muted" style="font-size:13px">Chargement des matchs…</span>
        </div>
      </div>

    </div>
  `;
}

// ── CHARGEMENT DES MATCHS ─────────────────────────────────────────────────

async function loadMatches(container, storeInstance) {
  const loader = container.querySelector('#matches-loader');
  const list   = container.querySelector('#matches-list');

  try {
    const date = getTodayDate();

    // Charger les matchs NBA (seul sport V1)
    const nbaData = await ProviderNBA.getMatchesToday(date);

    if (!nbaData || !nbaData.matches || nbaData.matches.length === 0) {
      renderEmptyState(list);
      updateSummary(container, 0, 0, 0);
      return;
    }

    // Stocker les matchs dans le store
    nbaData.matches.forEach(match => {
      storeInstance.upsert('matches', match.id, { ...match, sport: 'NBA' });
    });

    // Lancer les analyses (sans bloquer l'UI — résultats affichés au fil de l'eau)
    renderMatchCards(list, nbaData.matches, storeInstance);
    await analyzeMatchesBatch(list, nbaData.matches, storeInstance, container);

  } catch (err) {
    Logger.error('DASHBOARD_LOAD_ERROR', { message: err.message });
    renderError(list);
  }
}

// ── ANALYSE EN LOT ────────────────────────────────────────────────────────

async function analyzeMatchesBatch(list, matches, storeInstance, container) {
  let conclusive = 0;
  let rejected   = 0;

  // Analyser les 3 premiers matchs en priorité (prefetch intelligent)
  const priority = matches.slice(0, 3);
  const rest     = matches.slice(3);

  for (const match of [...priority, ...rest]) {
    try {
      const rawData = await buildMatchRawData(match);
      const analysis = EngineCore.compute('NBA', rawData);

      storeInstance.upsert('analyses', analysis.analysis_id, {
        ...analysis,
        match_id: match.id,
      });

      // Mettre à jour la carte
      updateMatchCard(list, match.id, analysis);

      if (analysis.confidence_level === 'INCONCLUSIVE') rejected++;
      else conclusive++;

      updateSummary(container, matches.length, conclusive, rejected);

    } catch (err) {
      Logger.warn('MATCH_ANALYSIS_ERROR', { matchId: match.id, message: err.message });
    }
  }
}

// ── CONSTRUCTION DES DONNÉES BRUTES ──────────────────────────────────────

/**
 * Construit le rawData à passer au moteur à partir d'un match.
 * Charge les stats des deux équipes.
 * Si une requête échoue → null (pas de valeur inventée).
 */
async function buildMatchRawData(match) {
  const season = getCurrentNBASeason();

  const [
    homeStats,
    awayStats,
    homeRecent,
    awayRecent,
    homeHomeStats,
    awayAwayStats,
    homeInjuries,
    awayInjuries,
  ] = await Promise.allSettled([
    ProviderNBA.getTeamStats(match.home_team.id, 'SEASON',  season),
    ProviderNBA.getTeamStats(match.away_team.id, 'SEASON',  season),
    ProviderNBA.getTeamStats(match.home_team.id, 'LAST_10', season),
    ProviderNBA.getTeamStats(match.away_team.id, 'LAST_10', season),
    ProviderNBA.getTeamStats(match.home_team.id, 'HOME',    season),
    ProviderNBA.getTeamStats(match.away_team.id, 'AWAY',    season),
    ProviderNBA.getInjuries(match.home_team.id),
    ProviderNBA.getInjuries(match.away_team.id),
  ]);

  return {
    match_id:             match.id,
    home_team_stats:      homeStats.status    === 'fulfilled' ? homeStats.value    : null,
    away_team_stats:      awayStats.status    === 'fulfilled' ? awayStats.value    : null,
    home_team_recent:     homeRecent.status   === 'fulfilled' ? homeRecent.value   : null,
    away_team_recent:     awayRecent.status   === 'fulfilled' ? awayRecent.value   : null,
    home_team_home_stats: homeHomeStats.status=== 'fulfilled' ? homeHomeStats.value: null,
    away_team_away_stats: awayAwayStats.status=== 'fulfilled' ? awayAwayStats.value: null,
    injuries: {
      home: homeInjuries.status === 'fulfilled' ? homeInjuries.value?.players : null,
      away: awayInjuries.status === 'fulfilled' ? awayInjuries.value?.players : null,
    },
    context: {
      home_days_rest:        null,   // Non disponible sans schedule complet
      away_days_rest:        null,
    },
    h2h:                  null,      // H2H non chargé en dashboard (lazy)
    absences_confirmed:   null,      // Non confirmé sans source dédiée
    pitcher_confirmed:    null,      // N/A NBA
  };
}

// ── RENDU DES CARTES MATCHS ───────────────────────────────────────────────

function renderMatchCards(list, matches, storeInstance) {
  // Supprimer le loader
  list.innerHTML = '';

  if (matches.length === 0) {
    renderEmptyState(list);
    return;
  }

  const fragment = document.createDocumentFragment();

  matches.forEach(match => {
    const card = createMatchCard(match);
    fragment.appendChild(card);
  });

  list.appendChild(fragment);
}

function createMatchCard(match) {
  const card = document.createElement('div');
  card.className = 'match-card';
  card.dataset.matchId = match.id;

  const time = match.time
    ? new Date(`${match.date}T${match.time}`).toLocaleTimeString('fr-FR', {
        hour: '2-digit', minute: '2-digit'
      })
    : '—';

  card.innerHTML = `
    <div class="match-card__header">
      <span class="sport-tag sport-tag--nba">NBA</span>
      <span class="match-card__time text-muted">${time}</span>
      <span class="match-card__status-badge badge badge--inconclusive" id="status-${match.id}">
        Analyse…
      </span>
    </div>

    <div class="match-card__teams">
      <div class="match-card__team">
        <span class="match-card__team-abbr">${match.home_team.abbreviation ?? '—'}</span>
        <span class="match-card__team-name truncate">${match.home_team.name ?? '—'}</span>
        <span class="match-card__team-label text-muted">DOM</span>
      </div>
      <div class="match-card__vs">VS</div>
      <div class="match-card__team match-card__team--away">
        <span class="match-card__team-abbr">${match.away_team.abbreviation ?? '—'}</span>
        <span class="match-card__team-name truncate">${match.away_team.name ?? '—'}</span>
        <span class="match-card__team-label text-muted">EXT</span>
      </div>
    </div>

    <!-- Barres de scores — remplies après analyse -->
    <div class="match-card__scores" id="scores-${match.id}">
      <div class="score-bar score-bar--signal">
        <div class="score-bar__header">
          <span class="score-bar__label">Signal</span>
          <span class="score-bar__value text-muted mono">—</span>
        </div>
        <div class="score-bar__track">
          <div class="score-bar__fill" style="width: 0%"></div>
        </div>
      </div>
      <div class="score-bar score-bar--robust">
        <div class="score-bar__header">
          <span class="score-bar__label">Robustesse</span>
          <span class="score-bar__value text-muted mono">—</span>
        </div>
        <div class="score-bar__track">
          <div class="score-bar__fill" style="width: 0%"></div>
        </div>
      </div>
    </div>

    <!-- Bouton analyser -->
    <button class="btn btn--ghost match-card__cta" data-match-id="${match.id}">
      → Analyser
    </button>
  `;

  // Navigation vers la fiche match
  card.querySelector('.match-card__cta').addEventListener('click', (e) => {
    e.stopPropagation();
    const matchId = e.currentTarget.dataset.matchId;
    router.navigate('match', { matchId });
  });

  return card;
}

/**
 * Met à jour une carte match après analyse.
 * @param {HTMLElement} list
 * @param {string} matchId
 * @param {AnalysisOutput} analysis
 */
function updateMatchCard(list, matchId, analysis) {
  const statusBadge = list.querySelector(`#status-${matchId}`);
  const scoresBlock = list.querySelector(`#scores-${matchId}`);

  if (!statusBadge || !scoresBlock) return;

  const interpretation = EngineCore.interpretConfidence(analysis.confidence_level);

  // Badge statut
  statusBadge.textContent  = interpretation.label;
  statusBadge.className    = `match-card__status-badge badge ${interpretation.cssClass}`;

  // Barres de scores
  const bars = scoresBlock.querySelectorAll('.score-bar');

  // Barre Signal
  if (bars[0] && analysis.predictive_score !== null) {
    const pct = Math.round(analysis.predictive_score * 100);
    bars[0].querySelector('.score-bar__value').textContent = `${pct}%`;
    bars[0].querySelector('.score-bar__fill').style.width  = `${pct}%`;
    bars[0].querySelector('.score-bar__value').className   = `score-bar__value mono text-signal`;
  }

  // Barre Robustesse
  if (bars[1] && analysis.robustness_score !== null) {
    const pct = Math.round(analysis.robustness_score * 100);
    const robClass = analysis.robustness_score >= 0.75 ? 'text-success'
                   : analysis.robustness_score >= 0.50 ? 'text-warning'
                   : 'text-danger';
    bars[1].querySelector('.score-bar__value').textContent = `${pct}%`;
    bars[1].querySelector('.score-bar__fill').style.width  = `${pct}%`;
    bars[1].querySelector('.score-bar__value').className   = `score-bar__value mono ${robClass}`;

    // Couleur dynamique de la fill robustesse
    const fill = bars[1].querySelector('.score-bar__fill');
    fill.style.background = analysis.robustness_score >= 0.75
      ? 'var(--color-robust-high)'
      : analysis.robustness_score >= 0.50
        ? 'var(--color-robust-mid)'
        : 'var(--color-robust-low)';
  }

  // Motif de rejet si inconclus
  if (analysis.rejection_reason) {
    const rejectionEl = document.createElement('div');
    rejectionEl.className = 'match-card__rejection text-muted';
    rejectionEl.textContent = `↳ ${formatRejectionReason(analysis.rejection_reason)}`;
    scoresBlock.after(rejectionEl);
  }
}

// ── RÉSUMÉ DU JOUR ────────────────────────────────────────────────────────

function updateSummary(container, total, conclusive, rejected) {
  const totalEl      = container.querySelector('#summary-total .summary-card__value');
  const conclusiveEl = container.querySelector('#summary-conclusive .summary-card__value');
  const rejectedEl   = container.querySelector('#summary-rejected .summary-card__value');

  if (totalEl)      totalEl.textContent      = total;
  if (conclusiveEl) conclusiveEl.textContent = conclusive;
  if (rejectedEl)   rejectedEl.textContent   = rejected;
}

// ── FILTRES ───────────────────────────────────────────────────────────────

function bindFilterEvents(container, storeInstance) {
  // Délégation d'événements sur les chips
  container.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;

    const parent = chip.closest('.filter-chips');
    if (!parent) return;

    // Désactiver tous les chips du groupe
    parent.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
    chip.classList.add('chip--active');

    const sport  = chip.dataset.sport;
    const status = chip.dataset.status;

    if (sport)  applyFilter(container, storeInstance, 'sport', sport);
    if (status) applyFilter(container, storeInstance, 'status', status);
  });
}

function applyFilter(container, storeInstance, filterType, value) {
  const cards = container.querySelectorAll('.match-card');

  cards.forEach(card => {
    const matchId  = card.dataset.matchId;
    const match    = storeInstance.get('matches')?.[matchId];
    const analyses = storeInstance.get('analyses') ?? {};

    // Trouver l'analyse correspondante
    const analysis = Object.values(analyses).find(a => a.match_id === matchId);

    let visible = true;

    if (filterType === 'sport' && value !== 'ALL') {
      visible = match?.sport === value;
    }

    if (filterType === 'status' && value !== 'ALL') {
      if (!analysis) {
        visible = false;
      } else if (value === 'CONCLUSIVE') {
        visible = analysis.confidence_level !== 'INCONCLUSIVE';
      } else if (value === 'INCONCLUSIVE') {
        visible = analysis.confidence_level === 'INCONCLUSIVE';
      }
    }

    card.style.display = visible ? '' : 'none';
  });
}

// ── ÉTATS VIDES ET ERREURS ───────────────────────────────────────────────

function renderEmptyState(container) {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">◎</div>
      <div class="empty-state__text">
        Aucun match trouvé pour aujourd'hui.<br>
        Vérifie la connexion au Worker Cloudflare.
      </div>
    </div>
  `;
}

function renderError(container) {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">⚠</div>
      <div class="empty-state__text">
        Erreur lors du chargement des matchs.<br>
        Consulte la console pour plus de détails.
      </div>
    </div>
  `;
}

// ── UTILITAIRES ───────────────────────────────────────────────────────────

function getCurrentNBASeason() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;  // 1-12
  // La saison NBA commence en octobre
  return month >= 10
    ? `${year}-${String(year + 1).slice(2)}`
    : `${year - 1}-${String(year).slice(2)}`;
}

function formatRejectionReason(reason) {
  const labels = {
    WEIGHTS_NOT_CALIBRATED:       'Pondérations non calibrées',
    MISSING_CRITICAL_DATA:        'Données critiques manquantes',
    DATA_QUALITY_BELOW_THRESHOLD: 'Qualité des données insuffisante',
    ROBUSTNESS_BELOW_THRESHOLD:   'Robustesse insuffisante',
    SPORT_NOT_SUPPORTED_OR_DISABLED: 'Sport non activé',
    ENGINE_NOT_IMPLEMENTED:       'Moteur non implémenté',
    ABSENCES_NOT_CONFIRMED:       'Absences non confirmées',
    PITCHER_NOT_CONFIRMED:        'Pitcher non confirmé',
  };
  return labels[reason] ?? reason;
}
