/**
 * MANI BET PRO — ui.match-detail.js v3
 *
 * Fiche match complète — Blocs 01 à 07.
 *
 * CORRECTIONS v3 :
 *   - WORKER_URL importé depuis api.config.js (plus de hardcoding)
 *   - Appel IA passe par ai.client.js + ai.guard.js (plus de fetch direct)
 *   - PaperEngine.loadAsync() au lieu de load() synchrone pour la bankroll Kelly
 *   - spread_line transmis dans data-attributes du bouton paper-bet-btn
 *   - Imports réorganisés en tête de fichier (plus de déclaration avant import)
 *   - Noms d'équipes échappés via escapeHtml dans innerHTML
 */

import { router }        from './ui.router.js';
import { EngineCore }    from '../engine/engine.core.js';
import { PaperEngine }   from '../paper/paper.engine.js';
import { ProviderNBA }   from '../providers/provider.nba.js';
import { AIClient }      from '../ai/ai.client.js';
import { Logger }        from '../utils/utils.logger.js';
import { API_CONFIG }    from '../config/api.config.js';
import {
  americanToDecimal,
  decimalToAmerican,
  formatAmerican,
} from '../utils/utils.odds.js';

const WORKER_URL = API_CONFIG.WORKER_BASE_URL;

// ── RENDER ────────────────────────────────────────────────────────────────

export async function render(container, storeInstance) {
  const matchId = storeInstance.get('activeMatchId');

  if (!matchId) { _renderNoMatch(container); return { destroy() {} }; }

  const match = storeInstance.get('matches')?.[matchId];
  if (!match) { _renderNoMatch(container); return { destroy() {} }; }

  const analyses = storeInstance.get('analyses') ?? {};
  const analysis = Object.values(analyses).find(a => a.match_id === matchId) ?? null;

  container.innerHTML = _renderShell(match, analysis);
  _bindEvents(container, storeInstance, match, analysis);

  // Cotes multi-books en arrière-plan (non bloquant)
  _loadAndRenderMultiBookOdds(container, match, analysis);

  return { destroy() {} };
}

// ── SHELL ─────────────────────────────────────────────────────────────────

function _renderShell(match, analysis) {
  return `
    <div class="match-detail">

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
        <button class="btn btn--ghost back-btn" id="back-btn">← Retour</button>
        <button class="btn btn--ghost" id="share-btn" style="font-size:12px">📤 Partager</button>
      </div>

      <div class="match-detail__header card">
        <div class="row row--between" style="margin-bottom:var(--space-3)">
          <span class="sport-tag sport-tag--nba">NBA</span>
          <span class="text-muted" style="font-size:12px">${_formatMatchTime(match)}</span>
        </div>

        <div class="match-detail__teams">
          <div class="match-detail__team">
            <div class="match-detail__team-abbr">${escapeHtml(match.home_team?.abbreviation ?? '—')}</div>
            <div class="match-detail__team-name">${escapeHtml(match.home_team?.name ?? '—')}</div>
            <div class="match-detail__team-role text-muted">Domicile</div>
            <div class="text-muted mono" style="font-size:11px">${match.home_team?.record ?? ''}</div>
          </div>
          <div class="match-detail__separator">
            <span class="match-detail__vs">VS</span>
          </div>
          <div class="match-detail__team match-detail__team--away">
            <div class="match-detail__team-abbr">${escapeHtml(match.away_team?.abbreviation ?? '—')}</div>
            <div class="match-detail__team-name">${escapeHtml(match.away_team?.name ?? '—')}</div>
            <div class="match-detail__team-role text-muted">Extérieur</div>
            <div class="text-muted mono" style="font-size:11px">${match.away_team?.record ?? ''}</div>
          </div>
        </div>

        ${match.odds ? _renderOddsBar(match.odds) : ''}
      </div>

      ${_renderBloc07(analysis, match)}
      ${_renderBloc01(analysis, match)}
      ${_renderBloc02(analysis)}
      ${_renderBloc03(analysis, match)}
      ${_renderBloc04(analysis)}
      ${_renderBloc05(analysis, match)}
      ${_renderBloc06(analysis)}

    </div>
  `;
}

// ── COTES ─────────────────────────────────────────────────────────────────

function _renderOddsBar(odds) {
  const spread = odds.spread != null
    ? (odds.spread > 0 ? `+${odds.spread}` : String(odds.spread))
    : '—';
  const ou     = odds.over_under ?? '—';
  const homeML = formatAmerican(odds.home_ml);
  const awayML = formatAmerican(odds.away_ml);

  return `
    <div class="odds-bar" style="margin-top:var(--space-3);display:flex;gap:16px;flex-wrap:wrap">
      <span class="text-muted" style="font-size:11px">📊 DraftKings</span>
      <span class="mono" style="font-size:11px">Spread <strong>${spread}</strong></span>
      <span class="mono" style="font-size:11px">O/U <strong>${ou}</strong></span>
      <span class="mono" style="font-size:11px">DOM <strong>${homeML}</strong></span>
      <span class="mono" style="font-size:11px">EXT <strong>${awayML}</strong></span>
    </div>
  `;
}

// ── BLOC 01 : VERDICT ORIENTÉ DÉCISION ────────────────────────────────────

