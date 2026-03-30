/**
 * MANI BET PRO — ui.match-detail.js
 *
 * Fiche match détaillée.
 * Phase 1 : Bloc 1 (Résumé exécutif) + Bloc 2 (Signaux dominants).
 * Blocs 3 à 9 ajoutés en phases suivantes.
 *
 * Aucune donnée fictive.
 * Si l'analyse est absente ou INCONCLUSIVE, l'affichage l'indique clairement.
 */

import { store }      from '../state/store.js';
import { router }     from './ui.router.js';
import { EngineCore } from '../engine/engine.core.js';
import { Logger }     from '../utils/utils.logger.js';

// ── RENDER (export requis par le router) ─────────────────────────────────

export async function render(container, storeInstance) {
  const matchId = storeInstance.get('activeMatchId');

  if (!matchId) {
    renderNoMatch(container);
    return { destroy() {} };
  }

  const match = storeInstance.get('matches')?.[matchId];
  if (!match) {
    renderNoMatch(container);
    return { destroy() {} };
  }

  // Trouver l'analyse correspondante
  const analyses = storeInstance.get('analyses') ?? {};
  const analysis = Object.values(analyses).find(a => a.match_id === matchId) ?? null;

  container.innerHTML = renderShell(match, analysis);
  bindEvents(container, storeInstance, match, analysis);

  return { destroy() {} };
}

// ── SHELL PRINCIPAL ───────────────────────────────────────────────────────

function renderShell(match, analysis) {
  return `
    <div class="match-detail">

      <!-- Bouton retour -->
      <button class="btn btn--ghost back-btn" id="back-btn">
        ← Retour
      </button>

      <!-- En-tête match -->
      <div class="match-detail__header card">
        <div class="row row--between" style="margin-bottom: var(--space-3)">
          <span class="sport-tag sport-tag--${match.sport?.toLowerCase() ?? 'nba'}">${match.sport ?? 'NBA'}</span>
          <span class="text-muted" style="font-size: 12px;">${formatMatchTime(match)}</span>
        </div>

        <div class="match-detail__teams">
          <div class="match-detail__team">
            <div class="match-detail__team-abbr">${match.home_team?.abbreviation ?? '—'}</div>
            <div class="match-detail__team-name">${match.home_team?.name ?? '—'}</div>
            <div class="match-detail__team-role text-muted">Domicile</div>
          </div>

          <div class="match-detail__separator">
            <span class="match-detail__vs">VS</span>
          </div>

          <div class="match-detail__team match-detail__team--away">
            <div class="match-detail__team-abbr">${match.away_team?.abbreviation ?? '—'}</div>
            <div class="match-detail__team-name">${match.away_team?.name ?? '—'}</div>
            <div class="match-detail__team-role text-muted">Extérieur</div>
          </div>
        </div>
      </div>

      <!-- BLOC 1 : Résumé exécutif -->
      ${renderBloc1(analysis)}

      <!-- BLOC 2 : Signaux dominants -->
      ${renderBloc2(analysis)}

      <!-- Blocs futurs (placeholders) -->
      <div class="bloc-placeholder card">
        <div class="text-muted" style="font-size:12px; text-align:center; padding: var(--space-4) 0;">
          Blocs 3–9 disponibles en Phase 2
          <br><span style="font-size:11px">(Qualité données, Robustesse, Explication IA, Volatilité, Simulateur, Audit)</span>
        </div>
      </div>

    </div>
  `;
}

// ── BLOC 1 : RÉSUMÉ EXÉCUTIF ──────────────────────────────────────────────

