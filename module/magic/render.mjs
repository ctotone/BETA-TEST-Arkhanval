import {
  combatantBlock,
  combatTechniqueDamageActions,
  resolutionPortraitMarkup,
  resolutionArchetypeMarkup
} from "../resolution/chat.mjs";
import { resolveCombatConfrontation } from "../combat/context.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// La magie utilise les mêmes portraits, badges et enveloppes que le jet classique.
// Les snapshots sont enregistrés dans les flags : pas de recherche DOM au re-render.
export function spellHeaderMarkup(resolution = {}) {
  const caster = resolution?.caster ?? {};
  const portrait = {
    name: String(caster?.name ?? "Magicien"),
    img: String(caster?.img ?? caster?.tokenImg ?? "")
  };
  const archetype = resolutionArchetypeMarkup({ skillIdentifier: String(resolution?.castingSkill ?? "") });
  const spellImage = String(resolution?.spellImg ?? "").trim()
    || "systems/arkhanval/assets/items/sortileges/sortilege.webp";
  const badge = archetype || `<span class="arkhanval-resolution-card__archetype-badge" title="Sortilège"><img src="${escapeHtml(spellImage)}" alt="Sortilège"></span>`;
  return `
    <header class="arkhanval-resolution-card__hero arkhanval-spell-resolution__hero">
      ${resolutionPortraitMarkup(portrait)}
      <div class="arkhanval-resolution-card__hero-main"><h3>Sortilège</h3></div>
      ${badge}
    </header>
  `;
}

export function spellInfoMarkup(resolution = {}) {
  const description = String(resolution?.spellDescriptionHtml ?? "").trim();
  const finished = Boolean(resolution?.finalDecision?.choice);
  return `
    <section class="arkhanval-resolution-card__info-block arkhanval-spell-resolution__info">
      <h4 class="arkhanval-spell-resolution__name">${escapeHtml(resolution?.spellName ?? "Sortilège")}</h4>
      <p class="arkhanval-spell-resolution__state">${finished ? "Sortilège lancé" : resolution?.premature ? "Incantation libérée avant l’objectif prévu" : "Incantation prête à être libérée"}</p>
      ${resolution?.premature && !finished ? `<p class="arkhanval-incantation-release__warning">Libération anticipée — résolution laissée au MJ.</p>` : ""}
      ${description ? `<details class="arkhanval-spell-resolution__spell-details">
        <summary><strong>Description du sortilège</strong></summary>
        <div class="arkhanval-richtext arkhanval-spell-resolution__spell-description">${description}</div>
      </details>` : ""}
    </section>
  `;
}