function _renderBloc01(analysis, match) {
  if (!analysis || analysis.predictive_score === null) {
    return `
      <div class="card match-detail__bloc" id="bloc-1">
        <div class="bloc-header">
          <span class="bloc-header__number mono text-muted">01</span>
          <span class="bloc-header__title">Verdict</span>
          <span class="badge badge--inconclusive">Inconclus</span>
        </div>
        <div class="text-muted" style="font-size:13px;padding:var(--space-3) 0">
          ${analysis?.rejection_reason ? _formatRejection(analysis.rejection_reason) : 'Données insuffisantes.'}
        </div>
      </div>`;
  }

  const decision    = analysis.decision ?? _legacyDecision(analysis);
  const decisionCfg = _decisionConfig(decision);

  const homeProb = Math.round(analysis.predictive_score * 100);
  const awayProb = 100 - homeProb;
  const homeName = escapeHtml(match?.home_team?.name ?? 'Domicile');
  const awayName = escapeHtml(match?.away_team?.name ?? 'Extérieur');

  // Cote équitable
  const fairHome = homeProb > 0 ? (100 / homeProb).toFixed(2) : '—';
  const fairAway = awayProb > 0 ? (100 / awayProb).toFixed(2) : '—';

  const best       = analysis.betting_recommendations?.best;
  const hasBet     = best && best.edge >= 5;
  const dataQ      = analysis.data_quality_score ?? 0;
  const edge       = best?.edge ?? 0;

  // Probabilités marché vig-free
  const mktHome = analysis.betting_recommendations?.market_prob_home;
  const mktAway = analysis.betting_recommendations?.market_prob_away;

  return `
    <div class="card match-detail__bloc" id="bloc-1">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">01</span>
        <span class="bloc-header__title">Verdict</span>
        <span style="font-size:13px;font-weight:700;color:${decisionCfg.color}">
          ${decisionCfg.icon} ${decision}
        </span>
      </div>

      ${_renderDataIncompleteWarning(analysis)}

      <!-- Probabilités moteur vs marché -->
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin-bottom:16px">

        <div style="text-align:left">
          <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">${homeName}</div>
          <div style="font-size:28px;font-weight:700;color:${homeProb >= awayProb ? 'var(--color-signal)' : 'var(--color-muted)'}">
            ${homeProb}%
          </div>
          ${mktHome != null ? `
            <div style="font-size:11px;color:var(--color-muted)">
              Marché ${Math.round(mktHome * 100)}%
            </div>` : ''}
          <div style="font-size:10px;color:var(--color-muted)">Cote équitable ${fairHome}</div>
        </div>

        <div style="text-align:center;color:var(--color-muted);font-size:13px">vs</div>

        <div style="text-align:right">
          <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">${awayName}</div>
          <div style="font-size:28px;font-weight:700;color:${awayProb > homeProb ? 'var(--color-signal)' : 'var(--color-muted)'}">
            ${awayProb}%
          </div>
          ${mktAway != null ? `
            <div style="font-size:11px;color:var(--color-muted)">
              Marché ${Math.round(mktAway * 100)}%
            </div>` : ''}
          <div style="font-size:10px;color:var(--color-muted)">Cote équitable ${fairAway}</div>
        </div>
      </div>

      <!-- Barre de probabilité -->
      <div style="height:6px;border-radius:3px;overflow:hidden;background:var(--color-border);margin-bottom:12px">
        <div style="height:100%;width:${homeProb}%;background:var(--color-signal);border-radius:3px"></div>
      </div>

      ${hasBet ? `
        <div style="
          background:rgba(${decision === 'ANALYSER' ? '34,197,94' : '245,158,11'},0.08);
          border-left:3px solid ${decisionCfg.color};
          border-radius:var(--radius-sm);
          padding:10px 12px;
          font-size:12px;
          margin-bottom:12px;
        ">
          <div style="font-weight:600;color:${decisionCfg.color};margin-bottom:4px">
            ${decisionCfg.icon} ${decision}
          </div>
          <div style="color:var(--color-muted)">
            Edge : <strong style="color:var(--color-text)">+${edge}%</strong>
            · Qualité données : <strong style="color:var(--color-text)">${Math.round(dataQ * 100)}%</strong>
            ${dataQ < 0.80 ? ' · <span style="color:var(--color-warning)">⚠ Données incomplètes</span>' : ''}
          </div>
        </div>
      ` : `
        <div style="font-size:12px;color:var(--color-muted);margin-bottom:12px">
          Aucun edge suffisant détecté sur ce match.
        </div>
      `}

      <div class="bloc-meta text-muted">
        <span class="mono" style="font-size:10px">
          ${analysis.computed_at ? `Calculé ${new Date(analysis.computed_at).toLocaleTimeString('fr-FR')}` : ''}
          ${analysis.model_version ? ` · v${analysis.model_version}` : ''}
        </span>
      </div>
    </div>
  `;
}

// ── BLOC 02 : SIGNAUX DOMINANTS ────────────────────────────────────────────

function _renderBloc02(analysis) {
  const signals = analysis?.key_signals ?? [];

  return `
    <div class="card match-detail__bloc" id="bloc-2">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">02</span>
        <span class="bloc-header__title">Pourquoi ce favori ?</span>
        <span class="text-muted" style="font-size:11px">${signals.length} signal${signals.length !== 1 ? 's' : ''}</span>
      </div>

      ${signals.length === 0 ? `
        <div class="empty-state" style="padding:var(--space-5) 0">
          <div class="empty-state__text text-muted">
            ${!analysis ? 'Analyse non disponible'
              : analysis.rejection_reason ? 'Aucun signal calculable — analyse rejetée'
              : 'Aucun signal significatif'}
          </div>
        </div>
      ` : `
        <div class="signals-list stack stack--sm">
          ${signals.map(s => _renderSignalRow(s)).join('')}
        </div>

        ${analysis?.weak_signals?.length > 0 ? `
          <div class="collapsible" id="weak-signals">
            <div class="collapsible__header">
              <span class="text-muted" style="font-size:12px">
                ${analysis.weak_signals.length} signal${analysis.weak_signals.length !== 1 ? 's' : ''} faible${analysis.weak_signals.length !== 1 ? 's' : ''}
              </span>
              <span class="collapsible__arrow">▾</span>
            </div>
            <div class="collapsible__body">
              <div class="signals-list stack stack--sm" style="margin-top:var(--space-2)">
                ${analysis.weak_signals.map(s => _renderSignalRow(s, true)).join('')}
              </div>
            </div>
          </div>
        ` : ''}
      `}
    </div>
  `;
}

