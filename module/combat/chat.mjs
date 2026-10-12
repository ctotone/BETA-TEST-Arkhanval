import { showEvaluatedRoll, showEvaluatedDiceBatch } from "../integrations/dice-so-nice.mjs";
import {
  calculateCombatDamageTotal,
  captureCombatRollContext,
  combatAttackerQrForResponse,
  equippedProtection,
  equippedProtectionTags,
  isDirectCombatSkill,
  resolveCombatConfrontation
} from "./context.mjs";
import {
  experienceSourceFromRollRequest,
  promptSkillRoll
} from "../resolution/dialog.mjs";
import {
  rerollSelectedD10,
  resolveRoll
} from "../resolution/engine.mjs";
import { listActorSkills } from "../resolution/skills.mjs";
import { buildResolutionChatContent, documentSafeClone, postResolutionChatMessage } from "../resolution/chat.mjs";
import { buildUnifiedSpellOppositionChatContent } from "../magic/render.mjs";
import {
  promptArkRerollSelection,
  promptRerollResultChoice,
  spendArkCircle
} from "../progression.mjs";
import { promptArkRollRequest } from "../arks.mjs";
import { weaponUsageTagForSkill } from "../rules/catalog.mjs";
import {
  buildCombatRuleModifiers,
  buildDamageRuleModifiers,
  buildProtectionRuleModifiers
} from "../rules/evaluator.mjs";
import {
  resolveDamageWound,
  resolveFixedWound,
  woundStateMatches
} from "./wounds.mjs";
import {
  canUseSecondaryEffectTable,
  effectFollowupLabel,
  effectIsAssistedState,
  maladresseEffectFor,
  secondaryEffectFor
} from "./secondary-effects.mjs";
import { stateItemData, statePresetSummary } from "../state-presets.mjs";
import { scheduleRoundReminder } from "./round-tracker.mjs";
import { artCombatCreditContext, artCombatResultContext, consumeArtCombatCredit, restoreArtCombatCredit } from "../art-of-combat.mjs";
import { cancelAllSpellIncantations, combatIncantationSnapshot } from "../magic/incantation.mjs";

const { DialogV2 } = foundry.applications.api;
const SOCKET_CHANNEL = "system.arkhanval";
const SOCKET_TYPE_RESPONSE = "combat-response-submit";
const SOCKET_TYPE_INCANTATION_ABANDON = "combat-incantation-abandon";
const SOCKET_TYPE_ARK_DECISION = "combat-ark-decision";
const SOCKET_TYPE_FINALIZE = "combat-finalize";
const SOCKET_TYPE_DAMAGE = "combat-damage-request";
const SOCKET_TYPE_WOUND = "combat-wound-request";
const SOCKET_TYPE_STATE = "combat-state-request";
const SOCKET_TYPE_MALADRESSE_PLAYER = "combat-maladresse-player-roll";
const SOCKET_TYPE_SECONDARY_DAMAGE = "combat-secondary-extra-damage";
const SOCKET_TYPE_SECONDARY_WOUND = "combat-secondary-extra-wound";
const SOCKET_TYPE_SECONDARY_SKILL = "combat-secondary-skill-complete";
const SOCKET_TYPE_ART_CREDIT_REROLL = "combat-art-credit-reroll";
const SOCKET_TYPE_DAMAGE_ART_CREDIT_REROLL = "combat-damage-art-credit-reroll";
const SOCKET_TYPE_ART_CREDIT_DECLINE = "combat-art-credit-decline";
const pendingDamageRequests = new Set();
const pendingWoundRequests = new Set();
const pendingStateRequests = new Set();
const pendingMaladressePlayerRequests = new Set();
const pendingPrivateSecondaryPublications = new Set();
const pendingSecondaryDamageRequests = new Set();
const pendingSecondaryWoundRequests = new Set();
const pendingSecondarySkillRequests = new Set();
const pendingArtCreditRerollRequests = new Set();
const pendingDamageArtCreditRerollRequests = new Set();
const ART_CREDIT_ICON_SMALL = "systems/arkhanval/assets/icones/art-combat/credit-relance.webp";

