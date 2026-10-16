import { ARKHANVAL_ARKS, ARKHANVAL_ARCHETYPES } from "../config.mjs";
import { combatAttackerResultForResponse, resolveCombatConfrontation } from "../combat/context.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function chainText(chain, plan) {
  const values = chain.rolls.map((roll) => {
    const natural = `d${roll.faces}: ${roll.natural}`;
    if (plan.resultModifier === 0) return natural;
    const sign = plan.resultModifier >= 0 ? "+" : "";
    return `${natural} (${sign}${plan.resultModifier} → ${roll.modified})`;
  });

  const suffix = plan.chainMode === "cumulative"
    ? ` = ${chain.cumulativeTotal ?? 0}`
    : "";

  return `${values.join(" → ")}${suffix}`;
}

function localizedArchetypeLabel(archetypeId = "") {
  const entry = ARKHANVAL_ARCHETYPES.find((candidate) => candidate.id === archetypeId);
  return entry ? game.i18n.localize(entry.labelKey) : "";
}

function rollArchetypeId(plan = {}) {
  const fromSource = String(plan?.rollSource?.archetype ?? "").trim().toLowerCase();
  if (fromSource) return fromSource;
  const identifier = String(plan?.rollSource?.identifier ?? plan?.skillIdentifier ?? "").trim().toLowerCase();
  const match = identifier.match(/^arkhanval\.skill\.([^.]+)\./);
  return match?.[1] ?? "";
}

export function resolutionPortraitMarkup(chatActor = null) {
  const img = String(chatActor?.img ?? "").trim() || "icons/svg/mystery-man.svg";
  const alt = String(chatActor?.name ?? "Personnage");
  return `<span class="arkhanval-resolution-card__portrait"><img src="${escapeHtml(img)}" alt="${escapeHtml(alt)}"></span>`;
}

export function resolutionArchetypeMarkup(plan = {}) {
  const archetypeId = rollArchetypeId(plan);
  const source = plan?.rollSource ?? {};
  const sourceIdentifier = String(source.identifier ?? plan?.skillIdentifier ?? "").trim().toLowerCase();
  const arkIdentifier = sourceIdentifier.match(/^arkhanval\.ark\.([^.]+)/);
  const arkId = String(source.arkId ?? arkIdentifier?.[1] ?? "").trim().toLowerCase();
  const isArk = source.sourceType === "ark" || archetypeId === "ark" || Boolean(arkIdentifier);

  if (isArk) {
    const ark = ARKHANVAL_ARKS.find((entry) => entry.id === arkId);
    // Ne jamais rendre une icône d'archétype inexistante pour un jet d'Ark.
    if (!ark) return "";
    const img = `systems/arkhanval/assets/icones/ark/${ark.id}.webp`;
    return `
      <div class="arkhanval-resolution-card__archetype-badge" title="${escapeHtml(ark.label)}">
        <img src="${escapeHtml(img)}" alt="${escapeHtml(ark.label)}">
      </div>
    `;
  }

  if (!archetypeId) return "";
  const label = localizedArchetypeLabel(archetypeId) || archetypeId;
  const img = `systems/arkhanval/assets/icones/archetype/${archetypeId}.webp`;
  return `
    <div class="arkhanval-resolution-card__archetype-badge" title="${escapeHtml(label)}">
      <img src="${escapeHtml(img)}" alt="${escapeHtml(label)}">
    </div>
  `;
}

function resolutionDieFaces(faces) {
  const numeric = Number(faces) || 10;
  return [8, 10, 12].includes(numeric) ? numeric : 10;
}

function resolutionDieState(roll = {}, plan = {}) {
  if (roll?.criticalFailure) return "critical";
  return Number(roll?.modified) >= Number(plan?.effectiveFd)
    ? "success"
    : "neutral";
}


function resolutionDieStateOrder(state = "neutral") {
  switch (String(state)) {
    case "critical": return 0;
    case "neutral": return 1;
    case "success": return 2;
    default: return 99;
  }
}

function resolutionDieMarkup(roll = {}, plan = {}, { size = "large" } = {}) {
  const faces = resolutionDieFaces(roll?.faces ?? 10);
  const state = resolutionDieState(roll, plan);
  const value = Number.isFinite(Number(roll?.natural)) ? Number(roll.natural) : (Number(roll?.modified) || 0);
  return `
    <span class="arkhanval-resolution-card__die arkhanval-resolution-card__die--${escapeHtml(size)}"
          data-faces="${faces}"
          data-state="${escapeHtml(state)}">
      <span class="arkhanval-resolution-card__die-value">${escapeHtml(value)}</span>
    </span>
  `;
}