function _renderSignalRow(signal, weak = false) {
  const icon = signal.direction === 'POSITIVE' ? '▲' : signal.direction === 'NEGATIVE' ? '▼' : '■';
  const cls  = signal.direction === 'POSITIVE' ? 'text-success' : signal.direction === 'NEGATIVE' ? 'text-danger' : 'text-muted';
  const cPct = signal.contribution !== null ? Math.round(Math.abs(signal.contribution) * 100) : null;

  return `
    <div class="signal-row ${weak ? 'signal-row--weak' : ''}">
      <div class="signal-row__direction ${cls}">${icon}</div>
      <div class="signal-row__content">
        <div class="signal-row__label">
          ${escapeHtml(signal.label ?? signal.variable)}
          ${signal.data_quality ? `<span class="badge badge--data" style="font-size:9px">${signal.data_quality}</span>` : ''}
        </div>
        <div class="signal-row__why text-muted">${escapeHtml(signal.why_signal ?? '—')}</div>
      </div>
      <div class="signal-row__contribution mono">${cPct !== null ? `${cPct}%` : '—'}</div>
      ${cPct !== null ? `
        <div class="signal-row__bar">
          <div class="signal-row__bar-fill fill-${signal.direction === 'POSITIVE' ? 'success' : signal.direction === 'NEGATIVE' ? 'danger' : 'muted'}"
            style="width:${Math.min(100, cPct * 4)}%"></div>
        </div>
      ` : '<div></div>'}
    </div>
  `;
}

// ── BLOC 03 : QUALITÉ DES DONNÉES ─────────────────────────────────────────

function _renderBloc03(analysis, match) {
  const breakdown = analysis?.data_quality_breakdown?.breakdown ?? {};
  const fields    = Object.entries(breakdown);

  const QUALITY_LABELS = {
    VERIFIED:            { label: 'Vérifié',    cls: 'text-success' },
    PARTIAL:             { label: 'Partiel',     cls: 'text-warning' },
    ESTIMATED:           { label: 'Estimé',      cls: 'text-warning' },
    LOW_SAMPLE:          { label: 'Faible N',    cls: 'text-warning' },
    UNCALIBRATED:        { label: 'Non calibré', cls: 'text-muted'   },
    INSUFFICIENT_SAMPLE: { label: 'Insuff.',     cls: 'text-danger'  },
    MISSING:             { label: 'Absent',      cls: 'text-danger'  },
  };

  return `
    <div class="card match-detail__bloc" id="bloc-3">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">03</span>
        <span class="bloc-header__title">Sources utilisées</span>
        ${analysis?.data_quality_score != null
          ? `<span class="mono" style="color:var(--color-data-quality);font-size:13px">
               ${Math.round(analysis.data_quality_score * 100)}%
             </span>`
          : ''}
      </div>

      ${!fields.length ? `
        <div class="text-muted" style="font-size:12px">Qualité non calculée — analyse non disponible.</div>
      ` : `
        <div class="data-quality-table">
          ${fields.map(([varId, d]) => {
            const q = QUALITY_LABELS[d.quality] ?? { label: d.quality, cls: 'text-muted' };
            return `
              <div class="dq-row">
                <div style="flex:1">
                  <span style="font-size:12px">${escapeHtml(d.label)}</span>
                  ${d.critical ? '<span class="badge badge--warning" style="font-size:9px">CRITIQUE</span>' : ''}
                </div>
                <span class="${q.cls} mono" style="font-size:11px;min-width:80px;text-align:right">${q.label}</span>
                <span class="text-muted mono" style="font-size:10px;min-width:90px;text-align:right">${escapeHtml(d.source ?? '—')}</span>
              </div>
            `;
          }).join('')}
        </div>
        <div class="text-muted" style="font-size:10px;margin-top:var(--space-4);line-height:1.6">
          Sources : ESPN Scoreboard · BallDontLie v1 · PDF NBA officiel
        </div>
      `}
    </div>
  `;
}

// ── BLOC 04 : ROBUSTESSE ──────────────────────────────────────────────────

function _renderBloc04(analysis) {
  const rb = analysis?.robustness_breakdown;

  return `
    <div class="card match-detail__bloc" id="bloc-4">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">04</span>
        <span class="bloc-header__title">Stabilité de l'analyse</span>
        ${rb?.score != null
          ? `<span class="mono ${rb.score >= 0.75 ? 'text-success' : rb.score >= 0.50 ? 'text-warning' : 'text-danger'}" style="font-size:13px">
               ${Math.round(rb.score * 100)}%
             </span>`
          : ''}
      </div>

      ${!rb || rb.score === null ? `
        <div class="text-muted" style="font-size:12px">Robustesse non calculable — score prédictif absent.</div>
      ` : `
        ${rb.critical_variables?.length > 0 ? `
          <div style="margin-bottom:var(--space-3);padding:var(--space-3);background:rgba(249,115,22,0.08);border-radius:var(--radius-sm);font-size:12px">
            ⚠ Variables critiques : ${rb.critical_variables.join(', ')}
          </div>
        ` : ''}

        ${rb.reversal_threshold ? `
          <div style="margin-bottom:var(--space-3);padding:var(--space-3);background:rgba(239,68,68,0.08);border-radius:var(--radius-sm);font-size:12px">
            ↻ Renversement si <strong>${rb.reversal_threshold.variable}</strong>
            varie de <strong>${rb.reversal_threshold.step_pct > 0 ? '+' : ''}${rb.reversal_threshold.step_pct}%</strong>
          </div>
        ` : `
          <div class="text-muted" style="font-size:11px;margin-bottom:var(--space-3)">
            ✓ Aucun renversement détecté (±10%, ±20%).
          </div>
        `}

        <div class="sensitivity-table">
          <div class="text-muted" style="font-size:10px;display:flex;justify-content:space-between;padding:0 4px">
            <span>Variable</span><span>Δmax score</span>
          </div>
          ${(rb.sensitivities ?? [])
            .filter(s => s.available)
            .sort((a, b) => (b.max_delta ?? 0) - (a.max_delta ?? 0))
            .map(s => {
              const d      = s.max_delta ?? 0;
              const barPct = Math.min(100, d * 600);
              const cls    = d > 0.15 ? 'text-danger' : d > 0.08 ? 'text-warning' : 'text-success';
              return `
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="flex:1;font-size:11px">${escapeHtml(s.label)}</span>
                  <div style="width:80px;height:4px;background:var(--color-border);border-radius:2px;overflow:hidden">
                    <div style="height:100%;width:${barPct}%;background:var(--color-${d > 0.15 ? 'danger' : d > 0.08 ? 'warning' : 'success'})"></div>
                  </div>
                  <span class="mono ${cls}" style="font-size:11px;min-width:40px;text-align:right">
                    ${(d * 100).toFixed(1)}%
                  </span>
                </div>
              `;
            }).join('')}
        </div>
        <div class="text-muted" style="font-size:10px;margin-top:var(--space-3)">
          Perturbation ±10% ±20% par variable. Score = 1 − Δmax.
        </div>
      `}
    </div>
  `;
}

