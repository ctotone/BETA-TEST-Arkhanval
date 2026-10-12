import { rescoreResolvedRollWithFdModifier } from "../resolution/engine.mjs";
import { ARKHANVAL_COMBAT_TECHNIQUES } from "../config.mjs";
import { weaponFamilyFromTags, weaponUsageTagForSkill } from "../rules/catalog.mjs";
import { combatIncantationSnapshot } from "../magic/incantation.mjs";

const DIRECT_COMBAT_SKILLS = Object.freeze(new Set([
  "arkhanval.skill.combattant.armes-1-main",
  "arkhanval.skill.combattant.armes-a-deux-mains",
  "arkhanval.skill.combattant.armes-jet",
  "arkhanval.skill.combattant.armes-tir",
  "arkhanval.skill.combattant.mains-nues"
]));

function actorItems(actor) {
  if (!actor?.items) return [];
  if (Array.isArray(actor.items)) return actor.items;
  if (typeof actor.items.filter === "function") return actor.items.filter(() => true);
  if (typeof actor.items.values === "function") return Array.from(actor.items.values());
  return [];
}

function itemTags(item) {
  return new Set(Array.from(item?.system?.tags ?? []).map((tag) => String(tag)));
}

function weaponSnapshot(item, compatibleTag) {
  const tags = Array.from(itemTags(item));
  const family = weaponFamilyFromTags(tags);
  return {
    id: String(item?.id ?? ""),
    uuid: String(item?.uuid ?? ""),
    name: String(item?.name ?? "Arme"),
    img: String(item?.img ?? ""),
    damage: String(item?.system?.damage ?? "").trim(),
    armorPenetration: Math.max(0, Math.trunc(Number(item?.system?.armorPenetration) || 0)),
    tags,
    family,
    compatible: compatibleTag ? tags.includes(compatibleTag) : false
  };
}

export function actorCombatWeapons(actor, skillIdentifier) {
  const compatibleTag = weaponUsageTagForSkill(skillIdentifier);
  return actorItems(actor)
    .filter((item) => item?.type === "weapon")
    .map((item) => weaponSnapshot(item, compatibleTag))
    .sort((left, right) =>
      (left.family.order - right.family.order) ||
      left.name.localeCompare(right.name, "fr", { sensitivity: "base" })
    );
}

export function defaultCombatWeaponId(actor, skillIdentifier) {
  if (String(skillIdentifier ?? "") === "arkhanval.skill.combattant.mains-nues") return "";
  const compatible = actorCombatWeapons(actor, skillIdentifier)
    .filter((weapon) => weapon.compatible);
  return compatible.length === 1 ? compatible[0].id : null;
}

export function isDirectCombatSkill(skillIdentifier) {
  return DIRECT_COMBAT_SKILLS.has(String(skillIdentifier ?? ""));
}

export function equippedProtection(actor) {
  return actorItems(actor)
    .filter((item) => item?.type === "armor" && item.system?.equipped)
    .reduce(
      (total, item) => total + (Number(item.system?.protection?.current) || 0),
      0
    );
}

export function equippedProtectionTags(actor) {
  return actorItems(actor)
    .filter((item) => item?.type === "armor" && item.system?.equipped)
    .flatMap((item) => Array.from(item?.system?.tags ?? []).map(String));
}

function combatTechniqueSnapshot(actor) {
  const id = String(actor?.system?.combat?.technique ?? "none") || "none";
  const definition = ARKHANVAL_COMBAT_TECHNIQUES.find((entry) => entry.id === id)
    ?? ARKHANVAL_COMBAT_TECHNIQUES[0];
  return {
    id: String(definition?.id ?? "none"),
    label: game.i18n.localize(definition?.labelKey ?? "ARKHANVAL.CombatTechniques.None"),
    defaultFdModifier: Number(definition?.defaultFdModifier) || 0
  };
}

function targetActorFromToken(token) {
  return token?.actor ?? token?.document?.actor ?? null;
}

function targetKey({ actorUuid = "", tokenId = "" } = {}) {
  return String(tokenId || actorUuid || "");
}

function actorSnapshot(actor, {
  tokenId = "",
  tokenImg = "",
  sceneId = "",
  actorId = ""
} = {}) {
  if (!actor) return null;
  const snapshot = {
    actorUuid: String(actor.uuid ?? ""),
    actorId: String(actorId || actor.id || ""),
    sceneId: String(sceneId ?? ""),
    tokenId: String(tokenId ?? ""),
    tokenImg: String(
      tokenImg ||
      actor?.token?.texture?.src ||
      actor?.prototypeToken?.texture?.src ||
      actor?.img ||
      ""
    ),
    name: String(actor.name ?? "Adversaire"),
    protection: equippedProtection(actor),
    incantation: combatIncantationSnapshot(actor)
  };
  snapshot.key = targetKey(snapshot);
  return snapshot;
}

