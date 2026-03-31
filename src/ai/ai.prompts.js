/**
 * MANI BET PRO — ai.prompts.js v2.1
 *
 * Prompts optimisés pour minimiser les tokens Haiku.
 */

const RULES = `Règles : données fournies uniquement, pas de probabilité inventée, pas de vainqueur affirmé, français factuel.`;

export const AI_PROMPTS = {

  VERSION: '0.2.1',

  SYSTEM_EXPLAIN: `Auditeur analytique NBA. Explique ce que le moteur a calculé : signaux dominants, direction, contribution. Mentionne les données manquantes si présentes. Max 200 mots. ${RULES}`,

  SYSTEM_AUDIT: `Auditeur analytique NBA. Audite la cohérence des signaux : contradictions, valeurs anormales, robustesse vs signaux. Max 150 mots. ${RULES}`,

  SYSTEM_DETECT_INCONSISTENCY: `Auditeur analytique NBA. Détecte les incohérences : signal fort + faible robustesse, variable critique manquante, forme récente vs bilan saison. Si aucune → dis-le. Max 120 mots. ${RULES}`,

  SYSTEM_BETTING: `Auditeur analytique NBA. Explique les recommandations de paris détectées par le moteur. Pour chaque paris : nomme le marché, explique l'edge calculé, rappelle les limites (edge ≠ certitude). Max 150 mots. ${RULES}`,

  SYSTEM_SCENARIO: `Auditeur analytique NBA. Explore le scénario en t'appuyant uniquement sur les données fournies. Conditionnel uniquement. Max 150 mots. ${RULES}`,

  buildUserMessage(task, context) {
    const { match_meta, engine_output } = context;

    const signals = (engine_output.top_signals ?? [])
      .filter(s => Math.abs(s.contribution) > 0.02)
      .slice(0, 3)
      .map(s => `${s.label}:${s.direction}(${(s.contribution * 100).toFixed(0)}%)`)
      .join(', ');

    const score  = engine_output.predictive_score !== null ? Math.round(engine_output.predictive_score * 100) + '%' : '—';
    const rob    = engine_output.robustness_score !== null ? Math.round(engine_output.robustness_score * 100) + '%' : '—';
    const qual   = engine_output.data_quality_score !== null ? Math.round(engine_output.data_quality_score * 100) + '%' : '—';
    const missing = (engine_output.missing_critical ?? []).join(', ') || 'aucune';

    const reversal = engine_output.reversal_threshold
      ? `${engine_output.reversal_threshold.variable}@${engine_output.reversal_threshold.step_pct}%`
      : 'aucun';

    const needsRobustness = ['AUDIT', 'INCONSISTENCY'].some(t => task.toUpperCase().includes(t));

    return `${match_meta?.home ?? '—'} vs ${match_meta?.away ?? '—'} | NBA | ${engine_output.confidence_level}
Score:${score} Rob:${rob} Qual:${qual}
Signaux: ${signals || 'aucun'}
Manquantes: ${missing}${needsRobustness ? `\nRenversement: ${reversal}` : ''}
→ ${task}`;
  },
};
