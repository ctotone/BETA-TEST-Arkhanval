import { captureCombatRollContext, isDirectCombatSkill } from "../combat/context.mjs";
import { promptSkillRoll } from "../resolution/dialog.mjs";
import { rescoreResolvedRollWithFdModifier, resolveRoll } from "../resolution/engine.mjs";
import { listActorSkills } from "../resolution/skills.mjs";
import { spendArkCircle } from "../progression.mjs";
import { artCombatResultContext } from "../art-of-combat.mjs";
import { getSpellIncantation, releaseSpellIncantation } from "./incantation.mjs";
import { buildUnifiedSpellOppositionChatContent, finalDecisionMarkup, spellHeaderMarkup, spellInfoMarkup, spellResolutionCanFinalize } from "./render.mjs";

const { DialogV2 } = foundry.applications.api;
const SOCKET_CHANNEL = "system.arkhanval";
const SOCKET_TYPE_TARGET_RESPONSE = "spell-target-response";
const SOCKET_TYPE_FINAL_DECISION = "spell-final-decision";

// Les soumissions d'une même carte utilisent l'état le plus récent sur le client
// autoritaire, même si deux cibles répondent au même instant.
const spellMutationTails = new Map();
function queueSpellMessageMutation(messageId, operation) {
  const key = String(messageId ?? "");
  const previous = spellMutationTails.get(key) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(operation);
  const tail = result.catch(() => {});
  spellMutationTails.set(key, tail);
  void tail.then(() => {
    if (spellMutationTails.get(key) === tail) spellMutationTails.delete(key);
  });
  return result;
}