// ── BLOC 05 : EXPLICATION IA ──────────────────────────────────────────────

function _renderBloc05(analysis, match) {
  const canCallAI = analysis && analysis.confidence_level !== null && analysis.explanation_context;

  return `
    <div class="card match-detail__bloc" id="bloc-5">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">05</span>
        <span class="bloc-header__title">Analyse IA</span>
      </div>

      <div id="ai-content">
        ${!canCallAI ? `
          <div class="text-muted" style="font-size:12px">Analyse non disponible pour ce match.</div>
        ` : `
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:var(--space-3)">
            <button class="btn btn--primary" data-ai-task="EXPLAIN" id="btn-ai-explain">
              💬 Expliquer ce match
            </button>
            <button class="btn btn--ghost btn--sm" data-ai-task="AUDIT">
              🔍 Cohérence
            </button>
            <button class="btn btn--ghost btn--sm" data-ai-task="DETECT_INCONSISTENCY">
              ⚡ Anomalies
            </button>
          </div>
          <div id="ai-response" class="ai-response text-muted">
            Clique sur "Expliquer ce match" pour obtenir une analyse.
          </div>
        `}
      </div>
    </div>
  `;
}

// ── BLOC 06 : VOLATILITÉ ──────────────────────────────────────────────────

function _renderBloc06(analysis) {
  const vi = analysis?.volatility_index;

  const volLevel = vi === null ? null
    : vi >= 0.6 ? { label: 'Élevée',  cls: 'text-danger',  desc: "Match potentiellement imprévisible." }
    : vi >= 0.4 ? { label: 'Modérée', cls: 'text-warning', desc: "Facteurs d'incertitude présents." }
    :             { label: 'Faible',   cls: 'text-success', desc: "Contexte relativement stable." };

  return `
    <div class="card match-detail__bloc" id="bloc-6">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">06</span>
        <span class="bloc-header__title">Niveau d'incertitude</span>
        ${volLevel ? `<span class="${volLevel.cls} mono" style="font-size:13px">${Math.round(vi * 100)}%</span>` : ''}
      </div>

      ${vi === null ? `
        <div class="text-muted" style="font-size:12px">Volatilité non calculée.</div>
      ` : `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:var(--space-3)">
          <div>
            <div style="font-size:28px;font-weight:700;color:var(--color-${vi >= 0.6 ? 'danger' : vi >= 0.4 ? 'warning' : 'success'})">${Math.round(vi * 100)}%</div>
            <div class="${volLevel.cls}" style="font-size:13px;font-weight:500">${volLevel.label}</div>
          </div>
          <div style="flex:1">
            <div class="score-bar__track">
              <div class="score-bar__fill" style="width:${Math.round(vi * 100)}%;background:var(--color-${vi >= 0.6 ? 'danger' : vi >= 0.4 ? 'warning' : 'success'})"></div>
            </div>
          </div>
        </div>
        <div class="text-muted" style="font-size:12px;margin-bottom:var(--space-3)">${volLevel.desc}</div>
        <div class="context-factors">
          ${_renderContextFactor('Bruit intrinsèque NBA', 'Faible — signal stable sur 82 matchs', 'LOW')}
          ${_renderContextFactor('Modélisabilité', 'Élevée — statistiques ESPN disponibles', 'HIGH')}
          ${_renderContextFactor('Sources actives', 'ESPN · BallDontLie · PDF NBA', 'INFO')}
        </div>
        <div class="text-muted" style="font-size:10px;margin-top:var(--space-3)">
          Volatilité estimée. Non calibrée sur données historiques — indicatif.
        </div>
      `}
    </div>
  `;
}

// ── BLOC 07 : RECOMMANDATIONS PARIS ───────────────────────────────────────

