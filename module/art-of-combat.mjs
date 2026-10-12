
import { findActorSkill } from "./resolution/skills.mjs";
import { combatRollDisclosure, resolutionArchetypeMarkup, resolutionPortraitMarkup } from "./resolution/chat.mjs";
import { promptSkillRoll } from "./resolution/dialog.mjs";
import { rerollSelectedD10, resolveRoll } from "./resolution/engine.mjs";
import { promptArkRerollSelection, promptRerollResultChoice, resolveExperienceDie, spendArkCircle } from "./progression.mjs";
import { cleanupCombatRoundTracking } from "./combat/round-tracker.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SETTING_KEY = "artOfCombatRegistry";
const SOCKET_CHANNEL = "system.arkhanval";
const SOCKET_ACTION = "art-combat-action";
const SOCKET_REFRESH = "art-combat-refresh";
const ART_COMBAT_IDENTIFIER = "arkhanval.skill.combattant.art-combat";

let activeApplication = null;
let roundRefreshHookRegistered = false;

// Un seul MJ actif traite les mutations successivement : deux réponses de joueurs
// ne doivent pas réécrire le registre depuis deux instantanés concurrents.
let artCombatMutationTail = Promise.resolve();
function queueArtCombatMutation(task) {
  const operation = artCombatMutationTail.then(task);
  artCombatMutationTail = operation.catch(() => {});
  return operation;
}


function refreshArtCombatInterfaces({ refreshChat = true } = {}) {
  activeApplication?.render?.({ force: true });
  // La dépense d'un crédit appartient au registre Art du combat : elle ne doit
  // pas faire réapparaître une ancienne carte C10 dans le chat pendant la
  // relance de la carte de combat / dégâts qui l'a demandée.
  if (refreshChat) globalThis.ui?.chat?.render?.({ force: true });
}

function documentSafeClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function emptyRegistry() {
  return {
    version: 1,
    confrontations: []
  };
}

function registry() {
  const stored = game.settings.get("arkhanval", SETTING_KEY);
  if (!stored || typeof stored !== "object") return emptyRegistry();
  return {
    version: 1,
    confrontations: Array.isArray(stored.confrontations)
      ? foundry.utils.deepClone(stored.confrontations)
      : []
  };
}

