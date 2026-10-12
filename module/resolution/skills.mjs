import {
  ARKHANVAL_ARCHETYPES
} from "../config.mjs";

function normalizeSkillName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function fixedSkillForItem(item) {
  if (item?.type !== "skill") return null;
  const archetype = ARKHANVAL_ARCHETYPES.find(
    (entry) => entry.id === item.system.archetype
  );
  if (!archetype) return null;

  const byIdentifier = archetype.skills.find(
    (skill) => skill.identifier === item.system.identifier
  );
  if (byIdentifier) return byIdentifier;

  const itemName = normalizeSkillName(item.name);
  if (!itemName) return null;

  return archetype.skills.find(
    (skill) => normalizeSkillName(game.i18n.localize(skill.labelKey)) === itemName
  ) ?? null;
}

function descriptorFromFixed(actor, archetype, skill) {
  const canonicalName = normalizeSkillName(game.i18n.localize(skill.labelKey));
  const item = actor.items.find(
    (candidate) =>
      candidate.type === "skill" &&
      candidate.system.archetype === archetype.id &&
      (
        candidate.system.identifier === skill.identifier ||
        normalizeSkillName(candidate.name) === canonicalName
      )
  );

  return {
    key: item?.id ? `item:${item.id}` : `native:${skill.identifier}`,
    name: item?.name ?? game.i18n.localize(skill.labelKey),
    identifier: skill.identifier,
    archetype: archetype.id,
    archetypeLabel: game.i18n.localize(archetype.labelKey),
    rank: Number(item?.system.rank) || 0,
    xp: Number(item?.system.xp) || 0,
    itemId: item?.id ?? "",
    isCustom: false
  };
}

function descriptorFromCustom(item, archetype) {
  return {
    key: `item:${item.id}`,
    name: item.name,
    identifier: item.system.identifier ?? "",
    archetype: archetype.id,
    archetypeLabel: game.i18n.localize(archetype.labelKey),
    rank: Number(item.system.rank) || 0,
    xp: Number(item.system.xp) || 0,
    itemId: item.id,
    isCustom: true
  };
}

export function listActorSkills(actor) {
  const skillItems = actor.items.filter((item) => item.type === "skill");
  const result = [];

  for (const archetype of ARKHANVAL_ARCHETYPES) {
    const fixedIdentifiers = new Set(
      archetype.skills.map((skill) => skill.identifier)
    );

    for (const skill of archetype.skills) {
      result.push(descriptorFromFixed(actor, archetype, skill));
    }

    const customs = skillItems
      .filter((item) =>
        item.system.archetype === archetype.id &&
        !fixedIdentifiers.has(item.system.identifier)
      );

    for (const item of customs) {
      result.push(descriptorFromCustom(item, archetype));
    }
  }

  return result;
}

export function findActorSkill(actor, {
  itemId = "",
  identifier = "",
  archetype = ""
} = {}) {
  if (itemId) {
    const item = actor.items.get(itemId);
    if (item?.type === "skill") {
      const fixed = fixedSkillForItem(item);
      const family = ARKHANVAL_ARCHETYPES.find(
        (entry) => entry.id === item.system.archetype
      );
      if (!family) return null;
      return fixed
        ? descriptorFromFixed(actor, family, fixed)
        : descriptorFromCustom(item, family);
    }
  }

  return listActorSkills(actor).find(
    (skill) =>
      skill.identifier === identifier &&
      (!archetype || skill.archetype === archetype)
  ) ?? null;
}

export function isNativeSkillItem(item) {
  return Boolean(fixedSkillForItem(item));
}