function _renderBloc07(analysis, match) {
  const betting = analysis?.betting_recommendations;
  const odds    = match?.odds;

  if (!odds) {
    return `
      <div class="card match-detail__bloc" id="bloc-7">
        <div class="bloc-header">
          <span class="bloc-header__number mono text-muted">07</span>
          <span class="bloc-header__title">Recommandations paris</span>
        </div>
        <div class="text-muted" style="font-size:13px;padding:var(--space-3) 0">
          Cotes non disponibles.
        </div>
      </div>`;
  }

  if (!betting?.recommendations?.length) {
    return `
      <div class="card match-detail__bloc" id="bloc-7">
        <div class="bloc-header">
          <span class="bloc-header__number mono text-muted">07</span>
          <span class="bloc-header__title">Recommandations paris</span>
        </div>
        <div class="text-muted" style="font-size:13px;padding:var(--space-3) 0">
          Aucune opportunité détectée.
        </div>
      </div>`;
  }

  const best      = betting.best;
  const SIDE_LABELS = {
    HOME:  escapeHtml(match?.home_team?.name ?? 'Domicile'),
    AWAY:  escapeHtml(match?.away_team?.name ?? 'Extérieur'),
    OVER:  'Over',
    UNDER: 'Under',
  };
  const CONF_COLORS = {
    FORTE:   'var(--color-success)',
    MOYENNE: 'var(--color-warning)',
    FAIBLE:  'var(--color-muted)',
  };
  const marketLabel = {
    MONEYLINE:  'Vainqueur du match',
    SPREAD:     'Handicap (spread)',
    OVER_UNDER: 'Total de points',
  };

  const motorFavorite = analysis?.predictive_score != null
    ? (analysis.predictive_score > 0.5
        ? escapeHtml(match?.home_team?.name ?? 'Domicile')
        : escapeHtml(match?.away_team?.name ?? 'Extérieur'))
    : null;

  const rows = betting.recommendations.map(r => {
    const sideLabel   = SIDE_LABELS[r.side] ?? r.side;
    const isBest      = best && r.type === best.type && r.side === best.side;
    const confColor   = CONF_COLORS[r.confidence] ?? 'var(--color-muted)';
    const oddsDecimal = americanToDecimal(r.odds_line);

    // "Pourquoi" en prose — sans chiffres inventés
    let whyText = null;
    if (r.type === 'MONEYLINE' && r.motor_prob != null) {
      const isUnderdog = motorFavorite && sideLabel !== motorFavorite;
      if (isUnderdog) {
        whyText = `${motorFavorite} est favori selon le moteur, mais sa cote ne reflète pas suffisamment cet avantage. ${sideLabel} à ${oddsDecimal ?? r.odds_line} offre une valeur détectée de +${r.edge}%.`;
      } else {
        whyText = `Le moteur estime ${r.motor_prob}% de chances pour ${sideLabel}. Le marché n'intègre que ${r.implied_prob}% — écart de +${r.edge}%.`;
      }
    } else if (r.type === 'SPREAD') {
      whyText = `Spread ${r.spread_line > 0 ? '+' : ''}${r.spread_line} pts · cote ${r.odds_decimal ?? oddsDecimal} (${r.odds_source}) · edge +${r.edge}%.`;
    } else if (r.type === 'OVER_UNDER') {
      whyText = `${r.note ?? `Projection moteur ${r.motor_prob} pts · ligne ${r.ou_line} pts · cote ${r.odds_decimal} (${r.odds_source})`}`;
    }

    return `
      <div class="betting-row${isBest ? ' betting-row--best' : ''}" style="
        background:var(--color-bg);
        border-radius:var(--radius-md);
        padding:14px;
        margin-bottom:10px;
        border:1px solid ${isBest ? 'var(--color-success)' : 'var(--color-border)'};
      ">
        ${isBest ? '<div style="font-size:10px;color:var(--color-success);font-weight:700;margin-bottom:8px;letter-spacing:0.05em">★ MEILLEUR PARI DU MATCH</div>' : ''}

        <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin-bottom:10px">
          <span style="font-size:10px;color:var(--color-muted);align-self:center">PARIER SUR</span>
          <span style="font-size:15px;font-weight:700">${sideLabel}</span>

          <span style="font-size:10px;color:var(--color-muted);align-self:center">MARCHÉ</span>
          <span style="font-size:12px">${marketLabel[r.type] ?? r.type}</span>

          <span style="font-size:10px;color:var(--color-muted);align-self:center">COTE</span>
          <span style="font-size:18px;font-weight:700;color:var(--color-signal)">
            ${r.type === 'SPREAD'
              ? `${r.spread_line > 0 ? '+' : ''}${r.spread_line} · ${r.odds_decimal ?? oddsDecimal ?? '—'}`
              : r.type === 'OVER_UNDER'
              ? `${r.side === 'OVER' ? 'Over' : 'Under'} ${r.ou_line} · ${r.odds_decimal ?? oddsDecimal ?? '—'}`
              : oddsDecimal ?? '—'}
            ${r.odds_source ? `<span style="font-size:10px;color:var(--color-muted);margin-left:6px">${r.odds_source}</span>` : ''}
          </span>

          <span style="font-size:10px;color:var(--color-muted);align-self:center">EDGE</span>
          <span style="font-size:13px;font-weight:600;color:${confColor}">+${r.edge}%</span>

          ${whyText ? `
          <span style="font-size:10px;color:var(--color-muted);align-self:flex-start;padding-top:2px">POURQUOI</span>
          <span style="font-size:12px;color:var(--color-muted);line-height:1.5">${escapeHtml(whyText)}</span>
          ` : ''}
        </div>

        <button class="btn btn--primary paper-bet-btn" style="width:100%;padding:10px;font-size:13px;font-weight:600"
          data-market="${r.type}"
          data-side="${r.side}"
          data-side-label="${escapeHtml(sideLabel)}"
          data-odds="${r.odds_line}"
          data-spread-line="${r.spread_line ?? ''}"
          data-edge="${r.edge}"
          data-motor-prob="${r.motor_prob}"
          data-implied-prob="${r.implied_prob}"
          data-kelly="${r.kelly_stake ?? 0}"
        >
          📋 Enregistrer ce pari
        </button>
      </div>`;
  }).join('');

  return `
    <div class="card match-detail__bloc" id="bloc-7">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">07</span>
        <span class="bloc-header__title">Recommandations paris</span>
        <span class="text-muted" style="font-size:11px">
          ${betting.recommendations.length} marché${betting.recommendations.length > 1 ? 's' : ''} analysé${betting.recommendations.length > 1 ? 's' : ''}
        </span>
      </div>

      <div class="text-muted" style="font-size:11px;margin-bottom:var(--space-3);padding:var(--space-2);border-left:2px solid var(--color-border)">
        Un pari de valeur n'est pas forcément sur le favori — c'est le pari dont la cote sous-estime les vraies chances. Mise calculée selon Kelly Criterion (Kelly/4, max 5% bankroll).
      </div>

      <div class="betting-list">${rows}</div>
    </div>`;
}

// ── COTES MULTI-BOOKS ─────────────────────────────────────────────────────

