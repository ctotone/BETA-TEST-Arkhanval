const FLAG_SCOPE = "arkhanval";
const FLAG_KEY = "incantations";

function safeClone(value) {
  if (value === undefined) return undefined;
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function currentIncantations(actor) {
  const raw = actor?.getFlag?.(FLAG_SCOPE, FLAG_KEY) ?? {};
  return raw && typeof raw === "object" ? safeClone(raw) : {};
}

function computeTotal(contributions = {}) {
  return Object.values(contributions)
    .reduce((total, value) => total + normalizeNumber(value, 0), 0);
}

function cappedTotal(total, target) {
  const normalizedTotal = normalizeNumber(total, 0);
  const normalizedTarget = Math.max(0, Math.trunc(normalizeNumber(target, 0)));
  return normalizedTarget > 0
    ? Math.min(normalizedTotal, normalizedTarget)
    : normalizedTotal;
}

function derivedStatus(total, target) {
  if (target > 0 && total >= target) return "ready";
  if (total < 0) return "negative";
  return "channeling";
}

function readyQrFromState(state) {
  const explicit = Number(state?.readyQr);
  if (Number.isFinite(explicit)) return explicit;

  const target = Math.max(0, Math.trunc(normalizeNumber(state?.target, 0)));
  if (target <= 0) return null;

  let total = 0;
  for (const value of Object.values(state?.contributions ?? {})) {
    const qr = normalizeNumber(value, 0);
    total += qr;
    if (total >= target) return qr;
  }

  return null;
}

function canMutateActor(actor) {
  return Boolean(game.user?.isGM || actor?.isOwner || actor?.testUserPermission?.(game.user, "OWNER"));
}

async function persistIncantations(actor, incantations) {
  if (!actor) throw new Error("Personnage introuvable.");
  if (!canMutateActor(actor)) throw new Error("Vous n'avez pas l'autorisation de modifier cette incantation.");

  // Keep creation, mutation and clearing on the same proven Foundry path.
  // An empty object represents “no active incantation”; this avoids relying on
  // unsetFlag semantics during an Actor-sheet render cycle.
  await actor.setFlag(FLAG_SCOPE, FLAG_KEY, safeClone(incantations ?? {}));
}

export function getSpellIncantation(actor, spellId) {
  if (!actor || !spellId) return null;
  return currentIncantations(actor)[String(spellId)] ?? null;
}

export function prepareIncantationView(actor, spell) {
  const state = getSpellIncantation(actor, spell?.id);
  if (!state) return null;

  const target = Math.max(0, Math.trunc(normalizeNumber(state.target, 0)));
  const contributionValues = Object.values(state.contributions ?? {});
  const rawTotal = contributionValues.length
    ? computeTotal(state.contributions)
    : normalizeNumber(state.total, 0);
  const total = cappedTotal(rawTotal, target);
  const status = derivedStatus(rawTotal, target);

  return {
    ...state,
    target,
    total,
    status,
    readyQr: status === "ready" ? readyQrFromState(state) : null,
    ready: status === "ready",
    negative: status === "negative",
    progressLabel: `${total} / ${target}`
  };
}

export function combatIncantationSnapshot(actor) {
  const states = Object.values(currentIncantations(actor));
  const readySpells = states
    .map((state) => {
      const target = Math.max(0, Math.trunc(normalizeNumber(state?.target, 0)));
      const contributionValues = Object.values(state?.contributions ?? {});
      const rawTotal = contributionValues.length
        ? computeTotal(state?.contributions)
        : normalizeNumber(state?.total, 0);
      const total = cappedTotal(rawTotal, target);
      const status = derivedStatus(rawTotal, target);
      if (status !== "ready") return null;

      const readyQr = readyQrFromState(state);

      return {
        sessionId: String(state?.id ?? ""),
        spellId: String(state?.spellId ?? ""),
        spellName: String(state?.spellName ?? "Sortilège"),
        castingSkill: String(state?.castingSkill ?? ""),
        total,
        target,
        readyQr: Number(readyQr)
      };
    })
    .filter(Boolean);

  return {
    active: states.length > 0,
    count: states.length,
    spellIds: states.map((state) => String(state?.spellId ?? "")).filter(Boolean),
    ready: readySpells.length > 0,
    readySpells
  };
}

// Édition manuelle avancée de la session en cours (sans remplacer l'identité
// de la session ni effacer les contributions déjà associées aux cartes Chat).
export async function adjustSpellIncantationProgress(actor, { spellId, total, target } = {}) {
  if (!actor || !canMutateActor(actor)) throw new Error("Modification d'incantation non autorisée.");
  const key = String(spellId ?? "");
  const incantations = currentIncantations(actor);
  const state = incantations[key];
  if (!state) throw new Error("Cette incantation n'est plus active.");
  const nextTotal = Number(total);
  const nextTarget = Number(target);
  if (!Number.isInteger(nextTotal) || !Number.isInteger(nextTarget)
      || nextTarget < 0 || nextTarget > 99999 || nextTotal < -99999 || nextTotal > 99999) {
    throw new Error("La progression doit être entière et l'objectif positif ou nul.");
  }
  const manualKey = "__manualAdjustment";
  const contributions = { ...(state.contributions ?? {}) };
  delete contributions[manualKey];
  const otherTotal = computeTotal(contributions);
  // Un seul ajustement stable : les contributions antérieures restent identifiables.
  contributions[manualKey] = nextTotal - otherTotal;
  const status = derivedStatus(nextTotal, nextTarget);
  incantations[key] = {
    ...state, target: nextTarget, total: cappedTotal(nextTotal, nextTarget), contributions,
    readyQr: status === "ready" ? (Number.isFinite(Number(state.readyQr)) ? Number(state.readyQr) : 0) : null,
    readyContributionId: status === "ready" ? String(state.readyContributionId ?? "") : ""
  };
  await persistIncantations(actor, incantations);
  return incantations[key];
}

export async function startSpellIncantation(actor, spell) {
  if (!actor || !spell || spell.type !== "spell") {
    throw new Error("Sortilège invalide pour démarrer une incantation.");
  }

  const incantations = currentIncantations(actor);
  const spellId = String(spell.id);
  const existing = incantations[spellId];
  if (existing) return existing;

  const target = Math.max(0, Math.trunc(normalizeNumber(spell.system.magicPoints, 0)));
  const fd = Math.max(0, Math.trunc(normalizeNumber(spell.system.fd, 0)));
  const id = globalThis.foundry?.utils?.randomID?.() ?? crypto.randomUUID();

  const state = {
    id,
    spellId,
    spellUuid: String(spell.uuid ?? ""),
    spellName: String(spell.name ?? "Sortilège"),
    castingSkill: String(spell.system.castingSkill ?? ""),
    target,
    fd,
    requirements: Array.from(spell.system.requirements ?? []).map((entry) => String(entry)),
    contributions: {},
    total: 0,
    createdAt: Date.now()
  };

  incantations[spellId] = state;
  await persistIncantations(actor, incantations);
  return state;
}

function forcedDeletion() {
  const ForcedDeletion = globalThis.foundry?.data?.operators?.ForcedDeletion;
  if (!ForcedDeletion) {
    throw new Error("Opérateur Foundry v14 ForcedDeletion indisponible.");
  }
  return new ForcedDeletion();
}

async function clearSpellIncantation(actor, spellId) {
  if (!actor) throw new Error("Personnage introuvable.");
  if (!canMutateActor(actor)) throw new Error("Vous n'avez pas l'autorisation de modifier cette incantation.");

  const incantations = currentIncantations(actor);
  const key = String(spellId ?? "").trim();
  const state = incantations[key];
  if (!state) return null;

  // Foundry merges object updates. Rewriting the parent object without this key
  // does not guarantee that the existing nested flag is removed. Foundry v14
  // replaces the legacy "-=key" syntax with a ForcedDeletion operator.
  await actor.update({
    flags: {
      [FLAG_SCOPE]: {
        [FLAG_KEY]: {
          [key]: forcedDeletion()
        }
      }
    }
  });

  return state;
}

export async function cancelSpellIncantation(actor, spellId) {
  return Boolean(await clearSpellIncantation(actor, spellId));
}

export async function recordIncantationContribution(actor, {
  spellId,
  sessionId,
  contributionId,
  qr
} = {}) {
  const incantations = currentIncantations(actor);
  const key = String(spellId ?? "");
  const state = incantations[key];
  if (!state) return null;
  if (sessionId && String(state.id) !== String(sessionId)) return null;

  const contributionKey = String(contributionId ?? "").trim();
  if (!contributionKey) throw new Error("Contribution d'incantation sans identifiant.");

  const previousTotal = computeTotal(state.contributions ?? {});
  const contributions = {
    ...(state.contributions ?? {}),
    [contributionKey]: normalizeNumber(qr, 0)
  };
  const rawTotal = computeTotal(contributions);
  const target = Math.max(0, normalizeNumber(state.target, 0));
  const total = cappedTotal(rawTotal, target);
  const status = derivedStatus(rawTotal, target);

  let readyQr = Number.isFinite(Number(state.readyQr)) ? Number(state.readyQr) : null;
  let readyContributionId = String(state.readyContributionId ?? "");
  if (status === "ready" && (previousTotal < target || readyContributionId === contributionKey)) {
    readyQr = normalizeNumber(qr, 0);
    readyContributionId = contributionKey;
  } else if (status !== "ready") {
    readyQr = null;
    readyContributionId = "";
  }

  incantations[key] = {
    ...state,
    contributions,
    total,
    readyQr,
    readyContributionId
  };
  await persistIncantations(actor, incantations);

  return {
    ...incantations[key],
    status
  };
}

export async function releaseSpellIncantation(actor, spellId) {
  return clearSpellIncantation(actor, spellId);
}

export function incantationChatContext(state, contributionId) {
  if (!state) return null;
  return {
    sessionId: String(state.id ?? ""),
    spellId: String(state.spellId ?? ""),
    spellName: String(state.spellName ?? ""),
    target: Math.max(0, Math.trunc(normalizeNumber(state.target, 0))),
    contributionId: String(contributionId ?? "")
  };
}

export async function cancelAllSpellIncantations(actor) {
  if (!actor) throw new Error("Personnage introuvable.");
  if (!canMutateActor(actor)) throw new Error("Vous n'avez pas l'autorisation de modifier cette incantation.");

  const incantations = currentIncantations(actor);
  const keys = Object.keys(incantations);
  if (!keys.length) return 0;

  const deletions = {};
  for (const key of keys) deletions[key] = forcedDeletion();

  await actor.update({
    flags: {
      [FLAG_SCOPE]: {
        [FLAG_KEY]: deletions
      }
    }
  });
  return keys.length;
}