function activeSpellSession(caster, resolution) {
  const current = getSpellIncantation(caster, String(resolution?.spellId ?? ""));
  return Boolean(current && String(current.id ?? "") === String(resolution?.sessionId ?? ""));
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readFormValue(formData, name, fallback = "") {
  if (!formData) return fallback;
  if (typeof formData.get === "function") return formData.get(name) ?? fallback;
  return formData?.[name] ?? fallback;
}

function spellTargetKey(target, index = 0) {
  const sceneId = String(target?.sceneId ?? "").trim();
  const tokenId = String(target?.tokenId ?? "").trim();
  const actorId = String(target?.actorId ?? "").trim();
  const actorUuid = String(target?.actorUuid ?? "").trim();

  // Les clés sont persistées dans un objet de flags Foundry. Elles doivent donc
  // rester sûres pour les diff/update imbriqués : pas de point issu d'un UUID.
  const raw = tokenId
    ? `token-${sceneId || "scene"}-${tokenId}`
    : actorId
      ? `actor-${actorId}`
      : actorUuid
        ? `uuid-${actorUuid}`
        : `target-${index + 1}`;
  return raw.replace(/[^A-Za-z0-9_-]+/g, "_");
}

function snapshotActorToken(actor, token = null, index = 0) {
  const document = token?.document ?? token ?? null;
  const snapshot = {
    sceneId: String(document?.parent?.id ?? globalThis.canvas?.scene?.id ?? ""),
    tokenId: String(token?.id ?? document?.id ?? ""),
    actorUuid: String(actor?.uuid ?? ""),
    actorId: String(actor?.id ?? document?.actorId ?? ""),
    name: String(document?.name ?? token?.name ?? actor?.name ?? `Cible ${index + 1}`),
    img: String(document?.texture?.src ?? actor?.img ?? "icons/svg/mystery-man.svg")
  };
  return {
    ...snapshot,
    key: spellTargetKey(snapshot, index)
  };
}

export function captureSpellTargets(targets = null) {
  return Array.from(targets ?? game.user?.targets ?? []).map((token, index) => {
    const document = token?.document ?? token ?? null;
    const actor = token?.actor ?? document?.actor ?? null;
    return snapshotActorToken(actor, token, index);
  });
}

export function captureSpellCaster(actor) {
  const controlled = Array.from(globalThis.canvas?.tokens?.controlled ?? [])
    .find((token) => String(token?.actor?.id ?? "") === String(actor?.id ?? "")) ?? null;
  const active = controlled ?? Array.from(actor?.getActiveTokens?.() ?? [])[0] ?? null;
  return snapshotActorToken(actor, active, 0);
}

function actorFromTargetSnapshot(target) {
  const sceneId = String(target?.sceneId ?? "");
  const tokenId = String(target?.tokenId ?? "");
  if (sceneId && tokenId) {
    const scene = game.scenes?.get?.(sceneId) ?? null;
    const actor = scene?.tokens?.get?.(tokenId)?.actor ?? null;
    if (actor) return actor;
  }

  const actorId = String(target?.actorId ?? "");
  if (actorId) {
    const actor = game.actors?.get?.(actorId) ?? null;
    if (actor) return actor;
  }

  const actorUuid = String(target?.actorUuid ?? "");
  if (actorUuid && typeof globalThis.fromUuidSync === "function") {
    try {
      return globalThis.fromUuidSync(actorUuid) ?? null;
    } catch (_error) {
      return null;
    }
  }

  return null;
}

function tokenLikeFromSnapshot(snapshot, actor) {
  const sceneId = String(snapshot?.sceneId ?? "");
  const tokenId = String(snapshot?.tokenId ?? "");
  if (sceneId && tokenId) {
    const document = game.scenes?.get?.(sceneId)?.tokens?.get?.(tokenId) ?? null;
    if (document) return document;
  }

  return {
    id: tokenId,
    actor,
    document: {
      id: tokenId,
      actor,
      actorId: String(actor?.id ?? snapshot?.actorId ?? ""),
      parent: sceneId ? { id: sceneId } : null,
      texture: { src: String(snapshot?.img ?? actor?.img ?? "icons/svg/mystery-man.svg") },
      name: String(snapshot?.name ?? actor?.name ?? "Personnage")
    }
  };
}

function userCanControlActor(user, actor) {
  if (!user || !actor) return false;
  if (user.isGM) return true;
  if (typeof actor.testUserPermission === "function") {
    return Boolean(actor.testUserPermission(user, "OWNER"));
  }
  const ownership = actor.ownership ?? {};
  return Number(ownership[user.id] ?? ownership.default ?? 0) >= 3;
}

function userCanControlSpellTarget(user, target) {
  if (!user || !target) return false;
  if (user.isGM) return true;
  return userCanControlActor(user, actorFromTargetSnapshot(target));
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

function responseForTarget(resolution, target) {
  return resolution?.responses?.[String(target?.key ?? "")] ?? null;
}

function targetResponseBlock(resolution, target) {
  const key = String(target?.key ?? "");
  const name = String(target?.name ?? "Cible");
  const img = String(target?.img ?? "icons/svg/mystery-man.svg");
  const response = responseForTarget(resolution, target);

  let actions = "";
  if (response?.choice === "none") {
    actions = `
      <div class="arkhanval-spell-resolution__actions">
        <button type="button" disabled>Ne rien faire</button>
      </div>
      <p class="arkhanval-spell-resolution__status"><strong>Aucune opposition.</strong> Le sort peut poursuivre sa résolution.</p>
    `;
  } else if (response?.choice === "oppose") {
    actions = `
      <div class="arkhanval-spell-resolution__actions">
        <button type="button" disabled>S’opposer</button>
      </div>
      <p class="arkhanval-spell-resolution__status"><strong>Opposition engagée.</strong> Le workflow de combat a été ouvert contre le magicien.</p>
    `;
  } else {
    actions = `
      <div class="arkhanval-spell-resolution__actions">
        <button type="button"
                data-arkhanval-spell-target-response="none"
                data-target-key="${escapeHtml(key)}">
          Ne rien faire
        </button>
        <button type="button"
                data-arkhanval-spell-target-response="oppose"
                data-target-key="${escapeHtml(key)}">
          S’opposer
        </button>
      </div>
    `;
  }

  return `
    <section class="arkhanval-spell-resolution__target" data-spell-target-key="${escapeHtml(key)}">
      <header class="arkhanval-spell-resolution__target-header">
        <img src="${escapeHtml(img)}" alt="" class="arkhanval-spell-resolution__target-img">
        <strong>${escapeHtml(name)}</strong>
      </header>
      <p>Souhaites-tu t’opposer à ${escapeHtml(resolution?.caster?.name ?? "le magicien")} via une action physique ?</p>
      ${actions}
    </section>
  `;
}

export function buildSpellFinalChatContent(resolution = {}) {
  return `
    <article class="arkhanval-resolution-card arkhanval-incantation-release arkhanval-spell-resolution arkhanval-spell-resolution--final">
      <section class="arkhanval-resolution-card__shell arkhanval-spell-resolution__shell">
        ${spellHeaderMarkup(resolution)}
        ${spellInfoMarkup(resolution)}
        ${finalDecisionMarkup(resolution)}
      </section>
    </article>
  `.trim();
}

export function buildSpellResolutionChatContent(resolution = {}, combat = null) {
  return buildUnifiedSpellOppositionChatContent(resolution, combat);
}

export async function createSpellFinalChatMessage(resolution = {}) {
  const ChatMessageClass = globalThis.foundry?.documents?.ChatMessage ?? globalThis.ChatMessage;
  if (!ChatMessageClass) throw new Error("API ChatMessage de Foundry indisponible.");

  const caster = actorFromTargetSnapshot(resolution?.caster ?? null);
  const finalResolution = {
    ...resolution,
    mode: "final",
    status: "awaiting-final-decision",
    finalDecision: resolution?.finalDecision ?? null
  };

  return ChatMessageClass.create({
    speaker: ChatMessageClass.getSpeaker({ actor: caster ?? null }),
    content: buildSpellFinalChatContent(finalResolution),
    flags: {
      arkhanval: {
        spellResolution: finalResolution
      }
    }
  });
}

function targetByKey(resolution, targetKey) {
  const wanted = String(targetKey ?? "");
  return Array.from(resolution?.targets ?? [])
    .find((target) => String(target?.key ?? "") === wanted) ?? null;
}

async function promptSpellOppositionSkill(actor, spellName = "Sortilège") {
  const skills = listActorSkills(actor)
    .filter((skill) => isDirectCombatSkill(skill.identifier));

  if (!skills.length) {
    ui.notifications?.warn?.("Arkhanval | Aucune compétence de combat disponible pour s’opposer au sort.");
    return null;
  }

  const options = skills.map((skill) => `
    <option value="${escapeHtml(skill.key)}">${escapeHtml(skill.name)} — rang ${Number(skill.rank) || 0}</option>
  `).join("");

  const result = await DialogV2.input({
    position: { width: "auto", height: "auto" },
    window: { title: `Arkhanval — S’opposer à ${spellName}` },
    classes: ["arkhanval", "arkhanval-popup-dialog", "arkhanval-popup-dialog--input"],
    modal: true,
    rejectClose: false,
    content: `
      <div class="arkhanval-combat-dialog">
        <p>Choisissez l’action de combat utilisée pour vous opposer au lancement du sort.</p>
        <label>
          <span>Compétence de combat</span>
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
  return skills.find((skill) => String(skill.key ?? "") === key) ?? null;
}

function combatArkDecisionForSpellResponse(actor, result) {
  if (actor?.getFlag?.("arkhanval", "viewMode") === "npc") {
    return { available: false, diceCount: 0, choice: "no", locked: true };
  }
  const attemptIndex = Number(result?.selectedAttemptIndex);
  const attempt = Number.isInteger(attemptIndex) && attemptIndex >= 0
    ? result?.attempts?.[attemptIndex] ?? null
    : null;
  const diceCount = Array.from(attempt?.chains ?? [])
    .filter((chain) => Number(chain?.initialFaces) === 10)
    .length;
  const hasCircle = Object.values(actor?.system?.arks ?? {})
    .some((ark) => (Number(ark?.circles) || 0) > 0);
  return {
    available: hasCircle && diceCount > 0,
    diceCount: hasCircle ? Math.min(2, diceCount) : 0,
    choice: "",
    locked: false
  };
}

function combatSnapshotFromSpellSnapshot(snapshot, actor = null) {
  const key = String(snapshot?.key ?? snapshot?.tokenId ?? snapshot?.actorUuid ?? snapshot?.actorId ?? "");
  return {
    key,
    actorUuid: String(snapshot?.actorUuid ?? actor?.uuid ?? ""),
    actorId: String(snapshot?.actorId ?? actor?.id ?? ""),
    sceneId: String(snapshot?.sceneId ?? ""),
    tokenId: String(snapshot?.tokenId ?? ""),
    tokenImg: String(snapshot?.img ?? actor?.img ?? "icons/svg/mystery-man.svg"),
    name: String(snapshot?.name ?? actor?.name ?? "Personnage"),
    protection: 0,
    incantation: null
  };
}

function syntheticSpellAttackResult(resolution) {
  return {
    qr: 0,
    selectedAttemptIndex: 0,
    attempts: [],
    experienceEligible: false,
    plan: {
      skillName: String(resolution?.spellName ?? "Sortilège"),
      skillIdentifier: String(resolution?.castingSkill ?? ""),
      primaryRank: 0,
      poolLabel: "",
      fd: Number(resolution?.fd) || 0,
      effectiveFd: Number(resolution?.fd) || 0,
      chainMode: "success",
      specialtyNotes: [],
      rankFdModifier: 0,
      suppressCriticalFailures: false,
      rank8OpenNines: false,
      criticalFailureThreshold: 1
    }
  };
}

function baseSpellOppositionCombat(resolution) {
  const caster = actorFromTargetSnapshot(resolution?.caster ?? null);
  const attacker = combatSnapshotFromSpellSnapshot(resolution?.caster ?? null, caster);
  const targets = Array.from(resolution?.targets ?? []).map((target) =>
    combatSnapshotFromSpellSnapshot(target, actorFromTargetSnapshot(target))
  );
  const attackResult = syntheticSpellAttackResult(resolution);
  return {
    context: {
      enabled: true,
      skillIdentifier: String(resolution?.castingSkill ?? ""),
      attacker,
      weapons: [],
      defaultWeaponId: "",
      technique: { id: "none", label: "Aucune", defaultFdModifier: 0 },
      targets,
      targetCount: targets.length,
      targetState: targets.length === 1 ? "single" : targets.length > 1 ? "multiple" : "none",
      target: targets.length === 1 ? targets[0] : null,
      spellOpposition: {
        active: true,
        spellId: String(resolution?.spellId ?? ""),
        sessionId: String(resolution?.sessionId ?? ""),
        spellName: String(resolution?.spellName ?? "Sortilège")
      }
    },
    attackerQr: 0,
    attackResult,
    attackerArk: {
      available: false,
      diceCount: 0,
      choice: "no",
      locked: true
    },
    responses: {},
    chatOptions: {
      progressGain: null,
      arkBoost: "",
      experienceSource: null,
      arkRerollAvailable: false,
      arkRerollDiceCount: 0
    }
  };
}

async function startSpellOppositionCombat(resolution, target) {
  const opponent = actorFromTargetSnapshot(target);
  const caster = actorFromTargetSnapshot(resolution?.caster ?? null);
  if (!opponent) throw new Error("Personnage opposant introuvable.");
  if (!caster) throw new Error("Magicien introuvable pour ouvrir le workflow de combat.");

  const skill = await promptSpellOppositionSkill(opponent, String(resolution?.spellName ?? "Sortilège"));
  if (!skill) return null;

  const casterTarget = tokenLikeFromSnapshot(resolution.caster, caster);
  const combatContext = captureCombatRollContext(opponent, skill.identifier, {
    targets: [casterTarget]
  });
  if (!combatContext?.enabled || Number(combatContext.targetCount) !== 1) {
    throw new Error("Impossible de préparer la confrontation contre le magicien.");
  }

  const request = await promptSkillRoll({
    actor: opponent,
    skill,
    combatContext,
    title: `Opposition — ${resolution?.spellName ?? "Sortilège"}`
  });
  if (!request) return null;

  let result = await resolveRoll(request);
  if (request.ark?.boost) {
    const spent = await spendArkCircle(opponent, request.ark.boost);
    if (!spent) {
      ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
      return null;
    }
  }

  // Le magicien est sans défense : la réponse physique est résolue avec FD -2,
  // mais le même jet de dés est conservé et simplement rescored.
  result = rescoreResolvedRollWithFdModifier(result, -2);

  const active = getSpellIncantation(caster, String(resolution?.spellId ?? ""));
  const rawMagicQr = active?.readyQr;
  const magicQr = rawMagicQr === null || rawMagicQr === undefined || rawMagicQr === ""
    ? Number.NaN
    : Number(rawMagicQr);
  const artCombat = artCombatResultContext(String(opponent?.id ?? ""), String(caster?.id ?? ""));
  const artCombatQr = Number(artCombat?.qr);
  const spellOrder = Number.isFinite(magicQr) && artCombat && Number.isFinite(artCombatQr)
    ? {
        spellId: String(resolution?.spellId ?? ""),
        spellName: String(resolution?.spellName ?? "Sortilège"),
        sessionId: String(resolution?.sessionId ?? ""),
        magicQr,
        artCombatQr,
        artCombatConfrontationId: String(artCombat?.confrontationId ?? ""),
        order: magicQr > artCombatQr ? "spell-first" : "attack-first"
      }
    : null;

  if (!spellOrder) {
    ui.notifications?.warn?.(
      "Arkhanval | L’opposition physique est enregistrée, mais l’ordre ne peut pas encore être déterminé automatiquement (QR de fin d’incantation ou Art du combat manquant)."
    );
  }

  const arkDecision = combatArkDecisionForSpellResponse(opponent, result);
  const response = {
    mode: "spell-opposition",
    qr: Number(result.qr) || 0,
    skillName: String(request.skillName ?? skill.name ?? ""),
    skillIdentifier: String(request.skillIdentifier ?? skill.identifier ?? ""),
    combat: request.combat ?? combatContext,
    result,
    spellOrder,
    arkDecision,
    finalized: Boolean(arkDecision.locked)
  };
  return response;
}

async function applySpellTargetResponse(payload) {
  const message = game.messages?.get?.(payload?.messageId) ?? null;
  if (!message) return;

  const resolution = message.getFlag?.("arkhanval", "spellResolution") ?? null;
  if (!resolution || String(resolution?.mode ?? "") !== "opposed" || resolution?.finalDecision) return;
  const caster = actorFromTargetSnapshot(resolution?.caster ?? null);
  if (!caster || !activeSpellSession(caster, resolution)) {
    throw new Error("Cette incantation n’est plus active ou a été remplacée.");
  }

  const target = targetByKey(resolution, payload?.targetKey);
  const submittingUser = game.users?.get?.(payload?.userId) ?? null;
  if (!target || !submittingUser || !userCanControlSpellTarget(submittingUser, target)) return;

  const key = String(target.key ?? "");
  if (resolution?.responses?.[key]) return;

  const choice = String(payload?.choice ?? "");
  if (choice !== "none" && choice !== "oppose") return;
  if (choice === "oppose" && !payload?.combatResponse) return;

  const responses = {
    ...(resolution.responses ?? {}),
    [key]: {
      choice,
      userId: String(submittingUser.id ?? "")
    }
  };

  const targets = Array.from(resolution.targets ?? []);
  const complete = targets.length > 0 && targets.every((entry) => Boolean(responses[String(entry?.key ?? "")]));
  const next = {
    ...resolution,
    status: complete ? "target-responses-complete" : "awaiting-target-response",
    responses
  };

  let combat = message.getFlag?.("arkhanval", "combat") ?? null;
  if (choice === "oppose") {
    combat = combat ?? baseSpellOppositionCombat(next);
    const combatResponse = payload.combatResponse;
    const arkDecision = combatResponse?.arkDecision ?? {
      available: false,
      diceCount: 0,
      choice: "no",
      locked: true
    };
    const storedResponse = {
      ...combatResponse,
      arkDecision,
      finalized: Boolean(combat?.attackerArk?.locked && arkDecision.locked)
    };
    combat = {
      ...combat,
      responses: {
        ...(combat.responses ?? {}),
        [key]: storedResponse
      }
    };
  }

  const update = {
    content: buildUnifiedSpellOppositionChatContent(next, combat),
    "flags.arkhanval.spellResolution": next
  };
  if (combat) update["flags.arkhanval.combat"] = combat;
  await message.update(update);
}

async function submitSpellTargetResponse(message, targetKey, choice, {
  combatResponse = null
} = {}) {
  const envelope = {
    type: SOCKET_TYPE_TARGET_RESPONSE,
    messageId: String(message?.id ?? ""),
    userId: String(game.user?.id ?? ""),
    targetKey: String(targetKey ?? ""),
    choice: String(choice ?? ""),
    combatResponse
  };

  if (isCurrentAuthority(message)) {
    await queueSpellMessageMutation(envelope.messageId, () => applySpellTargetResponse(envelope));
    return true;
  }

  if (!activeAuthorityId(message)) {
    ui.notifications?.error?.("Arkhanval | Aucun client autorisé n’est disponible pour enregistrer la réponse au sort.");
    return false;
  }

  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
  return true;
}


async function applySpellFinalDecision(payload) {
  const message = game.messages?.get?.(payload?.messageId) ?? null;
  if (!message) return;

  const resolution = message.getFlag?.("arkhanval", "spellResolution") ?? null;
  if (!resolution || resolution?.finalDecision) return;

  const submittingUser = game.users?.get?.(payload?.userId) ?? null;
  const caster = actorFromTargetSnapshot(resolution?.caster ?? null);
  if (!submittingUser || !caster || !userCanControlActor(submittingUser, caster)) return;

  const choice = String(payload?.choice ?? "");
  if (choice !== "consume" && choice !== "keep") return;

  const combat = message.getFlag?.("arkhanval", "combat") ?? null;
  if (!spellResolutionCanFinalize(resolution, combat)) {
    throw new Error("Le sort ne peut pas être lancé : les réponses, oppositions ou dégâts préalables sont encore en attente.");
  }
  if (!activeSpellSession(caster, resolution)) {
    throw new Error("Cette incantation n’est plus active ou a été remplacée.");
  }
  if (choice === "consume") {
    await releaseSpellIncantation(caster, String(resolution.spellId));
  }

  const next = {
    ...resolution,
    finalDecision: {
      choice,
      userId: String(submittingUser.id ?? ""),
      at: Date.now()
    }
  };

  await message.update({
    content: String(next?.mode ?? "") === "opposed"
      ? buildUnifiedSpellOppositionChatContent(next, combat)
      : buildSpellFinalChatContent(next),
    "flags.arkhanval.spellResolution": next
  });
}

async function submitSpellFinalDecision(message, choice) {
  const envelope = {
    type: SOCKET_TYPE_FINAL_DECISION,
    messageId: String(message?.id ?? ""),
    userId: String(game.user?.id ?? ""),
    choice: String(choice ?? "")
  };

  if (isCurrentAuthority(message)) {
    await queueSpellMessageMutation(envelope.messageId, () => applySpellFinalDecision(envelope));
    return true;
  }

  if (!activeAuthorityId(message)) {
    ui.notifications?.error?.("Arkhanval | Aucun client autorisé n’est disponible pour traiter l’incantation.");
    return false;
  }

  game.socket?.emit?.(SOCKET_CHANNEL, envelope);
  return true;
}

export function initializeSpellResolutionSocket() {
  game.socket?.on?.(SOCKET_CHANNEL, async (payload) => {
    if (payload?.type !== SOCKET_TYPE_TARGET_RESPONSE && payload?.type !== SOCKET_TYPE_FINAL_DECISION) return;
    const message = game.messages?.get?.(payload?.messageId) ?? null;
    if (!message || !isCurrentAuthority(message)) return;

    try {
      if (payload?.type === SOCKET_TYPE_TARGET_RESPONSE) {
        await queueSpellMessageMutation(payload.messageId, () => applySpellTargetResponse(payload));
      } else {
        await queueSpellMessageMutation(payload.messageId, () => applySpellFinalDecision(payload));
      }
    } catch (error) {
      console.error("Arkhanval | Échec du traitement de la carte de sort", error);
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  });
}

export function activateSpellResolutionChatMessage(message, html) {
  const resolution = message.getFlag?.("arkhanval", "spellResolution") ?? null;
  if (!resolution || !["direct", "opposed", "final"].includes(String(resolution?.mode ?? ""))) return;

  const caster = actorFromTargetSnapshot(resolution?.caster ?? null);
  // Un défenseur peut ne pas avoir accès aux flags du magicien : seul un
  // utilisateur autorisé sur le lanceur décide localement si la carte est périmée.
  // L'autorité vérifie la session pour toutes les soumissions, sans exception.
  const canCheckSession = Boolean(caster && userCanControlActor(game.user, caster));
  const expired = !resolution?.finalDecision && canCheckSession && !activeSpellSession(caster, resolution);
  if (expired) {
    for (const button of html.querySelectorAll?.("[data-arkhanval-spell-target-response], [data-arkhanval-spell-final-decision]") ?? []) {
      button.disabled = true;
    }
    const card = html.querySelector?.(".arkhanval-spell-resolution") ?? null;
    if (card && !card.querySelector?.("[data-arkhanval-spell-expired]")) {
      const warning = document.createElement("p");
      warning.className = "arkhanval-incantation-release__warning";
      warning.dataset.arkhanvalSpellExpired = "";
      warning.textContent = "Cette incantation n’est plus active ou a été remplacée. Les actions de cette carte sont désactivées.";
      card.append(warning);
    }
    return;
  }

  for (const button of html.querySelectorAll?.("[data-arkhanval-spell-target-response]") ?? []) {
    const targetKey = String(button.dataset.targetKey ?? "");
    const choice = String(button.dataset.arkhanvalSpellTargetResponse ?? "");
    const target = targetByKey(resolution, targetKey);
    const canUse = Boolean(target && userCanControlSpellTarget(game.user, target));

    if (!canUse) {
      button.hidden = true;
      button.disabled = true;
      continue;
    }

    button.addEventListener("click", async () => {
      if (button.disabled) return;
      const block = button.closest?.("[data-spell-target-key]") ?? null;
      for (const sibling of block?.querySelectorAll?.("button") ?? []) sibling.disabled = true;

      try {
        let combatResponse = null;
        if (choice === "oppose") {
          combatResponse = await startSpellOppositionCombat(resolution, target);
          if (!combatResponse) {
            for (const sibling of block?.querySelectorAll?.("button") ?? []) sibling.disabled = false;
            return;
          }
        }

        const submitted = await submitSpellTargetResponse(message, targetKey, choice, {
          combatResponse
        });
        if (!submitted) {
          for (const sibling of block?.querySelectorAll?.("button") ?? []) sibling.disabled = false;
        }
      } catch (error) {
        console.error("Arkhanval | Échec de la réponse de cible au sort", error);
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        for (const sibling of block?.querySelectorAll?.("button") ?? []) sibling.disabled = false;
      }
    });
  }

  const canFinalize = Boolean(caster && userCanControlActor(game.user, caster));
  if (!canFinalize) {
    // Sur une décision en attente, les deux boutons sont exclusivement
    // réservés au lanceur/MJ. Retirer l'encart complet (et non hidden sur le
    // bouton : son display:flex peut primer sur l'attribut HTML hidden).
    // Le statut d'une décision déjà prise, sans bouton d'action, reste visible.
    const finalPanel = html.querySelector?.("[data-arkhanval-spell-final]") ?? null;
    if (finalPanel?.querySelector?.("[data-arkhanval-spell-final-decision]")) finalPanel.remove();
  }
  for (const button of html.querySelectorAll?.("[data-arkhanval-spell-final-decision]") ?? []) {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      const block = button.closest?.("[data-arkhanval-spell-final]") ?? null;
      for (const sibling of block?.querySelectorAll?.("button") ?? []) sibling.disabled = true;

      try {
        const submitted = await submitSpellFinalDecision(
          message,
          String(button.dataset.arkhanvalSpellFinalDecision ?? "")
        );
        if (!submitted) {
          for (const sibling of block?.querySelectorAll?.("button") ?? []) sibling.disabled = false;
        }
      } catch (error) {
        console.error("Arkhanval | Échec du traitement final du sort", error);
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        for (const sibling of block?.querySelectorAll?.("button") ?? []) sibling.disabled = false;
      }
    });
  }
}