async function _loadAndRenderMultiBookOdds(container, match, analysis) {
  try {
    const comparison = await ProviderNBA.getOddsComparison();
    if (!comparison) return;

    const matchOdds = ProviderNBA.findMatchOdds(
      comparison, match.home_team?.name, match.away_team?.name
    );
    if (!matchOdds?.bookmakers?.length) return;

    const bloc7 = container.querySelector('#bloc-7');
    if (!bloc7) return;

    const existing = bloc7.querySelector('.multibook-table');
    if (existing) existing.remove();

    const BOOK_LABELS = {
      winamax:   'Winamax',
      betclic:   'Betclic',
      unibet_eu: 'Unibet',
      betsson:   'Betsson',
      pinnacle:  'Pinnacle',
      bet365:    'Bet365',
    };

    const isFlipped = matchOdds.home_team !== match.home_team?.name;

    const rows = matchOdds.bookmakers.map(bk => {
      const homeOdds = isFlipped ? bk.away_ml : bk.home_ml;
      const awayOdds = isFlipped ? bk.home_ml : bk.away_ml;
      const label    = BOOK_LABELS[bk.key] ?? bk.title;
      const bHome    = matchOdds.best_home_ml;
      const bAway    = matchOdds.best_away_ml;

      return `
        <tr style="border-bottom:1px solid var(--color-border)">
          <td style="padding:6px 8px;font-size:12px;color:var(--color-muted)">${escapeHtml(label)}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:${homeOdds === bHome ? '700' : '400'};color:${homeOdds === bHome ? 'var(--color-success)' : 'var(--color-text)'}">
            ${homeOdds?.toFixed(2) ?? '—'}
          </td>
          <td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:${awayOdds === bAway ? '700' : '400'};color:${awayOdds === bAway ? 'var(--color-success)' : 'var(--color-text)'}">
            ${awayOdds?.toFixed(2) ?? '—'}
          </td>
        </tr>`;
    }).join('');

    const table = document.createElement('div');
    table.className = 'multibook-table';
    table.style.cssText = 'margin-top:16px;border-top:1px solid var(--color-border);padding-top:12px';
    table.innerHTML = `
      <div style="font-size:11px;color:var(--color-muted);margin-bottom:8px;font-weight:600">
        Comparaison cotes — ${matchOdds.bookmakers.length} bookmakers
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:1px solid var(--color-border)">
            <th style="padding:4px 8px;font-size:10px;color:var(--color-muted);text-align:left;font-weight:500">Book</th>
            <th style="padding:4px 8px;font-size:10px;color:var(--color-muted);text-align:center;font-weight:500">${match.home_team?.abbreviation ?? 'DOM'}</th>
            <th style="padding:4px 8px;font-size:10px;color:var(--color-muted);text-align:center;font-weight:500">${match.away_team?.abbreviation ?? 'EXT'}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="font-size:10px;color:var(--color-muted);margin-top:6px">
        ★ Meilleure cote · Source : The Odds API
      </div>
    `;

    bloc7.appendChild(table);
    _checkBetterOddsAlert(bloc7, matchOdds, match, analysis);

  } catch {
    // Silencieux — cotes multi-books optionnelles
  }
}

function _checkBetterOddsAlert(bloc7, matchOdds, match, analysis) {
  if (!analysis?.betting_recommendations?.best) return;
  const best       = analysis.betting_recommendations.best;
  const isFlipped  = matchOdds.home_team !== match.home_team?.name;
  const dkDecimal  = americanToDecimal(best.odds_line);
  const sideIsHome = best.side === 'HOME';

  let bestExternal = null, bestBook = null;
  for (const bk of (matchOdds.bookmakers ?? [])) {
    const odds = isFlipped
      ? (sideIsHome ? bk.away_ml : bk.home_ml)
      : (sideIsHome ? bk.home_ml : bk.away_ml);
    if (odds && (!bestExternal || odds > bestExternal)) {
      bestExternal = odds;
      bestBook     = bk.title;
    }
  }

  if (!bestExternal || !dkDecimal || bestExternal <= dkDecimal) return;

  const existing = bloc7.querySelector('.better-odds-alert');
  if (existing) existing.remove();

  const alert = document.createElement('div');
  alert.className = 'better-odds-alert';
  alert.style.cssText = 'margin-top:10px;padding:10px 12px;background:rgba(34,197,94,0.08);border-left:3px solid var(--color-success);border-radius:var(--radius-sm);font-size:12px;';
  alert.innerHTML = `
    <div style="color:var(--color-success);font-weight:700;margin-bottom:2px">💡 Meilleure cote disponible ailleurs</div>
    <div style="color:var(--color-muted)">
      ${escapeHtml(bestBook ?? '—')} offre <strong style="color:var(--color-text)">${bestExternal.toFixed(2)}</strong>
      vs DraftKings <strong style="color:var(--color-text)">${dkDecimal}</strong>
    </div>
  `;
  bloc7.appendChild(alert);
}

// ── AVERTISSEMENT DONNÉES INCOMPLÈTES ─────────────────────────────────────

function _renderDataIncompleteWarning(analysis) {
  const quality = analysis?.data_quality_score;
  if (quality == null || quality >= 0.80) return '';

  const missing = analysis?.missing_variables ?? [];
  const LABELS  = {
    recent_form_ema: 'Forme récente (BallDontLie)',
    absences_impact: 'Blessures (ESPN Injuries)',
    back_to_back:    'Back-to-back (ESPN)',
    rest_days_diff:  'Jours de repos (ESPN)',
  };

  const list = missing.map(v => LABELS[v] ?? v).filter(Boolean).slice(0, 3);

  return `
    <div style="
      display:flex;align-items:flex-start;gap:8px;
      padding:var(--space-2) var(--space-3);
      background:rgba(245,158,11,0.07);
      border-left:2px solid var(--color-warning);
      border-radius:var(--radius-sm);
      margin-bottom:var(--space-3);
      font-size:11px;
    ">
      <span style="color:var(--color-warning);font-size:13px">⚠</span>
      <div>
        <div style="color:var(--color-warning);font-weight:600;margin-bottom:2px">
          Données incomplètes — qualité ${Math.round(quality * 100)}%
        </div>
        ${list.length > 0 ? `<div class="text-muted">Manquant : ${list.join(' · ')}</div>` : ''}
      </div>
    </div>
  `;
}

// ── ÉVÉNEMENTS ────────────────────────────────────────────────────────────