export function artCombatCreditContext(actorId, opponentActorId) {
  const sourceId = String(actorId ?? "");
  const opponentId = String(opponentActorId ?? "");
  if (!sourceId || !opponentId || sourceId === opponentId) return null;

  const matches = registry().confrontations
    .filter((entry) => Boolean(entry?.resolved && entry?.finalized))
    .map((entry) => {
      const participants = Array.from(entry?.participants ?? []);
      const source = participants.find((participant) => String(participant?.actorId ?? "") === sourceId) ?? null;
      const opponent = participants.find((participant) => String(participant?.actorId ?? "") === opponentId) ?? null;
      if (!source || !opponent || String(source.camp ?? "") === String(opponent.camp ?? "")) return null;
      return {
        confrontationId: String(entry.id ?? ""),
        updatedAt: Number(entry.updatedAt) || 0,
        actorId: sourceId,
        opponentActorId: opponentId,
        credit: Math.max(0, Number(source.credit) || 0)
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.updatedAt - left.updatedAt);

  return matches[0] ?? null;
}

export function artCombatResultContext(actorId, opponentActorId) {
  const sourceId = String(actorId ?? "");
  const opponentId = String(opponentActorId ?? "");
  if (!sourceId || !opponentId || sourceId === opponentId) return null;

  const matches = registry().confrontations
    .filter((entry) => Boolean(entry?.resolved && entry?.finalized))
    .map((entry) => {
      const participants = Array.from(entry?.participants ?? []);
      const source = participants.find((participant) => String(participant?.actorId ?? "") === sourceId) ?? null;
      const opponent = participants.find((participant) => String(participant?.actorId ?? "") === opponentId) ?? null;
      if (!source || !opponent || String(source.camp ?? "") === String(opponent.camp ?? "")) return null;
      if (!qrIsSet(source.qr)) return null;
      return {
        confrontationId: String(entry.id ?? ""),
        updatedAt: Number(entry.updatedAt) || 0,
        actorId: sourceId,
        opponentActorId: opponentId,
        qr: Number(source.qr),
        result: documentSafeClone(source.result ?? null)
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.updatedAt - left.updatedAt);

  return matches[0] ?? null;
}

export async function consumeArtCombatCredit(confrontationId, actorId, {
  opponentActorId = ""
} = {}) {
  return queueArtCombatMutation(async () => {
    if (!game.user?.isGM) throw new Error("Seul le MJ peut consommer un crédit Art du combat.");

    const id = String(confrontationId ?? "");
    const sourceId = String(actorId ?? "");
    const opponentId = String(opponentActorId ?? "");
    if (!id || !sourceId) throw new Error("Crédit Art du combat introuvable.");

    const state = registry();
    const confrontation = state.confrontations.find((entry) => String(entry?.id ?? "") === id) ?? null;
    if (!confrontation?.resolved || !confrontation?.finalized) {
      throw new Error("La confrontation Art du combat n'est pas résolue.");
    }

    const participants = Array.from(confrontation.participants ?? []);
    const source = participants.find((participant) => String(participant?.actorId ?? "") === sourceId) ?? null;
    if (!source) throw new Error("Participant Art du combat introuvable.");

    if (opponentId) {
      const opponent = participants.find((participant) => String(participant?.actorId ?? "") === opponentId) ?? null;
      if (!opponent || String(opponent.camp ?? "") === String(source.camp ?? "")) {
        throw new Error("Cette confrontation Art du combat ne correspond pas à l'adversaire.");
      }
    }

    const available = Math.max(0, Number(source.credit) || 0);
    if (available < 1) throw new Error("Aucun crédit de relance disponible.");

    source.credit = available - 1;
    confrontation.updatedAt = Date.now();

    // Le registre fait foi et la fenêtre Art du combat se met à jour ; en
    // revanche, ne pas rafraîchir le chat ni rééditer le vieux message C10.
    // C'est la carte appelante qui doit seule se mettre à jour après la relance.
    await saveRegistry(state, { refreshChat: false });

    return {
      confrontationId: id,
      actorId: sourceId,
      remaining: source.credit
    };
  });
}

export async function restoreArtCombatCredit(confrontationId, actorId) {
  return queueArtCombatMutation(async () => {
    if (!game.user?.isGM) return false;

    const id = String(confrontationId ?? "");
    const sourceId = String(actorId ?? "");
    if (!id || !sourceId) return false;

    const state = registry();
    const confrontation = state.confrontations.find((entry) => String(entry?.id ?? "") === id) ?? null;
    const source = Array.from(confrontation?.participants ?? [])
      .find((participant) => String(participant?.actorId ?? "") === sourceId) ?? null;
    if (!confrontation || !source) return false;

    source.credit = Math.max(0, Number(source.credit) || 0) + 1;
    confrontation.updatedAt = Date.now();
    // Même principe lors d'une restitution après échec de la relance.
    await saveRegistry(state, { refreshChat: false });
    return true;
  });
}

async function saveRegistry(next, { refreshChat = true } = {}) {
  if (!game.user?.isGM) throw new Error("Seul le MJ peut modifier le registre Art du combat.");
  const normalized = documentSafeClone({
    version: 1,
    confrontations: Array.isArray(next?.confrontations)
      ? next.confrontations
      : []
  });
  await game.settings.set("arkhanval", SETTING_KEY, normalized);
  game.socket?.emit?.(SOCKET_CHANNEL, { type: SOCKET_REFRESH, refreshChat });
  refreshArtCombatInterfaces({ refreshChat });
  return normalized;
}

function authoritativeGmId() {
  return Array.from(game.users?.values?.() ?? [])
    .filter((user) => Boolean(user?.isGM && user?.active))
    .map((user) => String(user.id ?? ""))
    .filter(Boolean)
    .sort()[0] ?? "";
}

function actorOwners(actor) {
  return Array.from(game.users?.values?.() ?? [])
    .filter((user) => Boolean(user?.isGM) || actor?.testUserPermission?.(user, "OWNER"))
    .map((user) => String(user.id ?? ""))
    .filter(Boolean)
    .filter((id, index, array) => array.indexOf(id) === index);
}

function actorSnapshot(actor, camp) {
  return {
    actorId: String(actor?.id ?? ""),
    actorUuid: String(actor?.uuid ?? ""),
    name: String(actor?.name ?? "Personnage"),
    img: String(actor?.img ?? ""),
    camp: String(camp ?? ""),
    qr: null,
    credit: 0,
    pending: true,
    result: null,
    arkChoice: "",
    locked: false,
    experienceUsed: false
  };
}

function qrIsSet(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function confrontationKey(campA, campB) {
  const normalize = (actors) => actors.map((actor) => String(actor.actorId ?? actor.id ?? "")).filter(Boolean).sort().join(",");
  return `A:${normalize(campA)}|B:${normalize(campB)}`;
}

function recalculateCredits(confrontation) {
  const participants = Array.isArray(confrontation?.participants)
    ? confrontation.participants
    : [];
  const complete = participants.length >= 2
    && participants.every((participant) => qrIsSet(participant.qr));

  if (!complete || !confrontation.finalized) {
    for (const participant of participants) participant.credit = 0;
    confrontation.resolved = false;
    return confrontation;
  }

  const sortedQr = participants
    .map((participant) => Number(participant.qr))
    .sort((left, right) => right - left);
  const multiCap = participants.length > 2
    ? Math.max(0, sortedQr[0] - sortedQr[1])
    : Number.POSITIVE_INFINITY;

  for (const participant of participants) {
    const opponents = participants.filter((other) => other.camp !== participant.camp);
    const bestOpponent = opponents.length
      ? Math.max(...opponents.map((other) => Number(other.qr)))
      : Number(participant.qr);

    const raw = Number(participant.qr) > bestOpponent
      ? Number(participant.qr) - bestOpponent
      : 0;
    participant.credit = Math.max(0, Math.floor(Math.min(raw, multiCap)));
    participant.pending = false;
  }

  confrontation.resolved = true;
  return confrontation;
}

function allParticipantsHaveQr(confrontation) {
  const participants = Array.from(confrontation?.participants ?? []);
  return participants.length >= 2 && participants.every((participant) => qrIsSet(participant.qr));
}

function allParticipantsLocked(confrontation) {
  const participants = Array.from(confrontation?.participants ?? []);
  return allParticipantsHaveQr(confrontation)
    && participants.every((participant) => Boolean(participant.locked));
}

function finalizeConfrontation(confrontation, { forced = false } = {}) {
  if (!allParticipantsHaveQr(confrontation)) return false;

  for (const participant of confrontation.participants ?? []) {
    if (!participant.locked) {
      participant.locked = true;
      participant.arkChoice = forced ? "forced" : (participant.arkChoice || "no");
    }
  }

  confrontation.finalized = true;
  confrontation.updatedAt = Date.now();
  recalculateCredits(confrontation);
  return true;
}

function confrontationView(entry, index, isGM) {
  const participants = Array.isArray(entry.participants) ? entry.participants : [];
  const winningCamp = entry.resolved
    ? String(participants.find((participant) => Number(participant.credit) > 0)?.camp ?? "")
    : "";
  const prepare = (camp) => participants
    .filter((participant) => participant.camp === camp)
    .map((participant) => ({
      ...participant,
      hasQr: qrIsSet(participant.qr),
      qrDisplay: qrIsSet(participant.qr) ? Number(participant.qr) : "—",
      canDecrease: isGM && Boolean(entry.resolved) && Number(participant.credit) > 0,
      canIncrease: isGM && Boolean(entry.resolved)
    }));

  return {
    ...entry,
    displayIndex: index + 1,
    campA: prepare("A"),
    campB: prepare("B"),
    campAState: winningCamp === "A" ? "winner" : (winningCamp === "B" ? "loser" : ""),
    campBState: winningCamp === "B" ? "winner" : (winningCamp === "A" ? "loser" : ""),
    campAClass: winningCamp === "A"
      ? " arkhanval-art-combat__confrontation-camp--winner"
      : (winningCamp === "B" ? " arkhanval-art-combat__confrontation-camp--loser" : ""),
    campBClass: winningCamp === "B"
      ? " arkhanval-art-combat__confrontation-camp--winner"
      : (winningCamp === "A" ? " arkhanval-art-combat__confrontation-camp--loser" : ""),
    isGM,
    waiting: !entry.resolved
  };
}

async function resolveDroppedActor(event) {
  const internal = event.dataTransfer?.getData?.("application/x-arkhanval-art-combat");
  if (internal) {
    try {
      const data = JSON.parse(internal);
      if (data?.actorId) return game.actors?.get?.(String(data.actorId)) ?? null;
    } catch (_error) {
      // Ignore malformed internal drag data.
    }
  }

  let data = {};
  try {
    const helper = foundry.applications.ux.TextEditor.implementation;
    data = helper.getDragEventData(event) ?? {};
  } catch (_error) {
    try {
      data = JSON.parse(event.dataTransfer?.getData?.("text/plain") ?? "{}");
    } catch (_nested) {
      data = {};
    }
  }

  if (data?.type !== "Actor" && !String(data?.uuid ?? "").startsWith("Actor.")) return null;

  if (data?.uuid && typeof globalThis.fromUuid === "function") {
    const document = await globalThis.fromUuid(data.uuid);
    if (document?.documentName === "Actor" || document?.constructor?.name === "Actor") return document;
  }

  const id = String(data?.id ?? data?.actorId ?? "");
  return id ? game.actors?.get?.(id) ?? null : null;
}


// Réutilise exactement le volet QR de la carte de jet classique (dés visuels,
// relances ouvertes, QR). Le choix alternatif de compétence reste signalé.
function artCombatRollDisclosure(participant) {
  if (!participant?.result || !qrIsSet(participant.qr)) return "";
  const escape = foundry.utils.escapeHTML;
  const actualIdentifier = String(participant.result?.plan?.skillIdentifier ?? "");
  const actualName = String(participant.result?.plan?.skillName ?? "");
  const sourceNotice = actualIdentifier && actualIdentifier !== ART_COMBAT_IDENTIFIER
    ? `<section class="arkhanval-resolution-card__info-block"><div class="arkhanval-resolution-card__info-content"><p>Jet utilisé : <strong>${escape(actualName || actualIdentifier)}</strong></p></div></section>`
    : "";
  return `${sourceNotice}${combatRollDisclosure(participant.result)}`;
}

function actorHasArkCircle(actor) {
  if (!actor) return false;
  return ["arksonge", "arkentropie", "arkoeur"]
    .some((arkId) => (Number(actor.system.arks?.[arkId]?.circles) || 0) > 0);
}

function actorCanArkReroll(actor, result) {
  if (!actor || !result || !actorHasArkCircle(actor)) return false;

  const attemptIndex = Number(result.selectedAttemptIndex);
  if (!Number.isInteger(attemptIndex) || attemptIndex < 0) return false;
  return Array.from(result.attempts?.[attemptIndex]?.chains ?? [])
    .some((chain) => Number(chain?.initialFaces) === 10);
}


const ART_CREDIT_ICON_SMALL = "systems/arkhanval/assets/icones/art-combat/credit-relance.webp";

function artCreditCountMarkup(value) {
  const count = Math.max(0, Number(value) || 0);
  return `<span class="arkhanval-art-credit-count" title="${count} crédit(s) de relance"><strong>${count}</strong><img src="${ART_CREDIT_ICON_SMALL}" alt="" class="arkhanval-art-credit-icon arkhanval-art-credit-icon--count"></span>`;
}

function artCombatExperienceSource(actor, participant) {
  const source = participant?.result?.plan?.rollSource ?? null;

  if (source?.sourceType === "ark") {
    return {
      type: "ark",
      arkId: String(source.arkId ?? ""),
      arkLabel: String(source.name ?? "Ark")
    };
  }

  const identifier = String(
    source?.identifier
    ?? participant?.result?.plan?.skillIdentifier
    ?? ""
  );
  const skill = findActorSkill(actor, {
    itemId: String(source?.itemId ?? ""),
    identifier
  });
  if (!skill) return null;

  return {
    type: "skill",
    skill: {
      itemId: skill.itemId ?? "",
      name: skill.name,
      identifier: skill.identifier ?? "",
      archetype: skill.archetype ?? "",
      rank: Number(skill.rank) || 0,
      xp: Number(skill.xp) || 0
    }
  };
}

function artCombatParticipantBlock(confrontation, participant) {
  const escape = foundry.utils.escapeHTML;
  const actor = game.actors?.get?.(participant.actorId) ?? null;
  const img = String(participant.img ?? actor?.img ?? "");
  const name = String(participant.name ?? actor?.name ?? "Personnage");
  const resolved = Boolean(confrontation.finalized);
  const hasQr = qrIsSet(participant.qr);
  const plan = participant.result?.plan ?? null;
  const actualSkillName = String(plan?.skillName ?? "Art du combat");
  const fallbackSkill = actor ? findActorSkill(actor, { identifier: ART_COMBAT_IDENTIFIER }) : null;
  const actualRank = plan?.rollSource?.rank ?? plan?.primaryRank ?? fallbackSkill?.rank;
  const rank = Number.isFinite(Number(actualRank)) ? `Rang ${Math.max(0, Number(actualRank))}` : "";
  const count = Array.from(plan?.pool ?? []).length;
  const fd = plan?.effectiveFd === plan?.fd
    ? String(plan?.effectiveFd ?? 7)
    : `${plan?.fd ?? 7} → ${plan?.effectiveFd ?? 7}`;
  const stats = hasQr && plan ? `
    <section class="arkhanval-resolution-card__stats-block">
      <div class="arkhanval-resolution-card__stat">
        <span class="arkhanval-resolution-card__stat-label">Nombre de dés</span>
        <strong class="arkhanval-resolution-card__stat-value">${escape(plan.poolLabel || `${count} dé${count > 1 ? "s" : ""}`)}</strong>
      </div>
      <div class="arkhanval-resolution-card__stat arkhanval-resolution-card__stat--fd">
        <span class="arkhanval-resolution-card__stat-label">FD</span>
        <strong class="arkhanval-resolution-card__stat-value">${escape(fd)}</strong>
      </div>
    </section>` : "";
  const autoNotes = [
    ...Array.from(plan?.specialtyNotes ?? []),
    ...(Number(plan?.criticalFailureThreshold) > 1 && !plan?.suppressCriticalFailures
      ? [game.i18n.format("ARKHANVAL.Resolution.ChatRiskThreshold", { threshold: plan.criticalFailureThreshold })]
      : [])
  ];
  const infoBlock = autoNotes.length ? `
    <section class="arkhanval-resolution-card__info-block">
      <div class="arkhanval-resolution-card__info-content">${autoNotes.map((note) => `<p>${escape(note)}</p>`).join("")}</div>
    </section>` : "";

  let action = "";
  if (!hasQr) {
    action = `
      <button type="button"
              class="arkhanval-art-combat-card__roll"
              data-arkhanval-art-combat-roll
              data-confrontation-id="${escape(confrontation.id)}"
              data-actor-id="${escape(participant.actorId)}">
        Lancer Art du combat
      </button>
    `;
  } else if (!participant.locked && !resolved && actorCanArkReroll(actor, participant.result)) {
    action = `
      <div class="arkhanval-art-combat-card__ark"
           data-arkhanval-art-combat-ark-controls
           data-actor-id="${escape(participant.actorId)}">
        <span>Utiliser un cercle d'Ark :</span>
        <div class="arkhanval-art-combat-card__ark-actions">
          <button type="button"
                  data-arkhanval-art-combat-ark
                  data-ark-choice="yes"
                  data-confrontation-id="${escape(confrontation.id)}"
                  data-actor-id="${escape(participant.actorId)}">Oui</button>
          <button type="button"
                  data-arkhanval-art-combat-ark
                  data-ark-choice="no"
                  data-confrontation-id="${escape(confrontation.id)}"
                  data-actor-id="${escape(participant.actorId)}">Non</button>
        </div>
      </div>
    `;
  }

  const experienceAction = hasQr
    && participant.locked
    && Boolean(participant.result?.experienceEligible)
    && !participant.experienceUsed
    ? `
      <button type="button"
              class="arkhanval-art-combat-card__experience"
              data-arkhanval-art-combat-experience
              data-confrontation-id="${escape(confrontation.id)}"
              data-actor-id="${escape(participant.actorId)}">
        Lancer le dé d’expérience
      </button>
    `
    : "";

  // Le portrait et le badge d'archétype utilisent les générateurs de la carte
  // classique ; seules les données de l'Art du combat varient.
  const archetypePlan = plan ?? { rollSource: { archetype: "combattant" } };
  return `
    <article class="arkhanval-art-combat-card__participant arkhanval-resolution-card__shell"
             data-art-combat-participant="${escape(participant.actorId)}">
      <header class="arkhanval-resolution-card__hero">
        ${resolutionPortraitMarkup({ name, img })}
        <div class="arkhanval-resolution-card__hero-main">
          <div class="arkhanval-art-combat-card__participant-name">${escape(name)}</div>
          <h3>${escape(actualSkillName)}</h3>
          ${rank ? `<div class="arkhanval-resolution-card__hero-rank">${escape(rank)}</div>` : ""}
        </div>
        ${resolutionArchetypeMarkup(archetypePlan)}
      </header>
      ${stats}
      ${infoBlock}
      ${hasQr ? artCombatRollDisclosure(participant) : ""}
      ${action || experienceAction ? `
        <div class="arkhanval-art-combat-card__action-panel arkhanval-chat-decision-block">
          ${action}
          ${experienceAction}
          ${!hasQr ? `<small class="arkhanval-chat-action-context">${escape(name)} — En attente du jet</small>` : ""}
        </div>
      ` : ""}
    </article>
  `;
}

function artCombatJudgeBlock(confrontation) {
  const escape = foundry.utils.escapeHTML;
  const participants = Array.from(confrontation.participants ?? []);
  const ready = allParticipantsHaveQr(confrontation);
  const resolved = Boolean(confrontation.finalized);

  if (!ready) {
    const done = participants.filter((participant) => qrIsSet(participant.qr)).length;
    return `
      <section class="arkhanval-art-combat-card__judge arkhanval-art-combat-card__judge--pending">
        <strong>Art du combat en cours</strong>
        <span>${done} / ${participants.length} jets effectués</span>
      </section>
    `;
  }

  if (!resolved) {
    return `
      <section class="arkhanval-art-combat-card__judge arkhanval-art-combat-card__judge--ready"
               data-arkhanval-art-combat-force
               data-confrontation-id="${escape(confrontation.id)}">
        <strong>Résultats prêts</strong>
        <small>MJ — cliquez ici pour figer les résultats.</small>
      </section>
    `;
  }

  // Pour la teinte, on utilise les QR figées (et non les crédits restants,
  // puisqu'un crédit peut avoir été consommé après la confrontation).
  const topQr = (camp) => Math.max(-Infinity,
    ...participants.filter((entry) => entry.camp === camp).map((entry) => Number(entry.qr)));
  const a = topQr("A");
  const b = topQr("B");
  const winner = a > b ? "a" : b > a ? "b" : "tie";
  const verdict = winner === "tie"
    ? "Égalité — aucun avantage tactique"
    : `Le camp ${winner.toUpperCase()} remporte la confrontation`;
  const winners = participants.filter((participant) => Number(participant.credit) > 0);
  const credits = winners.length
    ? `Crédits disponibles : ${winners.map((participant) => {
        const credit = Number(participant.credit) || 0;
        return `${escape(participant.name)} : ${artCreditCountMarkup(credit)}`;
      }).join(" · ")}`
    : "Aucun crédit de relance disponible";

  return `
    <section class="arkhanval-art-combat-card__judge arkhanval-art-combat-card__judge--resolved arkhanval-art-combat-card__judge--${winner}">
      <strong>${escape(verdict)}</strong>
      <span>${credits}</span>
    </section>
  `;
}

function buildArtCombatChatContent(confrontation) {
  const campA = Array.from(confrontation.participants ?? [])
    .filter((participant) => participant.camp === "A")
    .map((participant) => artCombatParticipantBlock(confrontation, participant))
    .join("");
  const campB = Array.from(confrontation.participants ?? [])
    .filter((participant) => participant.camp === "B")
    .map((participant) => artCombatParticipantBlock(confrontation, participant))
    .join("");

  return `
    <section class="arkhanval-art-combat-card arkhanval-art-combat-card--opposition"
             data-art-combat-card
             data-confrontation-id="${foundry.utils.escapeHTML(confrontation.id)}">
      <header class="arkhanval-art-combat-card__title">Art du combat — FD 7</header>
      <section class="arkhanval-art-combat-card__camp arkhanval-art-combat-card__camp--a">
        <h3>Camp A</h3>
        ${campA}
      </section>
      ${artCombatJudgeBlock(confrontation)}
      <section class="arkhanval-art-combat-card__camp arkhanval-art-combat-card__camp--b">
        <h3>Camp B</h3>
        ${campB}
      </section>
    </section>
  `.trim();
}

async function syncConfrontationChatMessage(confrontation) {
  if (!game.user?.isGM || !confrontation?.messageId) return;
  const message = game.messages?.get?.(String(confrontation.messageId)) ?? null;
  if (!message) return;
  await message.update({
    content: buildArtCombatChatContent(confrontation),
    "flags.arkhanval.artCombat.confrontationId": String(confrontation.id)
  });
}

async function syncRegistryChatMessages(state) {
  if (!game.user?.isGM) return;
  for (const confrontation of Array.from(state?.confrontations ?? [])) {
    if (!confrontation?.messageId) continue;
    await syncConfrontationChatMessage(confrontation);
  }
}

function userCanActForActor(userId, actor) {
  const user = game.users?.get?.(String(userId ?? ""));
  if (!user || !actor) return false;
  return Boolean(user.isGM || actor.testUserPermission?.(user, "OWNER"));
}

async function submitArtCombatAction(payload) {
  const action = {
    type: SOCKET_ACTION,
    userId: String(game.user?.id ?? ""),
    ...payload
  };

  if (game.user?.isGM) {
    await applyArtCombatAction(action);
    return;
  }

  game.socket?.emit?.(SOCKET_CHANNEL, action);
}

async function applyArtCombatAction(payload) {
  return queueArtCombatMutation(async () => {
    if (!game.user?.isGM) return;

    const state = registry();
    const confrontation = state.confrontations.find((entry) => entry.id === String(payload.confrontationId ?? ""));
    if (!confrontation) return;

    const actorId = String(payload.actorId ?? "");
    const participant = confrontation.participants?.find((entry) => entry.actorId === actorId) ?? null;
    const actor = actorId ? game.actors?.get?.(actorId) ?? null : null;

    if (payload.action === "force") {
      const user = game.users?.get?.(String(payload.userId ?? ""));
      if (!user?.isGM || !allParticipantsHaveQr(confrontation) || confrontation.finalized) return;
      finalizeConfrontation(confrontation, { forced: true });
    } else {
      if (!participant || !userCanActForActor(payload.userId, actor)) return;

      if (payload.action === "experience-roll") {
        if (!participant.locked || !participant.result?.experienceEligible || participant.experienceUsed) return;
        const source = artCombatExperienceSource(actor, participant);
        if (!source) throw new Error(`Source d’expérience introuvable pour ${actor?.name ?? "ce personnage"}.`);
        // Une carte C02 créée avant un échec d’écriture du registre est réutilisée.
        // La carte C10 et le participant identifient une seule opportunité XP ; une nouvelle
      // confrontation sur les mêmes camps possède une nouvelle carte C10.
        const sourceMessageId = `art-combat:${confrontation.id}:${confrontation.messageId}:${actorId}`;
        const existing = Array.from(game.messages?.contents ?? []).find((entry) =>
          entry.getFlag?.("arkhanval", "experienceGain")?.sourceMessageId === sourceMessageId);
        if (!existing) {
          const rolled = await resolveExperienceDie(actor, source, sourceMessageId);
          if (!rolled?.message) throw new Error("Impossible de créer la carte du dé d’expérience.");
        }
        participant.experienceUsed = true;
      } else {
        if (confrontation.finalized) return;

        if (payload.action === "result") {
          if (qrIsSet(participant.qr)) return;
          const result = foundry.utils.deepClone(payload.result ?? null);
          if (!result || !Number.isFinite(Number(result.qr))) return;
          participant.result = result;
          participant.qr = Number(result.qr);
          participant.pending = false;
          participant.arkChoice = "";
          participant.experienceUsed = false;
          participant.locked = !actorCanArkReroll(actor, result);
        } else if (payload.action === "ark-no") {
        if (!qrIsSet(participant.qr) || participant.locked) return;
        participant.arkChoice = "no";
        participant.locked = true;
        } else if (payload.action === "ark-yes") {
          if (!qrIsSet(participant.qr) || participant.locked) return;
          const result = foundry.utils.deepClone(payload.result ?? null);
          if (!result || !Number.isFinite(Number(result.qr))) return;
          participant.result = result;
          participant.qr = Number(result.qr);
          participant.arkChoice = "yes";
          participant.locked = true;
        }

        if (allParticipantsLocked(confrontation)) {
          finalizeConfrontation(confrontation);
        }
      }
    }

    confrontation.updatedAt = Date.now();
    await saveRegistry(state);
    await syncConfrontationChatMessage(confrontation);
  });
}

async function rollArtCombat(confrontationId, actorId) {
  const state = registry();
  const confrontation = state.confrontations.find((entry) => entry.id === confrontationId);
  const participant = confrontation?.participants?.find((entry) => entry.actorId === actorId);
  if (!confrontation || !participant || confrontation.finalized) return false;
  if (qrIsSet(participant.qr)) {
    ui.notifications?.info?.("Arkhanval | Ce jet d’Art du combat a déjà été enregistré.");
    return true;
  }

  const actor = game.actors?.get?.(actorId);
  if (!actor) return false;
  if (!game.user?.isGM && !actor.testUserPermission?.(game.user, "OWNER")) {
    ui.notifications?.warn?.("Arkhanval | Vous ne contrôlez pas ce personnage.");
    return false;
  }

  const skill = findActorSkill(actor, { identifier: ART_COMBAT_IDENTIFIER });
  if (!skill) {
    ui.notifications?.warn?.(`Arkhanval | Source du jet introuvable pour ${actor.name}.`);
    return false;
  }

  const request = await promptSkillRoll({
    actor,
    skill,
    combatContext: null,
    defaultFd: 7
  });
  if (!request) return false;

  const result = await resolveRoll(request);

  if (request.ark?.boost) {
    const spent = await spendArkCircle(actor, request.ark.boost);
    if (!spent) {
      ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
      return false;
    }
  }

  await submitArtCombatAction({
    action: "result",
    confrontationId,
    actorId,
    result
  });
  return true;
}

async function chooseArtCombatArk(confrontationId, actorId, choice) {
  const state = registry();
  const confrontation = state.confrontations.find((entry) => entry.id === confrontationId);
  const participant = confrontation?.participants?.find((entry) => entry.actorId === actorId);
  if (!confrontation || !participant || confrontation.finalized || participant.locked) return false;
  if (!qrIsSet(participant.qr)) return false;

  const actor = game.actors?.get?.(actorId);
  if (!actor) return false;
  if (!game.user?.isGM && !actor.testUserPermission?.(game.user, "OWNER")) {
    ui.notifications?.warn?.("Arkhanval | Vous ne contrôlez pas ce personnage.");
    return false;
  }

  if (choice === "no") {
    await submitArtCombatAction({
      action: "ark-no",
      confrontationId,
      actorId
    });
    return true;
  }

  if (choice !== "yes") return false;

  const reroll = await promptArkRerollSelection(actor, participant.result);
  if (!reroll) return false;

  const available = Number(actor.system.arks?.[reroll.arkId]?.circles) || 0;
  if (available <= 0) {
    ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
    return false;
  }

  const nextResult = await rerollSelectedD10(participant.result, reroll.chainIndices, {
    attemptIndex: reroll.attemptIndex
  });

  const retainedChoice = await promptRerollResultChoice(participant.result, nextResult, {
    attemptIndex: reroll.attemptIndex,
    chainIndices: reroll.chainIndices,
    title: "Relance d’Ark — résultat retenu"
  });
  const retainedResult = retainedChoice === "new" ? nextResult : participant.result;

  const spent = await spendArkCircle(actor, reroll.arkId);
  if (!spent) {
    ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
    return false;
  }

  await submitArtCombatAction({
    action: "ark-yes",
    confrontationId,
    actorId,
    result: retainedResult
  });
  return true;
}

async function rollArtCombatExperience(confrontationId, actorId) {
  const state = registry();
  const confrontation = state.confrontations.find((entry) => entry.id === confrontationId);
  const participant = confrontation?.participants?.find((entry) => entry.actorId === actorId);
  if (!confrontation || !participant || !participant.locked) return;
  if (!participant.result?.experienceEligible || participant.experienceUsed) return;

  const actor = game.actors?.get?.(actorId);
  if (!actor) return;
  if (!game.user?.isGM && !actor.testUserPermission?.(game.user, "OWNER")) {
    ui.notifications?.warn?.("Arkhanval | Vous ne contrôlez pas ce personnage.");
    return;
  }

  // Le MJ crée C02 et marque le résultat dans une seule action sérialisée.
  // Le joueur ne crée jamais une C02 locale en attente du retour socket.
  await submitArtCombatAction({
    action: "experience-roll",
    confrontationId,
    actorId
  });
}


function currentRoundCombat() {
  return game.combat ?? null;
}

async function createSilentRoundCombat() {
  const CombatClass = CONFIG?.Combat?.documentClass ?? globalThis.Combat;
  if (!CombatClass?.create) throw new Error("Impossible de créer une rencontre Foundry.");

  const data = {
    name: "Arkhanval — Gestion des rounds",
    active: true
  };
  const sceneId = String(canvas?.scene?.id ?? "");
  if (sceneId) data.scene = sceneId;

  const combat = await CombatClass.create(data);
  if (!combat) throw new Error("La rencontre Foundry n’a pas pu être créée.");
  return combat;
}

function activeConfrontationActorIds() {
  return Array.from(new Set(
    registry().confrontations
      .flatMap((entry) => Array.from(entry?.participants ?? []))
      .map((participant) => String(participant?.actorId ?? ""))
      .filter(Boolean)
  ));
}

function actorSceneToken(actor) {
  const scene = canvas?.scene ?? null;
  if (!scene || !actor?.id) return null;
  return Array.from(scene.tokens ?? []).find((token) => String(token?.actorId ?? token?.actor?.id ?? "") === String(actor.id)) ?? null;
}

async function synchronizeArtCombatParticipants(combat) {
  if (!combat || !game.user?.isGM) return 0;

  const existingActorIds = new Set(
    Array.from(combat.combatants ?? [])
      .map((combatant) => String(combatant?.actor?.id ?? combatant?.actorId ?? ""))
      .filter(Boolean)
  );

  const rows = [];
  for (const actorId of activeConfrontationActorIds()) {
    if (existingActorIds.has(actorId)) continue;
    const actor = game.actors?.get?.(actorId) ?? null;
    if (!actor) continue;

    const token = actorSceneToken(actor);
    rows.push({
      actorId,
      ...(token ? { tokenId: String(token.id), sceneId: String(token.parent?.id ?? canvas?.scene?.id ?? "") } : {}),
      name: String(actor.name ?? "Personnage"),
      img: String(actor.img ?? "")
    });
    existingActorIds.add(actorId);
  }

  if (!rows.length) return 0;
  await combat.createEmbeddedDocuments("Combatant", rows);
  return rows.length;
}

async function advanceArtCombatRound() {
  if (!game.user?.isGM) return null;

  let combat = currentRoundCombat();
  if (!combat) combat = await createSilentRoundCombat();

  await synchronizeArtCombatParticipants(combat);

  if (!combat.started) {
    await combat.startCombat();
    await combat.nextRound();
  } else {
    await combat.nextRound();
  }

  activeApplication?.render?.({ force: true });
  return combat;
}

async function endArtCombatRoundTracking() {
  if (!game.user?.isGM) return null;
  const combat = currentRoundCombat();
  if (!combat) return null;

  const cleanup = await cleanupCombatRoundTracking(combat);
  await combat.delete();
  activeApplication?.render?.({ force: true });
  return cleanup;
}

export class ArkhanvalArtCombatApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super({
      id: "arkhanval-art-combat",
      ...options
    });
    this.draft = {
      A: [],
      B: []
    };
  }

  static DEFAULT_OPTIONS = {
    tag: "section",
    classes: ["arkhanval", "arkhanval-art-combat"],
    position: {
      width: 960,
      height: 650
    },
    window: {
      resizable: true,
      title: "Art du combat",
      icon: "fa-solid fa-chess"
    },
    actions: {
      resolve: this.#onResolve,
      nextRound: this.#onNextRound,
      endCombat: this.#onEndCombat,
      deleteConfrontation: this.#onDeleteConfrontation,
      creditDown: this.#onCreditDown,
      creditUp: this.#onCreditUp
    }
  };

  static PARTS = {
    body: {
      template: "systems/arkhanval/templates/apps/art-of-combat.hbs"
    }
  };

  static async #onResolve() {
    if (!game.user?.isGM) return;

    const campA = Array.from(this.draft.A ?? []);
    const campB = Array.from(this.draft.B ?? []);
    if (!campA.length || !campB.length) {
      ui.notifications?.warn?.("Arkhanval | Déposez au moins un personnage dans chaque camp.");
      return;
    }

    const missingSkill = [...campA, ...campB]
      .map((entry) => game.actors?.get?.(entry.actorId) ?? null)
      .filter(Boolean)
      .filter((actor) => !findActorSkill(actor, { identifier: ART_COMBAT_IDENTIFIER }));

    if (missingSkill.length) {
      ui.notifications?.warn?.(
        `Arkhanval | Art du combat introuvable pour : ${missingSkill.map((actor) => actor.name).join(", ")}.`
      );
      return;
    }

    const key = confrontationKey(campA, campB);
    const state = registry();
    let confrontation = state.confrontations.find((entry) => entry.key === key);

    const participants = [
      ...campA.map((entry) => actorSnapshot(game.actors.get(entry.actorId), "A")),
      ...campB.map((entry) => actorSnapshot(game.actors.get(entry.actorId), "B"))
    ].filter((entry) => entry.actorId);

    if (confrontation) {
      confrontation.participants = participants;
      confrontation.resolved = false;
      confrontation.finalized = false;
      confrontation.messageId = "";
      confrontation.updatedAt = Date.now();
    } else {
      confrontation = {
        id: foundry.utils.randomID(),
        key,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        resolved: false,
        finalized: false,
        messageId: "",
        participants
      };
      state.confrontations.push(confrontation);
    }

    await saveRegistry(state);

    const message = await ChatMessage.create({
      speaker: { alias: "Arkhanval — Art du combat" },
      content: buildArtCombatChatContent(confrontation),
      flags: {
        arkhanval: {
          artCombat: {
            confrontationId: confrontation.id
          }
        }
      }
    });

    confrontation.messageId = String(message?.id ?? "");
    await saveRegistry(state);
    await syncConfrontationChatMessage(confrontation);

    this.draft = { A: [], B: [] };
    this.render({ force: true });
  }

  static async #onNextRound() {
    if (!game.user?.isGM) return;
    try {
      const combat = await advanceArtCombatRound();
      const round = Number(combat?.round) || 0;
      ui.notifications?.info?.(`Arkhanval | Round ${round}.`);
      this.render({ force: true });
    } catch (error) {
      console.error("Arkhanval | Échec du passage au round suivant", error);
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  }

  static async #onEndCombat() {
    if (!game.user?.isGM) return;
    try {
      const cleanup = await endArtCombatRoundTracking();
      if (!cleanup) {
        ui.notifications?.info?.("Arkhanval | Aucune rencontre active.");
        return;
      }
      ui.notifications?.info?.(`Arkhanval | Combat terminé — ${Number(cleanup.statesDeleted) || 0} état(s) temporaire(s) nettoyé(s).`);
      this.render({ force: true });
    } catch (error) {
      console.error("Arkhanval | Échec de la fin de combat", error);
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  }

  static async #onDeleteConfrontation(_event, target) {
    if (!game.user?.isGM) return;
    const id = String(target?.dataset?.confrontationId ?? "");
    if (!id) return;

    const state = registry();
    state.confrontations = state.confrontations.filter((entry) => entry.id !== id);
    await saveRegistry(state);
  }

  static async #onCreditDown(_event, target) {
    await this._adjustCredit(target, -1);
  }

  static async #onCreditUp(_event, target) {
    await this._adjustCredit(target, 1);
  }

  async _adjustCredit(target, delta) {
    if (!game.user?.isGM) return;
    const confrontationId = String(target?.dataset?.confrontationId ?? "");
    const actorId = String(target?.dataset?.actorId ?? "");
    if (!confrontationId || !actorId) return;

    const state = registry();
    const confrontation = state.confrontations.find((entry) => entry.id === confrontationId);
    const participant = confrontation?.participants?.find((entry) => entry.actorId === actorId);
    if (!participant) return;

    participant.credit = Math.max(0, (Number(participant.credit) || 0) + delta);
    await saveRegistry(state);
    await syncConfrontationChatMessage(confrontation);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const isGM = Boolean(game.user?.isGM);
    const state = registry();

    const viewDraft = (camp) => Array.from(this.draft[camp] ?? []).map((entry) => {
      const actor = game.actors?.get?.(entry.actorId);
      return {
        actorId: entry.actorId,
        name: actor?.name ?? entry.name ?? "Personnage",
        img: actor?.img ?? entry.img ?? ""
      };
    });

    context.isGM = isGM;
    context.draftA = viewDraft("A");
    context.draftB = viewDraft("B");
    context.canResolve = isGM && context.draftA.length > 0 && context.draftB.length > 0;
    const combat = currentRoundCombat();
    const currentRound = combat?.started ? Math.max(1, Number(combat.round) || 1) : null;
    context.hasActiveCombat = Boolean(combat);
    context.roundStatus = currentRound ? `Round actuel : ${currentRound}` : "Combat non démarré";
    context.nextRoundLabel = currentRound ? `Passer au round ${currentRound + 1}` : "Passer au round suivant";
    context.confrontations = state.confrontations.map((entry, index) => confrontationView(entry, index, isGM));
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    if (!root) return;

    for (const zone of root.querySelectorAll("[data-art-camp-drop]")) {
      zone.addEventListener("dragover", (event) => {
        if (!game.user?.isGM) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        zone.classList.add("is-dragover");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("is-dragover"));
      zone.addEventListener("drop", async (event) => {
        if (!game.user?.isGM) return;
        event.preventDefault();
        event.stopPropagation();
        zone.classList.remove("is-dragover");
        const actor = await resolveDroppedActor(event);
        if (!actor) return;
        this._moveDraftActor(actor, String(zone.dataset.artCampDrop ?? ""));
      });
    }

    for (const chip of root.querySelectorAll("[data-draft-actor]")) {
      if (!game.user?.isGM) continue;
      chip.addEventListener("dragstart", (event) => {
        const actorId = String(chip.dataset.draftActor ?? "");
        const camp = String(chip.dataset.camp ?? "");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-arkhanval-art-combat", JSON.stringify({ actorId, camp }));
        event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Actor", id: actorId, uuid: `Actor.${actorId}` }));

        document.addEventListener("drop", (dropEvent) => {
          if (dropEvent.target?.closest?.("[data-art-camp-drop]")) return;
          this._removeDraftActor(actorId);
        }, { capture: true, once: true });
      });
    }

    root.addEventListener("dragover", (event) => {
      if (!game.user?.isGM) return;
      event.preventDefault();
    });

    root.addEventListener("drop", async (event) => {
      if (!game.user?.isGM) return;
      if (event.target?.closest?.("[data-art-camp-drop]")) return;

      const internal = event.dataTransfer?.getData?.("application/x-arkhanval-art-combat");
      if (!internal) return;
      event.preventDefault();
      try {
        const data = JSON.parse(internal);
        this._removeDraftActor(String(data.actorId ?? ""));
      } catch (_error) {
        // Ignore malformed data.
      }
    });
  }

  _moveDraftActor(actor, targetCamp) {
    if (!["A", "B"].includes(targetCamp)) return;
    const actorId = String(actor?.id ?? "");
    if (!actorId) return;

    this.draft.A = this.draft.A.filter((entry) => entry.actorId !== actorId);
    this.draft.B = this.draft.B.filter((entry) => entry.actorId !== actorId);
    this.draft[targetCamp].push({
      actorId,
      name: String(actor.name ?? "Personnage"),
      img: String(actor.img ?? "")
    });
    this.render({ force: true });
  }

  _removeDraftActor(actorId) {
    this.draft.A = this.draft.A.filter((entry) => entry.actorId !== actorId);
    this.draft.B = this.draft.B.filter((entry) => entry.actorId !== actorId);
    this.render({ force: true });
  }
}