function resolutionAttemptVisual(attempt, index, result) {
  const multipleAttempts = Array.from(result?.attempts ?? []).length > 1;
  const retained = multipleAttempts && result?.selectedAttemptIndex === index;
  const tied = multipleAttempts && result?.comparisonTie;
  const status = retained
    ? `<span class="arkhanval-resolution-card__retained">${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.Retained"))}</span>`
    : tied
      ? `<span class="arkhanval-resolution-card__tie">${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.EqualQR"))}</span>`
      : "";
  const ignored = Number(attempt?.ignoredCriticalFailures) > 0
    ? ` (${escapeHtml(game.i18n.format("ARKHANVAL.Resolution.IgnoredCriticalsShort", {
        count: attempt.ignoredCriticalFailures
      }))})`
    : "";

  if (attempt?.autoSuccess) {
    return `
      <section class="arkhanval-resolution-card__attempt">
        ${multipleAttempts ? `<header><strong>${escapeHtml(game.i18n.format("ARKHANVAL.Resolution.Attempt", { number: index + 1 }))}</strong>${status}</header>` : ""}
        <p class="arkhanval-resolution-card__auto-success">Réussite automatique — aucun dé lancé.</p>
        <div class="arkhanval-resolution-card__attempt-footer">
          <span>Succès : <strong>${Number(attempt?.successes) || 0}</strong></span>
          <span>Échecs critiques : <strong>${Number(attempt?.criticalFailures) || 0}</strong>${ignored}</span>
        </div>
      </section>
    `;
  }

  const chains = Array.from(attempt?.chains ?? [])
    .map((chain, originalIndex) => {
      const rolls = Array.from(chain?.rolls ?? []);
      const [first, ...rerolls] = rolls;
      if (!first) return null;
      const state = resolutionDieState(first, result?.plan);
      return {
        originalIndex,
        state,
        markup: `
          <li class="arkhanval-resolution-card__die-cluster" data-state="${escapeHtml(state)}">
            ${resolutionDieMarkup(first, result?.plan, { size: "large" })}
            ${rerolls.length
              ? `<div class="arkhanval-resolution-card__die-rerolls">${rerolls.map((roll) => resolutionDieMarkup(roll, result?.plan, { size: "small" })).join("")}</div>`
              : ""}
          </li>
        `
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const orderDiff = resolutionDieStateOrder(left?.state) - resolutionDieStateOrder(right?.state);
      return orderDiff !== 0 ? orderDiff : left.originalIndex - right.originalIndex;
    })
    .map((entry) => entry.markup)
    .join("");

  return `
    <section class="arkhanval-resolution-card__attempt">
      ${multipleAttempts
        ? `<header><strong>${escapeHtml(game.i18n.format("ARKHANVAL.Resolution.Attempt", { number: index + 1 }))}</strong><span class="arkhanval-resolution-card__attempt-meta">QR ${Number(attempt?.qr) || 0}</span>${status}</header>`
        : ""}
      <div class="arkhanval-resolution-card__attempt-visual">
        <ul class="arkhanval-resolution-card__dice-board">${chains}</ul>
      </div>
      <div class="arkhanval-resolution-card__attempt-footer">
        <span>Succès : <strong>${Number(attempt?.successes) || 0}</strong></span>
        <span>Échecs critiques : <strong>${Number(attempt?.criticalFailures) || 0}</strong>${ignored}</span>
      </div>
    </section>
  `;
}

function attemptCard(attempt, index, result) {
  const multipleAttempts = Array.from(result?.attempts ?? []).length > 1;
  const retained = multipleAttempts && result.selectedAttemptIndex === index;
  const tied = multipleAttempts && result.comparisonTie;
  const status = retained
    ? `<span class="arkhanval-resolution-card__retained">${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.Retained"))}</span>`
    : tied
      ? `<span class="arkhanval-resolution-card__tie">${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.EqualQR"))}</span>`
      : "";

  const chains = attempt.autoSuccess
    ? `<li><strong>Réussite automatique</strong> — aucun dé lancé.</li>`
    : attempt.chains
        .map((chain) => `<li>${escapeHtml(chainText(chain, result.plan))}</li>`)
        .join("");

  const ignored = attempt.ignoredCriticalFailures > 0
    ? ` (${escapeHtml(game.i18n.format("ARKHANVAL.Resolution.IgnoredCriticalsShort", {
        count: attempt.ignoredCriticalFailures
      }))})`
    : "";

  const attemptHeader = multipleAttempts
    ? `
      <header>
        <strong>${escapeHtml(game.i18n.format("ARKHANVAL.Resolution.Attempt", {
          number: index + 1
        }))}</strong>
        ${status}
      </header>
    `
    : "";

  return `
    <section class="arkhanval-resolution-card__attempt">
      ${attemptHeader}
      <ul class="arkhanval-resolution-card__dice">${chains}</ul>
      <div class="arkhanval-resolution-card__score">
        <span>${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.Successes"))}: <strong>${attempt.successes}</strong></span>
        <span>${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.CriticalFailures"))}: <strong>${attempt.criticalFailures}</strong>${ignored}</span>
        <span>QR: <strong>${attempt.qr}</strong></span>
      </div>
    </section>
  `;
}


function combatQrValue(result, fallback = 0) {
  const qr = Number(result?.qr ?? fallback);
  return Number.isFinite(qr) ? qr : 0;
}

// Conserver ce générateur pour les anciens usages de l’Art du combat ;
// le détail de la carte de jet classique ne rappelle plus les règles de rang.
export function rankRollNotesMarkup(plan) {
  if (!plan) return "";
  const notes = [];
  if (plan.rankFdModifier === -1) notes.push(game.i18n.localize("ARKHANVAL.Resolution.AutoRank6"));
  if (plan.suppressCriticalFailures) notes.push(game.i18n.localize("ARKHANVAL.Resolution.AutoRank7"));
  if (plan.rank8OpenNines) notes.push(game.i18n.localize("ARKHANVAL.Resolution.AutoRank8"));
  return notes.length
    ? `<ul class="arkhanval-resolution-card__rank-effects">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
    : "";
}

export function combatRollDisclosure(result, {
  fallbackQr = 0,
  fallbackDetail = ""
} = {}) {
  const qr = combatQrValue(result, fallbackQr);
  const details = result
    ? Array.from(result.attempts ?? [])
        .map((attempt, index) => resolutionAttemptVisual(attempt, index, result))
        .join("")
    : fallbackDetail
      ? `<p class="arkhanval-resolution-card__combat-roll-fallback">${escapeHtml(fallbackDetail)}</p>`
      : "";

  return `
    <details class="arkhanval-resolution-card__quality">
      <summary class="arkhanval-resolution-card__quality-summary">
        <span class="arkhanval-resolution-card__quality-label">Qualité de réussite</span>
        <strong class="arkhanval-resolution-card__quality-value">${qr}</strong>
      </summary>
      <div class="arkhanval-resolution-card__quality-body">
        ${details}
      </div>
    </details>
  `;
}


function combatantVisual(snapshot, fallbackLabel = "Combattant") {
  const name = String(snapshot?.name ?? fallbackLabel);
  const tokenImg = String(snapshot?.tokenImg ?? "");
  const visual = tokenImg
    ? `<img src="${escapeHtml(tokenImg)}" alt="">`
    : `<span class="arkhanval-resolution-card__combatant-fallback"><i class="fa-solid fa-user" aria-hidden="true"></i></span>`;

  return `
    <div class="arkhanval-resolution-card__combatant-identity">
      <span class="arkhanval-resolution-card__combatant-portrait">${visual}</span>
      <strong>${escapeHtml(name)}</strong>
    </div>
  `;
}

export function combatArkDecisionBlock({
  side = "attacker",
  targetKey = "",
  decision = null,
  finalized = false
} = {}) {
  if (!decision) return "";

  if (decision.locked || finalized || !decision.available) return "";

  const yesDisabled = decision.available ? "" : " disabled";

  return `
    <div class="arkhanval-resolution-card__combat-ark">
      <span>Utiliser un cercle d’Ark :</span>
      <div class="arkhanval-resolution-card__combat-ark-actions">
        <button type="button"
                data-arkhanval-combat-ark-choice="${escapeHtml(side)}"
                data-arkhanval-combat-ark-value="yes"
                data-target-key="${escapeHtml(targetKey)}"${yesDisabled}>Oui</button>
        <button type="button"
                data-arkhanval-combat-ark-choice="${escapeHtml(side)}"
                data-arkhanval-combat-ark-value="no"
                data-target-key="${escapeHtml(targetKey)}">Non</button>
      </div>
    </div>
  `;
}

export function combatantBlock({
  side = "attacker",
  snapshot = null,
  result = null,
  qr = 0,
  skillName = "",
  technique = null,
  contextNote = "",
  actions = "",
  footer = "",
  responseMode = "",
  arkDecision = null,
  targetKey = "",
  finalized = false
} = {}) {
  const roleLabel = side === "attacker" ? "Attaquant" : "Défenseur";
  const fallbackDetail = responseMode === "accept"
    ? "Encaisse automatiquement."
    : responseMode === "incantation-continue"
      ? "Continue à incanter — sans défense. FD attaquant −2."
      : responseMode === "spell-order"
        ? "Lancement du sort engagé — sans défense. FD attaquant −2."
        : responseMode === "manual"
          ? "Qualité de réussite saisie manuellement par le MJ."
          : "";
  const plan = result?.plan ?? null;
  const rank = Math.max(0, Number(plan?.rollSource?.rank ?? plan?.primaryRank) || 0);
  const pool = Array.from(plan?.pool ?? []);
  const fd = plan?.effectiveFd === plan?.fd
    ? `${plan?.effectiveFd ?? ""}`
    : `${plan?.fd ?? ""} → ${plan?.effectiveFd ?? ""}`;
  const techniqueLabel = String(technique?.label ?? "").trim();
  const showsTechnique = techniqueLabel && techniqueLabel !== "Aucune";
  const portrait = {
    img: String(snapshot?.tokenImg ?? snapshot?.img ?? "").trim(),
    name: String(snapshot?.name ?? roleLabel)
  };
  const automaticEntries = [
    ...Array.from(plan?.specialtyNotes ?? []),
    ...(contextNote ? [contextNote] : [])
  ].filter(Boolean);

  // A true defensive roll uses the SAME classes and markup building blocks
  // as the validated classical resolution card, not a lookalike alternative.
  const rolledContent = result ? `
    <header class="arkhanval-resolution-card__hero">
      ${resolutionPortraitMarkup(portrait)}
      <div class="arkhanval-resolution-card__hero-main">
        <h3>${escapeHtml(skillName || plan?.skillName || "Jet de défense")}</h3>
        <div class="arkhanval-resolution-card__hero-rank">Rang ${rank}</div>
      </div>
      ${resolutionArchetypeMarkup(plan)}
    </header>
    <section class="arkhanval-resolution-card__stats-block${showsTechnique ? " arkhanval-resolution-card__stats-block--technique" : ""}">
      <div class="arkhanval-resolution-card__stat">
        <span class="arkhanval-resolution-card__stat-label">Nombre de dés</span>
        <strong class="arkhanval-resolution-card__stat-value">${escapeHtml(plan?.poolLabel || `${pool.length} dé${pool.length > 1 ? "s" : ""}`)}</strong>
      </div>
      ${showsTechnique ? `<div class="arkhanval-resolution-card__stat">
        <span class="arkhanval-resolution-card__stat-label">Technique</span>
        <strong class="arkhanval-resolution-card__stat-value">${escapeHtml(techniqueLabel)}</strong>
      </div>` : ""}
      <div class="arkhanval-resolution-card__stat arkhanval-resolution-card__stat--fd">
        <span class="arkhanval-resolution-card__stat-label">FD</span>
        <strong class="arkhanval-resolution-card__stat-value">${escapeHtml(fd)}</strong>
      </div>
    </section>
    ${automaticEntries.length ? `<section class="arkhanval-resolution-card__info-block"><div class="arkhanval-resolution-card__info-content">${automaticEntries.map((entry) => `<p>${escapeHtml(entry)}</p>`).join("")}</div></section>` : ""}
    ${combatRollDisclosure(result)}
  ` : "";

  const waitingContent = !result ? `
    <header class="arkhanval-resolution-card__combatant-header">
      ${combatantVisual(snapshot, roleLabel)}
    </header>
    ${!responseMode ? `
      <section class="arkhanval-resolution-card__combatant-choice-panel">
        <p class="arkhanval-resolution-card__combatant-choice-prompt">Choisissez comment répondre à l’attaque.</p>
        ${actions ? `<div class="arkhanval-resolution-card__combatant-actions">${actions}</div>` : ""}
      </section>
    ` : `
      ${combatRollDisclosure(null, { fallbackQr: qr, fallbackDetail })}
      ${contextNote ? `<section class="arkhanval-resolution-card__info-block"><div class="arkhanval-resolution-card__info-content"><p>${escapeHtml(contextNote)}</p></div></section>` : ""}
    `}
  ` : "";

  const arkBlock = combatArkDecisionBlock({ side, targetKey, decision: arkDecision, finalized });
  return `
    <section class="arkhanval-resolution-card__combatant arkhanval-resolution-card__combatant--${escapeHtml(side)}">
      <div class="arkhanval-resolution-card__combatant-body">
        ${rolledContent}
        ${waitingContent}
        ${arkBlock ? `<section class="arkhanval-resolution-card__rerolls">${arkBlock}</section>` : ""}
        ${actions && (result || responseMode) ? `<div class="arkhanval-resolution-card__combatant-actions">${actions}</div>` : ""}
        ${footer ? `<section class="arkhanval-resolution-card__damage-action-panel arkhanval-resolution-card__combatant-footer">${footer}</section>` : ""}
      </div>
    </section>
  `;
}

function spellOrderJudgeBlock(spellOrder) {
  if (!spellOrder) return "";

  const magicQr = Number(spellOrder.magicQr) || 0;
  const artCombatQr = Number(spellOrder.artCombatQr) || 0;
  const spellName = String(spellOrder.spellName ?? "Sortilège");
  const spellFirst = String(spellOrder.order ?? "") === "spell-first";
  const verdict = spellFirst
    ? `${spellName} agit avant l’attaque`
    : `Attaque / dégâts avant ${spellName}`;
  return `
    <section class="arkhanval-resolution-card__combat-judge arkhanval-resolution-card__combat-judge--resolved arkhanval-resolution-card__spell-order">
      <strong>Détermination de l’ordre</strong>
      <div class="arkhanval-resolution-card__combat-judge-qrs">
        <span>Magie — QR <strong>${magicQr}</strong></span>
        <span>Art du combat — QR <strong>${artCombatQr}</strong></span>
      </div>
      <strong class="arkhanval-resolution-card__combat-judge-verdict">${escapeHtml(verdict)}</strong>
    </section>
  `;
}

function combatJudgeBlock(attackerSnapshot, defenderSnapshot, attackerQr, response = null, targetKey = "") {
  const attackerName = String(attackerSnapshot?.name ?? "Attaquant");
  const defenderName = String(defenderSnapshot?.name ?? "Défenseur");

  if (!response) {
    return `
      <section class="arkhanval-resolution-card__combat-judge arkhanval-resolution-card__combat-judge--pending">
        <strong class="arkhanval-resolution-card__combat-judge-title">Confrontation en attente</strong>
      </section>
    `;
  }

  if (!response.finalized) {
    return `
      <section class="arkhanval-resolution-card__combat-judge arkhanval-resolution-card__combat-judge--pending"
               data-arkhanval-combat-force
               data-target-key="${escapeHtml(targetKey)}">
        <strong class="arkhanval-resolution-card__combat-judge-title">Confrontation en cours</strong>
      </section>
    `;
  }

  const defenderQr = Number(response.qr) || 0;
  const confrontation = resolveCombatConfrontation(attackerQr, defenderQr);
  const winner = confrontation.hit ? confrontation.winner : null;
  const winnerClass = winner === "attacker"
    ? " arkhanval-resolution-card__combat-judge--attacker-win"
    : winner === "defender"
      ? " arkhanval-resolution-card__combat-judge--defender-win"
      : "";

  const verdict = winner === "attacker"
    ? `${attackerName} remporte la confrontation`
    : winner === "defender"
      ? `${defenderName} remporte la confrontation`
      : confrontation.outcome === "tie"
        ? "Égalité — aucune touche"
        : "Aucun vainqueur — aucune touche";

  return `
    <section class="arkhanval-resolution-card__combat-judge arkhanval-resolution-card__combat-judge--resolved${winnerClass}">
      <strong class="arkhanval-resolution-card__combat-judge-verdict">${escapeHtml(verdict)}</strong>
    </section>
  `;
}


function combatTargetList(context) {
  const targets = Array.from(context?.targets ?? []);
  if (targets.length) return targets;
  return context?.target ? [context.target] : [];
}

function combatOutcomeLabel(attackerQr, defenderQr) {
  const resolution = resolveCombatConfrontation(attackerQr, defenderQr);
  if (resolution.outcome === "tie") return "Neutralisation";
  if (!resolution.hit) return "Aucune touche";
  if (resolution.winner === "attacker") {
    return `Attaque réussie · écart ${resolution.difference}`;
  }
  return `La cible remporte la confrontation · écart ${resolution.difference}`;
}

function combatResponseLabel(response) {
  const qr = Number(response?.qr) || 0;
  const signedQr = qr > 0 ? `+${qr}` : String(qr);
  if (response?.mode === "accept") return `Encaisse automatiquement · QR ${signedQr}`;
  if (response?.mode === "manual") return `QR saisie par le MJ : ${signedQr}`;
  const skill = String(response?.skillName ?? "Jet de réponse");
  return `${skill} · QR ${signedQr}`;
}

function combatDefenseOnlyForSide(context, response, side) {
  if (side === "attacker") return Boolean(context?.combatRules?.defenseOnly);
  if (side === "defender") return Boolean(response?.combat?.combatRules?.defenseOnly);
  return false;
}

function combatTechniqueForSide(context, response, side) {
  const technique = side === "attacker"
    ? context?.technique
    : response?.combat?.technique;
  return {
    id: String(technique?.id ?? "none") || "none",
    label: String(technique?.label ?? "Aucune") || "Aucune",
    fdModifier: Number(technique?.fdModifier) || 0
  };
}

function combatDamageActionButton(key, mode, label) {
  return `<button type="button" class="arkhanval-resolution-card__damage-action" data-arkhanval-combat-action="damage" data-damage-mode="${escapeHtml(mode)}" data-target-key="${escapeHtml(key)}">${escapeHtml(label)}</button>`;
}

export function combatTechniqueDamageActions(context, response, winnerSide, key) {
  const technique = combatTechniqueForSide(context, response, winnerSide);

  switch (technique.id) {
    case "feinte":
      return `
        <div class="arkhanval-resolution-card__damage-options">
          ${combatDamageActionButton(key, "normal", "Lancer les dégâts")}
          ${combatDamageActionButton(key, "bonus-d10", "Lancer les dégâts +1d10")}
          ${combatDamageActionButton(key, "feint-effect", "Lancer les dégâts + effet secondaire")}
        </div>
      `;
    case "mode-agressif":
      return `
        <div class="arkhanval-resolution-card__damage-options">
          ${combatDamageActionButton(key, "normal", "Lancer les dégâts")}
          ${combatDamageActionButton(key, "bonus-d10", "Lancer les dégâts +1d10")}
        </div>
      `;
    case "posture-defensive":
      return combatDamageActionButton(key, "minus5", "Lancer les dégâts -5");
    case "viser":
      return technique.fdModifier <= -2
        ? combatDamageActionButton(key, "normal", "Lancer les dégâts")
        : `
          <div class="arkhanval-resolution-card__damage-options">
            ${combatDamageActionButton(key, "normal", "Lancer les dégâts")}
            ${combatDamageActionButton(key, "bonus-d10", "Lancer les dégâts +1d10")}
          </div>
        `;
    case "prise-mains-nues":
      return `
        <div class="arkhanval-resolution-card__damage-options">
          ${combatDamageActionButton(key, "unarmed-none", "Aucun dégât")}
          ${combatDamageActionButton(key, "unarmed-light", "Blessure légère")}
          ${combatDamageActionButton(key, "unarmed-immobilize", "Immobiliser")}
        </div>
      `;
    case "coups-speciaux":
      return `
        <div class="arkhanval-resolution-card__damage-options">
          ${combatDamageActionButton(key, "normal", "Lancer les dégâts")}
          <small class="arkhanval-resolution-card__damage-resolved">Coup spécial — résolution particulière laissée au MJ</small>
        </div>
      `;
    default:
      return combatDamageActionButton(key, "normal", "Lancer les dégâts");
  }
}

function combatResponseDiceLabel(response) {
  if (response?.mode !== "roll" || !response?.result) return "";
  const result = response.result;
  const attempt = result.selectedAttempt
    ?? result.attempts?.[result.selectedAttemptIndex ?? 0]
    ?? result.attempts?.[0]
    ?? null;
  if (!attempt) return "";

  const values = Array.from(attempt.chains ?? []).map((chain) =>
    Array.from(chain.rolls ?? [])
      .map((roll) => String(roll.natural ?? ""))
      .filter(Boolean)
      .join("→")
  ).filter(Boolean);

  const pool = String(result.plan?.poolLabel ?? "");
  if (!values.length) return pool;
  return `${pool}${pool ? " · " : ""}${values.join(" · ")}`;
}

function manualCombatResult(combatState, attackerQr) {
  const response = combatState?.manualResponse ?? null;
  if (!response) return "";
  return `
    <div class="arkhanval-resolution-card__combat-manual-result">
      <strong>${escapeHtml(combatResponseLabel(response))}</strong>
      <span>${escapeHtml(combatOutcomeLabel(attackerQr, response.qr))}</span>
    </div>
  `;
}

function combatBranches(context, combatState, attackerResult, attackerDamageActions = []) {
  const targets = combatTargetList(context);
  if (!targets.length) return "";

  const attackerSnapshot = context?.attacker ?? null;
  const responses = combatState?.responses ?? {};

  // Conserver l'ordre des cibles, mais séparer les résumés des cartes
  // Défenseur : tous les résumés viennent immédiatement après l'Attaquant.
  // Chaque carte Défenseur conserve son data-combat-target-key, nécessaire
  // aux actions et aux injections de relance/maladresse du workflow Foundry.
  const confrontations = targets.map((target) => {
        const key = String(target?.key ?? target?.tokenId ?? target?.actorUuid ?? "");
        const response = responses[key] ?? null;
        const finalized = Boolean(response?.finalized);
        const damageState = combatState?.damage?.[key] ?? null;
        const targetAttackerResult = combatAttackerResultForResponse(attackerResult, response);
        const targetAttackerQr = Number(targetAttackerResult?.qr) || 0;

        let attackerFooter = "";
        let defenderFooter = "";

        if (response && finalized) {
          const confrontation = resolveCombatConfrontation(targetAttackerQr, response.qr);

          if (confrontation.hit && confrontation.winner) {
            const winnerDefenseOnly = combatDefenseOnlyForSide(context, response, confrontation.winner);
            let winnerAction = "";

            if (winnerDefenseOnly) {
              winnerAction = `<small class="arkhanval-resolution-card__damage-resolved">Défense uniquement — aucun dégât</small>`;
            } else if (damageState) {
              // Action persistante : après traitement le même bouton reste en place,
              // avec le libellé de résolution et l'état bleu désactivé.
              winnerAction = `<button type="button" class="arkhanval-resolution-card__damage-action arkhanval-resolution-card__damage-action--resolved" disabled aria-disabled="true">${escapeHtml(damageState.label ?? "Dégâts résolus")}</button>`;
            } else {
              winnerAction = combatTechniqueDamageActions(context, response, confrontation.winner, key);
            }

            if (confrontation.winner === "attacker") attackerFooter = winnerAction;
            if (confrontation.winner === "defender") defenderFooter = winnerAction;
          }
        }


        const judgeBlock = response?.mode === "spell-order"
          ? spellOrderJudgeBlock(response.spellOrder)
          : combatJudgeBlock(
              attackerSnapshot,
              target,
              targetAttackerQr,
              response,
              key
            );

        if (!response) {
          const incanting = Boolean(target?.incantation?.active);
          const readySpells = Array.from(target?.incantation?.readySpells ?? []);
          const spellOppositionEngaged = Boolean(context?.spellOpposition?.active);
          const readySpellActions = readySpells
            .map((spell) => `
              <button type="button"
                      data-arkhanval-combat-action="spell-order"
                      data-target-key="${escapeHtml(key)}"
                      data-spell-id="${escapeHtml(spell?.spellId ?? "")}">
                Lancer le sortilège
              </button>
            `)
            .join("");
          const targetActions = spellOppositionEngaged
            ? `
              <strong class="arkhanval-resolution-card__incantation-defense-label">Lancement du sortilège engagé</strong>
              <p class="arkhanval-resolution-card__combat-roll-fallback">
                L’ordre doit être déterminé à partir de la QR magique et de l’Art du combat de l’assaillant.
              </p>
            `
            : readySpells.length
            ? `
              <strong class="arkhanval-resolution-card__incantation-defense-label">Sort prêt à être lancé</strong>
              ${readySpellActions}
              <button type="button" data-arkhanval-combat-action="incantation-continue" data-target-key="${escapeHtml(key)}">
                Continuer à incanter et encaisser
              </button>
              <button type="button" data-arkhanval-combat-action="incantation-abandon" data-target-key="${escapeHtml(key)}">
                Abandonner pour se défendre
              </button>
              <button type="button" class="arkhanval-resolution-card__combat-gm-action" data-arkhanval-combat-action="manual" data-target-key="${escapeHtml(key)}">
                Saisir une QR
              </button>
            `
            : incanting
            ? `
              <strong class="arkhanval-resolution-card__incantation-defense-label">Incantation en cours</strong>
              <button type="button" data-arkhanval-combat-action="incantation-abandon" data-target-key="${escapeHtml(key)}">
                Abandonner pour se défendre
              </button>
              <button type="button" data-arkhanval-combat-action="incantation-continue" data-target-key="${escapeHtml(key)}">
                Continuer à incanter et encaisser
              </button>
              <button type="button" class="arkhanval-resolution-card__combat-gm-action" data-arkhanval-combat-action="manual" data-target-key="${escapeHtml(key)}">
                Saisir une QR
              </button>
            `
            : `
              <button type="button" data-arkhanval-combat-action="respond" data-target-key="${escapeHtml(key)}">
                Répondre à l’attaque
              </button>
              <button type="button" data-arkhanval-combat-action="accept" data-target-key="${escapeHtml(key)}">
                Encaisser automatiquement
              </button>
              <button type="button" class="arkhanval-resolution-card__combat-gm-action" data-arkhanval-combat-action="manual" data-target-key="${escapeHtml(key)}">
                Saisir une QR
              </button>
            `;

          return {
            targetKey: key,
            targetName: String(target?.name ?? "Défenseur"),
            judgeBlock,
            defenderBlock: `
              <section class="arkhanval-resolution-card__combat-duel" data-combat-target-key="${escapeHtml(key)}">
                ${combatantBlock({
                  side: "defender",
                  snapshot: target,
                  qr: 0,
                  actions: targetActions
                })}
              </section>
            `
          };
        }

        const defenderTechnique = response?.mode === "roll"
          ? combatTechniqueForSide(context, response, "defender")
          : null;

        const defenderBlock = combatantBlock({
          side: "defender",
          snapshot: target,
          result: response?.mode === "roll" ? response.result : null,
          qr: response.qr,
          skillName: response?.mode === "roll" ? String(response.skillName ?? "") : "",
          technique: defenderTechnique,
          contextNote: response?.mode === "spell-order"
            ? `Sort prêt : ${String(response?.spellOrder?.spellName ?? "Sortilège")}`
            : "",
          footer: defenderFooter,
          responseMode: response?.mode ?? "",
          arkDecision: response?.arkDecision ?? null,
          targetKey: key,
          finalized
        });

        if (attackerFooter) {
          attackerDamageActions.push({
            targetName: String(target?.name ?? "Cible"),
            targetKey: key,
            markup: attackerFooter
          });
        }

        return {
          targetKey: key,
          targetName: String(target?.name ?? "Défenseur"),
          judgeBlock,
          defenderBlock: `
            <section class="arkhanval-resolution-card__combat-duel${finalized ? " arkhanval-resolution-card__combat-duel--resolved" : ""}" data-combat-target-key="${escapeHtml(key)}">
              ${defenderBlock}
            </section>
          `
        };
      });

  const multipleTargets = confrontations.length > 1;
  return `
    <div class="arkhanval-resolution-card__combat-confrontations">
      <div class="arkhanval-resolution-card__combat-summaries">
        ${confrontations.map(({ targetKey, targetName, judgeBlock }) => `
          <div class="arkhanval-resolution-card__combat-summary" data-combat-summary-key="${escapeHtml(targetKey)}">
            ${multipleTargets ? `<span class="arkhanval-resolution-card__combat-summary-target">Contre ${escapeHtml(targetName)}</span>` : ""}
            ${judgeBlock}
          </div>
        `).join("")}
      </div>
      <div class="arkhanval-resolution-card__combat-duels">
        ${confrontations.map(({ defenderBlock }) => defenderBlock).join("")}
      </div>
    </div>
  `;
}


export function buildResolutionChatContent(result, {
  progressGain = null,
  arkBoost = "",
  arkReroll = null,
  experienceSource = null,
  arkRerollAvailable = false,
  arkRerollOffered = false,
  arkRerollDiceCount = 0,
  combatContext = null,
  combatState = null,
  incantation = null,
  work = null,
  book = null,
  concentration = null,
  spellMaintenance = null,
  chatActor = null
} = {}) {
  const plan = result.plan;
  const second = plan.secondarySkillName
    ? ` + ${escapeHtml(plan.secondarySkillName)}`
    : "";

  const fd = plan.effectiveFd === plan.fd
    ? `${plan.effectiveFd}`
    : `${plan.fd} → ${plan.effectiveFd}`;

  const mode = plan.doubleRoll === "best"
    ? game.i18n.localize("ARKHANVAL.Resolution.DoubleBest")
    : plan.doubleRoll === "worst"
      ? game.i18n.localize("ARKHANVAL.Resolution.DoubleWorst")
      : "";

  const automatic = [];
  if (plan.criticalFailureThreshold > 1 && !plan.suppressCriticalFailures) {
    automatic.push(
      game.i18n.format("ARKHANVAL.Resolution.ChatRiskThreshold", {
        threshold: plan.criticalFailureThreshold
      })
    );
  }
  automatic.push(...Array.from(plan.specialtyNotes ?? []));

  const progressBlock = progressGain !== null && progressGain !== undefined
    ? `
      <section class="arkhanval-resolution-card__progress">
        <strong>${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.Progress"))}</strong>
        <span>${escapeHtml(game.i18n.format("ARKHANVAL.Resolution.ProgressGained", {
          points: progressGain
        }))}</span>
        <small>${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.ProgressManualTracking"))}</small>
      </section>
    `
    : "";

  const arkNotes = [];
  if (arkBoost) {
    const ark = ARKHANVAL_ARKS.find((entry) => entry.id === arkBoost);
    arkNotes.push(`1 cercle de ${ark?.label ?? arkBoost} dépensé : +2d10`);
  }
  if (arkReroll) {
    const rerolledCount = Math.max(1, Math.min(2, Number(arkReroll?.chainIndices?.length) || 0));
    arkNotes.push(`1 cercle d’Ark dépensé : ${rerolledCount}d10 relancé${rerolledCount > 1 ? "s" : ""}`);
  }

  const arkRerollActionBlock = arkRerollOffered && arkRerollAvailable && !combatContext?.enabled
    ? `
      <section class="arkhanval-resolution-card__ark-choice arkhanval-resolution-card__choice-block">
        <div class="arkhanval-resolution-card__choice-labels">
          <span class="arkhanval-resolution-card__choice-title">Utiliser un cercle d’Ark</span>
          <small>${escapeHtml(arkRerollDiceCount > 1 ? `Relancer jusqu’à ${arkRerollDiceCount}d10.` : "Relancer 1d10.")}</small>
        </div>
        <div class="arkhanval-resolution-card__combat-ark-actions">
          <button type="button" data-arkhanval-ark-reroll-choice="yes"${arkRerollAvailable ? "" : " disabled"}>Oui</button>
          <button type="button" data-arkhanval-ark-reroll-choice="no">Non</button>
        </div>
      </section>
    `
    : "";

  const incantationProgressActionBlock = incantation && !incantation.saved
    ? `
      <section class="arkhanval-resolution-card__incantation-progress">
        <button type="button" data-arkhanval-incantation-progress-save>Enregistrer la progression</button>
      </section>
    `
    : "";

  const workPendingGain = work ? Math.max(0, Math.trunc(Number(work.pendingQr) || 0)) : 0;
  const workProgressActionBlock = work && !work.saved
    ? `
      <section class="arkhanval-resolution-card__work-progress">
        <span>${workPendingGain > 0
          ? `Progression à enregistrer : +${workPendingGain}`
          : "Aucune progression à enregistrer."}</span>
        ${workPendingGain > 0
          ? `<button type="button" data-arkhanval-work-progress-save>Enregistrer la progression</button>`
          : ""}
      </section>
    `
    : "";

  const bookPendingGain = book ? Math.max(0, Math.trunc(Number(book.pendingQr) || 0)) : 0;
  const bookProgressActionBlock = book && !book.saved
    ? `
      <section class="arkhanval-resolution-card__book-progress">
        <span>${bookPendingGain > 0
          ? `Progression de lecture à enregistrer : +${bookPendingGain}`
          : "Aucune progression de lecture à enregistrer."}</span>
        ${bookPendingGain > 0
          ? `<button type="button" data-arkhanval-book-progress-save>Enregistrer la progression</button>`
          : ""}
      </section>
    `
    : "";

  const concentrationActionBlock = concentration
    ? `
      <section class="arkhanval-resolution-card__concentration-action">
        <button type="button" data-arkhanval-concentration-validate${concentration.validated ? " disabled" : ""}>
          ${concentration.validated ? "Jet de Concentration validé" : "Valider le jet de Concentration"}
        </button>
      </section>
    `
    : "";

  const experienceActionBlock = result.experienceEligible && experienceSource
    ? `
      <section class="arkhanval-resolution-card__experience-action">
        <button type="button" data-arkhanval-experience-roll>
          ${escapeHtml(game.i18n.localize("ARKHANVAL.Phase04.RollExperienceDie"))}
        </button>
      </section>
    `
    : "";

  const spellMaintenanceSuccess = spellMaintenance ? Number(result?.qr) > 0 : null;
  const spellMaintenanceClass = spellMaintenance
    ? spellMaintenanceSuccess
      ? " arkhanval-resolution-card--spell-maintain-success"
      : " arkhanval-resolution-card--spell-maintain-failure"
    : "";
  const spellMaintenanceActorName = String(spellMaintenance?.actorName ?? "Le personnage");
  const spellMaintenanceNotice = spellMaintenance
    ? `
      <p class="arkhanval-resolution-card__spell-maintain-notice">
        ${spellMaintenanceSuccess
          ? `<strong>${escapeHtml(spellMaintenanceActorName)}</strong> parvient à maintenir son sortilège.`
          : `<strong>${escapeHtml(spellMaintenanceActorName)}</strong> ne parvient pas à maintenir son sortilège qui devra donc être lancé.`}
      </p>
    `
    : "";

  let combatBlock = "";
  let attackerDamageBlock = "";
  const combatTargets = combatContext?.enabled ? combatTargetList(combatContext) : [];
  const hasCombatTargets = combatTargets.length > 0;
  if (combatContext?.enabled) {
    const targets = combatTargets;
    const targetCount = targets.length;

    if (targetCount > 0) {
      const attackerDamageActions = [];
      const duelsMarkup = combatBranches(combatContext, combatState, result, attackerDamageActions);
      // Les actions de dégâts sont rattachées au personnage source (l'attaquant)
      // et non plus insérées entre le verdict et la carte Défenseur.
      attackerDamageBlock = attackerDamageActions.map(({ targetName, markup }) => `
        <section class="arkhanval-resolution-card__damage-action-panel">
          ${targetCount > 1 ? `<span class="arkhanval-resolution-card__damage-action-target">Dégâts contre ${escapeHtml(targetName)}</span>` : ""}
          ${markup}
        </section>
      `).join("");
      combatBlock = `
        <section class="arkhanval-resolution-card__combat">
          ${duelsMarkup}
        </section>
      `;
    } else {
      let targetMarkup = `<strong>Aucune cible Foundry</strong>`;
      let helperText = "Confrontation manuelle disponible.";

      if (combatContext.targetState === "invalid") {
        targetMarkup = `<strong>Cible non exploitable</strong>`;
        helperText = "La confrontation peut être renseignée manuellement.";
      }

      combatBlock = `
        <section class="arkhanval-resolution-card__combat">
          <div class="arkhanval-resolution-card__combat-heading">
            ${targetMarkup}
            ${combatContext?.technique
              ? `<strong class="arkhanval-resolution-card__combat-technique">Technique : ${escapeHtml(combatContext.technique.label ?? "Aucune")}</strong>`
              : ""}
            <span>${escapeHtml(helperText)}</span>
          </div>
          ${combatRollDisclosure(result)}
          ${manualCombatResult(combatState, result.qr)}
          ${!combatState?.manualResponse && result.qr !== null && result.qr !== undefined
            ? `<button type="button" data-arkhanval-combat-compare>Confronter les QR</button>`
            : ""}
        </section>
      `;
    }
  }

  const automaticEntries = [
    ...automatic,
    ...arkNotes,
    ...(mode ? [mode] : [])
  ];

  const diceCount = Array.from(plan.pool ?? []).length;
  const rank = Math.max(0, Number(plan?.rollSource?.rank ?? plan?.primaryRank) || 0);
  const qualityBlock = combatRollDisclosure(result);

  return `
    <article class="arkhanval-resolution-card${spellMaintenanceClass}${hasCombatTargets ? " arkhanval-resolution-card--combat-opposition" : ""}">
      <section class="arkhanval-resolution-card__shell${hasCombatTargets ? " arkhanval-resolution-card__shell--attacker" : ""}">
        <header class="arkhanval-resolution-card__hero">
          ${resolutionPortraitMarkup(chatActor?.img ? chatActor : {
            img: combatContext?.attacker?.tokenImg ?? chatActor?.img ?? "",
            name: combatContext?.attacker?.name ?? chatActor?.name ?? "Personnage"
          })}
          <div class="arkhanval-resolution-card__hero-main">
            <h3>${escapeHtml(plan.skillName)}${second}</h3>
            <div class="arkhanval-resolution-card__hero-rank">Rang ${rank}</div>
          </div>
          ${resolutionArchetypeMarkup(plan)}
        </header>

        <section class="arkhanval-resolution-card__stats-block">
          <div class="arkhanval-resolution-card__stat">
            <span class="arkhanval-resolution-card__stat-label">Nombre de dés</span>
            <strong class="arkhanval-resolution-card__stat-value">${escapeHtml(plan.poolLabel || `${diceCount} dé${diceCount > 1 ? "s" : ""}`)}</strong>
          </div>
          <div class="arkhanval-resolution-card__stat arkhanval-resolution-card__stat--fd">
            <span class="arkhanval-resolution-card__stat-label">FD</span>
            <strong class="arkhanval-resolution-card__stat-value">${escapeHtml(fd)}</strong>
          </div>
        </section>

        ${automaticEntries.length
          ? `<section class="arkhanval-resolution-card__info-block"><div class="arkhanval-resolution-card__info-content">${automaticEntries.map((entry) => `<p>${escapeHtml(entry)}</p>`).join("")}</div></section>`
          : ""}

        ${qualityBlock}

        ${arkRerollActionBlock}
        ${hasCombatTargets && combatArkDecisionBlock({ side: "attacker", decision: combatState?.attackerArk, targetKey: "" })
          ? `<section class="arkhanval-resolution-card__rerolls">${combatArkDecisionBlock({ side: "attacker", decision: combatState?.attackerArk, targetKey: "" })}</section>`
          : ""}
        ${experienceActionBlock}
        ${attackerDamageBlock}
        ${progressBlock}
        ${incantationProgressActionBlock}
        ${workProgressActionBlock}
        ${bookProgressActionBlock}
        ${concentrationActionBlock}
      </section>

      ${spellMaintenanceNotice}
      ${combatBlock}

      ${result.comparisonTie
        ? `<p class="arkhanval-resolution-card__warning">${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.TieNoTiebreaker"))}</p>`
        : ""}
    </article>
  `;
}


function retainedAttemptIndex(result) {
  let attemptIndex = result?.selectedAttemptIndex;
  if ((!Number.isInteger(attemptIndex) || attemptIndex < 0) && result?.attempts?.length === 1) {
    attemptIndex = 0;
  }
  return Number.isInteger(attemptIndex) && attemptIndex >= 0 ? attemptIndex : null;
}

function arkRerollDiceCount(result) {
  const attemptIndex = retainedAttemptIndex(result);
  if (attemptIndex === null) return 0;

  const attempt = result.attempts?.[attemptIndex];
  const d10Count = (attempt?.chains ?? [])
    .filter((chain) => Number(chain?.initialFaces) === 10)
    .length;
  return Math.min(2, d10Count);
}

function hasAvailableArkCircle(actor) {
  // Les cercles sont propres à la vue PJ, y compris lors d'une reconstruction.
  if (actor?.getFlag?.("arkhanval", "viewMode") === "npc") return false;
  return ARKHANVAL_ARKS.some(
    (ark) => (Number(actor?.system?.arks?.[ark.id]?.circles) || 0) > 0
  );
}

export function documentSafeClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export async function postResolutionChatMessage(actor, result, options = {}) {
  const ChatMessageClass = globalThis.foundry?.documents?.ChatMessage ?? globalThis.ChatMessage;
  if (!ChatMessageClass) throw new Error("API ChatMessage de Foundry indisponible.");

  const rawExperienceSource = options.experienceSource ?? null;
  // Le mode enregistré sur l'Actor (y compris synthétique d'un token non lié)
  // gouverne la proposition. Les champs XP existants restent conservés.
  const experienceSource = result.experienceEligible
    && actor?.getFlag?.("arkhanval", "viewMode") !== "npc"
    ? rawExperienceSource
    : null;
  const availableArkRerollDiceCount = options.allowArkReroll !== false
    && actor?.getFlag?.("arkhanval", "viewMode") !== "npc"
    ? arkRerollDiceCount(result)
    : 0;
  const arkRerollOffered = availableArkRerollDiceCount > 0;
  const arkRerollAvailable = arkRerollOffered && hasAvailableArkCircle(actor);

  const incantationState = options.incantation
    ? {
        ...documentSafeClone(options.incantation),
        pendingQr: Number(result.qr) || 0,
        saved: Boolean(options.incantation.saved),
        result: documentSafeClone(result)
      }
    : null;

  const workState = options.work
    ? {
        ...documentSafeClone(options.work),
        pendingQr: Number(result.qr) || 0,
        saved: Boolean(options.work.saved),
        result: documentSafeClone(result)
      }
    : null;

  const bookState = options.book
    ? {
        ...documentSafeClone(options.book),
        pendingQr: Number(result.qr) || 0,
        saved: Boolean(options.book.saved),
        result: documentSafeClone(result)
      }
    : null;

  const chatOptions = {
    progressGain: options.progressGain ?? null,
    arkBoost: options.arkBoost ?? "",
    arkReroll: options.arkReroll ?? null,
    experienceSource,
    arkRerollAvailable,
    arkRerollOffered,
    arkRerollDiceCount: availableArkRerollDiceCount,
    combatContext: options.combatContext ?? null,
    combatState: options.combatState ?? null,
    combatAutoResponse: options.combatAutoResponse ?? null,
    incantation: incantationState,
    work: workState,
    book: bookState,
    concentration: options.concentration
      ? {
          ...documentSafeClone(options.concentration),
          qr: Number(result.qr) || 0,
          result: documentSafeClone(result)
        }
      : null,
    spellMaintenance: options.spellMaintenance
      ? documentSafeClone(options.spellMaintenance)
      : null,
    chatActor: actor
      ? {
          name: String(actor?.name ?? ""),
          img: String(actor?.img ?? "")
        }
      : null
  };

  const flags = { arkhanval: {} };
  if (options.actionChainParentMessageId) {
    flags.arkhanval.actionChainParentMessageId = String(options.actionChainParentMessageId);
  }

  if (experienceSource) {
    flags.arkhanval.experience = {
      source: experienceSource,
      used: false
    };
  }

  if (chatOptions.incantation) {
    flags.arkhanval.incantation = documentSafeClone(chatOptions.incantation);
  }

  if (chatOptions.work) {
    flags.arkhanval.work = documentSafeClone(chatOptions.work);
  }

  if (chatOptions.book) {
    flags.arkhanval.book = documentSafeClone(chatOptions.book);
  }

  if (chatOptions.concentration) {
    flags.arkhanval.concentration = documentSafeClone(chatOptions.concentration);
  }

  if (chatOptions.combatContext?.enabled) {
    const attackerArk = {
      available: arkRerollAvailable,
      diceCount: arkRerollAvailable ? availableArkRerollDiceCount : 0,
      choice: arkRerollAvailable ? "" : "no",
      locked: !arkRerollAvailable
    };
    const responses = {};
    const auto = chatOptions.combatAutoResponse;
    if (auto?.targetKey && auto?.response) {
      const response = documentSafeClone(auto.response);
      const arkDecision = response.arkDecision ?? {
        available: false,
        diceCount: 0,
        choice: "no",
        locked: true
      };
      responses[String(auto.targetKey)] = {
        mode: String(response.mode ?? "roll"),
        qr: Number(response.qr) || 0,
        skillName: String(response.skillName ?? ""),
        skillIdentifier: String(response.skillIdentifier ?? ""),
        result: response.result ?? null,
        combat: response.combat ?? null,
        spellOrder: response.spellOrder ?? null,
        attackerFdModifier: Number(response.attackerFdModifier) || 0,
        userId: String(auto.userId ?? "system"),
        arkDecision,
        finalized: Boolean(attackerArk.locked && arkDecision.locked)
      };
    }

    flags.arkhanval.combat = {
      context: chatOptions.combatContext,
      attackerQr: result.qr,
      attackResult: result,
      attackerArk,
      responses,
      chatOptions: {
        progressGain: chatOptions.progressGain,
        arkBoost: chatOptions.arkBoost,
        // Conserver la proposition filtrée, sinon une reconstruction ultérieure
        // de la carte de combat réintroduit l'XP d'un PNJ.
        experienceSource,
        arkRerollAvailable,
        arkRerollDiceCount: availableArkRerollDiceCount,
        chatActor: chatOptions.chatActor ?? {
          img: chatOptions.combatContext?.attacker?.tokenImg ?? "",
          name: chatOptions.combatContext?.attacker?.name ?? "Personnage"
        }
      }
    };
    chatOptions.combatState = flags.arkhanval.combat;
  }

  if (arkRerollOffered) {
    flags.arkhanval.reroll = {
      result,
      used: false,
      chatOptions: {
        progressGain: chatOptions.progressGain,
        arkBoost: chatOptions.arkBoost,
        // Même invariant pour les relances : aucun XP caché à réafficher.
        experienceSource,
        combatContext: chatOptions.combatContext,
        combatAutoResponse: chatOptions.combatAutoResponse,
        incantation: chatOptions.incantation,
        work: chatOptions.work,
        book: chatOptions.book,
        concentration: chatOptions.concentration,
        spellMaintenance: chatOptions.spellMaintenance,
        chatActor: chatOptions.chatActor
      }
    };
  }

  return ChatMessageClass.create({
    speaker: ChatMessageClass.getSpeaker({ actor }),
    content: buildResolutionChatContent(result, chatOptions),
    flags: Object.keys(flags.arkhanval).length ? documentSafeClone(flags) : {}
  });
}