function renderBloc1(analysis) {
  const interpretation = EngineCore.interpretConfidence(
    analysis?.confidence_level ?? 'INCONCLUSIVE'
  );

  const predictivePct  = analysis?.predictive_score  !== null
    ? Math.round(analysis.predictive_score  * 100)
    : null;

  const robustnessPct  = analysis?.robustness_score  !== null
    ? Math.round(analysis.robustness_score  * 100)
    : null;

  const dataQualityPct = analysis?.data_quality_score !== null
    ? Math.round(analysis.data_quality_score * 100)
    : null;

  const volatilityPct  = analysis?.volatility_index  !== null
    ? Math.round(analysis.volatility_index  * 100)
    : null;

  const robustnessClass = robustnessPct !== null
    ? (robustnessPct >= 75 ? 'text-success' : robustnessPct >= 50 ? 'text-warning' : 'text-danger')
    : 'text-muted';

  return `
    <div class="card match-detail__bloc" id="bloc-1">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">01</span>
        <span class="bloc-header__title">Résumé exécutif</span>
        <span class="badge ${interpretation.cssClass}">${interpretation.label}</span>
      </div>

      ${analysis?.rejection_reason ? `
        <div class="rejection-banner">
          <span class="rejection-banner__icon">⚠</span>
          <div>
            <div class="rejection-banner__title">Analyse non concluante</div>
            <div class="rejection-banner__reason text-muted">
              ${formatRejectionReason(analysis.rejection_reason)}
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Grille des 4 scores -->
      <div class="scores-grid">

        <div class="score-block score-block--signal">
          <div class="score-block__label">Signal prédictif</div>
          <div class="score-block__value ${predictivePct !== null ? 'text-signal' : 'text-muted'}">
            ${predictivePct !== null ? `${predictivePct}%` : '—'}
          </div>
          ${predictivePct !== null ? `
            <div class="score-bar score-bar--signal" style="margin-top: var(--space-2)">
              <div class="score-bar__track">
                <div class="score-bar__fill" style="width: ${predictivePct}%"></div>
              </div>
            </div>
          ` : `<div class="score-block__na">donnée non fournie ou non vérifiée</div>`}
        </div>

        <div class="score-block score-block--robust">
          <div class="score-block__label">Robustesse</div>
          <div class="score-block__value ${robustnessClass}">
            ${robustnessPct !== null ? `${robustnessPct}%` : '—'}
          </div>
          ${robustnessPct !== null ? `
            <div class="score-bar score-bar--robust" style="margin-top: var(--space-2)">
              <div class="score-bar__track">
                <div class="score-bar__fill" style="width: ${robustnessPct}%; background: ${
                  robustnessPct >= 75 ? 'var(--color-robust-high)'
                  : robustnessPct >= 50 ? 'var(--color-robust-mid)'
                  : 'var(--color-robust-low)'
                }"></div>
              </div>
            </div>
          ` : `<div class="score-block__na">donnée non fournie ou non vérifiée</div>`}
        </div>

        <div class="score-block score-block--data">
          <div class="score-block__label">Qualité données</div>
          <div class="score-block__value ${dataQualityPct !== null ? 'text-signal' : 'text-muted'}"
               style="${dataQualityPct !== null ? 'color: var(--color-data-quality)' : ''}">
            ${dataQualityPct !== null ? `${dataQualityPct}%` : '—'}
          </div>
          ${dataQualityPct !== null ? `
            <div class="score-bar score-bar--data" style="margin-top: var(--space-2)">
              <div class="score-bar__track">
                <div class="score-bar__fill" style="width: ${dataQualityPct}%"></div>
              </div>
            </div>
          ` : `<div class="score-block__na">donnée non fournie ou non vérifiée</div>`}
        </div>

        <div class="score-block score-block--volatility">
          <div class="score-block__label">Volatilité</div>
          <div class="score-block__value" style="color: var(--color-volatility)">
            ${volatilityPct !== null ? `${volatilityPct}%` : '—'}
          </div>
          ${volatilityPct !== null ? `
            <div class="score-bar score-bar--volatility" style="margin-top: var(--space-2)">
              <div class="score-bar__track">
                <div class="score-bar__fill" style="width: ${volatilityPct}%"></div>
              </div>
            </div>
          ` : `<div class="score-block__na">donnée non fournie ou non vérifiée</div>`}
        </div>

      </div>

      <!-- Données manquantes critiques -->
      ${renderMissingCritical(analysis)}

      <!-- Métadonnées -->
      <div class="bloc-meta text-muted">
        <span class="mono" style="font-size:10px">
          ${analysis?.computed_at
            ? `Calculé ${new Date(analysis.computed_at).toLocaleTimeString('fr-FR')}`
            : 'Non calculé'}
          ${analysis?.model_version ? ` · v${analysis.model_version}` : ''}
        </span>
      </div>
    </div>
  `;
}

// ── BLOC 2 : SIGNAUX DOMINANTS ────────────────────────────────────────────

function renderBloc2(analysis) {
  const signals = analysis?.key_signals ?? [];

  return `
    <div class="card match-detail__bloc" id="bloc-2">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">02</span>
        <span class="bloc-header__title">Signaux dominants</span>
        <span class="text-muted" style="font-size:11px">${signals.length} signal${signals.length > 1 ? 's' : ''}</span>
      </div>

      ${signals.length === 0 ? `
        <div class="empty-state" style="padding: var(--space-6) 0">
          <div class="empty-state__icon" style="font-size:20px">—</div>
          <div class="empty-state__text">
            ${analysis === null
              ? 'Analyse non disponible'
              : analysis.rejection_reason
                ? 'Aucun signal calculable — analyse rejetée'
                : 'Aucun signal significatif détecté'}
          </div>
        </div>
      ` : `
        <div class="signals-list stack stack--sm">
          ${signals.map(s => renderSignalRow(s)).join('')}
        </div>

        ${analysis?.weak_signals?.length > 0 ? `
          <div class="collapsible" id="weak-signals-collapsible">
            <div class="collapsible__header">
              <span class="text-muted" style="font-size:12px">
                ${analysis.weak_signals.length} signal${analysis.weak_signals.length > 1 ? 's' : ''} faible${analysis.weak_signals.length > 1 ? 's' : ''}
              </span>
              <span class="collapsible__arrow">▼</span>
            </div>
            <div class="collapsible__body">
              <div class="signals-list stack stack--sm" style="margin-top: var(--space-2)">
                ${analysis.weak_signals.map(s => renderSignalRow(s, true)).join('')}
              </div>
            </div>
          </div>
        ` : ''}
      `}
    </div>
  `;
}

function renderSignalRow(signal, weak = false) {
  const directionIcon  = signal.direction === 'POSITIVE' ? '▲'
                       : signal.direction === 'NEGATIVE' ? '▼'
                       : '■';
  const directionClass = signal.direction === 'POSITIVE' ? 'text-success'
                       : signal.direction === 'NEGATIVE' ? 'text-danger'
                       : 'text-muted';

  const contributionPct = signal.contribution !== null
    ? Math.round(Math.abs(signal.contribution) * 100)
    : null;

  const qualityBadge = signal.data_quality
    ? `<span class="badge badge--data" style="font-size:9px">${signal.data_quality}</span>`
    : '';

  return `
    <div class="signal-row ${weak ? 'signal-row--weak' : ''}">
      <div class="signal-row__direction ${directionClass}">${directionIcon}</div>
      <div class="signal-row__content">
        <div class="signal-row__label">
          ${signal.label ?? signal.variable}
          ${qualityBadge}
        </div>
        <div class="signal-row__why text-muted">${signal.why_signal ?? '—'}</div>
      </div>
      <div class="signal-row__contribution mono">
        ${contributionPct !== null ? `${contributionPct}%` : '—'}
      </div>
      ${contributionPct !== null ? `
        <div class="signal-row__bar">
          <div class="signal-row__bar-fill ${directionClass.replace('text-', 'fill-')}"
               style="width: ${Math.min(100, contributionPct * 5)}%"></div>
        </div>
      ` : ''}
    </div>
  `;
}

// ── DONNÉES MANQUANTES CRITIQUES ──────────────────────────────────────────

function renderMissingCritical(analysis) {
  const missing = analysis?.missing_critical ?? [];
  if (missing.length === 0) return '';

  return `
    <div class="missing-critical-alert">
      <div class="missing-critical-alert__title">
        ⚠ Données critiques manquantes (${missing.length})
      </div>
      <div class="missing-critical-alert__list">
        ${missing.map(m => `
          <div class="missing-item text-muted">
            · ${m} — donnée non fournie ou non vérifiée
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ── ÉVÉNEMENTS ────────────────────────────────────────────────────────────

function bindEvents(container, storeInstance, match, analysis) {
  // Bouton retour
  const backBtn = container.querySelector('#back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => router.navigate('dashboard'));
  }

  // Collapsibles
  container.querySelectorAll('.collapsible').forEach(el => {
    const header = el.querySelector('.collapsible__header');
    if (header) {
      header.addEventListener('click', () => {
        el.classList.toggle('open');
      });
    }
  });
}

// ── ÉTAT VIDE ─────────────────────────────────────────────────────────────

function renderNoMatch(container) {
  container.innerHTML = `
    <div class="view-placeholder">
      <div class="view-placeholder__icon">▦</div>
      <div class="view-placeholder__title">Aucun match sélectionné</div>
      <div class="view-placeholder__sub">
        Reviens au dashboard et sélectionne un match à analyser.
      </div>
      <button class="btn btn--ghost" id="back-from-empty">← Dashboard</button>
    </div>
  `;

  container.querySelector('#back-from-empty')?.addEventListener('click', () => {
    router.navigate('dashboard');
  });
}

// ── UTILITAIRES ───────────────────────────────────────────────────────────

function formatMatchTime(match) {
  if (!match.date) return '—';
  try {
    return new Date(match.date).toLocaleDateString('fr-FR', {
      weekday: 'short', day: 'numeric', month: 'short',
    }) + (match.time ? ` · ${match.time}` : '');
  } catch {
    return match.date;
  }
}

function formatRejectionReason(reason) {
  const labels = {
    WEIGHTS_NOT_CALIBRATED:          'Pondérations non calibrées — configurez les poids dans les réglages',
    MISSING_CRITICAL_DATA:           'Données critiques manquantes — impossible de calculer un score fiable',
    DATA_QUALITY_BELOW_THRESHOLD:    'Qualité des données insuffisante pour une analyse fiable',
    ROBUSTNESS_BELOW_THRESHOLD:      'Score trop sensible aux hypothèses — analyse non robuste',
    SPORT_NOT_SUPPORTED_OR_DISABLED: 'Ce sport n\'est pas activé en V1',
    ENGINE_NOT_IMPLEMENTED:          'Moteur non encore implémenté pour ce sport',
    ABSENCES_NOT_CONFIRMED:          'Statut des absences non confirmé — trop d\'incertitude',
    PITCHER_NOT_CONFIRMED:           'Pitcher titulaire non confirmé — rejet automatique',
  };
  return labels[reason] ?? reason;
}