export function registerArtCombatSetting() {
  game.settings.register("arkhanval", SETTING_KEY, {
    name: "Art du combat — registre",
    scope: "world",
    config: false,
    type: Object,
    default: emptyRegistry()
  });
}

export function initializeArtCombatSocket() {
  if (!roundRefreshHookRegistered) {
    Hooks.on("combatTurnChange", () => activeApplication?.render?.({ force: true }));
    Hooks.on("createCombat", () => activeApplication?.render?.({ force: true }));
    Hooks.on("deleteCombat", () => activeApplication?.render?.({ force: true }));
    roundRefreshHookRegistered = true;
  }

  game.socket?.on?.(SOCKET_CHANNEL, async (payload) => {
    if (!payload || typeof payload !== "object") return;

    if (payload.type === SOCKET_REFRESH) {
      refreshArtCombatInterfaces({ refreshChat: payload.refreshChat !== false });
      return;
    }

    if (payload.type === SOCKET_ACTION) {
      if (String(game.user?.id ?? "") !== authoritativeGmId()) return;
      try {
        await applyArtCombatAction(payload);
      } catch (error) {
        console.error("Arkhanval | Échec de réception d’une action Art du combat", error);
      }
    }
  });
}

export function activateArtCombatChatMessage(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0] ?? null;
  if (!root) return;

  for (const button of root.querySelectorAll("[data-arkhanval-art-combat-roll]")) {
    const actorId = String(button.dataset.actorId ?? "");
    const actor = game.actors?.get?.(actorId) ?? null;
    const canUse = Boolean(game.user?.isGM || actor?.testUserPermission?.(game.user, "OWNER"));
    if (!canUse) {
      button.hidden = true;
      button.disabled = true;
      continue;
    }

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      if (button.disabled) return;
      button.disabled = true;
      try {
        const submitted = await rollArtCombat(
          String(button.dataset.confrontationId ?? ""),
          actorId
        );
        if (!submitted) button.disabled = false;
      } catch (error) {
        console.error("Arkhanval | Échec du jet Art du combat", error);
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        button.disabled = false;
      }
    });
  }

  for (const controls of root.querySelectorAll("[data-arkhanval-art-combat-ark-controls]")) {
    const actorId = String(controls.dataset.actorId ?? "");
    const actor = game.actors?.get?.(actorId) ?? null;
    const canUse = Boolean(game.user?.isGM || actor?.testUserPermission?.(game.user, "OWNER"));
    if (!canUse) controls.hidden = true;
  }

  for (const button of root.querySelectorAll("[data-arkhanval-art-combat-ark]")) {
    const actorId = String(button.dataset.actorId ?? "");
    const actor = game.actors?.get?.(actorId) ?? null;
    const canUse = Boolean(game.user?.isGM || actor?.testUserPermission?.(game.user, "OWNER"));
    if (!canUse) {
      button.hidden = true;
      button.disabled = true;
      continue;
    }

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      if (button.disabled) return;
      const siblings = button.parentElement?.querySelectorAll?.("button") ?? [];
      for (const sibling of siblings) sibling.disabled = true;

      try {
        const completed = await chooseArtCombatArk(
          String(button.dataset.confrontationId ?? ""),
          actorId,
          String(button.dataset.arkChoice ?? "")
        );
        if (!completed) {
          for (const sibling of siblings) sibling.disabled = false;
        }
      } catch (error) {
        console.error("Arkhanval | Échec du choix Ark Art du combat", error);
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        for (const sibling of siblings) sibling.disabled = false;
      }
    });
  }

  for (const button of root.querySelectorAll("[data-arkhanval-art-combat-experience]")) {
    const actorId = String(button.dataset.actorId ?? "");
    const actor = game.actors?.get?.(actorId) ?? null;
    const canUse = Boolean(game.user?.isGM || actor?.testUserPermission?.(game.user, "OWNER"));
    if (!canUse) {
      button.hidden = true;
      button.disabled = true;
      continue;
    }

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      if (button.disabled) return;
      button.disabled = true;
      try {
        await rollArtCombatExperience(
          String(button.dataset.confrontationId ?? ""),
          actorId
        );
      } catch (error) {
        console.error("Arkhanval | Échec du dé d’expérience Art du combat", error);
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        button.disabled = false;
      }
    });
  }

  for (const judge of root.querySelectorAll("[data-arkhanval-art-combat-force]")) {
    if (!game.user?.isGM) {
      judge.removeAttribute("data-arkhanval-art-combat-force");
      judge.classList.remove("arkhanval-art-combat-card__judge--ready");
      continue;
    }

    judge.addEventListener("click", async () => {
      if (judge.dataset.processing === "1") return;
      judge.dataset.processing = "1";
      try {
        await submitArtCombatAction({
          action: "force",
          confrontationId: String(judge.dataset.confrontationId ?? "")
        });
      } catch (error) {
        console.error("Arkhanval | Échec du gel MJ Art du combat", error);
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        delete judge.dataset.processing;
      }
    });
  }
}

export async function openArtCombatTool() {
  if (activeApplication?.rendered) {
    activeApplication.bringToFront?.();
    return activeApplication;
  }

  activeApplication = new ArkhanvalArtCombatApplication();
  await activeApplication.render({ force: true });
  return activeApplication;
}

export function injectArtCombatActorDirectoryButton(application, element) {
  const ActorDirectoryClass = foundry.applications.sidebar.tabs.ActorDirectory;
  if (!(application instanceof ActorDirectoryClass)) return;

  const root = element instanceof HTMLElement ? element : element?.[0] ?? null;
  if (!root || root.querySelector("[data-arkhanval-art-combat-open]")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "arkhanval-art-combat-sidebar-button";
  button.dataset.arkhanvalArtCombatOpen = "";
  button.textContent = "Art du combat";
  button.title = "Accéder au système de gestion des jets d'Art du Combat";
  button.addEventListener("click", () => openArtCombatTool());

  const list = root.querySelector(".directory-list");
  if (list?.parentElement) list.parentElement.insertBefore(button, list);
  else root.prepend(button);
}