function appendArtCreditActionLabel(host) {
  const icon = document.createElement("img");
  icon.src = ART_CREDIT_ICON_SMALL;
  icon.alt = "";
  icon.className = "arkhanval-art-credit-icon arkhanval-art-credit-icon--action";

  const text = document.createElement("span");
  text.textContent = "Utiliser un crédit de relance :";

  host.classList.add("arkhanval-art-credit-action-label");
  host.append(icon, text);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function selectedSpellTargetSnapshots() {
  return Array.from(game.user?.targets ?? []).map((token) => {
    const document = token?.document ?? token ?? null;
    const actor = token?.actor ?? document?.actor ?? null;
    return {
      tokenId: String(token?.id ?? document?.id ?? ""),
      actorUuid: String(actor?.uuid ?? ""),
      actorId: String(actor?.id ?? document?.actorId ?? ""),
      sceneId: String(document?.parent?.id ?? globalThis.canvas?.scene?.id ?? "")
    };
  });
}

function readFormValue(formData, key, fallback = "") {
  if (!formData) return fallback;
  if (typeof formData.get === "function") return formData.get(key) ?? fallback;
  return formData[key] ?? fallback;
}

function signed(value) {
  const number = Number(value) || 0;
  return number > 0 ? `+${number}` : String(number);
}

function displayRollFormula(formula) {
  return String(formula ?? "")
    .replace(/(\d+)d10x10\b/g, "$1d10");
}

function actorItems(actor) {
  if (!actor?.items) return [];
  if (Array.isArray(actor.items)) return actor.items;
  if (typeof actor.items.values === "function") return Array.from(actor.items.values());
  if (typeof actor.items[Symbol.iterator] === "function") return Array.from(actor.items);
  return [];
}

function actorItemById(actor, itemId) {
  const wanted = String(itemId ?? "");
  if (!wanted) return null;
  if (typeof actor?.items?.get === "function") return actor.items.get(wanted) ?? null;
  return actorItems(actor).find((item) => String(item?.id ?? "") === wanted) ?? null;
}

function combatTargets(combat) {
  const targets = Array.from(combat?.context?.targets ?? []);
  if (targets.length) return targets;
  return combat?.context?.target ? [combat.context.target] : [];
}

function targetByKey(combat, key) {
  return combatTargets(combat).find((target) =>
    String(target?.key ?? target?.tokenId ?? target?.actorUuid ?? "") === String(key ?? "")
  ) ?? null;
}

function actorFromTargetDocument(target) {
  const sceneId = String(target?.sceneId ?? "");
  const tokenId = String(target?.tokenId ?? "");
  if (sceneId && tokenId) {
    const scene = game.scenes?.get?.(sceneId) ?? null;
    const token = scene?.tokens?.get?.(tokenId) ?? null;
    if (token?.actor) return token.actor;
  }

  if (tokenId && globalThis.canvas?.scene?.id === sceneId) {
    const actor = globalThis.canvas?.tokens?.get?.(tokenId)?.actor ?? null;
    if (actor) return actor;
  }

  const actorId = String(target?.actorId ?? "");
  if (actorId) {
    const actor = game.actors?.get?.(actorId) ?? null;
    if (actor) return actor;
  }

  return null;
}

async function actorFromTarget(target) {
  const direct = actorFromTargetDocument(target);
  if (direct) return direct;

  const uuid = String(target?.actorUuid ?? "");
  if (!uuid) return null;
  try {
    if (typeof globalThis.fromUuid === "function") return await globalThis.fromUuid(uuid);
  } catch (error) {
    console.warn("Arkhanval | Actor cible introuvable depuis UUID", uuid, error);
  }
  return null;
}

function targetControlActors(target) {
  const actors = [];

  const sceneId = String(target?.sceneId ?? "");
  const tokenId = String(target?.tokenId ?? "");
  if (sceneId && tokenId) {
    const scene = game.scenes?.get?.(sceneId) ?? null;
    const tokenActor = scene?.tokens?.get?.(tokenId)?.actor ?? null;
    if (tokenActor) actors.push(tokenActor);
  }

  const actorId = String(target?.actorId ?? "");
  if (actorId) {
    const sourceActor = game.actors?.get?.(actorId) ?? null;
    if (sourceActor && !actors.includes(sourceActor)) actors.push(sourceActor);
  }

  const uuid = String(target?.actorUuid ?? "");
  if (uuid && typeof globalThis.fromUuidSync === "function") {
    try {
      const uuidActor = globalThis.fromUuidSync(uuid);
      if (uuidActor && !actors.includes(uuidActor)) actors.push(uuidActor);
    } catch (_error) {
      // The scene/token and source Actor checks above are authoritative enough.
    }
  }

  return actors;
}

function userCanControlTarget(user, target) {
  if (!user || !target) return false;
  if (user.isGM) return true;
  return targetControlActors(target).some((actor) => userCanControlActor(user, actor));
}

function activePlayerOwnersForTarget(target) {
  return Array.from(game.users ?? []).filter((user) =>
    Boolean(user?.active && !user?.isGM && userCanControlTarget(user, target))
  );
}

function actorFromTargetSync(target) {
  const direct = actorFromTargetDocument(target);
  if (direct) return direct;

  const uuid = String(target?.actorUuid ?? "");
  if (!uuid) return null;
  try {
    if (typeof globalThis.fromUuidSync === "function") return globalThis.fromUuidSync(uuid);
  } catch (_error) {
    return null;
  }
  return null;
}


function combatRuleContexts(skillIdentifier) {
  const tag = weaponUsageTagForSkill(skillIdentifier);
  if (tag === "combat.ranged") return ["combat", "combat.ranged"];
  if (tag === "combat.thrown") return ["combat", "combat.thrown"];
  if (tag === "combat.unarmed") return ["combat", "combat.unarmed"];
  if (tag === "combat.one-handed" || tag === "combat.two-handed") {
    return ["combat", "combat.melee"];
  }
  return ["combat"];
}

function selectedWeaponForSide(combat, response, side) {
  if (side === "attacker") return combat?.context?.selectedWeapon ?? null;
  return response?.combat?.selectedWeapon ?? null;
}

function skillIdentifierForSide(combat, response, side) {
  if (side === "attacker") {
    return String(
      combat?.context?.skillIdentifier ??
      combat?.attackResult?.plan?.skillIdentifier ??
      ""
    );
  }
  return String(
    response?.combat?.skillIdentifier
    ?? response?.skillIdentifier
    ?? response?.result?.plan?.skillIdentifier
    ?? ""
  );
}

function skillRankForSide(combat, response, side) {
  if (side === "attacker") {
    return Number(combat?.attackResult?.plan?.primaryRank) || 0;
  }
  return Number(response?.result?.plan?.primaryRank) || 0;
}

function combatDefenseOnlyForSide(combat, response, side) {
  const snapshot = side === "attacker"
    ? combat?.context?.combatRules
    : response?.combat?.combatRules;
  return Boolean(snapshot?.defenseOnly);
}

function combatTechniqueForSide(combat, response, side) {
  const technique = side === "attacker"
    ? combat?.context?.technique
    : response?.combat?.technique;
  return {
    id: String(technique?.id ?? "none") || "none",
    label: String(technique?.label ?? "Aucune") || "Aucune",
    fdModifier: Number(technique?.fdModifier) || 0
  };
}

function allowedDamageModesForTechnique(technique) {
  switch (String(technique?.id ?? "none")) {
    case "feinte":
      return new Set(["normal", "bonus-d10", "feint-effect"]);
    case "mode-agressif":
      return new Set(["normal", "bonus-d10"]);
    case "posture-defensive":
      return new Set(["minus5"]);
    case "viser":
      return Number(technique?.fdModifier) <= -2
        ? new Set(["normal"])
        : new Set(["normal", "bonus-d10"]);
    case "prise-mains-nues":
      return new Set(["unarmed-none", "unarmed-light", "unarmed-immobilize"]);
    case "coups-speciaux":
      return new Set(["normal"]);
    default:
      return new Set(["normal"]);
  }
}

function damageRuleSnapshotForSide(combat, response, side) {
  const snapshot = side === "attacker"
    ? combat?.context?.damageRules
    : response?.combat?.damageRules;

  if (!snapshot) return null;

  return {
    flatModifier: Number(snapshot.flatModifier) || 0,
    extraDice: Array.from(snapshot.extraDice ?? [])
      .map(Number)
      .filter((faces) => Number.isFinite(faces)),
    ignoreProtection: Boolean(snapshot.ignoreProtection),
    applied: Array.from(snapshot.applied ?? []).map((entry) => ({ ...entry })),
    notes: Array.from(snapshot.notes ?? []).map(String),
    warnings: Array.from(snapshot.warnings ?? []).map(String)
  };
}

function maladresseIgnoreProtectionForDamage(combat, targetKey, targetSide) {
  const side = String(targetSide ?? "");
  if (side === "attacker") {
    return Boolean(combat?.maladresses?.attacker?.ignoreProtectionForDamage);
  }
  if (side === "defender") {
    return Boolean(combat?.maladresses?.[`defender:${String(targetKey ?? "")}`]?.ignoreProtectionForDamage);
  }
  return false;
}

function snapshotForSide(combat, target, side) {
  return side === "attacker"
    ? combat?.context?.attacker ?? null
    : target ?? null;
}

function confrontationForTarget(combat, targetKey) {
  const response = combat?.responses?.[String(targetKey ?? "")] ?? null;
  if (!response) return null;
  const attackerQr = combatAttackerQrForResponse(combat?.attackResult, response);
  return resolveCombatConfrontation(attackerQr, response.qr);
}

function damageSidesForTarget(combat, target, targetKey) {
  const response = combat?.responses?.[String(targetKey ?? "")] ?? null;
  if (!response || !response.finalized) return null;

  const attackerQr = combatAttackerQrForResponse(combat?.attackResult, response);
  const confrontation = resolveCombatConfrontation(attackerQr, response.qr);
  if (!confrontation.hit || !confrontation.winner) return null;
  if (combatDefenseOnlyForSide(combat, response, confrontation.winner)) return null;

  const sourceSide = confrontation.winner;
  const targetSide = sourceSide === "attacker" ? "defender" : "attacker";

  return {
    response,
    confrontation,
    sourceSide,
    targetSide,
    sourceSnapshot: snapshotForSide(combat, target, sourceSide),
    targetSnapshot: snapshotForSide(combat, target, targetSide),
    sourceWeapon: selectedWeaponForSide(combat, response, sourceSide),
    targetWeapon: selectedWeaponForSide(combat, response, targetSide),
    sourceSkillIdentifier: skillIdentifierForSide(combat, response, sourceSide),
    targetSkillIdentifier: skillIdentifierForSide(combat, response, targetSide),
    sourceSkillRank: skillRankForSide(combat, response, sourceSide),
    targetSkillRank: skillRankForSide(combat, response, targetSide)
  };
}

function normalizeRollFormula(rawFormula) {
  const raw = String(rawFormula ?? "").trim();
  if (!raw) return "";
  return raw.startsWith("+") ? raw.slice(1).trim() : raw;
}

async function evaluateFormula(formula) {
  const normalized = normalizeRollFormula(formula);
  if (!normalized) return null;

  const RollClass = globalThis.Roll ?? globalThis.foundry?.dice?.Roll;
  if (!RollClass) throw new Error("API Roll de Foundry indisponible.");

  try {
    const roll = new RollClass(normalized);
    return await roll.evaluate();
  } catch (error) {
    throw new Error(`Formule de dégâts invalide : ${formula}`);
  }
}

function rollNaturalValues(roll) {
  const dice = Array.from(roll?.dice ?? []);
  return dice.flatMap((die) =>
    Array.from(die?.results ?? [])
      .filter((result) => result?.active !== false)
      .map((result) => Number(result?.result))
      .filter(Number.isFinite)
  );
}

function openD10Label(roll) {
  const values = rollNaturalValues(roll);
  if (!values.length) return String(Number(roll?.total) || 0);
  return `${values.join(" → ")}${values.length > 1 ? ` = ${Number(roll?.total) || 0}` : ""}`;
}


function dieNaturalValues(die) {
  return Array.from(die?.results ?? [])
    .filter((result) => result?.active !== false)
    .map((result) => Number(result?.result))
    .filter(Number.isFinite);
}

function openD10Snapshot(die, { id = "", bucket = "extra", index = 0 } = {}) {
  const values = dieNaturalValues(die);
  const fallbackTotal = values.reduce((sum, value) => sum + value, 0);
  const total = Number.isFinite(Number(die?.total)) ? Number(die.total) : fallbackTotal;
  return {
    id: String(id || `${bucket}:${index}`),
    bucket: String(bucket),
    index: Number(index) || 0,
    total,
    values,
    label: values.length
      ? `${values.join(" → ")}${values.length > 1 ? ` = ${total}` : ""}`
      : String(total)
  };
}

function damageArtCreditCandidates(damage) {
  return Array.from(damage?.rerollableD10s ?? [])
    .filter((entry) => entry && entry.id && Array.isArray(entry.values));
}

async function promptDamageArtCreditSelection(damage) {
  const candidates = damageArtCreditCandidates(damage);
  if (!candidates.length) return null;

  const rows = candidates.map((candidate) => `
    <label class="arkhanval-phase04-die-choice">
      <input type="radio" name="die" value="${escapeHtml(candidate.id)}">
      <span>d10 : <strong>${escapeHtml(candidate.label ?? String(candidate.total ?? "?"))}</strong></span>
    </label>
  `).join("");

  const formData = await DialogV2.input({
    window: { title: "Crédit de relance — dégâts" },
    classes: ["arkhanval", "arkhanval-popup-dialog", "arkhanval-popup-dialog--dice"],
    content: `
      <div class="arkhanval-phase04-dialog">
        <p>Choisissez le <strong>d10 ouvert de dégâts</strong> à relancer.</p>
        <div class="arkhanval-phase04-dice">${rows}</div>
      </div>
    `,
    modal: true,
    rejectClose: false,
    ok: {
      label: "Relancer",
      icon: "fa-solid fa-rotate",
      disabled: true
    },
    render: (_event, dialog) => {
      const attach = (remainingFrames = 3) => {
        const form = dialog?.form ?? dialog?.element?.querySelector?.("form") ?? null;
        if (!form) {
          if (remainingFrames > 0 && globalThis.requestAnimationFrame) {
            globalThis.requestAnimationFrame(() => attach(remainingFrames - 1));
          }
          return;
        }
        const radios = Array.from(form.querySelectorAll?.('input[name="die"][type="radio"]') ?? []);
        const okButton = dialog?.element?.querySelector?.('button[data-action="ok"]')
          ?? form.querySelector?.('button[data-action="ok"]')
          ?? form.querySelector?.('button[type="submit"]')
          ?? null;
        const refresh = () => {
          if (okButton) okButton.disabled = !radios.some((radio) => radio.checked);
        };
        if (form.dataset.arkhanvalDamageCreditBound !== "true") {
          form.dataset.arkhanvalDamageCreditBound = "true";
          form.addEventListener("change", refresh);
        }
        refresh();
      };
      attach();
    }
  });

  if (!formData) return null;
  const id = String(readFormValue(formData, "die", ""));
  return candidates.find((candidate) => candidate.id === id) ?? null;
}

async function promptDamageRerollResultChoice(previous, next) {
  const oldLabel = escapeHtml(previous?.label ?? String(previous?.total ?? "?"));
  const newLabel = escapeHtml(next?.label ?? String(next?.total ?? "?"));

  const choice = await DialogV2.wait({
    window: { title: "Crédit de relance — résultat retenu" },
    classes: ["arkhanval", "arkhanval-popup-dialog", "arkhanval-popup-dialog--reroll"],
    content: `
      <div class="arkhanval-phase04-dialog arkhanval-reroll-compare">
        <p>La relance a été effectuée. Choisissez le résultat à conserver.</p>
        <div class="arkhanval-reroll-compare__results">
          <div><strong>Ancien lancer</strong><p>d10 : <strong>${oldLabel}</strong></p></div>
          <div><strong>Nouveau lancer</strong><p>d10 : <strong>${newLabel}</strong></p></div>
        </div>
      </div>
    `,
    modal: true,
    rejectClose: true,
    buttons: [
      {
        action: "old",
        label: "Conserver l’ancien résultat",
        icon: "fa-solid fa-rotate-left"
      },
      {
        action: "new",
        label: "Conserver le nouveau résultat",
        icon: "fa-solid fa-check",
        default: true
      }
    ]
  });

  return choice === "old" ? "old" : "new";
}

function woundTrackState(actor) {
  const counts = { light: 0, serious: 0, critical: 0 };
  for (const item of actorItems(actor)) {
    if (item?.type !== "wound") continue;
    const severity = String(item.system?.severity ?? "");
    if (Object.hasOwn(counts, severity)) counts[severity] += 1;
  }

  const capacity = {
    light: Math.max(0, Number(actor?.system?.woundCapacity?.light) || 0),
    serious: Math.max(0, Number(actor?.system?.woundCapacity?.serious) || 0),
    critical: Math.max(0, Number(actor?.system?.woundCapacity?.critical) || 0)
  };

  return { counts, capacity };
}

function buildDamageWoundProposal(actor, total) {
  return {
    ...resolveDamageWound(total, woundTrackState(actor)),
    applied: false,
    appliedBy: "",
    itemId: ""
  };
}

function buildFixedWoundProposal(actor, severity) {
  return {
    ...resolveFixedWound(severity, woundTrackState(actor)),
    applied: false,
    appliedBy: "",
    itemId: ""
  };
}

function secondaryEffectsAllowed(damage) {
  return damage?.resolution?.allowSecondaryEffect !== false;
}

function woundSeverityLabel(severity) {
  switch (String(severity ?? "")) {
    case "light":
      return "Blessure légère";
    case "serious":
      return "Blessure grave";
    case "critical":
      return "Blessure critique";
    default:
      return "";
  }
}

function woundItemName(severity) {
  switch (String(severity ?? "")) {
    case "light":
      return game.i18n.localize("ARKHANVAL.Wounds.LightLabel");
    case "serious":
      return game.i18n.localize("ARKHANVAL.Wounds.SeriousLabel");
    case "critical":
      return game.i18n.localize("ARKHANVAL.Wounds.CriticalLabel");
    default:
      return "Blessure";
  }
}

function frenchList(values) {
  const entries = Array.from(values ?? []).map(String).filter(Boolean);
  if (entries.length <= 1) return entries[0] ?? "";
  if (entries.length === 2) return `${entries[0]} et ${entries[1]}`;
  return `${entries.slice(0, -1).join(", ")} et ${entries.at(-1)}`;
}

function woundFilledReason(filled) {
  const labels = Array.from(filled ?? []).map((severity) => ({
    light: "légères",
    serious: "graves",
    critical: "critiques"
  })[severity]).filter(Boolean);

  if (!labels.length) return "";
  return `(Blessures ${frenchList(labels)} déjà remplies)`;
}

function buildWoundChatSection(damage, { combatCard = false } = {}) {
  const wound = damage?.wound ?? null;
  if (!wound) return "";

  if (wound.kind === "none") {
    return `
      <section class="arkhanval-damage-card__wound" data-arkhanval-wound-section>
        <h4>Aucune blessure comptabilisée</h4>
      </section>
    `;
  }

  if (wound.kind === "mortal") {
    const reason = woundFilledReason(wound.filled);
    return `
      <section class="arkhanval-damage-card__wound arkhanval-damage-card__wound--mortal" data-arkhanval-wound-section>
        <h4>Seuil mortel atteint</h4>
        ${reason ? `<p class="arkhanval-damage-card__wound-reason">${escapeHtml(reason)}</p>` : ""}
        <p class="arkhanval-damage-card__wound-note">Intervention du MJ requise. Aucune conséquence n’est appliquée automatiquement.</p>
      </section>
    `;
  }

  const label = woundSeverityLabel(wound.severity);
  const reason = woundFilledReason(wound.filled);
  const needsFollowup = secondaryEffectsAllowed(damage)
    && ["serious", "critical"].includes(String(wound.severity ?? ""));
  const action = wound.applied
    ? `<button type="button" class="arkhanval-damage-card__wound-action" disabled>Blessure appliquée</button>`
    : combatCard
      ? `<button type="button" class="arkhanval-damage-card__wound-action" data-arkhanval-wound-apply>MJ — Appliquer la blessure</button>`
      : `<div class="arkhanval-chat-decision-block"><button type="button" class="arkhanval-damage-card__wound-action" data-arkhanval-wound-apply>Appliquer la blessure</button><small class="arkhanval-chat-action-context">MJ — Action attendue</small></div>`;
  const concentration = damage?.concentration ?? null;
  const concentrationTargetName = String(concentration?.actorName ?? "Le personnage");
  const concentrationNotice = concentration?.required && !concentration?.validated
    ? `<p class="arkhanval-damage-card__concentration-note">Une blessure de cette gravité nécessite un jet de Concentration de <strong>${escapeHtml(concentrationTargetName)}</strong> pour maintenir son incantation.</p>`
    : "";
  const concentrationAction = concentration?.required
    ? concentration?.validated
      ? `<button type="button" class="arkhanval-damage-card__concentration-action" disabled>Jet de Concentration traité</button>`
      : concentration?.rollMessageId
        ? `<button type="button" class="arkhanval-damage-card__concentration-action" disabled>Jet de Concentration lancé</button>`
        : `<button type="button" class="arkhanval-damage-card__concentration-action" data-arkhanval-concentration-roll>Jet de Concentration</button>`
    : "";

  return `
    <section class="arkhanval-damage-card__wound${combatCard ? " arkhanval-damage-card__wound--actions" : ""}" data-arkhanval-wound-section>
      ${combatCard ? "" : `<h4>${escapeHtml(label)}</h4>`}
      ${reason ? `<p class="arkhanval-damage-card__wound-reason">${escapeHtml(reason)}</p>` : ""}
      ${needsFollowup
        ? `<p class="arkhanval-damage-card__wound-note">Effet secondaire à résoudre par le MJ.</p>`
        : ""}
      ${action}
      ${concentrationNotice}
      ${concentrationAction}
    </section>
  `;
}

function damageVisual(snapshot, fallbackIcon = "fa-solid fa-user") {
  const img = String(snapshot?.tokenImg ?? "");
  if (img) return `<img src="${escapeHtml(img)}" alt="">`;
  return `<span><i class="${fallbackIcon}" aria-hidden="true"></i></span>`;
}

function buildSecondaryExtraDamageChatContent(damage) {
  const points = Number(damage?.total) || 0;
  const pointLabel = points === 1 ? "point de dégât" : "points de dégâts";
  const formula = String(damage?.derivedDamage?.formula ?? "2d10");
  const wound = damage?.wound ?? null;
  const woundLabel = wound?.kind === "wound"
    ? woundSeverityLabel(wound.severity)
    : wound?.kind === "mortal" ? "Seuil mortel atteint" : "Aucune blessure";

  // Même structure que le jet de dégâts normal, mais la provenance secondaire
  // et l'interdiction d'un nouvel effet secondaire restent inchangées.
  return `
    <article class="arkhanval-damage-card arkhanval-damage-card--combat arkhanval-damage-card--secondary">
      <header class="arkhanval-damage-card__header">
        <h3>Dégâts supplémentaires</h3>
      </header>

      <div class="arkhanval-damage-card__actors" aria-label="Source vers cible">
        <div class="arkhanval-damage-card__actor">${damageVisual(damage?.source)}</div>
        <i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i>
        <div class="arkhanval-damage-card__actor">${damageVisual(damage?.target, "fa-solid fa-crosshairs")}</div>
      </div>

      <details class="arkhanval-damage-card__details">
        <summary class="arkhanval-damage-card__total">
          <span class="arkhanval-damage-card__total-intro">L’effet secondaire inflige</span>
          <strong class="arkhanval-damage-card__total-value">${points}</strong>
          <span class="arkhanval-damage-card__total-unit">${pointLabel}</span>
          <span class="arkhanval-damage-card__total-wound">${escapeHtml(woundLabel)}</span>
        </summary>
        <div class="arkhanval-damage-card__details-body">
          <ul class="arkhanval-damage-card__breakdown">
            <li><span>Jet supplémentaire <em class="arkhanval-damage-card__die-formula">(${escapeHtml(displayRollFormula(formula))})</em></span><strong>${points}</strong></li>
            <li class="arkhanval-damage-card__breakdown-final"><span>Total des dégâts</span><strong>${points}</strong></li>
          </ul>
          <p class="arkhanval-damage-card__secondary-note">Cette blessure provient d’un effet secondaire et ne peut pas générer un nouvel effet secondaire.</p>
        </div>
      </details>

      ${buildWoundChatSection(damage, { combatCard: true })}
    </article>
  `;
}

function buildSecondaryExtraWoundChatContent(damage) {
  const baseLabel = woundSeverityLabel(damage?.wound?.baseSeverity) || "Blessure";
  return `
    <article class="arkhanval-damage-card arkhanval-damage-card--secondary">
      <header class="arkhanval-damage-card__header">
        <h3>Blessure supplémentaire</h3>
      </header>

      <div class="arkhanval-damage-card__actors" aria-label="Source vers cible">
        <div class="arkhanval-damage-card__actor">${damageVisual(damage?.source)}</div>
        <i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i>
        <div class="arkhanval-damage-card__actor">${damageVisual(damage?.target, "fa-solid fa-crosshairs")}</div>
      </div>

      <p>L’effet secondaire impose une <strong>${escapeHtml(baseLabel)}</strong>.</p>
      <p><small>Cette blessure provient d’un effet secondaire et ne peut pas générer un nouvel effet secondaire.</small></p>

      ${buildWoundChatSection(damage)}
    </article>
  `;
}

function buildTechniqueLightWoundChatContent(damage) {
  return `
    <article class="arkhanval-damage-card arkhanval-damage-card--technique">
      <header class="arkhanval-damage-card__header">
        <h3>Prise à mains nues — Blessure légère</h3>
      </header>

      <div class="arkhanval-damage-card__actors" aria-label="Source vers cible">
        <div class="arkhanval-damage-card__actor">${damageVisual(damage?.source)}</div>
        <i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i>
        <div class="arkhanval-damage-card__actor">${damageVisual(damage?.target, "fa-solid fa-crosshairs")}</div>
      </div>

      <p>La prise permet d’infliger directement une <strong>Blessure légère</strong>.</p>
      ${buildWoundChatSection(damage)}
    </article>
  `;
}

function buildDamageChatContent(damage) {
  if (damage?.resolution?.origin === "secondary-effect") {
    return buildSecondaryExtraDamageChatContent(damage);
  }
  if (damage?.resolution?.origin === "secondary-effect-wound") {
    return buildSecondaryExtraWoundChatContent(damage);
  }
  if (damage?.resolution?.origin === "technique-unarmed-light") {
    return buildTechniqueLightWoundChatContent(damage);
  }

  const points = Number(damage?.total) || 0;
  const pointLabel = points === 1 ? "point de dégât" : "points de dégâts";
  const wound = damage?.wound ?? null;
  const woundLabel = wound?.kind === "wound"
    ? woundSeverityLabel(wound.severity)
    : wound?.kind === "mortal" ? "Seuil mortel atteint" : "Aucune blessure";
  const weapon = damage?.weapon ?? null;
  const weaponLine = weapon?.formula
    ? `<li><span>Arme <em class="arkhanval-damage-card__die-formula">(${escapeHtml(displayRollFormula(weapon.formula))})</em></span><strong>${Number(weapon.total) || 0}</strong></li>`
    : `<li><span>Arme</span><strong>0</strong></li>`;

  const extraLine = damage?.extraDice?.formula
    ? `<li><span>Dés supplémentaires <em class="arkhanval-damage-card__die-formula">(${escapeHtml(displayRollFormula(damage.extraDice.formula))})</em></span><strong>${Number(damage.extraDice.total) || 0}</strong></li>`
    : "";

  const effectLine = Number(damage?.specialty?.flatModifier)
    ? `<li><span>Effets automatiques</span><strong>${signed(damage.specialty.flatModifier)}</strong></li>`
    : "";
  const techniqueLine = Number(damage?.technique?.flatModifier)
    ? `<li><span>${escapeHtml(damage?.technique?.label ?? "Technique")}</span><strong>${signed(damage.technique.flatModifier)}</strong></li>`
    : "";

  const notes = [
    ...Array.from(damage?.specialty?.notes ?? []),
    ...Array.from(damage?.protection?.notes ?? [])
  ];
  const warnings = Array.from(damage?.specialty?.warnings ?? []);
  const resolvedProtection = Math.max(0, Number(damage?.protection?.resolved) || 0);
  const penetrationApplied = Math.max(0, Number(damage?.protection?.penetrationApplied) || 0);
  const protectionNote = damage?.protection?.ignored
    ? "ignorée"
    : penetrationApplied > 0
      ? `${resolvedProtection} − ${penetrationApplied} pénétration`
      : "";
  const protectionTotal = Number(damage?.protection?.used) || 0;

  return `
    <article class="arkhanval-damage-card arkhanval-damage-card--combat">
      <header class="arkhanval-damage-card__header">
        <h3>Jet de dégâts</h3>
      </header>

      <div class="arkhanval-damage-card__actors" aria-label="Source vers cible">
        <div class="arkhanval-damage-card__actor" title="${escapeHtml(damage?.source?.name ?? "Attaquant")}">${damageVisual(damage?.source)}</div>
        <i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i>
        <div class="arkhanval-damage-card__actor" title="${escapeHtml(damage?.target?.name ?? "Défenseur")}">${damageVisual(damage?.target, "fa-solid fa-crosshairs")}</div>
      </div>

      <details class="arkhanval-damage-card__details">
        <summary class="arkhanval-damage-card__total">
          <span class="arkhanval-damage-card__total-intro">L’attaque inflige</span>
          <strong class="arkhanval-damage-card__total-value">${points}</strong>
          <span class="arkhanval-damage-card__total-unit">${pointLabel}</span>
          <span class="arkhanval-damage-card__total-wound">${escapeHtml(woundLabel)}</span>
        </summary>

        <div class="arkhanval-damage-card__details-body">
          <ul class="arkhanval-damage-card__breakdown">
            <li><span>Écart de QR</span><strong>+${Math.max(0, Number(damage?.qrDifference) || 0)}</strong></li>
            <li><span>Résultat du d10 ouvert</span><strong>${Number(damage?.baseDie?.total) || 0}</strong></li>
            ${weaponLine}
            ${extraLine}
            ${effectLine}
            ${techniqueLine}
            <li><span>Protection${protectionNote ? ` <em class="arkhanval-damage-card__die-formula">(${escapeHtml(protectionNote)})</em>` : ""}</span><strong>${protectionTotal}</strong></li>
            <li class="arkhanval-damage-card__breakdown-final"><span>Total des dégâts</span><strong>${points}</strong></li>
          </ul>

          ${notes.length
            ? `<ul class="arkhanval-damage-card__effects">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
            : ""}
          ${warnings.length
            ? `<ul class="arkhanval-damage-card__warnings">${warnings.map((note) => `<li>⚠ ${escapeHtml(note)}</li>`).join("")}</ul>`
            : ""}
        </div>
      </details>

      ${buildWoundChatSection(damage, { combatCard: true })}
    </article>
  `;
}

function userCanControlActor(user, actor) {
  if (!user || !actor) return false;
  if (user.isGM) return true;
  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(user, "OWNER");
  }
  const ownership = actor.ownership ?? {};
  return Number(ownership[user.id] ?? ownership.default ?? 0) >= 3;
}

function activeAuthorityId(message) {
  const activeGms = Array.from(game.users ?? [])
    .filter((user) => user?.active && user?.isGM)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  if (activeGms.length) return activeGms[0].id;

  const author = message?.author ?? message?.user ?? null;
  return author?.active ? author.id : null;
}

function isCurrentAuthority(message) {
  return activeAuthorityId(message) === game.user?.id;
}

async function promptManualQr(title = "Arkhanval — QR adverse") {
  const result = await DialogV2.input({
    position: { width: "auto", height: "auto" },
    window: { title },
    classes: ["arkhanval", "arkhanval-popup-dialog", "arkhanval-popup-dialog--input"],
    modal: true,
    rejectClose: false,
    content: `
      <div class="arkhanval-combat-dialog">
        <label>
          <span>QR adverse</span>
          <input name="defenderQr" type="number" step="1" value="0" required>
        </label>
      </div>
    `,
    ok: {
      label: "Valider",
      icon: "fa-solid fa-check",
      class: "arkhanval-popup-action--primary"
    }
  });
  if (!result) return null;
  const qr = Number(readFormValue(result, "defenderQr", 0));
  return Number.isFinite(qr) ? qr : 0;
}

async function promptOpponentData(combat) {
  const qr = await promptManualQr("Arkhanval — Confrontation de combat");
  if (qr === null) return null;
  return { defenderQr: qr };
}

async function promptResponseSkill(actor, preferredIdentifier = "") {
  const skills = listActorSkills(actor)
    .filter((skill) => isDirectCombatSkill(skill.identifier));

  if (!skills.length) {
    ui.notifications?.warn?.("Arkhanval | Aucune compétence de combat disponible pour cette cible.");
    return null;
  }

  const preferred = skills.find((skill) => skill.identifier === preferredIdentifier) ?? null;
  const options = skills.map((skill) => {
    const selected = preferred?.key === skill.key ? " selected" : "";
    return `<option value="${escapeHtml(skill.key)}"${selected}>${escapeHtml(skill.name)} — rang ${Number(skill.rank) || 0}</option>`;
  }).join("");

  const result = await DialogV2.input({
    position: { width: "auto", height: "auto" },
    window: { title: "Arkhanval — Répondre à l’attaque" },
    classes: ["arkhanval", "arkhanval-popup-dialog", "arkhanval-popup-dialog--input"],
    modal: true,
    rejectClose: false,
    content: `
      <div class="arkhanval-combat-dialog">
        <label>
          <span>Compétence de réponse</span>
          <select name="skillKey">${options}</select>
        </label>
      </div>
    `,
    ok: {
      label: "Continuer",
      icon: "fa-solid fa-dice"
    }
  });

  if (!result) return null;
  const key = String(readFormValue(result, "skillKey", ""));
  return skills.find((skill) => skill.key === key) ?? null;
}

function buildCombatResponseContext(actor, skillIdentifier, combat) {
  const responseContext = captureCombatRollContext(actor, skillIdentifier, { targets: [] });
  if (!responseContext?.enabled) return responseContext;

  // A response is not a free attack: it necessarily answers the attacker
  // represented by the source combat card. Ignore the defender's current
  // manual Foundry targets and inject the original attacker as the sole target.
  const forcedTarget = combat?.context?.attacker ?? null;
  if (!forcedTarget) return { ...responseContext, responseMode: true };

  return {
    ...responseContext,
    responseMode: true,
    forcedResponseTarget: true,
    targets: [{ ...forcedTarget }],
    targetCount: 1,
    targetState: "single",
    target: { ...forcedTarget }
  };
}


function artCreditD10Candidates(result) {
  const attemptIndex = Number(result?.selectedAttemptIndex);
  if (!Number.isInteger(attemptIndex) || attemptIndex < 0) return null;

  const attempt = result?.attempts?.[attemptIndex] ?? null;
  const candidates = Array.from(attempt?.chains ?? [])
    .map((chain, index) => ({ chain, index }))
    .filter(({ chain }) => Number(chain?.initialFaces) === 10);

  return {
    attemptIndex,
    candidates
  };
}

async function promptArtCreditD10Selection(result) {
  const selection = artCreditD10Candidates(result);
  if (!selection?.candidates?.length) return null;

  const dice = selection.candidates
    .map(({ chain, index }) => {
      const values = Array.from(chain?.rolls ?? [])
        .map((roll) => Number(roll?.natural))
        .filter((value) => Number.isFinite(value));
      const label = values.length ? values.join(" → ") : "?";
      return `
        <label class="arkhanval-phase04-die-choice">
          <input type="radio" name="die" value="${index}">
          <span>d10 : <strong>${escapeHtml(label)}</strong></span>
        </label>
      `;
    })
    .join("");

  const formData = await DialogV2.input({
    window: { title: "Crédit de relance — Art du combat" },
    classes: ["arkhanval", "arkhanval-popup-dialog", "arkhanval-popup-dialog--dice"],
    content: `
      <div class="arkhanval-phase04-dialog">
        <p>Choisissez le <strong>d10</strong> à relancer.</p>
        <div class="arkhanval-phase04-dice">${dice}</div>
      </div>
    `,
    modal: true,
    rejectClose: false,
    ok: {
      label: "Relancer",
      icon: "fa-solid fa-rotate",
      disabled: true
    },
    render: (_event, dialog) => {
      const attach = (remainingFrames = 3) => {
        const form = dialog?.form ?? dialog?.element?.querySelector?.("form") ?? null;
        if (!form) {
          if (remainingFrames > 0 && globalThis.requestAnimationFrame) {
            globalThis.requestAnimationFrame(() => attach(remainingFrames - 1));
          }
          return;
        }

        const radios = Array.from(form.querySelectorAll?.('input[name="die"][type="radio"]') ?? []);
        const okButton = dialog?.element?.querySelector?.('button[data-action="ok"]')
          ?? form.querySelector?.('button[data-action="ok"]')
          ?? form.querySelector?.('button[type="submit"]')
          ?? null;

        const refresh = () => {
          if (okButton) okButton.disabled = !radios.some((radio) => radio.checked);
        };

        if (form.dataset.arkhanvalArtCreditBound !== "true") {
          form.dataset.arkhanvalArtCreditBound = "true";
          form.addEventListener("change", refresh);
        }
        refresh();
      };
      attach();
    }
  });

  if (!formData) return null;
  const chainIndex = Number(readFormValue(formData, "die", -1));
  if (!Number.isInteger(chainIndex) || chainIndex < 0) return null;
  if (!selection.candidates.some((candidate) => candidate.index === chainIndex)) return null;

  return {
    attemptIndex: selection.attemptIndex,
    chainIndex
  };
}

function combatArkRerollDiceCount(actor, result) {
  const attemptIndex = Number(result?.selectedAttemptIndex);
  if (!Number.isInteger(attemptIndex) || attemptIndex < 0) return 0;

  const attempt = result?.attempts?.[attemptIndex] ?? null;
  const d10Count = Array.from(attempt?.chains ?? [])
    .filter((chain) => Number(chain?.initialFaces) === 10)
    .length;
  if (d10Count < 1) return 0;

  const hasCircle = Object.values(actor?.system?.arks ?? {})
    .some((ark) => (Number(ark?.circles) || 0) > 0);

  return hasCircle ? Math.min(2, d10Count) : 0;
}

function combatArkDecisionForResult(actor, result) {
  const diceCount = combatArkRerollDiceCount(actor, result);
  return {
    available: diceCount > 0,
    diceCount,
    choice: diceCount > 0 ? "" : "no",
    locked: diceCount === 0
  };
}

function combatResponseFinalized(attackerArk, response) {
  // Une relance indisponible ne constitue pas une décision en attente.
  // Accepte également les messages créés avant la correction, dont les flags
  // indiquaient available:false et locked:false.
  const attackerDone = Boolean(attackerArk?.locked || attackerArk?.available === false);
  const defenderDone = Boolean(response?.arkDecision?.locked || response?.arkDecision?.available === false);
  return attackerDone && defenderDone;
}

async function rollCombatResponse(actor, combat) {
  const skill = await promptResponseSkill(actor, combat?.context?.skillIdentifier ?? "");
  if (!skill) return null;

  const responseCombatContext = buildCombatResponseContext(
    actor,
    skill.identifier,
    combat
  );

  const request = await promptSkillRoll({
    actor,
    skill,
    combatContext: responseCombatContext
  });
  if (!request) return null;

  const result = await resolveRoll(request);

  if (request.ark?.boost) {
    const spent = await spendArkCircle(actor, request.ark.boost);
    if (!spent) {
      ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
      return null;
    }
  }

  return {
    mode: "roll",
    qr: result.qr,
    skillName: request.skillName,
    skillIdentifier: request.skillIdentifier,
    combat: request.combat ?? null,
    result,
    arkDecision: combatArkDecisionForResult(actor, result)
  };
}

function combatRenderOptions(combat) {
  const saved = combat?.chatOptions ?? {};
  return {
    progressGain: saved.progressGain ?? null,
    arkBoost: saved.arkBoost ?? "",
    arkReroll: saved.arkReroll ?? null,
    experienceSource: saved.experienceSource ?? null,
    arkRerollAvailable: saved.arkRerollAvailable ?? false,
    arkRerollDiceCount: saved.arkRerollDiceCount ?? 0,
    combatContext: combat?.context ?? null,
    combatState: combat,
    chatActor: saved.chatActor ?? {
      img: combat?.context?.attacker?.tokenImg ?? "",
      name: combat?.context?.attacker?.name ?? "Personnage"
    }
  };
}

async function updateCombatMessage(message, nextCombat) {
  const result = nextCombat?.attackResult ?? null;
  if (!result) throw new Error("Résultat d’attaque introuvable dans la carte de combat.");

  const spellResolution = message.getFlag?.("arkhanval", "spellResolution") ?? null;
  const content = String(spellResolution?.mode ?? "") === "opposed"
    ? buildUnifiedSpellOppositionChatContent(spellResolution, nextCombat)
    : buildResolutionChatContent(result, combatRenderOptions(nextCombat));

  await message.update({
    content,
    "flags.arkhanval.combat": documentSafeClone(nextCombat)
  });
}


async function createDamageMessage(message, combat, target, sides, {
  requestedBy = "",
  damageMode = "normal"
} = {}) {
  const sourceActor = await actorFromTarget(sides.sourceSnapshot);
  const targetActor = await actorFromTarget(sides.targetSnapshot);

  if (!sourceActor) {
    throw new Error("Source des dégâts introuvable.");
  }
  if (!targetActor) {
    throw new Error("Cible des dégâts introuvable.");
  }

  const sourceWeapon = sides.sourceWeapon ?? null;
  const targetWeapon = sides.targetWeapon ?? null;

  const sourceUsageTag = weaponUsageTagForSkill(sides.sourceSkillIdentifier);
  const sourceTags = new Set([
    ...Array.from(sourceWeapon?.tags ?? []).map(String),
    ...(sourceUsageTag ? [sourceUsageTag] : [])
  ]);
  const sourceContexts = combatRuleContexts(sides.sourceSkillIdentifier);
  const sourceWeaponItem = actorItemById(sourceActor, sourceWeapon?.id);

  const frozenDamageRules = damageRuleSnapshotForSide(
    combat,
    sides.response,
    sides.sourceSide
  );
  const damageRules = frozenDamageRules ?? buildDamageRuleModifiers(sourceActor, {
    skillIdentifier: sides.sourceSkillIdentifier,
    skillRank: sides.sourceSkillRank,
    tags: Array.from(sourceTags),
    contexts: sourceContexts,
    ruleSources: sourceWeaponItem ? [sourceWeaponItem] : []
  });
  const technique = combatTechniqueForSide(combat, sides.response, sides.sourceSide);
  const techniqueExtraDice = damageMode === "bonus-d10" ? [10] : [];
  const techniqueFlatModifier = damageMode === "minus5" ? -5 : 0;

  const targetUsageTag = weaponUsageTagForSkill(sides.targetSkillIdentifier);
  const protectionTags = new Set([
    ...equippedProtectionTags(targetActor),
    ...Array.from(targetWeapon?.tags ?? []).map(String),
    ...(targetUsageTag ? [targetUsageTag] : [])
  ]);
  const targetWeaponItem = actorItemById(targetActor, targetWeapon?.id);
  const equippedArmorSources = actorItems(targetActor)
    .filter((item) => item?.type === "armor" && item.system?.equipped);
  const protectionRules = buildProtectionRuleModifiers(targetActor, {
    skillIdentifier: sides.targetSkillIdentifier,
    skillRank: sides.targetSkillRank,
    tags: Array.from(protectionTags),
    contexts: combatRuleContexts(sides.targetSkillIdentifier),
    ruleSources: [
      ...equippedArmorSources,
      ...(targetWeaponItem ? [targetWeaponItem] : [])
    ]
  });

  const baseRoll = await evaluateFormula("1d10x10");
  const weaponFormula = normalizeRollFormula(sourceWeapon?.damage ?? "");
  const weaponRoll = weaponFormula ? await evaluateFormula(weaponFormula) : null;

  const extraDiceFaces = [
    ...Array.from(damageRules.extraDice ?? []),
    ...techniqueExtraDice
  ];
  const extraDiceFormula = extraDiceFaces
    .map((faces) => `1d${faces}${Number(faces) === 10 ? "x10" : ""}`)
    .join(" + ");
  const extraDiceRoll = extraDiceFormula ? await evaluateFormula(extraDiceFormula) : null;
  await showEvaluatedDiceBatch([baseRoll, weaponRoll, extraDiceRoll]);

  const protectionBase = Math.max(0, Number(equippedProtection(targetActor)) || 0);
  const resolvedProtection = Math.max(
    0,
    protectionBase + (Number(protectionRules.flatModifier) || 0)
  );
  const combatTargetKey = String(target?.key ?? target?.tokenId ?? target?.actorUuid ?? "");
  const maladresseIgnoreProtection = maladresseIgnoreProtectionForDamage(
    combat,
    combatTargetKey,
    sides.targetSide
  );
  const ignoreProtection = Boolean(damageRules.ignoreProtection || maladresseIgnoreProtection);
  const armorPenetration = Math.max(0, Math.trunc(Number(sourceWeapon?.armorPenetration) || 0));
  const appliedArmorPenetration = ignoreProtection
    ? 0
    : Math.min(resolvedProtection, armorPenetration);
  const protectionUsed = ignoreProtection
    ? 0
    : Math.max(0, resolvedProtection - appliedArmorPenetration);

  const qrDifference = Math.max(0, Number(sides.confrontation?.difference) || 0);
  const baseTotal = Number(baseRoll?.total) || 0;
  const weaponTotal = Number(weaponRoll?.total) || 0;
  const extraDiceTotal = Number(extraDiceRoll?.total) || 0;
  const specialtyFlat = Number(damageRules.flatModifier) || 0;
  const combinedFlatModifier = specialtyFlat + techniqueFlatModifier;

  const { rawTotal, total } = calculateCombatDamageTotal({
    qrDifference,
    baseDie: baseTotal,
    weapon: weaponTotal,
    extraDice: extraDiceTotal,
    specialtyFlat: combinedFlatModifier,
    protection: protectionUsed
  });

  const allDamageDice = [
    ...rollNaturalValues(baseRoll),
    ...rollNaturalValues(weaponRoll),
    ...rollNaturalValues(extraDiceRoll)
  ];
  const resistanceFd = Math.min(
    10,
    Math.max(0, ...allDamageDice.map((value) => Number(value) || 0))
  );

  const baseD10Die = Array.from(baseRoll?.dice ?? [])
    .find((die) => Number(die?.faces) === 10) ?? null;
  const baseD10Snapshot = baseD10Die
    ? openD10Snapshot(baseD10Die, { id: "base:0", bucket: "base", index: 0 })
    : {
        id: "base:0",
        bucket: "base",
        index: 0,
        total: baseTotal,
        values: rollNaturalValues(baseRoll),
        label: openD10Label(baseRoll)
      };

  const extraDiceTerms = Array.from(extraDiceRoll?.dice ?? []);
  const extraD10Snapshots = extraDiceTerms
    .filter((die) => Number(die?.faces) === 10)
    .map((die, index) => openD10Snapshot(die, {
      id: `extra:${index}`,
      bucket: "extra",
      index
    }));
  const nonRerollableExtraDamageDice = extraDiceTerms
    .filter((die) => Number(die?.faces) !== 10)
    .flatMap(dieNaturalValues);
  const nonRerollableDamageDice = [
    ...rollNaturalValues(weaponRoll),
    ...nonRerollableExtraDamageDice
  ];

  const damage = {
    source: {
      ...sides.sourceSnapshot,
      tokenImg: String(sides.sourceSnapshot?.tokenImg || sourceActor?.img || "")
    },
    target: {
      ...sides.targetSnapshot,
      tokenImg: String(sides.targetSnapshot?.tokenImg || targetActor?.img || "")
    },
    sourceSide: sides.sourceSide,
    targetSide: sides.targetSide,
    sourceSkillIdentifier: String(sides.sourceSkillIdentifier ?? ""),
    qrDifference,
    baseDie: {
      formula: "1d10x10",
      total: baseTotal,
      values: rollNaturalValues(baseRoll),
      label: openD10Label(baseRoll)
    },
    weapon: {
      id: String(sourceWeapon?.id ?? ""),
      name: String(sourceWeapon?.name ?? ""),
      img: String(sourceWeapon?.img ?? ""),
      formula: weaponFormula,
      total: weaponTotal,
      armorPenetration,
      tags: Array.from(sourceWeapon?.tags ?? []).map(String)
    },
    extraDice: {
      formula: extraDiceFormula,
      total: extraDiceTotal,
      values: rollNaturalValues(extraDiceRoll)
    },
    technique: {
      id: technique.id,
      label: technique.label,
      fdModifier: technique.fdModifier,
      damageMode,
      flatModifier: techniqueFlatModifier,
      extraDice: techniqueExtraDice
    },
    specialty: {
      flatModifier: specialtyFlat,
      notes: damageRules.notes,
      warnings: damageRules.warnings
    },
    protection: {
      base: protectionBase,
      modifier: Number(protectionRules.flatModifier) || 0,
      resolved: resolvedProtection,
      penetration: armorPenetration,
      penetrationApplied: appliedArmorPenetration,
      ignored: ignoreProtection,
      ignoredByMaladresse: maladresseIgnoreProtection,
      used: protectionUsed,
      notes: [
        ...Array.from(protectionRules.notes ?? []),
        ...(maladresseIgnoreProtection ? ["Maladresse — la protection est ignorée pour ces dégâts."] : [])
      ],
      warnings: protectionRules.warnings
    },
    rawTotal,
    total,
    damageDice: allDamageDice,
    rerollableD10s: [baseD10Snapshot, ...extraD10Snapshots],
    nonRerollableDamageDice,
    resistanceFd,
    wound: buildDamageWoundProposal(targetActor, total),
    resolution: {
      origin: "combat",
      techniqueMode: String(damageMode ?? "normal"),
      sourceCombatMessageId: String(message?.id ?? ""),
      targetKey: combatTargetKey,
      incantationDefense: sides.response?.mode === "incantation-continue" && sides.targetSide === "defender"
        ? {
            active: true,
            spellIds: Array.from(target?.incantation?.spellIds ?? []).map(String).filter(Boolean)
          }
        : null
    },
    requestedBy: String(requestedBy ?? "")
  };

  const ChatMessageClass = globalThis.foundry?.documents?.ChatMessage ?? globalThis.ChatMessage;
  if (!ChatMessageClass) throw new Error("API ChatMessage de Foundry indisponible.");

  const rolls = [baseRoll, weaponRoll, extraDiceRoll].filter(Boolean);
  const damageMessage = await ChatMessageClass.create({
    speaker: { alias: "Arkhanval — Dégâts" },
    content: buildDamageChatContent(damage),
    rolls,
    flags: {
      arkhanval: {
        damage
      }
    }
  });

  if (damageMode === "feint-effect" && game.user?.isGM) {
    try {
      await createPrivateSecondaryEffectMessage(damageMessage, damage, {
        forcedSeverity: "serious",
        dieFaces: 8,
        originType: "feinte"
      });
    } catch (error) {
      console.error("Arkhanval | Échec du tirage d’effet secondaire de Feinte", error);
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  }

  return {
    damage,
    messageId: damageMessage?.id ?? ""
  };
}

async function createTechniqueLightWoundMessage(combat, target, sides, {
  requestedBy = ""
} = {}) {
  const sourceActor = await actorFromTarget(sides.sourceSnapshot);
  const targetActor = await actorFromTarget(sides.targetSnapshot);
  if (!sourceActor) throw new Error("Source de la prise introuvable.");
  if (!targetActor) throw new Error("Cible de la prise introuvable.");

  const technique = combatTechniqueForSide(combat, sides.response, sides.sourceSide);
  const damage = {
    source: {
      ...sides.sourceSnapshot,
      tokenImg: String(sides.sourceSnapshot?.tokenImg || sourceActor?.img || "")
    },
    target: {
      ...sides.targetSnapshot,
      tokenImg: String(sides.targetSnapshot?.tokenImg || targetActor?.img || "")
    },
    sourceSide: sides.sourceSide,
    targetSide: sides.targetSide,
    sourceSkillIdentifier: String(sides.sourceSkillIdentifier ?? ""),
    qrDifference: Math.max(0, Number(sides.confrontation?.difference) || 0),
    baseDie: { formula: "", total: 0, values: [], label: "—" },
    weapon: { id: "", name: "", img: "", formula: "", total: 0, tags: [] },
    extraDice: { formula: "", total: 0, values: [] },
    technique: {
      id: technique.id,
      label: technique.label,
      fdModifier: technique.fdModifier,
      damageMode: "unarmed-light",
      flatModifier: 0,
      extraDice: []
    },
    specialty: { flatModifier: 0, notes: [], warnings: [] },
    protection: {
      base: 0,
      modifier: 0,
      ignored: true,
      ignoredByMaladresse: false,
      used: 0,
      notes: [],
      warnings: []
    },
    rawTotal: 0,
    total: 0,
    damageDice: [],
    resistanceFd: 0,
    wound: buildFixedWoundProposal(targetActor, "light"),
    resolution: {
      origin: "technique-unarmed-light",
      techniqueMode: "unarmed-light",
      forcedWoundSeverity: "light",
      allowSecondaryEffect: false
    },
    requestedBy: String(requestedBy ?? "")
  };

  const ChatMessageClass = globalThis.foundry?.documents?.ChatMessage ?? globalThis.ChatMessage;
  if (!ChatMessageClass) throw new Error("API ChatMessage de Foundry indisponible.");

  const damageMessage = await ChatMessageClass.create({
    speaker: { alias: "Arkhanval — Prise à mains nues" },
    content: buildDamageChatContent(damage),
    flags: {
      arkhanval: {
        damage
      }
    }
  });

  return {
    damage,
    messageId: damageMessage?.id ?? ""
  };
}

async function validateDamageRequest(message, combat, payload) {
  const submittingUser = game.users?.get?.(payload.userId) ?? null;
  if (!submittingUser) return false;

  const target = targetByKey(combat, payload.targetKey);
  if (!target) return false;

  const sides = damageSidesForTarget(combat, target, payload.targetKey);
  if (!sides) return false;

  const technique = combatTechniqueForSide(combat, sides.response, sides.sourceSide);
  const damageMode = String(payload.damageMode ?? "normal");
  if (!allowedDamageModesForTechnique(technique).has(damageMode)) {
    console.warn("Arkhanval | Mode de résolution refusé pour la technique active", {
      technique: technique.id,
      damageMode
    });
    return false;
  }

  if (submittingUser.isGM) return true;
  return userCanControlTarget(submittingUser, sides.sourceSnapshot);
}

async function applyDamageRequest(payload) {
  const message = game.messages?.get?.(payload.messageId) ?? null;
  if (!message) return;

  const combat = message.getFlag?.("arkhanval", "combat") ?? null;
  if (!combat?.attackResult) return;

  const key = String(payload.targetKey ?? "");
  if (!key) return;
  if (combat?.damage?.[key]) return;

  const pendingKey = `${message.id}:${key}`;
  if (pendingDamageRequests.has(pendingKey)) return;

  if (!(await validateDamageRequest(message, combat, payload))) {
    console.warn("Arkhanval | Demande de dégâts refusée par l’autorité", {
      messageId: payload.messageId,
      userId: payload.userId,
      targetKey: key
    });
    return;
  }

  const target = targetByKey(combat, key);
  const sides = damageSidesForTarget(combat, target, key);
  if (!sides) return;

  pendingDamageRequests.add(pendingKey);
  try {
    const damageMode = String(payload.damageMode ?? "normal");
    let resolved = null;
    let label = "Dégâts résolus";

    if (damageMode === "unarmed-none") {
      label = "Prise — aucun dégât";
    } else if (damageMode === "unarmed-immobilize") {
      label = "Prise — immobilisation à gérer manuellement";
    } else if (damageMode === "unarmed-light") {
      resolved = await createTechniqueLightWoundMessage(combat, target, sides, {
        requestedBy: payload.userId
      });
      label = "Prise — Blessure légère préparée";
    } else {
      resolved = await createDamageMessage(message, combat, target, sides, {
        requestedBy: payload.userId,
        damageMode
      });
      if (damageMode === "bonus-d10") label = "Dégâts +1d10 résolus";
      else if (damageMode === "minus5") label = "Dégâts -5 résolus";
      else if (damageMode === "feint-effect") label = "Dégâts + effet secondaire résolus";
    }

    const damageState = {
      ...(combat.damage ?? {}),
      [key]: {
        messageId: resolved?.messageId ?? "",
        total: Number(resolved?.damage?.total) || 0,
        sourceSide: sides.sourceSide,
        targetSide: sides.targetSide,
        mode: damageMode,
        label
      }
    };

    await updateCombatMessage(message, {
      ...combat,
      damage: damageState
    });
  } finally {
    pendingDamageRequests.delete(pendingKey);
  }
}

async function submitDamageRequest(message, targetKey, damageMode = "normal") {
  const envelope = {
    type: SOCKET_TYPE_DAMAGE,
    messageId: message.id,
    userId: game.user.id,
    targetKey: String(targetKey ?? ""),
    damageMode: String(damageMode ?? "normal")
  };

  if (isCurrentAuthority(message)) {
    await applyDamageRequest(envelope);
    return;
  }

  const authorityId = activeAuthorityId(message);
  if (!authorityId) {
    ui.notifications?.error?.("Arkhanval | Aucun client autorisé n’est disponible pour lancer les dégâts.");
    return;
  }

  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
}

async function updateDamageMessage(message, damage) {
  await message.update({
    content: buildDamageChatContent(damage),
    "flags.arkhanval.damage": damage
  });
}

async function validateWoundRequest(message, payload) {
  const submittingUser = game.users?.get?.(payload.userId) ?? null;
  if (!submittingUser) return false;

  const damage = message.getFlag?.("arkhanval", "damage") ?? null;
  if (!damage || damage?.wound?.kind !== "wound" || damage?.wound?.applied) return false;

  return Boolean(submittingUser.isGM);
}

async function applyWoundRequest(payload) {
  const message = game.messages?.get?.(payload.messageId) ?? null;
  if (!message) return;

  const pendingKey = String(message.id ?? "");
  if (!pendingKey || pendingWoundRequests.has(pendingKey)) return;

  if (!(await validateWoundRequest(message, payload))) {
    console.warn("Arkhanval | Demande d’application de blessure refusée par l’autorité", {
      messageId: payload.messageId,
      userId: payload.userId
    });
    return;
  }

  pendingWoundRequests.add(pendingKey);
  try {
    const damage = message.getFlag?.("arkhanval", "damage") ?? null;
    if (!damage || damage?.wound?.kind !== "wound" || damage?.wound?.applied) return;

    const targetActor = await actorFromTarget(damage.target);
    if (!targetActor) throw new Error("Cible de la blessure introuvable.");

    const forcedSeverity = String(damage?.resolution?.forcedWoundSeverity ?? "");
    const currentProposal = forcedSeverity
      ? buildFixedWoundProposal(targetActor, forcedSeverity)
      : buildDamageWoundProposal(targetActor, damage.total);
    if (!woundStateMatches(damage.wound, currentProposal)) {
      await updateDamageMessage(message, {
        ...damage,
        wound: currentProposal
      });
      return;
    }

    const severity = String(damage.wound.severity ?? "");
    if (!["light", "serious", "critical"].includes(severity)) {
      throw new Error("Niveau de blessure invalide.");
    }

    const [created] = await targetActor.createEmbeddedDocuments("Item", [{
      name: woundItemName(severity),
      type: "wound",
      system: { severity }
    }]);

    const needsConcentration = ["serious", "critical"].includes(severity)
      && Boolean(damage?.resolution?.incantationDefense?.active);
    const updatedDamage = {
      ...damage,
      wound: {
        ...damage.wound,
        applied: true,
        appliedBy: String(payload.userId ?? ""),
        itemId: String(created?.id ?? "")
      },
      concentration: needsConcentration
        ? {
            required: true,
            fd: 9,
            actorName: String(targetActor?.name ?? "Le personnage"),
            spellIds: Array.from(damage?.resolution?.incantationDefense?.spellIds ?? []).map(String).filter(Boolean),
            rollMessageId: "",
            validated: false
          }
        : (damage?.concentration ?? null)
    };

    await updateDamageMessage(message, updatedDamage);
  } finally {
    pendingWoundRequests.delete(pendingKey);
  }
}

async function submitWoundRequest(message) {
  const envelope = {
    type: SOCKET_TYPE_WOUND,
    messageId: message.id,
    userId: game.user.id
  };

  if (isCurrentAuthority(message)) {
    await applyWoundRequest(envelope);
    return;
  }

  const authorityId = activeAuthorityId(message);
  if (!authorityId) {
    ui.notifications?.error?.("Arkhanval | Aucun client autorisé n’est disponible pour appliquer la blessure.");
    return;
  }

  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
}

function activateDamageWoundAction(message, html) {
  const damage = message.getFlag?.("arkhanval", "damage") ?? null;
  const button = html.querySelector?.("[data-arkhanval-wound-apply]");
  if (!damage || !button) return;

  const woundAvailable = Boolean(
    damage?.wound?.kind === "wound"
    && !damage?.wound?.applied
  );
  const canUse = Boolean(woundAvailable && game.user?.isGM);

  if (!canUse) {
    button.disabled = true;
    return;
  }

  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await submitWoundRequest(message);
    } catch (error) {
      console.error("Arkhanval | Échec d’application de la blessure", error);
      button.disabled = false;
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  });
}


function secondaryEffectSeverityLabel(severity) {
  const value = String(severity ?? "");
  if (value === "critical") return "Blessure critique";
  if (value === "maladroit") return "Maladresse";
  return "Blessure grave";
}

function secondaryEffectChatClass() {
  return globalThis.foundry?.documents?.ChatMessage ?? globalThis.ChatMessage ?? null;
}

function gmWhisperUserIds() {
  return Array.from(game.users?.values?.() ?? [])
    .filter((user) => Boolean(user?.isGM))
    .map((user) => String(user.id ?? ""))
    .filter(Boolean);
}

function secondaryEffectStateLabel(effect) {
  if (effect?.vanillaStateId === "groggy") return "Groggy";
  const preset = statePresetSummary(effect?.statePresetId);
  return String(preset?.name ?? "");
}

// Shared rendering for the private MJ draft and the public card.
// The flags, permissions and action attributes below remain the existing engine's.
function secondaryEffectCardHero(state) {
  const severityLabel = secondaryEffectSeverityLabel(state?.severity);
  const targetImg = String(state?.target?.tokenImg ?? "").trim() || "icons/svg/mystery-man.svg";
  return `
    <header class="arkhanval-secondary-effect-card__header">
      <h3>Effet secondaire — ${escapeHtml(severityLabel)}</h3>
    </header>
    <div class="arkhanval-secondary-effect-card__portrait" aria-label="Cible de l’effet">
      <img src="${escapeHtml(targetImg)}" alt="">
    </div>
  `;
}

function secondaryEffectCardOutcome(state) {
  const effect = state?.effect ?? null;
  const faces = Math.max(1, Number(state?.dieFaces) || 10);
  return `
    <section class="arkhanval-secondary-effect-card__outcome">
      <span class="arkhanval-secondary-effect-card__dice-caption">Résultat du d${faces}</span>
      <strong class="arkhanval-secondary-effect-card__result">${Number(effect?.result) || 0}</strong>
      <p class="arkhanval-secondary-effect-card__description">${escapeHtml(effect?.text ?? "")}</p>
    </section>
  `;
}

function buildEffectFollowupContent(effect, {
  publicCard = false,
  stateApplied = false,
  additionalContent = ""
} = {}) {
  if (!publicCard) return "";
  const label = effectFollowupLabel(effect);
  const stateLabel = secondaryEffectStateLabel(effect);
  const assisted = effectIsAssistedState(effect);
  const note = String(effect?.followupNote ?? "");
  const preset = effect?.statePresetId ? statePresetSummary(effect.statePresetId) : null;
  const assistance = effect?.vanillaStateId === "groggy"
    ? "Tant que Groggy est actif sur la fiche, ses effets sont automatiquement pris en compte dans les jets et le combat. Retirez Groggy lorsqu’un jet de résistance est réussi."
    : String(preset?.assistance ?? "");
  const action = assisted
    ? stateApplied
      ? `<button type="button" data-arkhanval-action-complete disabled>État appliqué : ${escapeHtml(stateLabel)}</button>`
      : `<button type="button" data-arkhanval-secondary-state-apply>${escapeHtml(effect?.vanillaStateId ? `Activer ${stateLabel}` : `Appliquer ${stateLabel}`)}</button>`
    : "";

  // Do not manufacture a tracking block for effects without actual follow-up.
  if (!assistance && !note && !action && !additionalContent.trim()) return "";

  return `
    <section class="arkhanval-secondary-effect-card__followup">
      <h4>Suivi de l’effet <small>— ${escapeHtml(label)}</small></h4>
      ${assistance ? `<p>${escapeHtml(assistance)}</p>` : ""}
      ${note ? `<p>${escapeHtml(note)}</p>` : ""}
      ${additionalContent}
      ${action}
    </section>
  `;
}

function buildPrivateSecondaryEffectContent(state) {
  const published = Boolean(state?.published);
  return `
    <article class="arkhanval-secondary-effect-card arkhanval-secondary-effect-card--private arkhanval-chat-card arkhanval-chat-card--effect">
      ${secondaryEffectCardHero(state)}
      ${secondaryEffectCardOutcome(state)}
      ${published
        ? `<p class="arkhanval-secondary-effect-card__published">Résultat validé et publié.</p>`
        : `
          <div class="arkhanval-secondary-effect-card__actions">
            <button type="button" data-arkhanval-secondary-reroll>MJ — Relancer</button>
            <button type="button" data-arkhanval-secondary-publish>MJ — Afficher le résultat</button>
          </div>
        `}
    </article>
  `;
}

function buildPublicSecondaryEffectContent(state) {
  const effect = state?.effect ?? null;
  const targetName = String(state?.target?.["name"] ?? "Cible");
  const fd = Math.max(0, Number(state?.resistanceFd) || 0);

  const resistanceAction = effect?.requiresResistance
    ? `
      <div class="arkhanval-secondary-effect-card__resistance">
        ${effect?.resistanceCondition ? `<p>${escapeHtml(effect.resistanceCondition)}</p>` : ""}
        <p>Jet de résistance — Arkœur, FD proposé : <strong>${fd}</strong></p>
        <button type="button" data-arkhanval-secondary-resistance>Faire le jet de résistance</button>
        <small class="arkhanval-chat-action-context">${escapeHtml(targetName)} — Jet attendu</small>
      </div>
    `
    : "";
  const skillAction = effect?.skillRoll
    ? state?.skillRollResolution?.resolved
      ? `<button type="button" data-arkhanval-secondary-skill-roll data-arkhanval-action-complete disabled>Jet effectué — ${escapeHtml(effect.skillRoll.label || "Compétence")} FD ${Number(state.skillRollResolution?.fdUsed) || Number(effect.skillRoll.fd) || 0}</button>`
      : `${effect.skillRoll.conditionLabel ? `<p>${escapeHtml(effect.skillRoll.conditionLabel)}</p>` : ""}<button type="button" data-arkhanval-secondary-skill-roll>Faire le jet — ${escapeHtml(effect.skillRoll.label || "Compétence")} FD ${escapeHtml(effect.skillRoll.fdFormula || String(Number(effect.skillRoll.fd) || 0))}</button>`
    : "";
  const extraDamageAction = effect?.extraDamage
    ? state?.extraDamageResolution?.resolved
      ? `<button type="button" data-arkhanval-secondary-extra-damage data-arkhanval-action-complete disabled>Dégâts supplémentaires lancés — ${escapeHtml(effect.extraDamage)} : ${Number(state.extraDamageResolution.total) || 0}</button>`
      : `<button type="button" data-arkhanval-secondary-extra-damage>Lancer les dégâts supplémentaires — ${escapeHtml(effect.extraDamage)}</button>`
    : "";
  const extraWoundAction = effect?.extraWoundSeverity
    ? state?.extraWoundResolution?.resolved
      ? `<button type="button" data-arkhanval-secondary-extra-wound data-arkhanval-action-complete disabled>Blessure supplémentaire préparée</button>`
      : `<button type="button" data-arkhanval-secondary-extra-wound>${escapeHtml(effect.extraWoundActionLabel || "Préparer la blessure supplémentaire")}</button>`
    : "";
  const followup = buildEffectFollowupContent(effect, {
    publicCard: true,
    stateApplied: Boolean(state?.stateApplication?.applied),
    additionalContent: `${resistanceAction}${skillAction}${extraDamageAction}${extraWoundAction}`
  });

  return `
    <article class="arkhanval-secondary-effect-card arkhanval-secondary-effect-card--public arkhanval-chat-card arkhanval-chat-card--effect">
      ${secondaryEffectCardHero(state)}
      ${secondaryEffectCardOutcome(state)}
      ${followup}
    </article>
  `;
}

async function rollSecondaryEffect(severity, {
  sourceName = "",
  targetName = "",
  dieFaces = 10
} = {}) {
  const RollClass = globalThis.Roll ?? globalThis.foundry?.dice?.Roll;
  if (!RollClass) throw new Error("API Roll de Foundry indisponible.");

  const faces = Math.max(1, Number(dieFaces) || 10);
  const roll = await new RollClass(`1d${faces}`).evaluate();
  // Effect is still GM-only here; publication is a separate explicit action.
  await showEvaluatedRoll(roll, { publicRoll: false });
  const result = Number(roll?.total) || 0;
  const effect = String(severity ?? "") === "maladroit"
    ? maladresseEffectFor(result, { sourceName, targetName })
    : secondaryEffectFor(severity, result, { sourceName, targetName });
  if (!effect) throw new Error(`Résultat d’effet secondaire introuvable : ${result}.`);
  return effect;
}

async function updateSourceSecondaryEffectState(sourceDamageMessageId, patch = {}) {
  const sourceMessage = game.messages?.get?.(String(sourceDamageMessageId ?? "")) ?? null;
  if (!sourceMessage) return;

  const damage = sourceMessage.getFlag?.("arkhanval", "damage") ?? null;
  if (!damage?.wound) return;

  const previous = damage.wound.secondaryEffect ?? {};
  await updateDamageMessage(sourceMessage, {
    ...damage,
    wound: {
      ...damage.wound,
      secondaryEffect: {
        ...previous,
        ...patch
      }
    }
  });
}

async function updateSourceMaladresseState(sourceCombatMessageId, key, patch = {}) {
  const sourceMessage = game.messages?.get?.(String(sourceCombatMessageId ?? "")) ?? null;
  if (!sourceMessage) return;

  const combat = sourceMessage.getFlag?.("arkhanval", "combat") ?? null;
  if (!combat) return;

  const maladresses = { ...(combat.maladresses ?? {}) };
  const previous = maladresses[String(key ?? "")] ?? {};
  maladresses[String(key ?? "")] = {
    ...previous,
    ...patch
  };

  await updateCombatMessage(sourceMessage, {
    ...combat,
    maladresses
  });
}

function maladresseContext(combat, key) {
  const rawKey = String(key ?? "");
  if (rawKey === "attacker") {
    return {
      target: combat?.context?.attacker ?? null,
      source: null,
      qr: Number(combat?.attackerQr),
      side: "attacker"
    };
  }

  if (!rawKey.startsWith("defender:")) return null;
  const targetKey = rawKey.slice("defender:".length);
  const target = targetByKey(combat, targetKey);
  const response = combat?.responses?.[targetKey] ?? null;
  if (!target || !response) return null;

  return {
    target,
    source: combat?.context?.attacker ?? null,
    qr: Number(response.qr),
    side: "defender",
    targetKey
  };
}

function sameTargetActor(left, right) {
  const leftUuid = String(left?.actorUuid ?? "");
  const rightUuid = String(right?.actorUuid ?? "");
  if (leftUuid && rightUuid) return leftUuid === rightUuid;
  const leftId = String(left?.actorId ?? "");
  const rightId = String(right?.actorId ?? "");
  return Boolean(leftId && rightId && leftId === rightId);
}

async function refreshExistingDamageForMaladresseIgnoreProtection(sourceMessage, key) {
  const combat = sourceMessage?.getFlag?.("arkhanval", "combat") ?? null;
  const context = maladresseContext(combat, key);
  if (!combat || !context?.target) return;

  for (const entry of Object.values(combat.damage ?? {})) {
    const damageMessage = game.messages?.get?.(String(entry?.messageId ?? "")) ?? null;
    const damage = damageMessage?.getFlag?.("arkhanval", "damage") ?? null;
    if (!damage || !sameTargetActor(damage.target, context.target)) continue;

    if (damage?.wound?.applied) {
      console.warn("Arkhanval | Maladresse 5 publiée après application de la blessure : vérification MJ requise", {
        sourceCombatMessageId: sourceMessage.id,
        damageMessageId: damageMessage.id,
        maladresseKey: key
      });
      if (game.user?.isGM) {
        ui.notifications?.warn?.("Arkhanval | Maladresse 5 : la blessure était déjà appliquée. Vérifiez manuellement les dégâts sans protection.");
      }
      continue;
    }

    const protectionUsed = Math.max(0, Number(damage?.protection?.used) || 0);
    if (protectionUsed <= 0 && damage?.protection?.ignored) continue;

    const recalculatedRawTotal = (Number(damage.rawTotal) || 0) + protectionUsed;
    const recalculatedTotal = Math.max(0, Math.trunc(recalculatedRawTotal));
    const targetActor = await actorFromTarget(damage.target);
    const nextWound = targetActor
      ? buildDamageWoundProposal(targetActor, recalculatedTotal)
      : damage.wound;

    const notes = Array.from(damage?.protection?.notes ?? []).map(String);
    const maladresseNote = "Maladresse — la protection est ignorée pour ces dégâts.";
    if (!notes.includes(maladresseNote)) notes.push(maladresseNote);

    await updateDamageMessage(damageMessage, {
      ...damage,
      protection: {
        ...(damage.protection ?? {}),
        ignored: true,
        ignoredByMaladresse: true,
        used: 0,
        notes
      },
      rawTotal: recalculatedRawTotal,
      total: recalculatedTotal,
      wound: nextWound
    });
  }
}

// Retrouver une carte publiée permet de terminer une publication interrompue
// après ChatMessage.create(), sans tirer ni publier une deuxième fois.
function publishedSecondaryMessage({ privateMessageId = "", sourceCombatMessageId = "", maladresseKey = "", delegated = false } = {}) {
  const privateId = String(privateMessageId || "");
  const sourceId = String(sourceCombatMessageId || "");
  const key = String(maladresseKey || "");
  for (const message of Array.from(game.messages?.contents ?? game.messages ?? [])) {
    const state = message?.getFlag?.("arkhanval", "secondaryEffect") ?? null;
    if (!state) continue;
    if (privateId && String(state.privateMessageId ?? "") === privateId) return message;
    if (delegated && sourceId && key
      && String(state.originType ?? "") === "maladroit"
      && String(state.sourceCombatMessageId ?? "") === sourceId
      && String(state.maladresseKey ?? "") === key
      && String(state.playerRoll?.userId ?? "")) return message;
  }
  return null;
}

async function createPrivateMaladresseMessage(sourceMessage, combat, key) {
  if (!game.user?.isGM) throw new Error("Seul le MJ peut tirer une Maladresse.");

  const context = maladresseContext(combat, key);
  if (!context || !(Number(context.qr) < 0)) {
    throw new Error("Aucune Maladresse valide à résoudre pour ce jet.");
  }

  const latestCombat = sourceMessage.getFlag?.("arkhanval", "combat") ?? combat;
  const existingState = latestCombat?.maladresses?.[String(key)] ?? null;
  if (existingState?.published || existingState?.publicMessageId) {
    throw new Error("Cette Maladresse a déjà été publiée.");
  }
  if (existingState?.delegatedToPlayer) {
    throw new Error("Ce tirage de Maladresse a été confié au joueur.");
  }

  const existingId = String(existingState?.privateMessageId ?? "");
  const orphanPrivate = Array.from(game.messages?.contents ?? game.messages ?? []).find((entry) => {
    const state = entry?.getFlag?.("arkhanval", "secondaryEffectPrivate") ?? null;
    return String(state?.sourceCombatMessageId ?? "") === String(sourceMessage.id ?? "")
      && String(state?.maladresseKey ?? "") === String(key ?? "")
      && !state?.published;
  });
  if (!existingId && orphanPrivate) {
    await updateSourceMaladresseState(sourceMessage.id, key, { privateMessageId: String(orphanPrivate.id) });
    ui.notifications?.info?.("Arkhanval | Tirage privé déjà créé ; lien rétabli.");
    return;
  }
  if (existingId && game.messages?.get?.(existingId)) {
    ui.notifications?.info?.("Arkhanval | Un tirage de Maladresse existe déjà pour ce jet.");
    return;
  }

  const effect = await rollSecondaryEffect("maladroit", {
    sourceName: String(context?.source?.name ?? ""),
    targetName: String(context?.target?.name ?? "")
  });

  const state = {
    originType: "maladroit",
    sourceCombatMessageId: String(sourceMessage.id ?? ""),
    maladresseKey: String(key ?? ""),
    source: { ...(context.source ?? {}) },
    target: { ...(context.target ?? {}) },
    severity: "maladroit",
    resistanceFd: Math.max(0, Number(effect?.resistanceFd) || (effect?.result === 10 ? 8 : 7)),
    effect,
    published: false,
    publicMessageId: ""
  };

  const ChatMessageClass = secondaryEffectChatClass();
  if (!ChatMessageClass) throw new Error("API ChatMessage de Foundry indisponible.");

  const whisper = gmWhisperUserIds();
  if (!whisper.length) throw new Error("Aucun MJ disponible pour recevoir le tirage privé.");

  const privateMessage = await ChatMessageClass.create({
    speaker: { alias: "Arkhanval — Maladresse" },
    content: buildPrivateSecondaryEffectContent(state),
    whisper,
    flags: {
      arkhanval: {
        secondaryEffectPrivate: state
      }
    }
  });

  await updateSourceMaladresseState(sourceMessage.id, key, {
    privateMessageId: String(privateMessage?.id ?? ""),
    publicMessageId: "",
    published: false
  });
}

async function delegateMaladresseToPlayer(sourceMessage, combat, key) {
  if (!game.user?.isGM) throw new Error("Seul le MJ peut confier un tirage de Maladresse.");

  const context = maladresseContext(combat, key);
  if (!context || !(Number(context.qr) < 0)) {
    throw new Error("Aucune Maladresse valide à confier pour ce jet.");
  }

  const current = combat?.maladresses?.[String(key)] ?? null;
  if (current?.published || current?.publicMessageId) {
    throw new Error("Cette Maladresse a déjà été publiée.");
  }
  if (current?.privateMessageId) {
    throw new Error("Un tirage MJ est déjà en cours pour cette Maladresse.");
  }
  if (current?.delegatedToPlayer) return;

  const owners = activePlayerOwnersForTarget(context.target);
  if (!owners.length) {
    throw new Error("Aucun joueur propriétaire actif ne peut effectuer ce tirage.");
  }

  await updateSourceMaladresseState(sourceMessage.id, key, {
    delegatedToPlayer: true,
    delegatedBy: String(game.user?.id ?? ""),
    delegatedAt: Date.now(),
    privateMessageId: "",
    publicMessageId: "",
    published: false
  });
}

async function applyDelegatedMaladresseRollRequest(payload) {
  const sourceMessage = game.messages?.get?.(String(payload?.messageId ?? "")) ?? null;
  if (!sourceMessage) return;

  const combat = sourceMessage.getFlag?.("arkhanval", "combat") ?? null;
  if (!combat) return;

  const key = String(payload?.maladresseKey ?? "");
  const pendingKey = `${String(sourceMessage.id ?? "")}:${key}`;
  if (!key || pendingMaladressePlayerRequests.has(pendingKey)) return;

  const context = maladresseContext(combat, key);
  const current = combat?.maladresses?.[key] ?? null;
  const submittingUser = game.users?.get?.(String(payload?.userId ?? "")) ?? null;
  const result = Number(payload?.result);

  if (!context || !(Number(context.qr) < 0)) return;
  if (!current?.delegatedToPlayer || current?.published || current?.publicMessageId || current?.privateMessageId) return;
  if (!submittingUser || submittingUser.isGM || !userCanControlTarget(submittingUser, context.target)) {
    console.warn("Arkhanval | Tirage joueur de Maladresse refusé", {
      messageId: payload?.messageId,
      userId: payload?.userId,
      maladresseKey: key
    });
    return;
  }
  if (!Number.isInteger(result) || result < 1 || result > 10) return;

  pendingMaladressePlayerRequests.add(pendingKey);
  try {
    const existingPublic = publishedSecondaryMessage({
      sourceCombatMessageId: sourceMessage.id, maladresseKey: key, delegated: true
    });
    const effect = existingPublic?.getFlag?.("arkhanval", "secondaryEffect")?.effect
      ?? maladresseEffectFor(result, {
        sourceName: String(context?.source?.name ?? ""),
        targetName: String(context?.target?.name ?? "")
      });
    if (!effect) throw new Error(`Résultat de Maladresse introuvable : ${result}.`);

    const publicState = {
      originType: "maladroit",
      sourceDamageMessageId: "",
      sourceCombatMessageId: String(sourceMessage.id ?? ""),
      maladresseKey: key,
      privateMessageId: "",
      source: { ...(context.source ?? {}) },
      target: { ...(context.target ?? {}) },
      woundItemId: "",
      severity: "maladroit",
      resistanceFd: Math.max(0, Number(effect?.resistanceFd) || (effect?.result === 10 ? 8 : 7)),
      effect: { ...effect },
      playerRoll: {
        userId: String(submittingUser.id ?? ""),
        userName: String(submittingUser.name ?? "")
      },
      skillRollResolution: {
        resolved: false,
        rolledBy: ""
      },
      stateApplication: {
        applied: false,
        itemId: "",
        appliedBy: ""
      }
    };

    const ChatMessageClass = secondaryEffectChatClass();
    if (!ChatMessageClass) throw new Error("API ChatMessage de Foundry indisponible.");

    const publicMessage = existingPublic ?? await ChatMessageClass.create({
      speaker: { alias: "Arkhanval — Maladresse" },
      content: buildPublicSecondaryEffectContent(publicState),
      flags: {
        arkhanval: {
          secondaryEffect: publicState
        }
      }
    });

    await updateSourceMaladresseState(sourceMessage.id, key, {
      delegatedToPlayer: false,
      delegatedBy: String(current?.delegatedBy ?? ""),
      rolledByPlayer: String(submittingUser.id ?? ""),
      privateMessageId: "",
      publicMessageId: String(publicMessage?.id ?? ""),
      published: true,
      ignoreProtectionForDamage: Boolean(effect?.ignoreProtection)
    });
    if (effect?.ignoreProtection) {
      await refreshExistingDamageForMaladresseIgnoreProtection(sourceMessage, key);
    }
  } finally {
    pendingMaladressePlayerRequests.delete(pendingKey);
  }
}

async function submitDelegatedMaladresseRoll(message, combat, key) {
  const context = maladresseContext(combat, key);
  if (!context || !(Number(context.qr) < 0)) {
    throw new Error("Aucune Maladresse valide à tirer.");
  }
  if (!userCanControlTarget(game.user, context.target) || game.user?.isGM) {
    throw new Error("Ce tirage est réservé au joueur propriétaire du personnage.");
  }

  const current = combat?.maladresses?.[String(key)] ?? null;
  if (!current?.delegatedToPlayer || current?.published || current?.publicMessageId || current?.privateMessageId) {
    throw new Error("Ce tirage de Maladresse n’est plus disponible.");
  }

  const existingPublic = publishedSecondaryMessage({
    sourceCombatMessageId: message.id, maladresseKey: key, delegated: true
  });
  const effect = existingPublic?.getFlag?.("arkhanval", "secondaryEffect")?.effect
    ?? await rollSecondaryEffect("maladroit", {
      sourceName: String(context?.source?.name ?? ""),
      targetName: String(context?.target?.name ?? "")
    });
  const envelope = {
    type: SOCKET_TYPE_MALADRESSE_PLAYER,
    messageId: String(message?.id ?? ""),
    userId: String(game.user?.id ?? ""),
    maladresseKey: String(key ?? ""),
    result: Number(effect?.result)
  };

  if (isCurrentAuthority(message)) {
    await applyDelegatedMaladresseRollRequest(envelope);
    return;
  }

  const authorityId = activeAuthorityId(message);
  if (!authorityId) {
    throw new Error("Aucun MJ actif n’est disponible pour publier la Maladresse.");
  }
  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
}

async function createPrivateSecondaryEffectMessage(sourceMessage, damage, {
  forcedSeverity = "",
  dieFaces = 10,
  originType = "damage"
} = {}) {
  if (!game.user?.isGM) throw new Error("Seul le MJ peut tirer un effet secondaire.");
  if (!String(damage?.target?.tokenId ?? "")) {
    throw new Error("Ce workflow nécessite actuellement une cible Token.");
  }

  const forced = String(forcedSeverity ?? "");
  const severity = forced || String(damage?.wound?.severity ?? "");
  if (!secondaryEffectsAllowed(damage)) {
    throw new Error("Cette blessure provient déjà d’un effet secondaire et ne peut pas en générer un autre.");
  }
  if (!forced && (damage?.wound?.kind !== "wound" || !canUseSecondaryEffectTable(severity))) {
    throw new Error("Aucune blessure grave ou critique à résoudre.");
  }
  if (forced && !canUseSecondaryEffectTable(severity)) {
    throw new Error("Table d’effet secondaire invalide.");
  }

  const latestDamage = sourceMessage.getFlag?.("arkhanval", "damage") ?? damage;
  const secondary = latestDamage?.wound?.secondaryEffect ?? null;
  if (secondary?.published || secondary?.publicMessageId) {
    throw new Error("L’effet secondaire a déjà été publié.");
  }
  const existingId = String(secondary?.privateMessageId ?? "");
  const orphanPrivate = Array.from(game.messages?.contents ?? game.messages ?? []).find((entry) => {
    const state = entry?.getFlag?.("arkhanval", "secondaryEffectPrivate") ?? null;
    return String(state?.sourceDamageMessageId ?? "") === String(sourceMessage.id ?? "")
      && !state?.published;
  });
  if (!existingId && orphanPrivate) {
    await updateSourceSecondaryEffectState(sourceMessage.id, { privateMessageId: String(orphanPrivate.id) });
    ui.notifications?.info?.("Arkhanval | Tirage privé déjà créé ; lien rétabli.");
    return;
  }
  if (existingId && game.messages?.get?.(existingId)) {
    ui.notifications?.info?.("Arkhanval | Un tirage d’effet secondaire existe déjà pour cette blessure.");
    return;
  }

  const effect = await rollSecondaryEffect(severity, {
    sourceName: String(damage?.source?.name ?? ""),
    targetName: String(damage?.target?.name ?? ""),
    dieFaces
  });
  const state = {
    originType: String(originType || "damage"),
    dieFaces: Math.max(1, Number(dieFaces) || 10),
    sourceDamageMessageId: String(sourceMessage.id ?? ""),
    source: { ...(damage.source ?? {}) },
    target: { ...(damage.target ?? {}) },
    woundItemId: String(damage?.wound?.itemId ?? ""),
    woundBaseSeverity: String(damage?.wound?.baseSeverity ?? ""),
    severity,
    resistanceFd: Math.max(0, Number(damage?.resistanceFd) || 0),
    effect,
    published: false,
    publicMessageId: ""
  };

  const ChatMessageClass = secondaryEffectChatClass();
  if (!ChatMessageClass) throw new Error("API ChatMessage de Foundry indisponible.");

  const whisper = gmWhisperUserIds();
  if (!whisper.length) throw new Error("Aucun MJ disponible pour recevoir le tirage privé.");

  const privateMessage = await ChatMessageClass.create({
    speaker: { alias: "Arkhanval — Effet secondaire" },
    content: buildPrivateSecondaryEffectContent(state),
    whisper,
    flags: {
      arkhanval: {
        secondaryEffectPrivate: state
      }
    }
  });

  await updateSourceSecondaryEffectState(sourceMessage.id, {
    privateMessageId: String(privateMessage?.id ?? ""),
    publicMessageId: "",
    published: false
  });
}

async function rerollPrivateSecondaryEffect(message) {
  if (!game.user?.isGM) throw new Error("Seul le MJ peut relancer l’effet secondaire.");

  const state = message.getFlag?.("arkhanval", "secondaryEffectPrivate") ?? null;
  if (!state || state.published || pendingPrivateSecondaryPublications.has(message.id)
    || publishedSecondaryMessage({ privateMessageId: message.id })) return;

  const effect = await rollSecondaryEffect(state.severity, {
    sourceName: String(state?.source?.name ?? ""),
    targetName: String(state?.target?.name ?? ""),
    dieFaces: Math.max(1, Number(state?.dieFaces) || 10)
  });
  const nextState = {
    ...state,
    effect
  };

  await message.update({
    content: buildPrivateSecondaryEffectContent(nextState),
    "flags.arkhanval.secondaryEffectPrivate": nextState
  });
}

async function publishPrivateSecondaryEffect(message) {
  if (!game.user?.isGM) throw new Error("Seul le MJ peut publier l’effet secondaire.");

  const state = message.getFlag?.("arkhanval", "secondaryEffectPrivate") ?? null;
  if (!state || pendingPrivateSecondaryPublications.has(message.id)) return;
  pendingPrivateSecondaryPublications.add(message.id);
  try {
  const existingPublic = publishedSecondaryMessage({ privateMessageId: message.id });
  if (state.published && !existingPublic) return;
  const target = state.target ?? null;
  const originType = String(state.originType ?? "damage");
  let sourceMessage = null;

  if (originType === "maladroit") {
    sourceMessage = game.messages?.get?.(String(state.sourceCombatMessageId ?? "")) ?? null;
    const combat = sourceMessage?.getFlag?.("arkhanval", "combat") ?? null;
    if (!sourceMessage || !combat) throw new Error("La carte de combat d’origine n’est plus disponible.");
  } else {
    sourceMessage = game.messages?.get?.(String(state.sourceDamageMessageId ?? "")) ?? null;
    const sourceDamage = sourceMessage?.getFlag?.("arkhanval", "damage") ?? null;
    if (!sourceMessage || !sourceDamage) {
      throw new Error("La carte de dégâts d’origine n’est plus disponible.");
    }

    const sameTarget =
      String(sourceDamage?.target?.tokenId ?? "") === String(target?.tokenId ?? "")
      && String(sourceDamage?.target?.sceneId ?? "") === String(target?.sceneId ?? "");
    const sameSeverity = String(sourceDamage?.wound?.severity ?? "") === String(state.severity ?? "");

    if (!sameTarget || (originType !== "feinte" && (sourceDamage?.wound?.kind !== "wound" || !sameSeverity))) {
      throw new Error("Le contexte cible ou le niveau de blessure a changé.");
    }
  }

  const ChatMessageClass = secondaryEffectChatClass();
  if (!ChatMessageClass) throw new Error("API ChatMessage de Foundry indisponible.");

  const publicState = {
    originType,
    sourceDamageMessageId: String(state.sourceDamageMessageId ?? ""),
    sourceCombatMessageId: String(state.sourceCombatMessageId ?? ""),
    maladresseKey: String(state.maladresseKey ?? ""),
    privateMessageId: String(message.id ?? ""),
    source: { ...(state.source ?? {}) },
    target: { ...(state.target ?? {}) },
    woundItemId: String(state.woundItemId ?? ""),
    severity: String(state.severity ?? ""),
    dieFaces: Math.max(1, Number(state?.dieFaces) || 10),
    resistanceFd: Math.max(0, Number(state?.effect?.resistanceFd) || Number(state.resistanceFd) || 0),
    effect: { ...(state.effect ?? {}) },
    extraDamageResolution: {
      resolved: false,
      messageId: "",
      total: 0,
      rolledBy: ""
    },
    skillRollResolution: {
      resolved: false,
      rolledBy: ""
    },
    stateApplication: {
      applied: false,
      itemId: "",
      appliedBy: ""
    }
  };

  const publicMessage = existingPublic ?? await ChatMessageClass.create({
    speaker: { alias: originType === "maladroit" ? "Arkhanval — Maladresse" : "Arkhanval — Effet secondaire" },
    content: buildPublicSecondaryEffectContent(publicState),
    flags: {
      arkhanval: {
        secondaryEffect: publicState
      }
    }
  });

  if (
    publicState.effect?.roundReminder === "critical4"
    && game.combat?.started
    && Number(game.combat?.round) > 0
  ) {
    await scheduleRoundReminder(game.combat, {
      id: `critical4:${publicState.sourceDamageMessageId}`,
      dueRound: Number(game.combat.round) + 1,
      targetName: String(publicState?.target?.name ?? "Cible"),
      label: "Blessure critique 4",
      note: "Appliquer une Blessure grave ce round. La perte de protection reste manuelle.",
      sourceMessageId: String(publicState.sourceDamageMessageId ?? ""),
      sourcePublicMessageId: String(publicMessage?.id ?? ""),
      targetActorUuid: String(publicState?.target?.actorUuid ?? ""),
      targetActorId: String(publicState?.target?.actorId ?? "")
    });
  }

  if (originType === "maladroit") {
    await updateSourceMaladresseState(state.sourceCombatMessageId, state.maladresseKey, {
      privateMessageId: "",
      publicMessageId: String(publicMessage?.id ?? ""),
      published: true,
      ignoreProtectionForDamage: Boolean(publicState?.effect?.ignoreProtection)
    });
    if (publicState?.effect?.ignoreProtection) {
      await refreshExistingDamageForMaladresseIgnoreProtection(sourceMessage, state.maladresseKey);
    }
  } else {
    await updateSourceSecondaryEffectState(state.sourceDamageMessageId, {
      privateMessageId: "",
      publicMessageId: String(publicMessage?.id ?? ""),
      published: true
    });
  }

  // Once the GM has accepted the result, the private review card has no further
  // gameplay value. Keep only the public, contextualized result in chat.
  await message.delete();
  } finally {
    pendingPrivateSecondaryPublications.delete(message.id);
  }
}

async function rollSecondaryResistance(message) {
  const state = message.getFlag?.("arkhanval", "secondaryEffect") ?? null;
  if (!state?.effect?.requiresResistance) return;

  if (!(game.user?.isGM || userCanControlTarget(game.user, state.target))) {
    throw new Error("Vous ne contrôlez pas la cible de ce jet de résistance.");
  }

  const actor = await actorFromTarget(state.target);
  if (!actor) throw new Error("Cible du jet de résistance introuvable.");

  const request = await promptArkRollRequest(actor, "arkoeur", {
    defaultFd: Math.max(0, Number(state.resistanceFd) || 0),
    fdMin: 0,
    fdMax: 20,
    title: `Jet de résistance — ${String(actor.name ?? "Arkœur")}`,
    allowArkSelection: true
  });
  if (!request) return;

  const result = await resolveRoll(request);

  if (request.ark?.boost) {
    const spent = await spendArkCircle(actor, request.ark.boost);
    if (!spent) {
      ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
      return;
    }
  }

  await postResolutionChatMessage(actor, result, {
    arkBoost: request.ark?.boost ?? "",
    experienceSource: experienceSourceFromRollRequest(actor, request)
  });
}

async function rollSecondarySkillAction(message) {
  const state = message.getFlag?.("arkhanval", "secondaryEffect") ?? null;
  const skillAction = state?.effect?.skillRoll ?? null;
  if (!skillAction || state?.skillRollResolution?.resolved) return;

  if (!(game.user?.isGM || userCanControlTarget(game.user, state.target))) {
    throw new Error("Vous ne contrôlez pas le personnage concerné par ce jet.");
  }

  const actor = await actorFromTarget(state.target);
  if (!actor) throw new Error("Personnage du jet introuvable.");

  const skill = listActorSkills(actor).find((entry) =>
    String(entry?.identifier ?? "") === String(skillAction.identifier ?? "")
  ) ?? null;
  if (!skill) throw new Error(`Compétence introuvable : ${skillAction.label || skillAction.identifier}.`);

  let defaultFd = Math.max(0, Number(skillAction.fd) || 0);
  const fdFormula = String(skillAction.fdFormula ?? "").trim();
  if (fdFormula) {
    const fdRoll = await evaluateFormula(fdFormula);
    if (!fdRoll) throw new Error(`Le FD ${fdFormula} n’a pas pu être déterminé.`);
    await showEvaluatedRoll(fdRoll, { publicRoll: false });
    defaultFd = Math.max(0, Math.min(12, Number(fdRoll.total) || 0));
  }

  const request = await promptSkillRoll({
    actor,
    skill,
    defaultFd
  });
  if (!request) return;

  const result = await resolveRoll(request);
  if (request.ark?.boost) {
    const spent = await spendArkCircle(actor, request.ark.boost);
    if (!spent) {
      ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
      return;
    }
  }

  const experienceSource = experienceSourceFromRollRequest(actor, request);

  await postResolutionChatMessage(actor, result, {
    arkBoost: request.ark?.boost ?? "",
    experienceSource,
    combatContext: request.combat ?? null
  });

  await submitSecondarySkillCompletion(message, { fdUsed: defaultFd });
}

async function validateSecondarySkillCompletionRequest(message, payload) {
  const submittingUser = game.users?.get?.(String(payload?.userId ?? "")) ?? null;
  if (!submittingUser) return false;

  const state = message.getFlag?.("arkhanval", "secondaryEffect") ?? null;
  if (!state?.effect?.skillRoll || state?.skillRollResolution?.resolved) return false;

  return Boolean(
    submittingUser.isGM
    || userCanControlTarget(submittingUser, state.target)
  );
}

async function applySecondarySkillCompletionRequest(payload) {
  const message = game.messages?.get?.(String(payload?.messageId ?? "")) ?? null;
  if (!message) return;

  const pendingKey = String(message.id ?? "");
  if (!pendingKey || pendingSecondarySkillRequests.has(pendingKey)) return;
  if (!(await validateSecondarySkillCompletionRequest(message, payload))) {
    console.warn("Arkhanval | Validation du jet de compétence lié à l’effet refusée par l’autorité", {
      messageId: payload?.messageId,
      userId: payload?.userId
    });
    return;
  }

  pendingSecondarySkillRequests.add(pendingKey);
  try {
    const state = message.getFlag?.("arkhanval", "secondaryEffect") ?? null;
    if (!state?.effect?.skillRoll || state?.skillRollResolution?.resolved) return;

    const nextState = {
      ...state,
      skillRollResolution: {
        resolved: true,
        rolledBy: String(payload?.userId ?? ""),
        fdUsed: Math.max(0, Number(payload?.fdUsed) || Number(state?.effect?.skillRoll?.fd) || 0)
      }
    };

    await message.update({
      content: buildPublicSecondaryEffectContent(nextState),
      "flags.arkhanval.secondaryEffect": nextState
    });
  } finally {
    pendingSecondarySkillRequests.delete(pendingKey);
  }
}

async function submitSecondarySkillCompletion(message, { fdUsed = 0 } = {}) {
  const envelope = {
    type: SOCKET_TYPE_SECONDARY_SKILL,
    messageId: String(message?.id ?? ""),
    userId: String(game.user?.id ?? ""),
    fdUsed: Math.max(0, Number(fdUsed) || 0)
  };

  if (isCurrentAuthority(message)) {
    await applySecondarySkillCompletionRequest(envelope);
    return;
  }

  const authorityId = activeAuthorityId(message);
  if (!authorityId) {
    ui.notifications?.error?.("Arkhanval | Aucun client autorisé n’est disponible pour enregistrer ce jet.");
    return;
  }

  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
}

function injectSecondaryEffectAction(message, html) {
  const damage = message.getFlag?.("arkhanval", "damage") ?? null;
  if (!damage || !game.user?.isGM || !secondaryEffectsAllowed(damage)) return;
  if (!String(damage?.target?.tokenId ?? "")) return;

  const severity = String(damage?.wound?.severity ?? "");
  if (damage?.wound?.kind !== "wound" || !canUseSecondaryEffectTable(severity)) return;

  const section = html.querySelector?.("[data-arkhanval-wound-section]");
  if (!section || section.querySelector("[data-arkhanval-secondary-effect-action]")) return;

  const existing = damage?.wound?.secondaryEffect ?? null;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.arkhanvalSecondaryEffectAction = "1";
  button.className = "arkhanval-damage-card__wound-action";
  const mainDamageCard = Boolean(html.querySelector?.(".arkhanval-damage-card--combat"));

  if (existing?.published || existing?.publicMessageId) {
    button.disabled = true;
    button.textContent = "Effet secondaire publié";
  } else if (existing?.privateMessageId) {
    button.disabled = true;
    button.textContent = "Effet secondaire en cours";
  } else {
    button.textContent = mainDamageCard ? "MJ — Tirer l’effet secondaire" : "Tirer l’effet secondaire";
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await createPrivateSecondaryEffectMessage(message, damage);
      } catch (error) {
        console.error("Arkhanval | Échec du tirage d’effet secondaire", error);
        button.disabled = false;
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
      }
    });
  }

  // Keep both persistent GM actions together, in the order used by the damage card.
  // A wound action can be wrapped by arkhanval-chat-decision-block on legacy cards:
  // insertBefore requires a *direct* child, not the nested button.
  const woundButton = section.querySelector?.("[data-arkhanval-wound-apply]")
    ?? section.querySelector?.(".arkhanval-damage-card__wound-action");
  const woundHost = woundButton?.closest?.(".arkhanval-chat-decision-block") ?? woundButton;
  if (woundHost?.parentElement === section) {
    if (mainDamageCard) woundHost.after(button);
    else section.insertBefore(button, woundHost);
  } else section.append(button);
}

function restorePrivateSecondaryEffectControls(message) {
  if (!game.user?.isGM) return;

  const state = message.getFlag?.("arkhanval", "secondaryEffectPrivate") ?? null;
  if (!state || state.published || pendingPrivateSecondaryPublications.has(message.id)) return;

  const messageId = String(message?.id ?? "");
  if (!messageId) return;

  const escapedId = globalThis.CSS?.escape
    ? CSS.escape(messageId)
    : messageId.replaceAll('"', '\\"');
  const roots = document.querySelectorAll?.(`[data-message-id="${escapedId}"]`) ?? [];

  for (const root of roots) {
    const reroll = root.querySelector?.("[data-arkhanval-secondary-reroll]");
    const publish = root.querySelector?.("[data-arkhanval-secondary-publish]");
    const alreadyPublic = Boolean(publishedSecondaryMessage({ privateMessageId: messageId }));
    if (reroll) reroll.disabled = alreadyPublic;
    if (publish) publish.disabled = false; // Permet de terminer une publication interrompue.
  }
}

function activatePrivateSecondaryEffectCard(message, html) {
  const state = message.getFlag?.("arkhanval", "secondaryEffectPrivate") ?? null;
  if (!state) return;

  const reroll = html.querySelector?.("[data-arkhanval-secondary-reroll]");
  const publish = html.querySelector?.("[data-arkhanval-secondary-publish]");
  if (!reroll && !publish) return;

  if (!game.user?.isGM || state.published) {
    if (reroll) {
      reroll.hidden = true;
      reroll.disabled = true;
    }
    if (publish) {
      publish.hidden = true;
      publish.disabled = true;
    }
    return;
  }

  if (reroll) {
    reroll.disabled = Boolean(publishedSecondaryMessage({ privateMessageId: message.id }));
    reroll.addEventListener("click", async () => {
      if (reroll.disabled) return;
      reroll.disabled = true;
      if (publish) publish.disabled = true;
      try {
        await rerollPrivateSecondaryEffect(message);
      } catch (error) {
        console.error("Arkhanval | Échec de relance de l’effet secondaire", error);
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
      } finally {
        // ChatMessage.update() peut conserver ponctuellement l'état DOM des contrôles
        // lors du morphing du message. La relance a pourtant réussi : on restaure
        // explicitement les contrôles de toutes les vues du message encore privé.
        restorePrivateSecondaryEffectControls(message);
      }
    });
  }

  if (publish) {
    publish.addEventListener("click", async () => {
      if (publish.disabled) return;
      publish.disabled = true;
      if (reroll) reroll.disabled = true;
      try {
        await publishPrivateSecondaryEffect(message);
      } catch (error) {
        console.error("Arkhanval | Échec de publication de l’effet secondaire", error);
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
      } finally {
        // En cas d'échec, ou si la publication n'a pas été finalisée, le message
        // privé doit rester immédiatement actionnable sans dépendre d'un rerender.
        restorePrivateSecondaryEffectControls(message);
      }
    });
  }
}





async function validateSecondaryExtraWoundRequest(message, payload) {
  const submittingUser = game.users?.get?.(payload.userId) ?? null;
  if (!submittingUser?.isGM) return false;

  const state = message.getFlag?.("arkhanval", "secondaryEffect") ?? null;
  if (!state || String(state.originType ?? "damage") !== "damage") return false;
  const severity = String(state?.effect?.extraWoundSeverity ?? "");
  if (!["light", "serious", "critical"].includes(severity)) return false;
  if (state?.extraWoundResolution?.resolved) return false;

  const sourceMessage = game.messages?.get?.(String(state.sourceDamageMessageId ?? "")) ?? null;
  const sourceDamage = sourceMessage?.getFlag?.("arkhanval", "damage") ?? null;
  if (!sourceDamage || sourceDamage?.wound?.kind !== "wound") return false;

  if (
    String(sourceDamage?.target?.tokenId ?? "") !== String(state?.target?.tokenId ?? "")
    || String(sourceDamage?.target?.sceneId ?? "") !== String(state?.target?.sceneId ?? "")
  ) {
    return false;
  }

  return true;
}

async function applySecondaryExtraWoundRequest(payload) {
  const message = game.messages?.get?.(payload.messageId) ?? null;
  if (!message) return;

  const pendingKey = String(message.id ?? "");
  if (!pendingKey || pendingSecondaryWoundRequests.has(pendingKey)) return;
  if (!(await validateSecondaryExtraWoundRequest(message, payload))) {
    console.warn("Arkhanval | Demande de blessure supplémentaire refusée par l’autorité", {
      messageId: payload.messageId,
      userId: payload.userId
    });
    return;
  }

  pendingSecondaryWoundRequests.add(pendingKey);
  try {
    const state = message.getFlag?.("arkhanval", "secondaryEffect") ?? null;
    if (!state || state?.extraWoundResolution?.resolved) return;

    const severity = String(state?.effect?.extraWoundSeverity ?? "");
    const targetActor = await actorFromTarget(state.target);
    if (!targetActor) throw new Error("Cible de la blessure supplémentaire introuvable.");

    const damage = {
      source: { ...(state.source ?? {}) },
      target: { ...(state.target ?? {}) },
      qrDifference: 0,
      baseDie: null,
      weapon: null,
      extraDice: null,
      specialty: {
        flatModifier: 0,
        notes: [],
        warnings: []
      },
      protection: {
        base: 0,
        modifier: 0,
        resolved: 0,
        used: 0,
        ignored: true
      },
      rawTotal: 0,
      total: 0,
      resistanceFd: 0,
      resolution: {
        origin: "secondary-effect-wound",
        forcedWoundSeverity: severity,
        allowSecondaryEffect: false,
        sourceSecondaryMessageId: String(message.id ?? ""),
        sourceDamageMessageId: String(state.sourceDamageMessageId ?? ""),
        sourceEffectResult: Number(state?.effect?.result) || 0
      },
      wound: buildFixedWoundProposal(targetActor, severity)
    };

    const ChatMessageClass = secondaryEffectChatClass();
    if (!ChatMessageClass) throw new Error("API ChatMessage de Foundry indisponible.");

    const damageMessage = await ChatMessageClass.create({
      speaker: { alias: "Arkhanval — Blessure supplémentaire" },
      content: buildDamageChatContent(damage),
      flags: {
        arkhanval: {
          damage
        }
      }
    });

    const nextState = {
      ...state,
      extraWoundResolution: {
        resolved: true,
        messageId: String(damageMessage?.id ?? ""),
        severity,
        preparedBy: String(payload.userId ?? "")
      }
    };

    await message.update({
      content: buildPublicSecondaryEffectContent(nextState),
      "flags.arkhanval.secondaryEffect": nextState
    });
  } finally {
    pendingSecondaryWoundRequests.delete(pendingKey);
  }
}

async function submitSecondaryExtraWoundRequest(message) {
  const envelope = {
    type: SOCKET_TYPE_SECONDARY_WOUND,
    messageId: String(message?.id ?? ""),
    userId: String(game.user?.id ?? "")
  };

  if (isCurrentAuthority(message)) {
    await applySecondaryExtraWoundRequest(envelope);
    return;
  }

  const authorityId = activeAuthorityId(message);
  if (!authorityId) {
    ui.notifications?.error?.("Arkhanval | Aucun client autorisé n’est disponible pour préparer cette blessure.");
    return;
  }

  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
}

async function validateSecondaryExtraDamageRequest(message, payload) {
  const submittingUser = game.users?.get?.(payload.userId) ?? null;
  if (!submittingUser?.isGM) return false;

  const state = message.getFlag?.("arkhanval", "secondaryEffect") ?? null;
  if (!state || String(state.originType ?? "damage") !== "damage") return false;
  if (!String(state?.effect?.extraDamage ?? "").trim()) return false;
  if (state?.extraDamageResolution?.resolved) return false;

  const sourceMessage = game.messages?.get?.(String(state.sourceDamageMessageId ?? "")) ?? null;
  const sourceDamage = sourceMessage?.getFlag?.("arkhanval", "damage") ?? null;
  if (!sourceDamage || sourceDamage?.wound?.kind !== "wound") return false;

  if (
    String(sourceDamage?.target?.tokenId ?? "") !== String(state?.target?.tokenId ?? "")
    || String(sourceDamage?.target?.sceneId ?? "") !== String(state?.target?.sceneId ?? "")
  ) {
    return false;
  }

  return true;
}

async function applySecondaryExtraDamageRequest(payload) {
  const message = game.messages?.get?.(payload.messageId) ?? null;
  if (!message) return;

  const pendingKey = String(message.id ?? "");
  if (!pendingKey || pendingSecondaryDamageRequests.has(pendingKey)) return;
  if (!(await validateSecondaryExtraDamageRequest(message, payload))) {
    console.warn("Arkhanval | Demande de dégâts supplémentaires refusée par l’autorité", {
      messageId: payload.messageId,
      userId: payload.userId
    });
    return;
  }

  pendingSecondaryDamageRequests.add(pendingKey);
  try {
    const state = message.getFlag?.("arkhanval", "secondaryEffect") ?? null;
    if (!state || state?.extraDamageResolution?.resolved) return;

    const formula = String(state?.effect?.extraDamage ?? "").trim();
    const targetActor = await actorFromTarget(state.target);
    if (!targetActor) throw new Error("Cible des dégâts supplémentaires introuvable.");

    const roll = await evaluateFormula(formula);
    if (!roll) throw new Error("Le jet de dégâts supplémentaires n’a pas pu être résolu.");
    await showEvaluatedRoll(roll);

    const total = Math.max(0, Number(roll.total) || 0);
    const values = rollNaturalValues(roll);
    const damage = {
      source: { ...(state.source ?? {}) },
      target: { ...(state.target ?? {}) },
      qrDifference: 0,
      baseDie: {
        formula,
        label: `${formula} = ${total}`,
        total
      },
      weapon: null,
      extraDice: null,
      specialty: {
        flatModifier: 0,
        notes: [],
        warnings: []
      },
      protection: {
        base: 0,
        modifier: 0,
        resolved: 0,
        used: 0,
        ignored: true
      },
      rawTotal: total,
      total,
      resistanceFd: 0,
      derivedDamage: {
        formula,
        values
      },
      resolution: {
        origin: "secondary-effect",
        allowSecondaryEffect: false,
        sourceSecondaryMessageId: String(message.id ?? ""),
        sourceDamageMessageId: String(state.sourceDamageMessageId ?? ""),
        sourceEffectResult: Number(state?.effect?.result) || 0
      },
      wound: buildDamageWoundProposal(targetActor, total)
    };

    const ChatMessageClass = secondaryEffectChatClass();
    if (!ChatMessageClass) throw new Error("API ChatMessage de Foundry indisponible.");

    const damageMessage = await ChatMessageClass.create({
      speaker: { alias: "Arkhanval — Dégâts supplémentaires" },
      content: buildDamageChatContent(damage),
      flags: {
        arkhanval: {
          damage
        }
      }
    });

    const nextState = {
      ...state,
      extraDamageResolution: {
        resolved: true,
        messageId: String(damageMessage?.id ?? ""),
        total,
        rolledBy: String(payload.userId ?? "")
      }
    };

    await message.update({
      content: buildPublicSecondaryEffectContent(nextState),
      "flags.arkhanval.secondaryEffect": nextState
    });
  } finally {
    pendingSecondaryDamageRequests.delete(pendingKey);
  }
}

async function submitSecondaryExtraDamageRequest(message) {
  const envelope = {
    type: SOCKET_TYPE_SECONDARY_DAMAGE,
    messageId: String(message?.id ?? ""),
    userId: String(game.user?.id ?? "")
  };

  if (isCurrentAuthority(message)) {
    await applySecondaryExtraDamageRequest(envelope);
    return;
  }

  const authorityId = activeAuthorityId(message);
  if (!authorityId) {
    ui.notifications?.error?.("Arkhanval | Aucun client autorisé n’est disponible pour lancer ces dégâts.");
    return;
  }

  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
}

function actorParticipatesInCombat(actor, combat) {
  if (!actor || !combat?.started) return false;
  const actorUuid = String(actor.uuid ?? "");
  const actorId = String(actor.id ?? "");
  return Array.from(combat.combatants ?? []).some((combatant) => {
    const candidate = combatant?.actor ?? null;
    return Boolean(
      candidate
      && (
        (actorUuid && String(candidate.uuid ?? "") === actorUuid)
        || (actorId && String(candidate.id ?? "") === actorId)
      )
    );
  });
}

async function validateStateEffectRequest(message, payload) {
  const submittingUser = game.users?.get?.(payload.userId) ?? null;
  if (!submittingUser) return false;

  const state = message.getFlag?.("arkhanval", "secondaryEffect") ?? null;
  if (!state || state?.stateApplication?.applied) return false;
  if (!effectIsAssistedState(state.effect)) return false;
  if (!submittingUser.isGM) return false;

  if (String(state.originType ?? "damage") === "damage") {
    const sourceMessage = game.messages?.get?.(String(state.sourceDamageMessageId ?? "")) ?? null;
    const damage = sourceMessage?.getFlag?.("arkhanval", "damage") ?? null;
    if (!damage || damage?.wound?.kind !== "wound") return false;
    if (String(damage?.wound?.severity ?? "") !== String(state.severity ?? "")) return false;
  } else if (String(state.originType ?? "") === "maladroit") {
    const sourceMessage = game.messages?.get?.(String(state.sourceCombatMessageId ?? "")) ?? null;
    if (!sourceMessage?.getFlag?.("arkhanval", "combat")) return false;
  }

  return true;
}

async function applySecondaryStateRequest(payload) {
  const message = game.messages?.get?.(payload.messageId) ?? null;
  if (!message) return;

  const pendingKey = String(message.id ?? "");
  if (!pendingKey || pendingStateRequests.has(pendingKey)) return;
  if (!(await validateStateEffectRequest(message, payload))) {
    console.warn("Arkhanval | Demande d’application d’état refusée par l’autorité", {
      messageId: payload.messageId,
      userId: payload.userId
    });
    return;
  }

  pendingStateRequests.add(pendingKey);
  try {
    const state = message.getFlag?.("arkhanval", "secondaryEffect") ?? null;
    if (!state || state?.stateApplication?.applied) return;

    const actor = await actorFromTarget(state.target);
    if (!actor) throw new Error("Cible de l’état introuvable.");

    let itemId = "";
    if (state.effect?.vanillaStateId === "groggy") {
      await actor.update({ "system.states.groggy": true });
    } else {
      const activeCombat = actorParticipatesInCombat(actor, game.combat) ? game.combat : null;
      const data = stateItemData(state.effect?.statePresetId, {
        combat: activeCombat
      });
      if (!data) throw new Error("Gabarit d’état introuvable.");

      const identifier = String(data?.system?.identifier ?? "");
      const existing = Array.from(actor.items ?? []).find(
        (item) => item?.type === "state" && String(item?.system?.identifier ?? "") === identifier
      );

      if (existing) {
        await existing.update({
          "system.description": data.system.description,
          "system.rules": data.system.rules,
          "system.tracking": data.system.tracking
        });
        itemId = String(existing.id ?? "");
      } else {
        const [created] = await actor.createEmbeddedDocuments("Item", [data]);
        itemId = String(created?.id ?? "");
      }
    }

    const nextState = {
      ...state,
      stateApplication: {
        applied: true,
        itemId,
        appliedBy: String(payload.userId ?? "")
      }
    };

    await message.update({
      content: buildPublicSecondaryEffectContent(nextState),
      "flags.arkhanval.secondaryEffect": nextState
    });
  } finally {
    pendingStateRequests.delete(pendingKey);
  }
}

async function submitSecondaryStateRequest(message) {
  const envelope = {
    type: SOCKET_TYPE_STATE,
    messageId: String(message?.id ?? ""),
    userId: String(game.user?.id ?? "")
  };

  if (isCurrentAuthority(message)) {
    await applySecondaryStateRequest(envelope);
    return;
  }

  const authorityId = activeAuthorityId(message);
  if (!authorityId) {
    ui.notifications?.error?.("Arkhanval | Aucun client autorisé n’est disponible pour appliquer cet état.");
    return;
  }
  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
}

function activatePublishedSecondaryEffectCard(message, html) {
  const state = message.getFlag?.("arkhanval", "secondaryEffect") ?? null;
  if (!state) return;

  const canControl = Boolean(
    game.user?.isGM || userCanControlTarget(game.user, state.target)
  );

  const resistanceButton = html.querySelector?.("[data-arkhanval-secondary-resistance]");
  if (resistanceButton) {
    const canUseResistance = Boolean(state?.effect?.requiresResistance && canControl);
    if (!canUseResistance) {
      resistanceButton.hidden = true;
      resistanceButton.disabled = true;
    } else {
      resistanceButton.addEventListener("click", async () => {
        if (resistanceButton.disabled) return;
        resistanceButton.disabled = true;
        try {
          await rollSecondaryResistance(message);
        } catch (error) {
          console.error("Arkhanval | Échec du jet de résistance", error);
          ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        } finally {
          resistanceButton.disabled = false;
        }
      });
    }
  }

  const extraDamageButton = html.querySelector?.("[data-arkhanval-secondary-extra-damage]");
  if (extraDamageButton) {
    const canUseExtraDamage = Boolean(
      state?.effect?.extraDamage
      && !state?.extraDamageResolution?.resolved
      && game.user?.isGM
    );
    if (!canUseExtraDamage) {
      extraDamageButton.disabled = true;
    } else {
      extraDamageButton.addEventListener("click", async () => {
        if (extraDamageButton.disabled) return;
        extraDamageButton.disabled = true;
        try {
          await submitSecondaryExtraDamageRequest(message);
        } catch (error) {
          console.error("Arkhanval | Échec des dégâts supplémentaires", error);
          ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
          extraDamageButton.disabled = false;
        }
      });
    }
  }

  const extraWoundButton = html.querySelector?.("[data-arkhanval-secondary-extra-wound]");
  if (extraWoundButton) {
    const canUseExtraWound = Boolean(
      state?.effect?.extraWoundSeverity
      && !state?.extraWoundResolution?.resolved
      && game.user?.isGM
    );
    if (!canUseExtraWound) {
      extraWoundButton.disabled = true;
    } else {
      extraWoundButton.addEventListener("click", async () => {
        if (extraWoundButton.disabled) return;
        extraWoundButton.disabled = true;
        try {
          await submitSecondaryExtraWoundRequest(message);
        } catch (error) {
          console.error("Arkhanval | Échec de préparation de la blessure supplémentaire", error);
          ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
          extraWoundButton.disabled = false;
        }
      });
    }
  }

  const skillRollButton = html.querySelector?.("[data-arkhanval-secondary-skill-roll]");
  if (skillRollButton) {
    const canUseSkillRoll = Boolean(
      state?.effect?.skillRoll
      && !state?.skillRollResolution?.resolved
      && canControl
    );
    if (!canUseSkillRoll) {
      skillRollButton.hidden = !state?.skillRollResolution?.resolved;
      skillRollButton.disabled = true;
    } else {
      skillRollButton.addEventListener("click", async () => {
        if (skillRollButton.disabled) return;
        skillRollButton.disabled = true;
        try {
          await rollSecondarySkillAction(message);
        } catch (error) {
          console.error("Arkhanval | Échec du jet de compétence lié à l’effet", error);
          ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
          skillRollButton.disabled = false;
        }
      });
    }
  }

  const stateButton = html.querySelector?.("[data-arkhanval-secondary-state-apply]");
  if (stateButton) {
    const canApply = Boolean(
      effectIsAssistedState(state.effect)
      && !state?.stateApplication?.applied
      && game.user?.isGM
    );
    if (!canApply) {
      stateButton.disabled = true;
    } else {
      stateButton.addEventListener("click", async () => {
        if (stateButton.disabled) return;
        stateButton.disabled = true;
        try {
          await submitSecondaryStateRequest(message);
        } catch (error) {
          console.error("Arkhanval | Échec d’application de l’état", error);
          ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
          stateButton.disabled = false;
        }
      });
    }
  }
}

async function startConcentrationRollFromDamage(message) {
  const damage = message.getFlag?.("arkhanval", "damage") ?? null;
  const concentration = damage?.concentration ?? null;
  if (!concentration?.required || concentration?.validated || concentration?.rollMessageId) return null;

  const actor = await actorFromTarget(damage.target);
  if (!actor) throw new Error("Personnage introuvable pour le jet de Concentration.");

  const skill = listActorSkills(actor)
    .find((entry) => String(entry?.identifier ?? "") === "arkhanval.skill.magicien.concentration") ?? null;
  if (!skill) throw new Error("La compétence Concentration est introuvable sur ce personnage.");

  const request = await promptSkillRoll({
    actor,
    skill,
    combatContext: null,
    defaultFd: Number(concentration.fd) || 9,
    title: "Jet de Concentration"
  });
  if (!request) return null;

  const result = await resolveRoll(request);
  if (request.ark?.boost) {
    const spent = await spendArkCircle(actor, request.ark.boost);
    if (!spent) {
      ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
      return null;
    }
  }

  const concentrationContext = {
    sourceDamageMessageId: String(message.id ?? ""),
    actorUuid: String(actor.uuid ?? ""),
    spellIds: Array.from(concentration.spellIds ?? []).map(String).filter(Boolean),
    qr: Number(result.qr) || 0,
    result: documentSafeClone(result),
    validated: false
  };
  const rollMessage = await postResolutionChatMessage(actor, result, {
    arkBoost: request.ark?.boost ?? "",
    experienceSource: null,
    concentration: concentrationContext
  });
  if (!rollMessage) return null;

  await updateDamageMessage(message, {
    ...damage,
    concentration: {
      ...concentration,
      rollMessageId: String(rollMessage.id ?? "")
    }
  });
  return rollMessage;
}

function activateDamageConcentrationAction(message, html) {
  const damage = message.getFlag?.("arkhanval", "damage") ?? null;
  const concentration = damage?.concentration ?? null;
  const button = html.querySelector?.("[data-arkhanval-concentration-roll]");
  if (!button || !concentration?.required) return;

  const actor = actorFromTargetSync(damage.target);
  const canUse = Boolean(
    game.user?.isGM
    || actor?.isOwner
    || actor?.testUserPermission?.(game.user, "OWNER")
  );
  if (!canUse) {
    button.hidden = true;
    button.disabled = true;
    return;
  }

  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      const created = await startConcentrationRollFromDamage(message);
      if (!created) button.disabled = false;
    } catch (error) {
      console.error("Arkhanval | Échec du jet de Concentration", error);
      button.disabled = false;
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  });
}

function injectDamagePrivateDetails(message, html) {
  const damage = message.getFlag?.("arkhanval", "damage") ?? null;
  if (!damage || !game.user?.isGM) return;

  const card = html.querySelector?.(".arkhanval-damage-card");
  if (!card || card.querySelector(".arkhanval-damage-card__gm-detail")) return;

  const protection = Math.max(0, Number(damage?.protection?.used) || 0);
  const modifier = Number(damage?.protection?.modifier) || 0;
  // La protection utilisée figure déjà dans le détail public des dégâts.
  // N'ajouter la ligne MJ que si elle apporte le modificateur détaillé.
  if (!modifier) return;
  const detail = document.createElement("p");
  detail.className = "arkhanval-damage-card__gm-detail";
  detail.textContent = `Protection utilisée : ${protection} (modificateur ${signed(modifier)})`;

  const detailBody = card.querySelector(".arkhanval-damage-card__details-body") ?? card;
  detailBody.append(detail);
}

function contextWithoutTargetIncantation(context, targetKey) {
  const key = String(targetKey ?? "");
  const patchTarget = (target) => {
    const targetKeyValue = String(target?.key ?? target?.tokenId ?? target?.actorUuid ?? "");
    if (targetKeyValue !== key) return target;
    return {
      ...target,
      incantation: {
        ...(target?.incantation ?? {}),
        active: false,
        count: 0,
        spellIds: [],
        ready: false,
        readySpells: []
      }
    };
  };

  return {
    ...(context ?? {}),
    target: context?.target ? patchTarget(context.target) : context?.target ?? null,
    targets: Array.from(context?.targets ?? []).map(patchTarget)
  };
}

async function applyIncantationAbandon(payload) {
  const message = game.messages?.get?.(payload.messageId) ?? null;
  if (!message) return;

  const combat = message.getFlag?.("arkhanval", "combat") ?? null;
  if (!combat?.attackResult) return;

  const submittingUser = game.users?.get?.(payload.userId) ?? null;
  const target = targetByKey(combat, payload.targetKey);
  if (!submittingUser || !target || !(submittingUser.isGM || userCanControlTarget(submittingUser, target))) return;

  const actor = await actorFromTarget(target);
  if (!actor) return;

  await cancelAllSpellIncantations(actor);
  await updateCombatMessage(message, {
    ...combat,
    context: contextWithoutTargetIncantation(combat.context, payload.targetKey)
  });
}

async function submitIncantationAbandon(message, targetKey) {
  const envelope = {
    type: SOCKET_TYPE_INCANTATION_ABANDON,
    messageId: message.id,
    userId: game.user.id,
    targetKey: String(targetKey ?? "")
  };

  if (isCurrentAuthority(message)) {
    await applyIncantationAbandon(envelope);
    return true;
  }

  if (!activeAuthorityId(message)) {
    ui.notifications?.error?.("Arkhanval | Aucun client autorisé n’est disponible pour abandonner l’incantation.");
    return false;
  }

  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
  return true;
}

async function validateSubmission(message, combat, payload) {
  const submittingUser = game.users?.get?.(payload.userId) ?? null;
  if (!submittingUser) return false;

  if (payload.manualNoTarget) {
    return submittingUser.isGM || message.author?.id === submittingUser.id;
  }

  const target = targetByKey(combat, payload.targetKey);
  if (!target) return false;

  if (payload.response?.mode === "manual") return Boolean(submittingUser.isGM);

  return userCanControlTarget(submittingUser, target);
}

async function spellOrderResponseForCombat(combat, target, spellId, spellTargets = []) {
  const targetActor = await actorFromTarget(target);
  if (!targetActor) throw new Error("Magicien introuvable pour déterminer l’ordre.");

  const readySpell = Array.from(combatIncantationSnapshot(targetActor)?.readySpells ?? [])
    .find((entry) => String(entry?.spellId ?? "") === String(spellId ?? "")) ?? null;
  if (!readySpell) {
    throw new Error("Ce sort n’est plus prêt à être lancé.");
  }

  const attackerActorId = String(combat?.context?.attacker?.actorId ?? "");
  const defenderActorId = String(targetActor.id ?? target?.actorId ?? "");
  const artCombat = artCombatResultContext(attackerActorId, defenderActorId);
  if (!artCombat) {
    throw new Error("Aucun résultat d’Art du combat exploitable n’est disponible pour cet assaillant.");
  }

  const rawMagicQr = readySpell.readyQr;
  const magicQr = rawMagicQr === null || rawMagicQr === undefined || rawMagicQr === ""
    ? Number.NaN
    : Number(rawMagicQr);
  const artCombatQr = Number(artCombat.qr);
  if (!Number.isFinite(magicQr)) {
    throw new Error("La QR qui a terminé l’incantation est introuvable. Effectuez un nouveau jet d’incantation puis enregistrez sa progression avant de déterminer l’ordre.");
  }
  if (!Number.isFinite(artCombatQr)) {
    throw new Error("QR d’Art du combat invalide pour déterminer l’ordre d’action.");
  }

  return {
    mode: "spell-order",
    qr: 0,
    skillName: String(readySpell.spellName ?? "Sortilège"),
    skillIdentifier: String(readySpell.castingSkill ?? ""),
    attackerFdModifier: -2,
    spellOrder: {
      spellId: String(readySpell.spellId ?? ""),
      spellName: String(readySpell.spellName ?? "Sortilège"),
      sessionId: String(readySpell.sessionId ?? ""),
      targets: Array.from(spellTargets ?? []).map((entry) => ({
        tokenId: String(entry?.tokenId ?? ""),
        actorUuid: String(entry?.actorUuid ?? ""),
        actorId: String(entry?.actorId ?? ""),
        sceneId: String(entry?.sceneId ?? "")
      })),
      magicQr,
      artCombatQr,
      artCombatConfrontationId: String(artCombat.confrontationId ?? ""),
      order: magicQr > artCombatQr ? "spell-first" : "attack-first"
    },
    arkDecision: {
      available: false,
      diceCount: 0,
      choice: "no",
      locked: true
    }
  };
}

async function applyCombatSubmission(payload) {
  const message = game.messages?.get?.(payload.messageId) ?? null;
  if (!message) return;

  const combat = message.getFlag?.("arkhanval", "combat") ?? null;
  if (!combat?.attackResult) return;
  if (!(await validateSubmission(message, combat, payload))) {
    console.warn("Arkhanval | Réponse de combat refusée par l’autorité", {
      messageId: payload.messageId,
      userId: payload.userId,
      targetKey: payload.targetKey,
      mode: payload.response?.mode
    });
    return;
  }

  let response = payload.response ?? {};
  if (String(response?.mode ?? "") === "spell-order") {
    const target = targetByKey(combat, payload.targetKey);
    response = await spellOrderResponseForCombat(combat, target, response.spellId, response.spellTargets);
  }
  if (!Number.isFinite(Number(response.qr))) return;

  if (payload.manualNoTarget) {
    if (combat.manualResponse) return;
    const nextCombat = {
      ...combat,
      manualResponse: {
        mode: "manual",
        qr: Number(response.qr),
        userId: payload.userId
      }
    };
    await updateCombatMessage(message, nextCombat);
    return;
  }

  const key = String(payload.targetKey ?? "");
  const responses = { ...(combat.responses ?? {}) };
  if (responses[key]) return;

  const attackerArk = normalizeCombatArkDecision(combat.attackerArk ?? {
    available: false,
    diceCount: 0,
    choice: "no",
    locked: true
  });
  const arkDecision = normalizeCombatArkDecision(response.arkDecision ?? {
    available: false,
    diceCount: 0,
    choice: "no",
    locked: true
  });

  responses[key] = {
    mode: String(response.mode ?? "roll"),
    qr: Number(response.qr),
    skillName: String(response.skillName ?? ""),
    skillIdentifier: String(response.skillIdentifier ?? ""),
    result: response.result ?? null,
    combat: response.combat ?? null,
    spellOrder: response.spellOrder ?? null,
    attackerFdModifier: Number(response.attackerFdModifier) || 0,
    userId: payload.userId,
    arkDecision,
    finalized: combatResponseFinalized(attackerArk, { arkDecision })
  };

  const nextCombat = {
    ...combat,
    attackerArk,
    responses
  };

  await updateCombatMessage(message, nextCombat);
}

async function submitCombatResponse(message, payload) {
  const envelope = {
    type: SOCKET_TYPE_RESPONSE,
    messageId: message.id,
    userId: game.user.id,
    ...payload
  };

  if (isCurrentAuthority(message)) {
    await applyCombatSubmission(envelope);
    return;
  }

  const authorityId = activeAuthorityId(message);
  if (!authorityId) {
    ui.notifications?.error?.("Arkhanval | Aucun client autorisé n’est disponible pour enregistrer la réponse.");
    return;
  }

  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
}

function normalizeCombatArkDecision(decision) {
  const available = Boolean(decision?.available);
  const locked = Boolean(decision?.locked || !available);
  return {
    available: available && !locked,
    diceCount: available && !locked ? Math.max(0, Number(decision?.diceCount) || 0) : 0,
    choice: String(decision?.choice ?? (locked ? "no" : "")) || (locked && !available ? "no" : ""),
    locked
  };
}

function finalizeResponsesForAttackerLock(responses, attackerArk) {
  const next = {};
  for (const [key, response] of Object.entries(responses ?? {})) {
    next[key] = {
      ...response,
      finalized: Boolean(response?.finalized || combatResponseFinalized(attackerArk, response))
    };
  }
  return next;
}

async function validateArkDecisionSubmission(message, combat, payload) {
  const submittingUser = game.users?.get?.(payload.userId) ?? null;
  if (!submittingUser) return false;

  const side = String(payload.side ?? "");
  if (side === "attacker") {
    return Boolean(
      submittingUser.isGM
      || userCanControlTarget(submittingUser, combat?.context?.attacker ?? null)
    );
  }

  if (side === "defender") {
    const target = targetByKey(combat, payload.targetKey);
    return Boolean(target && (
      submittingUser.isGM
      || userCanControlTarget(submittingUser, target)
    ));
  }

  return false;
}

async function applyCombatArkDecision(payload) {
  const message = game.messages?.get?.(payload.messageId) ?? null;
  if (!message) return;

  const combat = message.getFlag?.("arkhanval", "combat") ?? null;
  if (!combat?.attackResult) return;
  if (!(await validateArkDecisionSubmission(message, combat, payload))) return;

  const side = String(payload.side ?? "");
  const choice = String(payload.choice ?? "");
  if (!["yes", "no"].includes(choice)) return;

  if (side === "attacker") {
    const current = normalizeCombatArkDecision(combat.attackerArk);
    if (current.locked) return;
    if (choice === "yes" && !current.available) return;

    const nextResult = choice === "yes"
      ? payload.result ?? null
      : combat.attackResult;
    if (!nextResult) return;

    const attackerArk = {
      available: false,
      diceCount: 0,
      choice,
      locked: true
    };

    const nextCombat = {
      ...combat,
      attackerQr: Number(nextResult.qr) || 0,
      attackResult: nextResult,
      attackerArk,
      responses: finalizeResponsesForAttackerLock(combat.responses, attackerArk),
      chatOptions: {
        ...(combat.chatOptions ?? {}),
        arkReroll: choice === "yes"
          ? (nextResult.arkReroll ?? { arkId: String(payload.arkId ?? "") })
          : combat.chatOptions?.arkReroll ?? null,
        arkRerollAvailable: false,
        arkRerollDiceCount: 0
      }
    };

    await updateCombatMessage(message, nextCombat);
    return;
  }

  const key = String(payload.targetKey ?? "");
  const response = combat.responses?.[key] ?? null;
  if (!response) return;

  const current = normalizeCombatArkDecision(response.arkDecision);
  if (current.locked || response.finalized) return;
  if (choice === "yes" && !current.available) return;

  const nextResult = choice === "yes"
    ? payload.result ?? null
    : response.result ?? null;
  if (choice === "yes" && !nextResult) return;

  const arkDecision = {
    available: false,
    diceCount: 0,
    choice,
    locked: true
  };
  const nextResponse = {
    ...response,
    ...(choice === "yes" ? {
      result: nextResult,
      qr: Number(nextResult?.qr) || 0
    } : {}),
    arkDecision
  };
  nextResponse.finalized = combatResponseFinalized(combat.attackerArk, nextResponse);

  await updateCombatMessage(message, {
    ...combat,
    responses: {
      ...(combat.responses ?? {}),
      [key]: nextResponse
    }
  });
}

async function submitCombatArkDecision(message, payload) {
  const envelope = {
    type: SOCKET_TYPE_ARK_DECISION,
    messageId: message.id,
    userId: game.user.id,
    ...payload
  };

  if (isCurrentAuthority(message)) {
    await applyCombatArkDecision(envelope);
    return;
  }

  if (!activeAuthorityId(message)) {
    ui.notifications?.error?.("Arkhanval | Aucun client autorisé n’est disponible pour enregistrer le choix d’Ark.");
    return;
  }

  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
}

async function applyCombatFinalize(payload) {
  const message = game.messages?.get?.(payload.messageId) ?? null;
  if (!message) return;

  const combat = message.getFlag?.("arkhanval", "combat") ?? null;
  if (!combat?.attackResult) return;

  const user = game.users?.get?.(payload.userId) ?? null;
  if (!user?.isGM) return;

  const key = String(payload.targetKey ?? "");
  const response = combat.responses?.[key] ?? null;
  if (!response || response.finalized) return;

  const attackerArkCurrent = normalizeCombatArkDecision(combat.attackerArk);
  const attackerArk = attackerArkCurrent.locked
    ? attackerArkCurrent
    : {
        available: false,
        diceCount: 0,
        choice: "forced",
        locked: true
      };

  const defenderArkCurrent = normalizeCombatArkDecision(response.arkDecision);
  const defenderArk = defenderArkCurrent.locked
    ? defenderArkCurrent
    : {
        available: false,
        diceCount: 0,
        choice: "forced",
        locked: true
      };

  const responses = finalizeResponsesForAttackerLock(combat.responses, attackerArk);
  responses[key] = {
    ...response,
    arkDecision: defenderArk,
    finalized: true
  };

  const nextCombat = {
    ...combat,
    attackerArk,
    responses
  };

  await updateCombatMessage(message, nextCombat);
}

async function submitCombatFinalize(message, targetKey) {
  const envelope = {
    type: SOCKET_TYPE_FINALIZE,
    messageId: message.id,
    userId: game.user.id,
    targetKey: String(targetKey ?? "")
  };

  if (isCurrentAuthority(message)) {
    await applyCombatFinalize(envelope);
    return;
  }

  if (!activeAuthorityId(message)) {
    ui.notifications?.error?.("Arkhanval | Aucun client autorisé n’est disponible pour valider la confrontation.");
    return;
  }

  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
}


function artCreditCombatSide(combat, side, targetKey = "") {
  const normalizedSide = String(side ?? "");
  const key = String(targetKey ?? "");
  const target = targetByKey(combat, key);

  if (normalizedSide === "attacker") {
    return {
      side: "attacker",
      targetKey: key,
      actorSnapshot: combat?.context?.attacker ?? null,
      opponentSnapshot: target ?? null,
      result: combat?.attackResult ?? null,
      locked: normalizeCombatArkDecision(combat?.attackerArk).locked
    };
  }

  if (normalizedSide === "defender") {
    const response = combat?.responses?.[key] ?? null;
    return {
      side: "defender",
      targetKey: key,
      actorSnapshot: target ?? null,
      opponentSnapshot: combat?.context?.attacker ?? null,
      result: response?.result ?? null,
      locked: Boolean(response?.finalized || normalizeCombatArkDecision(response?.arkDecision).locked),
      response
    };
  }

  return null;
}

// Les refus de crédit concernent une proposition précise, pas tous les futurs jets.
// Une nouvelle confrontation ou un résultat différent peut donc être reproposé.
function artCreditDeclineContext(message, { kind, side = "", targetKey = "", combat = null, damage = null, credit = null } = {}) {
  if (kind === "combat") {
    const current = combat ?? message.getFlag?.("arkhanval", "combat") ?? null;
    const context = artCreditCombatSide(current, side, targetKey);
    if (!context?.result || context.locked) return null;
    const attempt = context.result.attempts?.[context.result.selectedAttemptIndex] ?? null;
    return {
      slot: `combat:${side}:${targetKey}`,
      signature: JSON.stringify([
        String(credit?.confrontationId ?? ""),
        context.result.qr,
        context.result.selectedAttemptIndex,
        attempt?.chains ?? null
      ]),
      actorSnapshot: context.actorSnapshot,
      opponentSnapshot: context.opponentSnapshot
    };
  }
  if (kind === "damage") {
    const current = damage ?? message.getFlag?.("arkhanval", "damage") ?? null;
    if (!current || String(current.resolution?.origin ?? "") !== "combat"
      || current.wound?.applied || current.wound?.secondaryEffect) return null;
    return {
      slot: "damage",
      signature: JSON.stringify([
        String(credit?.confrontationId ?? ""),
        current.total,
        damageArtCreditCandidates(current)
      ]),
      actorSnapshot: current.source,
      opponentSnapshot: current.target
    };
  }
  return null;
}

function artCreditOfferDeclined(message, offer) {
  if (!offer) return false;
  const decisions = message.getFlag?.("arkhanval", "artCreditDeclines") ?? {};
  return decisions[offer.slot] === offer.signature;
}

async function applyArtCreditDeclineRequest(payload) {
  const message = game.messages?.get?.(payload.messageId) ?? null;
  const submittingUser = game.users?.get?.(payload.userId) ?? null;
  if (!message || !submittingUser) return;

  const kind = String(payload.kind ?? "");
  const combat = kind === "combat" ? message.getFlag?.("arkhanval", "combat") : null;
  const damage = kind === "damage" ? message.getFlag?.("arkhanval", "damage") : null;
  const context = kind === "combat"
    ? artCreditCombatSide(combat, payload.side, payload.targetKey)
    : null;
  if (kind === "combat" && (!context?.result || context.locked)) return;
  if (kind === "damage" && (!damage || !damageArtCreditCandidates(damage).length)) return;

  const source = kind === "combat" ? context.actorSnapshot : damage?.source;
  const opponent = kind === "combat" ? context.opponentSnapshot : damage?.target;
  if (!artCreditUserCanControl(submittingUser, source)) return;
  const actorId = String(source?.actorId ?? "");
  const opponentId = String(opponent?.actorId ?? "");
  const credit = artCombatCreditContext(actorId, opponentId);
  if (!credit || Number(credit.credit) < 1) return;
  const offer = artCreditDeclineContext(message, {
    kind, side: String(payload.side ?? ""), targetKey: String(payload.targetKey ?? ""),
    combat, damage, credit
  });
  if (!offer || offer.signature !== String(payload.signature ?? "")) return;
  if (artCreditOfferDeclined(message, offer)) return;
  await message.update({
    "flags.arkhanval.artCreditDeclines": {
      ...(message.getFlag?.("arkhanval", "artCreditDeclines") ?? {}),
      [offer.slot]: offer.signature
    }
  });
}

async function submitArtCreditDecline(message, payload) {
  const envelope = {
    type: SOCKET_TYPE_ART_CREDIT_DECLINE,
    messageId: message.id,
    userId: game.user.id,
    ...payload
  };
  if (isCurrentAuthority(message)) {
    await applyArtCreditDeclineRequest(envelope);
    return true;
  }
  if (!activeAuthorityId(message)) {
    ui.notifications?.error?.("Arkhanval | Aucun MJ actif n’est disponible pour enregistrer le refus.");
    return false;
  }
  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
  return true;
}

function artCreditUserCanControl(user, snapshot) {
  if (!user || !snapshot) return false;
  if (user.isGM) return true;
  return userCanControlTarget(user, snapshot);
}

function validateArtCreditDieSelection(result, attemptIndex, chainIndex) {
  const selectedAttemptIndex = Number(result?.selectedAttemptIndex);
  if (!Number.isInteger(selectedAttemptIndex) || selectedAttemptIndex < 0) return false;
  if (Number(attemptIndex) !== selectedAttemptIndex) return false;

  const chain = result?.attempts?.[selectedAttemptIndex]?.chains?.[Number(chainIndex)] ?? null;
  return Boolean(chain && Number(chain.initialFaces) === 10);
}

async function applyArtCreditRerollRequest(payload) {
  const message = game.messages?.get?.(payload.messageId) ?? null;
  if (!message) return;

  const combat = message.getFlag?.("arkhanval", "combat") ?? null;
  if (!combat?.attackResult) return;

  const pendingKey = [
    String(message.id ?? ""),
    String(payload.side ?? ""),
    String(payload.targetKey ?? "")
  ].join(":");
  if (!pendingKey || pendingArtCreditRerollRequests.has(pendingKey)) return;

  const submittingUser = game.users?.get?.(payload.userId) ?? null;
  if (!submittingUser) return;

  const sideContext = artCreditCombatSide(combat, payload.side, payload.targetKey);
  if (!sideContext?.result || sideContext.locked) return;
  if (!artCreditUserCanControl(submittingUser, sideContext.actorSnapshot)) return;

  const actorId = String(sideContext.actorSnapshot?.actorId ?? "");
  const opponentActorId = String(sideContext.opponentSnapshot?.actorId ?? "");
  if (!actorId || !opponentActorId) return;

  const credit = artCombatCreditContext(actorId, opponentActorId);
  if (!credit || Number(credit.credit) < 1) return;
  if (String(payload.confrontationId ?? "") !== String(credit.confrontationId ?? "")) return;

  const attemptIndex = Number(payload.attemptIndex);
  const chainIndex = Number(payload.chainIndex);
  if (!validateArtCreditDieSelection(sideContext.result, attemptIndex, chainIndex)) return;

  pendingArtCreditRerollRequests.add(pendingKey);
  let spent = false;

  try {
    const nextResult = documentSafeClone(payload.result ?? null);
    if (!nextResult?.attempts || !Number.isFinite(Number(nextResult?.qr))) {
      throw new Error("Résultat de relance Art du combat invalide.");
    }

    await consumeArtCombatCredit(credit.confrontationId, actorId, {
      opponentActorId
    });
    spent = true;

    if (sideContext.side === "attacker") {
      await updateCombatMessage(message, {
        ...combat,
        attackerQr: Number(nextResult?.qr) || 0,
        attackResult: nextResult
      });
      return;
    }

    const currentResponse = combat?.responses?.[sideContext.targetKey] ?? null;
    if (!currentResponse) throw new Error("Réponse de combat introuvable.");

    await updateCombatMessage(message, {
      ...combat,
      responses: {
        ...(combat.responses ?? {}),
        [sideContext.targetKey]: {
          ...currentResponse,
          result: nextResult,
          qr: Number(nextResult?.qr) || 0
        }
      }
    });
  } catch (error) {
    if (spent) {
      try {
        await restoreArtCombatCredit(
          String(payload.confrontationId ?? ""),
          String(sideContext.actorSnapshot?.actorId ?? "")
        );
      } catch (restoreError) {
        console.error("Arkhanval | Échec de restitution du crédit Art du combat", restoreError);
      }
    }
    throw error;
  } finally {
    pendingArtCreditRerollRequests.delete(pendingKey);
  }
}

async function submitArtCreditReroll(message, payload) {
  const envelope = {
    type: SOCKET_TYPE_ART_CREDIT_REROLL,
    messageId: message.id,
    userId: game.user.id,
    ...payload
  };

  if (isCurrentAuthority(message)) {
    await applyArtCreditRerollRequest(envelope);
    return true;
  }

  const authorityId = activeAuthorityId(message);
  if (!authorityId) {
    ui.notifications?.error?.("Arkhanval | Aucun MJ actif n’est disponible pour appliquer le crédit de relance.");
    return false;
  }

  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
  return true;
}


function recomputeDamageAfterArtCreditReroll(damage, candidateId, retainedCandidate, targetActor) {
  const nextDamage = documentSafeClone(damage);
  const candidates = damageArtCreditCandidates(nextDamage);
  const index = candidates.findIndex((entry) => String(entry.id) === String(candidateId));
  if (index < 0) throw new Error("Dé de dégâts à relancer introuvable.");

  const previous = candidates[index];
  const replacement = {
    ...previous,
    ...documentSafeClone(retainedCandidate ?? previous),
    id: previous.id,
    bucket: previous.bucket,
    index: previous.index
  };

  const storedIndex = Array.from(nextDamage.rerollableD10s ?? [])
    .findIndex((entry) => String(entry?.id ?? "") === String(previous.id));
  if (storedIndex < 0) throw new Error("État du dé de dégâts introuvable.");
  nextDamage.rerollableD10s[storedIndex] = replacement;

  if (replacement.bucket === "base") {
    nextDamage.baseDie = {
      ...(nextDamage.baseDie ?? {}),
      total: Number(replacement.total) || 0,
      values: Array.from(replacement.values ?? []).map(Number).filter(Number.isFinite),
      label: String(replacement.label ?? replacement.total ?? "")
    };
  } else if (replacement.bucket === "extra") {
    nextDamage.extraDice = {
      ...(nextDamage.extraDice ?? {}),
      total: (Number(nextDamage.extraDice?.total) || 0)
        - (Number(previous.total) || 0)
        + (Number(replacement.total) || 0)
    };
  }

  const allRerollableValues = Array.from(nextDamage.rerollableD10s ?? [])
    .flatMap((entry) => Array.from(entry?.values ?? []))
    .map(Number)
    .filter(Number.isFinite);
  const fixedValues = Array.from(nextDamage.nonRerollableDamageDice ?? [])
    .map(Number)
    .filter(Number.isFinite);
  nextDamage.damageDice = [...allRerollableValues, ...fixedValues];
  nextDamage.resistanceFd = Math.min(
    10,
    Math.max(0, ...nextDamage.damageDice.map((value) => Number(value) || 0))
  );

  const combinedFlatModifier = (Number(nextDamage.specialty?.flatModifier) || 0)
    + (Number(nextDamage.technique?.flatModifier) || 0);
  const totals = calculateCombatDamageTotal({
    qrDifference: Number(nextDamage.qrDifference) || 0,
    baseDie: Number(nextDamage.baseDie?.total) || 0,
    weapon: Number(nextDamage.weapon?.total) || 0,
    extraDice: Number(nextDamage.extraDice?.total) || 0,
    specialtyFlat: combinedFlatModifier,
    protection: Number(nextDamage.protection?.used) || 0
  });
  nextDamage.rawTotal = totals.rawTotal;
  nextDamage.total = totals.total;
  if (targetActor) nextDamage.wound = buildDamageWoundProposal(targetActor, nextDamage.total);

  return nextDamage;
}

async function applyDamageArtCreditRerollRequest(payload) {
  const message = game.messages?.get?.(payload.messageId) ?? null;
  if (!message) return;

  const damage = message.getFlag?.("arkhanval", "damage") ?? null;
  if (!damage || String(damage?.resolution?.origin ?? "") !== "combat") return;
  if (damage?.wound?.applied || damage?.wound?.secondaryEffect) return;

  const submittingUser = game.users?.get?.(payload.userId) ?? null;
  if (!submittingUser) return;

  const sourceActorId = String(damage?.source?.actorId ?? "");
  const targetActorId = String(damage?.target?.actorId ?? "");
  if (!sourceActorId || !targetActorId) return;
  if (!artCreditUserCanControl(submittingUser, damage.source)) return;

  const credit = artCombatCreditContext(sourceActorId, targetActorId);
  if (!credit || Number(credit.credit) < 1) return;
  if (String(payload.confrontationId ?? "") !== String(credit.confrontationId ?? "")) return;

  const candidateId = String(payload.candidateId ?? "");
  const previousCandidate = damageArtCreditCandidates(damage)
    .find((entry) => String(entry.id) === candidateId) ?? null;
  if (!previousCandidate) return;

  const pendingKey = `${message.id}:${sourceActorId}:${candidateId}`;
  if (pendingDamageArtCreditRerollRequests.has(pendingKey)) return;
  pendingDamageArtCreditRerollRequests.add(pendingKey);

  let spent = false;
  try {
    const retainedIsNew = String(payload.retained ?? "old") === "new";
    const retained = retainedIsNew
      ? documentSafeClone(payload.newCandidate ?? null)
      : previousCandidate;
    if (!retained || !Array.isArray(retained.values)) {
      throw new Error("Résultat de relance des dégâts invalide.");
    }
    if (retainedIsNew) {
      const values = retained.values.map(Number);
      const validValues = values.length > 0
        && values.every((value) => Number.isInteger(value) && value >= 1 && value <= 10);
      const expectedTotal = values.reduce((sum, value) => sum + value, 0);
      if (!validValues || Number(retained.total) !== expectedTotal) {
        throw new Error("Résultat de relance des dégâts incohérent.");
      }
    }

    await consumeArtCombatCredit(credit.confrontationId, sourceActorId, {
      opponentActorId: targetActorId
    });
    spent = true;

    const targetActor = await actorFromTarget(damage.target);
    const nextDamage = recomputeDamageAfterArtCreditReroll(
      damage,
      candidateId,
      retained,
      targetActor
    );

    await message.update({
      content: buildDamageChatContent(nextDamage),
      "flags.arkhanval.damage": documentSafeClone(nextDamage)
    });
  } catch (error) {
    if (spent) {
      try {
        await restoreArtCombatCredit(credit.confrontationId, sourceActorId);
      } catch (restoreError) {
        console.error("Arkhanval | Échec de restitution du crédit après relance de dégâts", restoreError);
      }
    }
    throw error;
  } finally {
    pendingDamageArtCreditRerollRequests.delete(pendingKey);
  }
}

async function submitDamageArtCreditReroll(message, payload) {
  const envelope = {
    type: SOCKET_TYPE_DAMAGE_ART_CREDIT_REROLL,
    messageId: message.id,
    userId: game.user.id,
    ...payload
  };

  if (isCurrentAuthority(message)) {
    await applyDamageArtCreditRerollRequest(envelope);
    return true;
  }

  if (!activeAuthorityId(message)) {
    ui.notifications?.error?.("Arkhanval | Aucun MJ actif n’est disponible pour appliquer le crédit de relance.");
    return false;
  }

  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
  return true;
}

export function initializeCombatSocket() {
  game.socket?.on?.(SOCKET_CHANNEL, async (payload) => {
    if (![SOCKET_TYPE_RESPONSE, SOCKET_TYPE_INCANTATION_ABANDON, SOCKET_TYPE_ARK_DECISION, SOCKET_TYPE_FINALIZE, SOCKET_TYPE_DAMAGE, SOCKET_TYPE_WOUND, SOCKET_TYPE_STATE, SOCKET_TYPE_MALADRESSE_PLAYER, SOCKET_TYPE_SECONDARY_DAMAGE, SOCKET_TYPE_SECONDARY_WOUND, SOCKET_TYPE_SECONDARY_SKILL, SOCKET_TYPE_ART_CREDIT_REROLL, SOCKET_TYPE_DAMAGE_ART_CREDIT_REROLL, SOCKET_TYPE_ART_CREDIT_DECLINE].includes(payload?.type)) return;
    const message = game.messages?.get?.(payload.messageId) ?? null;
    if (!message || !isCurrentAuthority(message)) return;

    try {
      if (payload.type === SOCKET_TYPE_INCANTATION_ABANDON) {
        await applyIncantationAbandon(payload);
      } else if (payload.type === SOCKET_TYPE_ARK_DECISION) {
        await applyCombatArkDecision(payload);
      } else if (payload.type === SOCKET_TYPE_ART_CREDIT_REROLL) {
        await applyArtCreditRerollRequest(payload);
      } else if (payload.type === SOCKET_TYPE_DAMAGE_ART_CREDIT_REROLL) {
        await applyDamageArtCreditRerollRequest(payload);
      } else if (payload.type === SOCKET_TYPE_ART_CREDIT_DECLINE) {
        await applyArtCreditDeclineRequest(payload);
      } else if (payload.type === SOCKET_TYPE_FINALIZE) {
        await applyCombatFinalize(payload);
      } else if (payload.type === SOCKET_TYPE_DAMAGE) {
        await applyDamageRequest(payload);
      } else if (payload.type === SOCKET_TYPE_WOUND) {
        await applyWoundRequest(payload);
      } else if (payload.type === SOCKET_TYPE_STATE) {
        await applySecondaryStateRequest(payload);
      } else if (payload.type === SOCKET_TYPE_MALADRESSE_PLAYER) {
        await applyDelegatedMaladresseRollRequest(payload);
      } else if (payload.type === SOCKET_TYPE_SECONDARY_DAMAGE) {
        await applySecondaryExtraDamageRequest(payload);
      } else if (payload.type === SOCKET_TYPE_SECONDARY_WOUND) {
        await applySecondaryExtraWoundRequest(payload);
      } else if (payload.type === SOCKET_TYPE_SECONDARY_SKILL) {
        await applySecondarySkillCompletionRequest(payload);
      } else {
        await applyCombatSubmission(payload);
      }
    } catch (error) {
      let label = "Arkhanval | Échec de mise à jour d’une réponse de combat";
      if (payload.type === SOCKET_TYPE_DAMAGE) label = "Arkhanval | Échec de résolution des dégâts";
      if (payload.type === SOCKET_TYPE_WOUND) label = "Arkhanval | Échec d’application de la blessure";
      if (payload.type === SOCKET_TYPE_STATE) label = "Arkhanval | Échec d’application de l’état";
      if (payload.type === SOCKET_TYPE_MALADRESSE_PLAYER) label = "Arkhanval | Échec du tirage joueur de Maladresse";
      if (payload.type === SOCKET_TYPE_SECONDARY_DAMAGE) label = "Arkhanval | Échec des dégâts supplémentaires d’un effet secondaire";
      if (payload.type === SOCKET_TYPE_SECONDARY_WOUND) label = "Arkhanval | Échec de préparation d’une blessure supplémentaire";
      if (payload.type === SOCKET_TYPE_SECONDARY_SKILL) label = "Arkhanval | Échec d’enregistrement du jet de compétence lié à l’effet";
      if (payload.type === SOCKET_TYPE_ART_CREDIT_REROLL) label = "Arkhanval | Échec de la relance Art du combat";
      if (payload.type === SOCKET_TYPE_DAMAGE_ART_CREDIT_REROLL) label = "Arkhanval | Échec de la relance des dégâts par crédit";
      if (payload.type === SOCKET_TYPE_ART_CREDIT_DECLINE) label = "Arkhanval | Échec de mémorisation du refus de crédit";
      console.error(label, error);
    }
  });
}

function buildMaladresseGmActions(message, combat, key) {
  const wrapper = document.createElement("span");
  wrapper.className = "arkhanval-resolution-card__maladresse-gm-actions";
  wrapper.dataset.arkhanvalMaladresseActions = String(key);

  const drawButton = document.createElement("button");
  drawButton.type = "button";
  drawButton.className = "arkhanval-resolution-card__combat-gm-action";

  const delegateButton = document.createElement("button");
  delegateButton.type = "button";
  delegateButton.className = "arkhanval-resolution-card__combat-gm-action";

  const existing = combat?.maladresses?.[String(key)] ?? null;
  const context = maladresseContext(combat, key);
  const activeOwners = activePlayerOwnersForTarget(context?.target ?? null);

  if (existing?.published || existing?.publicMessageId) {
    drawButton.disabled = true;
    drawButton.textContent = "Maladresse publiée";
    delegateButton.disabled = true;
    delegateButton.textContent = "Tirage terminé";
  } else if (existing?.privateMessageId) {
    drawButton.disabled = true;
    drawButton.textContent = "Maladresse en cours";
    delegateButton.disabled = true;
    delegateButton.textContent = "Tirage MJ en cours";
  } else if (existing?.delegatedToPlayer) {
    drawButton.disabled = true;
    drawButton.textContent = "Tirage confié au joueur";
    delegateButton.disabled = true;
    delegateButton.textContent = "En attente du joueur";
  } else {
    drawButton.textContent = "Tirer la maladresse";
    drawButton.addEventListener("click", async () => {
      if (drawButton.disabled) return;
      drawButton.disabled = true;
      delegateButton.disabled = true;
      try {
        await createPrivateMaladresseMessage(message, combat, key);
      } catch (error) {
        console.error("Arkhanval | Échec du tirage de Maladresse", error);
        drawButton.disabled = false;
        delegateButton.disabled = !activeOwners.length;
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
      }
    });

    if (activeOwners.length) {
      delegateButton.textContent = "Confier le tirage au joueur";
      delegateButton.addEventListener("click", async () => {
        if (delegateButton.disabled) return;
        drawButton.disabled = true;
        delegateButton.disabled = true;
        try {
          await delegateMaladresseToPlayer(message, combat, key);
        } catch (error) {
          console.error("Arkhanval | Échec de délégation du tirage de Maladresse", error);
          drawButton.disabled = false;
          delegateButton.disabled = false;
          ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        }
      });
    }
  }

  wrapper.classList.add("arkhanval-chat-decision-block");
  wrapper.append(drawButton);
  if (existing?.delegatedToPlayer || activeOwners.length) wrapper.append(delegateButton);
  const actorName = String(context?.target?.name ?? "Personnage");
  const status = existing?.published || existing?.publicMessageId
    ? "Tirage terminé"
    : existing?.privateMessageId ? "Tirage MJ en cours"
    : existing?.delegatedToPlayer ? "En attente du joueur" : "Action du MJ attendue";
  const footer = document.createElement("small");
  footer.className = "arkhanval-chat-action-context";
  footer.textContent = `${actorName} — ${status}`;
  wrapper.append(footer);
  return wrapper;
}

function buildDelegatedMaladressePlayerButton(message, combat, key) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "arkhanval-resolution-card__combat-action";
  button.dataset.arkhanvalMaladressePlayerAction = String(key);
  const delegated = maladresseContext(combat, key);
  button.textContent = "Tirer la maladresse";
  button.title = `${String(delegated?.target?.name ?? "Personnage")} — Tirage attendu`;

  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await submitDelegatedMaladresseRoll(message, combat, key);
    } catch (error) {
      console.error("Arkhanval | Échec du tirage joueur de Maladresse", error);
      button.disabled = false;
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  });

  return button;
}

function buildMaladressePublicNotice(key, actorName) {
  const notice = document.createElement("p");
  notice.className = "arkhanval-resolution-card__maladresse-notice";
  notice.dataset.arkhanvalMaladresseNotice = String(key);

  const strong = document.createElement("strong");
  strong.textContent = "Maladresse";
  notice.append(strong, document.createTextNode(` — ${String(actorName || "Le personnage")} commet une maladresse.`));
  return notice;
}

// Avec une cible, la confrontation utilise combat-duel et non combat-heading.
// La maladresse de l'attaquant doit apparaître sur sa carte, une seule fois.
function attackerMaladresseHost(html) {
  return html.querySelector?.(".arkhanval-resolution-card__combat-heading")
    ?? html.querySelector?.(".arkhanval-resolution-card__combat-duel .arkhanval-resolution-card__combatant--attacker .arkhanval-resolution-card__combatant-body")
    ?? null;
}

function injectMaladressePublicNotices(message, html) {
  const combat = message.getFlag?.("arkhanval", "combat") ?? null;
  if (!combat) return;

  if (Number(combat.attackerQr) < 0) {
    const heading = attackerMaladresseHost(html);
    if (heading && !heading.querySelector?.('[data-arkhanval-maladresse-notice="attacker"]')) {
      heading.append(buildMaladressePublicNotice(
        "attacker",
        String(combat?.context?.attacker?.name ?? "L’attaquant")
      ));
    }
  }

  for (const [targetKey, response] of Object.entries(combat.responses ?? {})) {
    if (!(Number(response?.qr) < 0)) continue;
    const escaped = globalThis.CSS?.escape ? CSS.escape(String(targetKey)) : String(targetKey).replaceAll('"', '\\"');
    const branch = html.querySelector?.(`[data-combat-target-key="${escaped}"]`);
    if (!branch) continue;

    const key = `defender:${targetKey}`;
    const escapedKey = globalThis.CSS?.escape ? CSS.escape(key) : key.replaceAll('"', '\\"');
    if (branch.querySelector?.(`[data-arkhanval-maladresse-notice="${escapedKey}"]`)) continue;

    const target = targetByKey(combat, targetKey);
    const host = branch.querySelector?.(".arkhanval-resolution-card__combat-branch-result")
      ?? branch.querySelector?.(".arkhanval-resolution-card__combat-branch-actions")
      ?? branch;
    host.append(buildMaladressePublicNotice(
      key,
      String(target?.name ?? "Le défenseur")
    ));
  }
}

function injectMaladresseActions(message, html) {
  if (!game.user?.isGM) return;
  const combat = message.getFlag?.("arkhanval", "combat") ?? null;
  if (!combat) return;

  if (Number(combat.attackerQr) < 0) {
    const heading = attackerMaladresseHost(html);
    if (heading && !heading.querySelector?.('[data-arkhanval-maladresse-actions="attacker"]')) {
      heading.append(buildMaladresseGmActions(message, combat, "attacker"));
    }
  }

  for (const [targetKey, response] of Object.entries(combat.responses ?? {})) {
    if (!(Number(response?.qr) < 0)) continue;
    const escaped = globalThis.CSS?.escape ? CSS.escape(String(targetKey)) : String(targetKey).replaceAll('"', '\\"');
    const branch = html.querySelector?.(`[data-combat-target-key="${escaped}"]`);
    if (!branch) continue;
    const key = `defender:${targetKey}`;
    const escapedKey = globalThis.CSS?.escape ? CSS.escape(key) : key.replaceAll('"', '\\"');
    if (branch.querySelector?.(`[data-arkhanval-maladresse-actions="${escapedKey}"]`)) continue;
    const host = branch.querySelector?.(".arkhanval-resolution-card__combat-branch-result")
      ?? branch.querySelector?.(".arkhanval-resolution-card__combat-branch-actions")
      ?? branch;
    host.append(buildMaladresseGmActions(message, combat, key));
  }
}

function injectDelegatedMaladressePlayerActions(message, html) {
  if (game.user?.isGM) return;
  const combat = message.getFlag?.("arkhanval", "combat") ?? null;
  if (!combat) return;

  const maybeAppend = (key, host) => {
    if (!host) return;
    const current = combat?.maladresses?.[String(key)] ?? null;
    if (!current?.delegatedToPlayer || current?.published || current?.publicMessageId || current?.privateMessageId) return;
    const context = maladresseContext(combat, key);
    if (!context || !(Number(context.qr) < 0) || !userCanControlTarget(game.user, context.target)) return;
    const escapedKey = globalThis.CSS?.escape ? CSS.escape(String(key)) : String(key).replaceAll('"', '\\"');
    if (host.querySelector?.(`[data-arkhanval-maladresse-player-action="${escapedKey}"]`)) return;
    host.append(buildDelegatedMaladressePlayerButton(message, combat, key));
  };

  if (Number(combat.attackerQr) < 0) {
    maybeAppend("attacker", html.querySelector?.(".arkhanval-resolution-card__combat-heading"));
  }

  for (const [targetKey, response] of Object.entries(combat.responses ?? {})) {
    if (!(Number(response?.qr) < 0)) continue;
    const escaped = globalThis.CSS?.escape ? CSS.escape(String(targetKey)) : String(targetKey).replaceAll('"', '\\"');
    const branch = html.querySelector?.(`[data-combat-target-key="${escaped}"]`);
    if (!branch) continue;
    const host = branch.querySelector?.(".arkhanval-resolution-card__combat-branch-result")
      ?? branch.querySelector?.(".arkhanval-resolution-card__combat-branch-actions")
      ?? branch;
    maybeAppend(`defender:${targetKey}`, host);
  }
}

function disableTargetActions(html, targetKey, disabled = true) {
  for (const button of html.querySelectorAll?.(`[data-arkhanval-combat-action][data-target-key="${CSS.escape(String(targetKey))}"]`) ?? []) {
    button.disabled = disabled;
  }
}

async function resolveCombatArkChoiceLocally(message, combat, {
  side,
  targetKey,
  choice
}) {
  const normalizedSide = String(side ?? "");
  const key = String(targetKey ?? "");
  const normalizedChoice = String(choice ?? "");

  if (!["attacker", "defender"].includes(normalizedSide)) return false;
  if (!["yes", "no"].includes(normalizedChoice)) return false;

  if (normalizedChoice === "no") {
    await submitCombatArkDecision(message, {
      side: normalizedSide,
      targetKey: key,
      choice: "no"
    });
    return true;
  }

  let actor = null;
  let result = null;

  if (normalizedSide === "attacker") {
    actor = await actorFromTarget(combat?.context?.attacker ?? null);
    result = combat?.attackResult ?? null;
  } else {
    const response = combat?.responses?.[key] ?? null;
    const target = targetByKey(combat, key);

    // Dans une opposition physique à un sort, le jet affiché dans le bloc
    // Défenseur a été produit par le personnage opposant comme attaquant du
    // sous-contexte physique. On réutilise donc en priorité ce snapshot pour
    // retrouver l'Actor qui peut dépenser son cercle d'Ark.
    const actorSnapshot = response?.mode === "spell-opposition"
      ? response?.combat?.attacker ?? target
      : target;
    actor = await actorFromTarget(actorSnapshot);
    result = response?.result ?? null;
  }

  if (!actor || !result) {
    ui.notifications?.warn?.("Arkhanval | Résultat de combat introuvable pour la relance d’Ark.");
    return false;
  }

  const reroll = await promptArkRerollSelection(actor, result);
  if (!reroll) return false;

  const available = Number(actor.system.arks?.[reroll.arkId]?.circles) || 0;
  if (available <= 0) {
    ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
    return false;
  }

  const nextResult = await rerollSelectedD10(result, reroll.chainIndices, {
    attemptIndex: reroll.attemptIndex
  });

  const retainedChoice = await promptRerollResultChoice(result, nextResult, {
    attemptIndex: reroll.attemptIndex,
    chainIndices: reroll.chainIndices,
    title: "Relance d’Ark — résultat retenu"
  });
  const retainedResult = retainedChoice === "new" ? nextResult : result;

  const spent = await spendArkCircle(actor, reroll.arkId);
  if (!spent) {
    ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
    return false;
  }

  await submitCombatArkDecision(message, {
    side: normalizedSide,
    targetKey: key,
    choice: "yes",
    arkId: reroll.arkId,
    result: retainedResult
  });
  return true;
}


function injectArtCreditRerollActions(message, html, combat) {
  if (!combat?.attackResult) return;

  const addForSide = (duel, side, targetKey) => {
    const sideContext = artCreditCombatSide(combat, side, targetKey);
    if (!sideContext?.result || sideContext.locked) return;

    const actorId = String(sideContext.actorSnapshot?.actorId ?? "");
    const opponentActorId = String(sideContext.opponentSnapshot?.actorId ?? "");
    if (!actorId || !opponentActorId) return;

    const actor = game.actors?.get?.(actorId) ?? actorFromTargetSync(sideContext.actorSnapshot);
    const canUse = Boolean(game.user?.isGM || userCanControlActor(game.user, actor));
    if (!canUse) return;

    const credit = artCombatCreditContext(actorId, opponentActorId);
    if (!credit || Number(credit.credit) < 1) return;

    const dice = artCreditD10Candidates(sideContext.result);
    if (!dice?.candidates?.length) return;
    const offer = artCreditDeclineContext(message, { kind: "combat", side, targetKey, combat, credit });
    if (!offer || artCreditOfferDeclined(message, offer)) return;

    const card = duel.closest?.(".arkhanval-resolution-card--combat-opposition");
    const block = side === "attacker"
      ? card?.querySelector?.(".arkhanval-resolution-card__shell--attacker")
      : duel.querySelector?.(".arkhanval-resolution-card__combatant--defender");
    const body = block?.querySelector?.(".arkhanval-resolution-card__combatant-body") ?? block;
    if (!body) return;
    const hostKey = `${side}:${targetKey}`;
    if (Array.from(body.querySelectorAll?.("[data-arkhanval-art-credit-host]") ?? [])
      .some((entry) => entry.dataset.arkhanvalArtCreditHost === hostKey)) return;

    // One unified Ark / Art du combat reroll panel; never show an empty panel.
    let rerolls = body.querySelector?.(":scope > .arkhanval-resolution-card__rerolls");
    if (!rerolls) {
      rerolls = document.createElement("section");
      rerolls.className = "arkhanval-resolution-card__rerolls";
      const before = body.querySelector?.(":scope > .arkhanval-resolution-card__experience-action, :scope > .arkhanval-resolution-card__combatant-footer");
      if (before) body.insertBefore(rerolls, before);
      else body.append(rerolls);
    }
    const wrapper = document.createElement("div");
    wrapper.className = "arkhanval-resolution-card__art-credit arkhanval-resolution-card__reroll-row";
    wrapper.dataset.arkhanvalArtCreditHost = hostKey;

    // Dans la carte d'opposition, l'intitulé reprend le style du cercle
    // d'Ark : pas d'icône, même alignement texte/boutons. Les autres usages
    // de appendArtCreditActionLabel restent inchangés.
    const label = document.createElement("span");
    label.className = "arkhanval-art-credit-action-label";
    label.textContent = "Utiliser un crédit de relance :";

    const yesButton = document.createElement("button");
    yesButton.type = "button";
    yesButton.dataset.arkhanvalArtCreditReroll = side;
    yesButton.textContent = "Oui";

    const noButton = document.createElement("button");
    noButton.type = "button";
    noButton.dataset.arkhanvalArtCreditDecline = side;
    noButton.textContent = "Non";

    const controls = document.createElement("div");
    controls.className = "arkhanval-resolution-card__combat-ark-actions";
    controls.append(yesButton, noButton);
    wrapper.append(label, controls);
    const arkBlock = rerolls.querySelector?.(".arkhanval-resolution-card__combat-ark") ?? null;
    if (arkBlock) rerolls.insertBefore(wrapper, arkBlock);
    else rerolls.append(wrapper);

    noButton.addEventListener("click", async () => {
      if (noButton.disabled) return;
      noButton.disabled = true;
      yesButton.disabled = true;
      try {
        if (await submitArtCreditDecline(message, {
          kind: "combat", side, targetKey, signature: offer.signature
        })) {
          wrapper.remove();
          if (!rerolls.children.length) rerolls.remove();
        }
        else {
          noButton.disabled = false;
          yesButton.disabled = false;
        }
      } catch (error) {
        console.error("Arkhanval | Échec du refus de crédit de relance", error);
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        noButton.disabled = false;
        yesButton.disabled = false;
      }
    });

    yesButton.addEventListener("click", async () => {
      if (yesButton.disabled) return;
      yesButton.disabled = true;
      noButton.disabled = true;

      try {
        const selection = await promptArtCreditD10Selection(sideContext.result);
        if (!selection) {
          yesButton.disabled = false;
          noButton.disabled = false;
          return;
        }

        const candidateResult = await rerollSelectedD10(
          sideContext.result,
          [selection.chainIndex],
          { attemptIndex: selection.attemptIndex }
        );
        const retainedChoice = await promptRerollResultChoice(
          sideContext.result,
          candidateResult,
          {
            attemptIndex: selection.attemptIndex,
            chainIndices: [selection.chainIndex],
            title: "Crédit de relance — résultat retenu"
          }
        );
        const retainedResult = retainedChoice === "new"
          ? candidateResult
          : sideContext.result;

        const submitted = await submitArtCreditReroll(message, {
          side,
          targetKey,
          confrontationId: credit.confrontationId,
          attemptIndex: selection.attemptIndex,
          chainIndex: selection.chainIndex,
          result: retainedResult
        });
        if (!submitted) {
          yesButton.disabled = false;
          noButton.disabled = false;
        }
      } catch (error) {
        console.error("Arkhanval | Échec de la relance par crédit Art du combat", error);
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        yesButton.disabled = false;
        noButton.disabled = false;
      }
    });
  };

  for (const duel of html.querySelectorAll?.("[data-combat-target-key]") ?? []) {
    const targetKey = String(duel.dataset.combatTargetKey ?? "");
    if (!targetKey) continue;

    addForSide(duel, "attacker", targetKey);

    const response = combat?.responses?.[targetKey] ?? null;
    if (response?.mode === "roll" && response?.result) {
      addForSide(duel, "defender", targetKey);
    }
  }
}

function injectDamageArtCreditRerollAction(message, html) {
  const damage = message.getFlag?.("arkhanval", "damage") ?? null;
  if (!damage || String(damage?.resolution?.origin ?? "") !== "combat") return;
  if (damage?.wound?.applied || damage?.wound?.secondaryEffect) return;

  const sourceActorId = String(damage?.source?.actorId ?? "");
  const targetActorId = String(damage?.target?.actorId ?? "");
  if (!sourceActorId || !targetActorId) return;

  const sourceActor = game.actors?.get?.(sourceActorId) ?? actorFromTargetSync(damage.source);
  const canUse = Boolean(game.user?.isGM || userCanControlActor(game.user, sourceActor));
  if (!canUse) return;

  const credit = artCombatCreditContext(sourceActorId, targetActorId);
  if (!credit || Number(credit.credit) < 1) return;

  const candidates = damageArtCreditCandidates(damage);
  if (!candidates.length) return;
  const offer = artCreditDeclineContext(message, { kind: "damage", damage, credit });
  if (!offer || artCreditOfferDeclined(message, offer)) return;

  const card = html.querySelector?.(".arkhanval-damage-card") ?? null;
  if (!card || card.querySelector?.("[data-arkhanval-damage-art-credit]")) return;

  const wrapper = document.createElement("div");
  wrapper.className = "arkhanval-resolution-card__art-credit arkhanval-damage-card__art-credit";
  wrapper.dataset.arkhanvalDamageArtCredit = "true";

  const label = document.createElement("span");
  label.textContent = "Utiliser un crédit de relance :";

  const yesButton = document.createElement("button");
  yesButton.type = "button";
  yesButton.textContent = "Oui";

  const noButton = document.createElement("button");
  noButton.type = "button";
  noButton.textContent = "Non";

  wrapper.append(label, yesButton, noButton);

  // The reroll offer is its own optional action panel (not hidden in the
  // expanded damage breakdown). Its data hooks and authorization stay intact.
  const woundSection = card.querySelector?.(".arkhanval-damage-card__wound");
  if (woundSection) woundSection.before(wrapper);
  else card.append(wrapper);

  noButton.addEventListener("click", async () => {
    if (noButton.disabled) return;
    noButton.disabled = true;
    yesButton.disabled = true;
    try {
      if (await submitArtCreditDecline(message, { kind: "damage", signature: offer.signature })) {
        wrapper.remove();
      } else {
        noButton.disabled = false;
        yesButton.disabled = false;
      }
    } catch (error) {
      console.error("Arkhanval | Échec du refus du crédit de relance des dégâts", error);
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
      noButton.disabled = false;
      yesButton.disabled = false;
    }
  });

  yesButton.addEventListener("click", async () => {
    if (yesButton.disabled) return;
    yesButton.disabled = true;
    noButton.disabled = true;

    try {
      const selected = await promptDamageArtCreditSelection(damage);
      if (!selected) {
        yesButton.disabled = false;
        noButton.disabled = false;
        return;
      }

      const reroll = await evaluateFormula("1d10x10");
      // This Art du combat reroll is only a candidate until the keep-choice.
      await showEvaluatedRoll(reroll, { publicRoll: false });
      const die = Array.from(reroll?.dice ?? [])
        .find((entry) => Number(entry?.faces) === 10) ?? null;
      const nextCandidate = die
        ? openD10Snapshot(die, {
            id: selected.id,
            bucket: selected.bucket,
            index: selected.index
          })
        : {
            ...selected,
            total: Number(reroll?.total) || 0,
            values: rollNaturalValues(reroll),
            label: openD10Label(reroll)
          };

      const retained = await promptDamageRerollResultChoice(selected, nextCandidate);
      const submitted = await submitDamageArtCreditReroll(message, {
        confrontationId: credit.confrontationId,
        candidateId: selected.id,
        retained,
        newCandidate: nextCandidate
      });

      if (!submitted) {
        yesButton.disabled = false;
        noButton.disabled = false;
      }
    } catch (error) {
      console.error("Arkhanval | Échec de la relance des dégâts par crédit", error);
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
      yesButton.disabled = false;
      noButton.disabled = false;
    }
  });
}


// Répare les cartes créées avant que « zéro cercle » verrouille la décision Ark.
// Seul le client autorisé modifie le message ; le nouveau rendu ne relance pas la réparation.
const pendingUnavailableArkRecoveries = new Set();

async function recoverUnavailableArkDecisions(message, combat) {
  if (!isCurrentAuthority(message) || !combat?.attackResult) return;
  if (pendingUnavailableArkRecoveries.has(message.id)) return;

  let changed = false;
  const originalAttackerArk = combat.attackerArk ?? null;
  if (!originalAttackerArk) return;
  const attackerArk = normalizeCombatArkDecision(originalAttackerArk);
  if (!originalAttackerArk.locked && attackerArk.locked) changed = true;

  const responses = {};
  for (const [key, response] of Object.entries(combat.responses ?? {})) {
    const currentDecision = response?.arkDecision ?? null;
    const arkDecision = normalizeCombatArkDecision(currentDecision);
    const finalized = Boolean(response?.finalized || combatResponseFinalized(attackerArk, {arkDecision}));
    if ((!currentDecision?.locked && arkDecision.locked) || (finalized && !response?.finalized)) changed = true;
    responses[key] = {...response, arkDecision, finalized};
  }
  if (!changed) return;

  pendingUnavailableArkRecoveries.add(message.id);
  try {
    await updateCombatMessage(message, {...combat, attackerArk, responses});
  } finally {
    pendingUnavailableArkRecoveries.delete(message.id);
  }
}

export function activateCombatChatMessage(message, html) {
  injectDamagePrivateDetails(message, html);
  activateDamageWoundAction(message, html);
  activateDamageConcentrationAction(message, html);
  injectSecondaryEffectAction(message, html);
  injectDamageArtCreditRerollAction(message, html);
  activatePrivateSecondaryEffectCard(message, html);
  activatePublishedSecondaryEffectCard(message, html);
  injectMaladressePublicNotices(message, html);
  injectDelegatedMaladressePlayerActions(message, html);
  injectMaladresseActions(message, html);

  const combat = message.getFlag?.("arkhanval", "combat") ?? null;
  if (!combat) return;

  void recoverUnavailableArkDecisions(message, combat).catch((error) => {
    console.error("Arkhanval | Échec de reprise des décisions Ark indisponibles", error);
  });
  injectArtCreditRerollActions(message, html, combat);

  for (const button of html.querySelectorAll?.("[data-arkhanval-combat-ark-choice]") ?? []) {
    const side = String(button.dataset.arkhanvalCombatArkChoice ?? "");
    const choice = String(button.dataset.arkhanvalCombatArkValue ?? "");
    const key = String(button.dataset.targetKey ?? "");

    let canUse = Boolean(game.user?.isGM);
    if (!canUse && side === "attacker") {
      canUse = userCanControlTarget(game.user, combat?.context?.attacker ?? null);
    } else if (!canUse && side === "defender") {
      canUse = userCanControlTarget(game.user, targetByKey(combat, key));
    }

    if (!canUse) {
      button.hidden = true;
      button.disabled = true;
      continue;
    }

    button.addEventListener("click", async () => {
      if (button.disabled) return;

      const group = button.closest?.(".arkhanval-resolution-card__combat-ark");
      for (const sibling of group?.querySelectorAll?.("button") ?? []) sibling.disabled = true;

      try {
        const completed = await resolveCombatArkChoiceLocally(message, combat, {
          side,
          targetKey: key,
          choice
        });
        if (!completed) {
          for (const sibling of group?.querySelectorAll?.("button") ?? []) sibling.disabled = false;
        }
      } catch (error) {
        console.error("Arkhanval | Échec du choix de relance d’Ark en combat", error);
        for (const sibling of group?.querySelectorAll?.("button") ?? []) sibling.disabled = false;
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
      }
    });
  }

  for (const judge of html.querySelectorAll?.("[data-arkhanval-combat-force]") ?? []) {
    if (!game.user?.isGM) continue;

    const key = String(judge.dataset.targetKey ?? "");
    judge.classList?.add?.("arkhanval-resolution-card__combat-judge--gm-action");
    judge.setAttribute?.("role", "button");
    judge.setAttribute?.("tabindex", "0");
    judge.setAttribute?.("title", "MJ — cliquer pour verrouiller les QR et résoudre la confrontation");
    if (!judge.querySelector?.(".arkhanval-resolution-card__combat-judge-gm-hint")) {
      const hint = document.createElement("small");
      hint.className = "arkhanval-resolution-card__combat-judge-gm-hint";
      hint.textContent = "MJ — Cliquer ici pour verrouiller les QR";
      judge.append(hint);
    }

    const activate = async () => {
      if (judge.dataset.arkhanvalBusy === "1") return;
      judge.dataset.arkhanvalBusy = "1";
      try {
        await submitCombatFinalize(message, key);
      } catch (error) {
        console.error("Arkhanval | Échec de validation MJ de la confrontation", error);
        delete judge.dataset.arkhanvalBusy;
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
      }
    };

    judge.addEventListener("click", activate);
    judge.addEventListener("keydown", async (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      await activate();
    });
  }

  const legacyConfrontation = message.getFlag?.("arkhanval", "confrontation") ?? null;
  if (game.user?.isGM && legacyConfrontation?.protectionUsed !== null && legacyConfrontation?.protectionUsed !== undefined) {
    const card = html.querySelector?.(".arkhanval-combat-card");
    if (card && !card.querySelector(".arkhanval-combat-card__gm-detail")) {
      const detail = document.createElement("p");
      detail.className = "arkhanval-combat-card__gm-detail is-visible";
      detail.textContent = `Protection utilisée : ${Math.max(0, Number(legacyConfrontation.protectionUsed) || 0)}`;
      card.append(detail);
    }
  }

  const manualNoTargetButton = html.querySelector?.("[data-arkhanval-combat-compare]");
  if (manualNoTargetButton) {
    const canUse = Boolean(message.isAuthor || game.user?.isGM);
    manualNoTargetButton.disabled = !canUse || Boolean(combat.manualResponse);

    if (canUse && !combat.manualResponse) {
      manualNoTargetButton.addEventListener("click", async () => {
        if (manualNoTargetButton.disabled) return;
        manualNoTargetButton.disabled = true;
        try {
          const input = await promptOpponentData(combat);
          if (!input) {
            manualNoTargetButton.disabled = false;
            return;
          }
          await submitCombatResponse(message, {
            manualNoTarget: true,
            response: {
              mode: "manual",
              qr: input.defenderQr
            }
          });
        } catch (error) {
          console.error("Arkhanval | Échec de la confrontation manuelle", error);
          manualNoTargetButton.disabled = false;
          ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        }
      });
    }
  }

  for (const button of html.querySelectorAll?.("[data-arkhanval-combat-action]") ?? []) {
    const action = String(button.dataset.arkhanvalCombatAction ?? "");
    const key = String(button.dataset.targetKey ?? "");
    const target = targetByKey(combat, key);
    const targetActor = actorFromTargetSync(target);
    const canControl = Boolean(game.user?.isGM || userCanControlActor(game.user, targetActor));

    let canUse;
    if (action === "manual") {
      canUse = Boolean(game.user?.isGM);
    } else if (action === "damage") {
      const sides = damageSidesForTarget(combat, target, key);
      canUse = Boolean(
        sides &&
        (game.user?.isGM || userCanControlTarget(game.user, sides.sourceSnapshot))
      );
    } else {
      canUse = canControl;
    }

    if (!canUse) {
      button.hidden = true;
      button.disabled = true;
      continue;
    }

    button.addEventListener("click", async () => {
      if (button.disabled) return;
      disableTargetActions(html, key, true);

      try {
        if (action === "damage") {
          const damageMode = String(button.dataset.damageMode ?? "normal");
          await submitDamageRequest(message, key, damageMode);
          return;
        }

        if (action === "incantation-abandon") {
          const submitted = await submitIncantationAbandon(message, key);
          if (!submitted) disableTargetActions(html, key, false);
          return;
        }

        if (action === "incantation-continue") {
          await submitCombatResponse(message, {
            targetKey: key,
            response: {
              mode: "incantation-continue",
              qr: 0,
              attackerFdModifier: -2,
              arkDecision: {
                available: false,
                diceCount: 0,
                choice: "no",
                locked: true
              }
            }
          });
          return;
        }

        if (action === "spell-order") {
          const spellId = String(button.dataset.spellId ?? "");
          const attackerActorId = String(combat?.context?.attacker?.actorId ?? "");
          const defenderActorId = String(targetActor?.id ?? target?.actorId ?? "");
          const artCombat = artCombatResultContext(attackerActorId, defenderActorId);
          if (!artCombat) {
            ui.notifications?.warn?.("Arkhanval | Aucun résultat d’Art du combat exploitable pour cet assaillant. Résolvez d’abord son Art du combat.");
            disableTargetActions(html, key, false);
            return;
          }

          await submitCombatResponse(message, {
            targetKey: key,
            response: {
              mode: "spell-order",
              qr: 0,
              spellId,
              spellTargets: selectedSpellTargetSnapshots()
            }
          });
          return;
        }

        if (action === "accept") {
          await submitCombatResponse(message, {
            targetKey: key,
            response: {
              mode: "accept",
              qr: 0
            }
          });
          return;
        }

        if (action === "manual") {
          const qr = await promptManualQr("Arkhanval — Saisie MJ de la QR");
          if (qr === null) {
            disableTargetActions(html, key, false);
            return;
          }
          const manualCombatRules = buildCombatRuleModifiers(targetActor, {
            contexts: ["combat"]
          });
          await submitCombatResponse(message, {
            targetKey: key,
            response: {
              mode: "manual",
              qr,
              combat: {
                combatRules: {
                  defenseOnly: Boolean(manualCombatRules.defenseOnly),
                  applied: Array.from(manualCombatRules.applied ?? []).map((entry) => ({ ...entry })),
                  notes: Array.from(manualCombatRules.notes ?? []).map(String),
                  warnings: Array.from(manualCombatRules.warnings ?? []).map(String)
                }
              }
            }
          });
          return;
        }

        if (action === "respond") {
          const actor = await actorFromTarget(target);
          if (!actor || !userCanControlActor(game.user, actor)) {
            ui.notifications?.warn?.("Arkhanval | Vous ne contrôlez pas cette cible.");
            disableTargetActions(html, key, false);
            return;
          }

          const response = await rollCombatResponse(actor, combat);
          if (!response) {
            disableTargetActions(html, key, false);
            return;
          }

          await submitCombatResponse(message, {
            targetKey: key,
            response
          });
        }
      } catch (error) {
        console.error("Arkhanval | Échec de réponse à l’attaque", error);
        disableTargetActions(html, key, false);
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
      }
    });
  }
}