function _bindEvents(container, storeInstance, match, analysis) {
  container.querySelector('#back-btn')?.addEventListener('click', () => {
    router.navigate('dashboard');
  });

  container.querySelector('#share-btn')?.addEventListener('click', () => {
    if (!analysis?.betting_recommendations?.best) return;
    const best      = analysis.betting_recommendations.best;
    const sideLabel = { HOME: match.home_team?.name, AWAY: match.away_team?.name, OVER: 'Over', UNDER: 'Under' }[best.side] ?? best.side;
    const odds      = americanToDecimal(best.odds_line);
    const text = `🏀 ${match.home_team?.name} vs ${match.away_team?.name}\n✅ ${sideLabel} @ ${odds}\n📊 Edge +${best.edge}% · Moteur ${best.motor_prob}%\n🤖 Mani Bet Pro`;
    navigator.clipboard?.writeText(text).then(() => {
      const btn = container.querySelector('#share-btn');
      if (btn) { btn.textContent = '✓ Copié !'; setTimeout(() => { btn.textContent = '📤 Partager'; }, 2000); }
    });
  });

  // Collapsibles
  container.querySelectorAll('.collapsible').forEach(el => {
    el.querySelector('.collapsible__header')?.addEventListener('click', () => {
      el.classList.toggle('open');
    });
  });

  // Paper trading
  container.querySelectorAll('.paper-bet-btn').forEach(btn => {
    btn.addEventListener('click', () => _openBetModal(btn, match, analysis, storeInstance));
  });

  // Boutons IA — passe par ai.client.js (plus de fetch direct)
  if (analysis?.explanation_context) {
    container.querySelectorAll('[data-ai-task]').forEach(btn => {
      btn.addEventListener('click', () => {
        _triggerAIExplanation(container, analysis, match, btn.dataset.aiTask);
      });
    });
  }
}

// ── APPEL IA via ai.client.js ─────────────────────────────────────────────

async function _triggerAIExplanation(container, analysis, match, task) {
  const responseEl = container.querySelector('#ai-response');
  if (!responseEl) return;

  responseEl.innerHTML = '<span class="text-muted">Analyse en cours…</span>';

  const matchMeta = {
    home:  match.home_team?.name ?? '—',
    away:  match.away_team?.name ?? '—',
    date:  match.date,
    sport: 'NBA',
  };

  try {
    // Passe par AIClient qui valide via AIGuard
    const explanation = await AIClient.explain(analysis, task, matchMeta);

    if (!explanation) {
      responseEl.innerHTML = '<div class="text-muted" style="font-size:12px">Réponse IA non disponible.</div>';
      return;
    }

    const flagWarning = explanation.has_flags
      ? `<div style="font-size:10px;color:var(--color-warning);margin-top:var(--space-2)">⚠ Certains passages ont été signalés pour vérification</div>`
      : '';

    responseEl.innerHTML = `
      <div style="line-height:1.8;font-size:13px">${escapeHtml(explanation.response_text ?? '')}</div>
      ${flagWarning}
      <div class="text-muted" style="font-size:10px;margin-top:var(--space-2)">
        Claude Sonnet · Basé uniquement sur les données du moteur
        ${explanation.tokens_used ? `· ${explanation.tokens_used} tokens` : ''}
      </div>
    `;

  } catch (err) {
    Logger.error('AI_EXPLANATION_ERROR', { message: err.message });
    responseEl.innerHTML = `
      <div class="text-muted" style="font-size:12px">
        Erreur : ${escapeHtml(err.message)}<br>Vérifie la connexion au Worker.
      </div>
    `;
  }
}

// ── MODAL PAPER TRADING ───────────────────────────────────────────────────