function targetTokenImage(token, actor) {
  return String(
    token?.document?.texture?.src ??
    token?.texture?.src ??
    actor?.img ??
    ""
  );
}

function targetSnapshotFromToken(token) {
  const actor = targetActorFromToken(token);
  if (!actor) return null;
  const document = token?.document ?? token ?? null;
  return actorSnapshot(actor, {
    actorId: document?.actorId ?? actor?.id ?? "",
    sceneId: document?.parent?.id ?? globalThis.canvas?.scene?.id ?? "",
    tokenId: token?.id ?? document?.id ?? "",
    tokenImg: targetTokenImage(token, actor)
  });
}

/**
 * Snapshot only objective combat context known at roll time.
 * Target QR values are deliberately absent: each defender must provide a real
 * roll, accept QR 0, or let the GM enter a manual QR.
 */
export function captureCombatRollContext(actor, skillIdentifier, {
  targets = null
} = {}) {
  if (!isDirectCombatSkill(skillIdentifier)) return null;

  const sourceTargets = targets ?? game.user?.targets ?? [];
  const selected = Array.from(sourceTargets ?? []);
  const attacker = actorSnapshot(actor);
  const weapons = actorCombatWeapons(actor, skillIdentifier);
  const defaultWeaponId = defaultCombatWeaponId(actor, skillIdentifier);
  const targetSnapshots = selected
    .map(targetSnapshotFromToken)
    .filter(Boolean);

  const common = {
    enabled: true,
    skillIdentifier: String(skillIdentifier ?? ""),
    attacker,
    weapons,
    defaultWeaponId,
    technique: combatTechniqueSnapshot(actor),
    targets: targetSnapshots,
    targetCount: selected.length
  };

  if (selected.length === 0) {
    return {
      ...common,
      targetState: "none",
      target: null
    };
  }

  if (selected.length === 1) {
    return {
      ...common,
      targetState: targetSnapshots.length === 1 ? "single" : "invalid",
      target: targetSnapshots[0] ?? null
    };
  }

  return {
    ...common,
    targetState: "multiple",
    target: null
  };
}

export function resolveCombatConfrontation(attackerQr, defenderQr) {
  const attacker = Number(attackerQr);
  const defender = Number(defenderQr);
  if (!Number.isFinite(attacker) || !Number.isFinite(defender)) {
    throw new Error("Les deux QR doivent être numériques.");
  }

  const attackerMaladroit = attacker < 0;
  const defenderMaladroit = defender < 0;

  if (attacker === defender) {
    return {
      outcome: "tie",
      winner: null,
      difference: 0,
      hit: false,
      attackerMaladroit,
      defenderMaladroit
    };
  }

  const attackerWins = attacker > defender;
  const winningQr = attackerWins ? attacker : defender;
  const difference = Math.abs(attacker - defender);
  const hit = winningQr > 0;

  return {
    outcome: hit ? "hit" : "no-hit",
    winner: hit ? (attackerWins ? "attacker" : "defender") : null,
    difference,
    hit,
    attackerMaladroit,
    defenderMaladroit
  };
}


export function calculateCombatDamageTotal({
  qrDifference = 0,
  baseDie = 0,
  weapon = 0,
  extraDice = 0,
  specialtyFlat = 0,
  protection = 0
} = {}) {
  const rawTotal = (
    (Number(qrDifference) || 0) +
    (Number(baseDie) || 0) +
    (Number(weapon) || 0) +
    (Number(extraDice) || 0) +
    (Number(specialtyFlat) || 0) -
    Math.max(0, Number(protection) || 0)
  );

  return {
    rawTotal,
    total: Math.max(0, Math.trunc(rawTotal))
  };
}

export function combatAttackerResultForResponse(attackResult, response = null) {
  const modifier = Number(response?.attackerFdModifier) || 0;
  if (!modifier) return attackResult;
  return rescoreResolvedRollWithFdModifier(attackResult, modifier);
}

export function combatAttackerQrForResponse(attackResult, response = null) {
  const result = combatAttackerResultForResponse(attackResult, response);
  const qr = Number(result?.qr);
  return Number.isFinite(qr) ? qr : 0;
}