// Avant décision : deux choix. Après enregistrement : seule l'action retenue
// reste visible, désactivée et bleutée ; aucune option abandonnée n'est affichée.
export function finalDecisionMarkup(resolution = {}) {
  const choice = String(resolution?.finalDecision?.choice ?? "");
  const completed = choice === "consume" || choice === "keep";
  const options = [
    ["consume", "et réinitialiser l’incantation", "incantation réinitialisée"],
    ["keep", "et conserver l’incantation", "incantation conservée"]
  ];
  return `
    <section class="arkhanval-spell-resolution__final" data-arkhanval-spell-final>
      <div class="arkhanval-spell-resolution__actions">
        ${options.filter(([value]) => !completed || value === choice).map(([value, after, done]) => `
          <div class="arkhanval-spell-resolution__action-panel">
            <button type="button" class="arkhanval-spell-resolution__decision-button${completed ? " is-completed" : ""}"
              ${completed ? "disabled" : `data-arkhanval-spell-final-decision="${value}"`}>
              <span class="arkhanval-spell-resolution__button-title">${completed ? "Sortilège lancé" : "Lancer le sortilège"}</span>
              <span class="arkhanval-spell-resolution__button-detail">${completed ? done : after}</span>
            </button>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function visual(snapshot, fallback = "Personnage") {
  const name = String(snapshot?.name ?? fallback);
  const img = String(snapshot?.img ?? snapshot?.tokenImg ?? "icons/svg/mystery-man.svg");
  return `
    <header class="arkhanval-resolution-card__hero">
      ${resolutionPortraitMarkup({ name, img })}
      <div class="arkhanval-resolution-card__hero-main"><h3>${escapeHtml(name)}</h3></div>
      <span class="arkhanval-resolution-card__archetype-badge arkhanval-spell-resolution__target-badge" aria-hidden="true"><i class="fa-solid fa-shield-halved"></i></span>
    </header>
  `;
}

function orderMarkup(spellOrder = null) {
  if (!spellOrder) {
    return `
      <section class="arkhanval-resolution-card__combat-judge arkhanval-resolution-card__combat-judge--pending">
        <strong>Détermination de l’ordre</strong>
        <span>QR magique ou Art du combat indisponible.</span>
      </section>
    `;
  }
  const magicQr = Number(spellOrder.magicQr) || 0;
  const artCombatQr = Number(spellOrder.artCombatQr) || 0;
  const spellName = String(spellOrder.spellName ?? "Sortilège");
  const spellFirst = String(spellOrder.order ?? "") === "spell-first";
  return `
    <section class="arkhanval-resolution-card__combat-judge arkhanval-resolution-card__combat-judge--resolved arkhanval-resolution-card__spell-order">
      <strong>Détermination de l’ordre</strong>
      <div class="arkhanval-resolution-card__combat-judge-qrs">
        <span>Magie — QR <strong>${magicQr}</strong></span>
        <span>Art du combat — QR <strong>${artCombatQr}</strong></span>
      </div>
      <strong class="arkhanval-resolution-card__combat-judge-verdict">${escapeHtml(spellFirst ? `${spellName} agit avant l’attaque` : `Attaque / dégâts avant ${spellName}`)}</strong>
    </section>
  `;
}

function targetQuestion(resolution, target) {
  const name = String(resolution?.caster?.name ?? "le magicien");
  const key = escapeHtml(target?.key ?? "");
  return `
    <section class="arkhanval-resolution-card__combatant arkhanval-resolution-card__combatant--defender arkhanval-spell-resolution__target" data-spell-target-key="${key}">
      <div class="arkhanval-resolution-card__combatant-body">
        ${visual(target, "Défenseur")}
        <section class="arkhanval-resolution-card__combatant-choice-panel">
          <p class="arkhanval-resolution-card__combatant-choice-prompt">Souhaites-tu t’opposer à <strong>${escapeHtml(name)}</strong> via une action physique ?</p>
          <div class="arkhanval-resolution-card__combatant-actions arkhanval-spell-resolution__actions">
            <button type="button" data-arkhanval-spell-target-response="none" data-target-key="${key}">Ne rien faire</button>
            <button type="button" data-arkhanval-spell-target-response="oppose" data-target-key="${key}">S’opposer</button>
          </div>
          <small class="arkhanval-chat-action-context">${escapeHtml(target?.name ?? "Défenseur")} — En attente de réponse</small>
        </section>
      </div>
    </section>
  `;
}

function noOppositionBlock(target) {
  return `
    <section class="arkhanval-resolution-card__combatant arkhanval-resolution-card__combatant--defender arkhanval-spell-resolution__target arkhanval-spell-resolution__target--resolved">
      <div class="arkhanval-resolution-card__combatant-body">
        ${visual(target, "Défenseur")}
        <section class="arkhanval-resolution-card__info-block"><div class="arkhanval-resolution-card__info-content"><p>Aucune opposition physique.</p></div></section>
      </div>
    </section>
  `;
}

function terminalTargetBlock(target) {
  return `
    <section class="arkhanval-resolution-card__combatant arkhanval-resolution-card__combatant--defender arkhanval-spell-resolution__target arkhanval-spell-resolution__target--resolved">
      <div class="arkhanval-resolution-card__combatant-body">
        ${visual(target, "Défenseur")}
        <section class="arkhanval-resolution-card__info-block"><div class="arkhanval-resolution-card__info-content"><p>Réponse de la cible traitée.</p></div></section>
      </div>
    </section>
  `;
}

function oppositionDefenderBlock(target, response, combat) {
  const key = String(target?.key ?? "");
  if (!response) {
    return `
      <section class="arkhanval-resolution-card__combatant arkhanval-resolution-card__combatant--defender arkhanval-spell-resolution__target">
        <div class="arkhanval-resolution-card__combatant-body">
          ${visual(target, "Défenseur")}
          <section class="arkhanval-resolution-card__info-block"><div class="arkhanval-resolution-card__info-content"><p>Opposition physique engagée.</p></div></section>
        </div>
      </section>
    `;
  }
  const finalized = Boolean(response?.finalized);
  const damageState = combat?.damage?.[key] ?? null;
  let footer = "";
  if (damageState) {
    footer = `<small class="arkhanval-resolution-card__damage-resolved">${escapeHtml(damageState.label ?? "Dégâts résolus")}</small>`;
  } else if (finalized) {
    const confrontation = resolveCombatConfrontation(0, Number(response?.qr) || 0);
    if (confrontation.hit && confrontation.winner === "defender") {
      footer = combatTechniqueDamageActions(combat?.context ?? {}, response, "defender", key);
    }
  }
  return combatantBlock({
    side: "defender",
    snapshot: { name: target?.name, tokenImg: target?.img },
    result: response?.result ?? null,
    qr: response?.qr ?? 0,
    skillName: response?.skillName ?? "",
    technique: response?.combat?.technique ?? null,
    contextNote: "FD −2 — magicien sans défense",
    responseMode: response?.result ? "roll" : "manual",
    arkDecision: response?.arkDecision ?? null,
    finalized,
    targetKey: key,
    footer
  });
}

function spellTargetVerdict(target, spellResponse, combatResponse, combat) {
  if (!spellResponse) return `<section class="arkhanval-resolution-card__combat-judge arkhanval-resolution-card__combat-judge--pending"><strong>Réponse en attente</strong></section>`;
  if (spellResponse.choice === "none") return `<section class="arkhanval-resolution-card__combat-judge arkhanval-resolution-card__combat-judge--resolved"><strong>Aucune opposition</strong></section>`;
  // La magie n'est pas un jet d'attaque armée (QR fictive 0 côté combat).
  // Le verdict affiché conserve donc la détermination d'ordre déjà calculée.
  return orderMarkup(combatResponse?.spellOrder ?? null);
}

// Une seule définition des préconditions, partagée par le rendu et le traitement
// autoritaire. Une décision de carte ne doit pas court-circuiter ses oppositions.
export function spellResolutionCanFinalize(resolution = {}, combat = null) {
  if (String(resolution?.mode ?? "") !== "opposed") return true;
  const targets = Array.from(resolution?.targets ?? []);
  const responses = resolution?.responses ?? {};
  if (!targets.length || !targets.every((target) => Boolean(responses[String(target?.key ?? "")]))) return false;
  return targets.every((target) => {
    const key = String(target?.key ?? "");
    if (responses[key]?.choice !== "oppose") return true;
    const response = combat?.responses?.[key] ?? null;
    if (!response?.finalized) return false;
    if (String(response?.spellOrder?.order ?? "") === "attack-first") {
      const confrontation = resolveCombatConfrontation(0, Number(response?.qr) || 0);
      if (confrontation.hit && confrontation.winner === "defender" && !combat?.damage?.[key]) return false;
    }
    return true;
  });
}

export function buildUnifiedSpellOppositionChatContent(resolution = {}, combat = null) {
  const targets = Array.from(resolution?.targets ?? []);
  const spellResponses = resolution?.responses ?? {};
  const combatResponses = combat?.responses ?? {};
  const canFinalize = spellResolutionCanFinalize(resolution, combat);
  const finalDecisionMade = Boolean(resolution?.finalDecision?.choice);
  const branches = targets.map((target) => {
    const key = String(target?.key ?? "");
    const spellResponse = spellResponses[key] ?? null;
    let defender = "";
    if (!spellResponse) {
      if (finalDecisionMade) {
        defender = terminalTargetBlock(target);
      } else {
        defender = targetQuestion(resolution, target);
      }
    } else if (spellResponse.choice === "none") {
      defender = noOppositionBlock(target);
    } else {
      defender = oppositionDefenderBlock(target, combatResponses[key] ?? null, combat);
    }
    return `<section class="arkhanval-resolution-card__combat-duel" data-combat-target-key="${escapeHtml(key)}">${defender}</section>`;
  }).join("");

  return `
    <article class="arkhanval-resolution-card arkhanval-resolution-card--combat-opposition arkhanval-incantation-release arkhanval-spell-resolution arkhanval-spell-resolution--unified">
      <section class="arkhanval-resolution-card__shell arkhanval-resolution-card__shell--attacker arkhanval-spell-resolution__caster">
        ${spellHeaderMarkup(resolution)}
        ${spellInfoMarkup(resolution)}
        ${canFinalize ? finalDecisionMarkup(resolution) : ""}
      </section>
      ${targets.length ? `<div class="arkhanval-resolution-card__combat-confrontations">
        <div class="arkhanval-resolution-card__combat-summaries">
          ${targets.map((target) => {
            const key = String(target?.key ?? "");
            return `<div class="arkhanval-resolution-card__combat-summary" data-combat-summary-key="${escapeHtml(key)}">
              ${targets.length > 1 ? `<span class="arkhanval-resolution-card__combat-summary-target">Contre ${escapeHtml(target?.name ?? "Défenseur")}</span>` : ""}
              ${spellTargetVerdict(target, spellResponses[key] ?? null, combatResponses[key] ?? null, combat)}
            </div>`;
          }).join("")}
        </div>
        <div class="arkhanval-resolution-card__combat-duels">${branches}</div>
      </div>` : `<p class="arkhanval-incantation-release__warning">Aucune cible sélectionnée.</p>`}
    </article>
  `.trim();
}