async function _openBetModal(btn, match, analysis, storeInstance) {
  const market     = btn.dataset.market;
  const side       = btn.dataset.side;
  const sideLabel  = btn.dataset.sideLabel;
  const odds       = Number(btn.dataset.odds);
  const spreadLine = btn.dataset.spreadLine ? Number(btn.dataset.spreadLine) : null;
  const edge       = Number(btn.dataset.edge);
  const motorProb  = Number(btn.dataset.motorProb);
  const impliedProb = Number(btn.dataset.impliedProb);
  const kelly      = Number(btn.dataset.kelly);

  // CORRECTION : loadAsync() pour avoir la bankroll KV à jour
  const state      = await PaperEngine.loadAsync();
  const bankroll   = state.current_bankroll;
  const kellySugg  = kelly > 0 ? Math.round(kelly * bankroll * 100) / 100 : null;

  const oddsStr    = formatAmerican(odds);
  const oddsDecStr = americanToDecimal(odds) ?? '—';
  const marketLabels = { MONEYLINE: 'Vainqueur', SPREAD: 'Handicap', OVER_UNDER: 'Total pts' };

  const modal = document.createElement('div');
  modal.className = 'paper-modal-overlay';
  modal.innerHTML = `
    <div class="paper-modal">
      <div class="paper-modal__header">
        <span style="font-weight:700;font-size:15px">Enregistrer un pari</span>
        <button class="paper-modal__close" id="modal-close">✕</button>
      </div>

      <div style="background:var(--color-bg);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px">
          ${escapeHtml(match.home_team?.name ?? '—')} vs ${escapeHtml(match.away_team?.name ?? '—')}
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:11px;color:var(--color-muted)">${marketLabels[market] ?? market}</span>
          <span style="font-size:14px;font-weight:700">${escapeHtml(sideLabel)}</span>
          <span style="font-size:13px;font-weight:600;color:var(--color-signal)">${oddsDecStr}</span>
        </div>
        <div style="display:flex;gap:12px;margin-top:6px;font-size:11px;color:var(--color-muted)">
          <span>Edge <strong style="color:var(--color-text)">${edge}%</strong></span>
          <span>Moteur <strong style="color:var(--color-text)">${motorProb}%</strong></span>
          <span>Book <strong style="color:var(--color-text)">${impliedProb}%</strong></span>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;margin-bottom:14px">
        <span style="font-size:12px;color:var(--color-muted)">Bankroll disponible</span>
        <span style="font-size:15px;font-weight:700">${bankroll.toFixed(2)} €</span>
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:6px">
          Cote réelle prise
          <span style="color:var(--color-muted);font-style:italic"> — modifiez si nécessaire</span>
        </label>
        <input type="number" id="odds-input" class="paper-modal__input"
          value="${oddsDecStr}" placeholder="Ex: 2.70" step="0.05" min="1.01"
          style="font-size:20px;font-weight:700;text-align:center"
        />
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:6px">
          Mise (€)
          ${kellySugg ? `<span style="color:var(--color-signal);font-weight:600"> · Kelly : ${kellySugg.toFixed(2)} €</span>` : ''}
        </label>
        <input type="number" id="stake-input" class="paper-modal__input"
          value="${kellySugg ?? ''}" placeholder="Montant €"
          min="0.5" max="${bankroll.toFixed(2)}" step="0.5"
          style="font-size:16px;font-weight:600;text-align:center"
        />
      </div>

      <div style="margin-bottom:18px">
        <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:6px">Note (optionnel)</label>
        <input type="text" id="note-input" class="paper-modal__input"
          placeholder="Ex: blessure clé non confirmée…" maxlength="200"
        />
      </div>

      <div style="display:flex;gap:8px">
        <button class="btn btn--ghost" id="modal-cancel" style="flex:1;padding:12px">Annuler</button>
        <button class="btn btn--primary" id="modal-confirm" style="flex:2;padding:12px;font-size:14px;font-weight:600">
          ✓ Confirmer
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#modal-close')?.addEventListener('click',  () => modal.remove());
  modal.querySelector('#modal-cancel')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelector('#modal-confirm')?.addEventListener('click', async () => {
    const stake       = parseFloat(modal.querySelector('#stake-input')?.value);
    const oddsDecimal = parseFloat(modal.querySelector('#odds-input')?.value) || americanToDecimal(odds);
    const oddsReal    = decimalToAmerican(oddsDecimal) ?? odds;
    const note        = modal.querySelector('#note-input')?.value?.trim() ?? null;

    if (!stake || stake <= 0 || stake > bankroll) {
      modal.querySelector('#stake-input')?.classList.add('input--error');
      return;
    }

    await PaperEngine.placeBet({
      match_id:          match.id,
      date:              match.date,
      sport:             'NBA',
      home:              match.home_team?.name ?? '—',
      away:              match.away_team?.name ?? '—',
      market,
      side,
      side_label:        sideLabel,
      odds_taken:        oddsReal,
      odds_decimal:      oddsDecimal,
      spread_line:       spreadLine,   // CORRECTION : transmis pour paper.settler.js
      stake,
      kelly_stake:       kelly,
      edge,
      motor_prob:        motorProb,
      implied_prob:      impliedProb,
      confidence_level:  analysis?.confidence_level ?? null,
      data_quality:      analysis?.data_quality_score ?? null,
      decision_note:     note,
    });

    storeInstance.set({ paperTradingVersion: (storeInstance.get('paperTradingVersion') ?? 0) + 1 });
    modal.remove();
    _showBetConfirmation(sideLabel, oddsStr, stake);
  });
}

function _showBetConfirmation(sideLabel, oddsStr, stake) {
  const toast = document.createElement('div');
  toast.className   = 'toast toast--success';
  toast.textContent = `✓ Pari enregistré : ${sideLabel} ${oddsStr} — ${stake.toFixed(2)} €`;
  document.getElementById('toast-container')?.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 300ms ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── ÉTAT VIDE ─────────────────────────────────────────────────────────────

function _renderNoMatch(container) {
  container.innerHTML = `
    <div class="view-placeholder">
      <div class="view-placeholder__icon">◪</div>
      <div class="view-placeholder__title">Aucun match sélectionné</div>
      <div class="view-placeholder__sub">Reviens au dashboard et sélectionne un match.</div>
      <button class="btn btn--ghost" id="back-from-empty">← Dashboard</button>
    </div>
  `;
  container.querySelector('#back-from-empty')?.addEventListener('click', () => {
    router.navigate('dashboard');
  });
}

// ── HELPERS ───────────────────────────────────────────────────────────────

function _decisionConfig(decision) {
  const map = {
    'ANALYSER':    { icon: '✓', color: 'var(--color-success)' },
    'EXPLORER':    { icon: '△', color: 'var(--color-warning)' },
    'INSUFFISANT': { icon: '—', color: 'var(--color-muted)'   },
    'REJETÉ':      { icon: '✕', color: 'var(--color-danger)'  },
  };
  return map[decision] ?? { icon: '—', color: 'var(--color-muted)' };
}

function _legacyDecision(analysis) {
  if (!analysis || analysis.confidence_level === 'INCONCLUSIVE' || analysis.confidence_level === null) {
    return 'INSUFFISANT';
  }
  const edge = analysis.betting_recommendations?.best?.edge ?? 0;
  if (edge >= 7 && analysis.confidence_level === 'HIGH') return 'ANALYSER';
  if (edge >= 5) return 'EXPLORER';
  return 'INSUFFISANT';
}

function _renderContextFactor(label, value, level) {
  const cls = level === 'HIGH' || level === 'LOW' ? 'text-success' : level === 'MEDIUM' ? 'text-warning' : 'text-muted';
  return `
    <div class="context-factor">
      <span class="context-factor__label">${escapeHtml(label)}</span>
      <span class="${cls}" style="font-size:11px;text-align:right;max-width:200px">${escapeHtml(value)}</span>
    </div>
  `;
}

function _formatMatchTime(match) {
  try {
    if (match.datetime) {
      return new Date(match.datetime).toLocaleDateString('fr-FR', {
        weekday: 'short', day: 'numeric', month: 'short',
      }) + ' · ' + new Date(match.datetime).toLocaleTimeString('fr-FR', {
        hour: '2-digit', minute: '2-digit',
      });
    }
    if (match.date) {
      return new Date(match.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    }
  } catch {}
  return '—';
}

function _formatRejection(reason) {
  const labels = {
    WEIGHTS_NOT_CALIBRATED:          'Pondérations non calibrées',
    MISSING_CRITICAL_DATA:           'Données critiques manquantes',
    DATA_QUALITY_BELOW_THRESHOLD:    'Qualité des données insuffisante',
    ROBUSTNESS_BELOW_THRESHOLD:      'Signal trop sensible aux hypothèses',
    SPORT_NOT_SUPPORTED_OR_DISABLED: 'Sport non activé',
    ENGINE_NOT_IMPLEMENTED:          'Moteur non implémenté',
    ABSENCES_NOT_CONFIRMED:          'Absences non confirmées',
  };
  return labels[reason] ?? reason;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
