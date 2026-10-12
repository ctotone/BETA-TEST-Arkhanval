import { ARKHANVAL_ARCHETYPES } from "../config.mjs";

/**
 * Rule vocabulary.
 *
 * This is deliberately small: it describes concrete modifiers already needed
 * by Arkhanval specialties without trying to become a generic effects engine.
 */
export const ARKHANVAL_RULE_EFFECTS = Object.freeze([
  Object.freeze({ id: "roll.fd", label: "Modifier le FD", valueType: "integer", example: "-2" }),
  Object.freeze({ id: "roll.extraDie", label: "Ajouter des dés au jet", valueType: "dice", example: "1d10 ou @skill.rankd8" }),
  Object.freeze({ id: "roll.diceMultiplier", label: "Multiplier la réserve de dés", valueType: "number", example: "0.5" }),
  Object.freeze({ id: "roll.dieUpgrade", label: "Remplacer des d10 par des d12", valueType: "integer", example: "1" }),
  Object.freeze({ id: "roll.repeatKeep", label: "Répéter le jet et garder un résultat", valueType: "integer", example: "2" }),
  Object.freeze({ id: "roll.criticalFailureThreshold", label: "Élargir le seuil d’échec critique", valueType: "integer", example: "2 ou 3" }),
  Object.freeze({ id: "roll.reroll", label: "Accorder des relances de dés", valueType: "integer", example: "1" }),
  Object.freeze({ id: "roll.rerollCritical", label: "Relancer un échec critique", valueType: "integer", example: "1" }),
  Object.freeze({ id: "roll.autoSuccess", label: "Réussite automatique", valueType: "integer", example: "1" }),
  Object.freeze({ id: "roll.note", label: "Afficher un rappel contextuel", valueType: "text", example: "Texte du rappel" }),
  Object.freeze({ id: "roll.ignoreCritical", label: "Ignorer des échecs critiques", valueType: "integer", example: "1" }),
  Object.freeze({ id: "skill.rankFlat", label: "Modifier temporairement le rang", valueType: "formula", example: "+1" }),
  Object.freeze({ id: "damage.flat", label: "Modifier les dégâts", valueType: "formula", example: "+2 ou @skill.rank" }),
  Object.freeze({ id: "damage.extraDie", label: "Ajouter des dés de dégâts", valueType: "dice", example: "1d8" }),
  Object.freeze({ id: "damage.ignoreProtection", label: "Ignorer la protection", valueType: "text", example: "all" }),
  Object.freeze({ id: "protection.flat", label: "Modifier la protection", valueType: "formula", example: "+2 ou @combatArt.rank" }),
  Object.freeze({ id: "resistance.fd", label: "Modifier le FD d’un jet de résistance", valueType: "integer", example: "-2" }),
  Object.freeze({ id: "task.requiredSuccesses", label: "Modifier les réussites requises", valueType: "integer", example: "-2" }),
  Object.freeze({ id: "progression.skillCostMultiplier", label: "Multiplier le coût XP d’une compétence", valueType: "number", example: "0.5" }),
  Object.freeze({ id: "progression.skillUsePrimaryCost", label: "Utiliser le barème principal pour une compétence", valueType: "integer", example: "1" }),
  Object.freeze({ id: "progression.specialtyCostMultiplier", label: "Multiplier le coût XP d’une spécialité", valueType: "number", example: "0.5" }),
  Object.freeze({ id: "progression.specialtyCostFlat", label: "Modifier le coût XP d’une spécialité", valueType: "integer", example: "+10" }),
  Object.freeze({ id: "combat.usesPerRound", label: "Usages autorisés par round", valueType: "integer", example: "2" }),
  Object.freeze({ id: "combat.defenseOnly", label: "Combat — défense uniquement", valueType: "integer", example: "1" }),
  Object.freeze({ id: "resource.flat", label: "Modifier une ressource effective", valueType: "formula", example: "+2" }),
  Object.freeze({ id: "wound.inflict", label: "Infliger directement une blessure", valueType: "text", example: "serious" }),
  Object.freeze({ id: "wound.downgrade", label: "Rétrograder une blessure", valueType: "integer", example: "1" })
]);

export const ARKHANVAL_SYSTEM_VARIABLES = Object.freeze([
  Object.freeze({ id: "@skill.rank", label: "Rang de la compétence utilisée pour l’action" }),
  Object.freeze({ id: "@combatArt.rank", label: "Rang en Art du combat" }),
  Object.freeze({ id: "@arksonge.rank", label: "Rang d’Arksonge" }),
  Object.freeze({ id: "@arkentropie.rank", label: "Rang d’Arkentropie" }),
  Object.freeze({ id: "@arkoeur.rank", label: "Rang d’Arkœur" }),
  Object.freeze({ id: "@arksonge.circles", label: "Cercles actuels d’Arksonge" }),
  Object.freeze({ id: "@arkentropie.circles", label: "Cercles actuels d’Arkentropie" }),
  Object.freeze({ id: "@arkoeur.circles", label: "Cercles actuels d’Arkœur" }),
  Object.freeze({ id: "@parameter.<clé>", label: "Valeur brute d’un paramètre de la source de règle" }),
  Object.freeze({ id: "@parameter.<clé>.rank", label: "Rang actuel de la compétence stockée dans un paramètre de la source" })
]);

/**
 * Canonical relation between martial skill selectors and weapon usage tags.
 *
 * This relation is shared by combat selection and weapon-sheet rule previews:
 * a specialty targeting a combat skill therefore also applies to any weapon
 * whose usage tags declare compatibility with that skill.
 */
export const ARKHANVAL_COMBAT_SKILL_WEAPON_TAG = Object.freeze({
  "arkhanval.skill.combattant.armes-1-main": "combat.one-handed",
  "arkhanval.skill.combattant.armes-a-deux-mains": "combat.two-handed",
  "arkhanval.skill.combattant.armes-jet": "combat.thrown",
  "arkhanval.skill.combattant.armes-tir": "combat.ranged",
  "arkhanval.skill.combattant.mains-nues": "combat.unarmed"
});

export function weaponUsageTagForSkill(skillIdentifier) {
  return ARKHANVAL_COMBAT_SKILL_WEAPON_TAG[String(skillIdentifier ?? "")] ?? "";
}

export function combatSkillIdentifiersForWeaponTags(tags = []) {
  const ownedTags = new Set(Array.from(tags ?? []).map(String));
  return Object.entries(ARKHANVAL_COMBAT_SKILL_WEAPON_TAG)
    .filter(([, tag]) => ownedTags.has(tag))
    .map(([skillIdentifier]) => skillIdentifier);
}


export const ARKHANVAL_TAG_CATALOG = Object.freeze([
  // Combat usage: these mirror the canonical martial skills and are useful on weapons.
  Object.freeze({ id: "combat.one-handed", label: "Combat : Arme à une main", itemTypes: ["weapon"] }),
  Object.freeze({ id: "combat.two-handed", label: "Combat : Arme à deux mains", itemTypes: ["weapon"] }),
  Object.freeze({ id: "combat.thrown", label: "Combat : Arme de lancer", itemTypes: ["weapon"] }),
  Object.freeze({ id: "combat.ranged", label: "Combat : Arme de tir", itemTypes: ["weapon"] }),
  Object.freeze({ id: "combat.unarmed", label: "Combat : Mains nues", itemTypes: ["weapon"] }),

  // Families explicitly used by the rules for weapon specialties.
  Object.freeze({ id: "weapon.family.one-handed-sword", label: "Famille : Épées à une main", itemTypes: ["weapon"] }),
  Object.freeze({ id: "weapon.family.blunt", label: "Famille : Armes contondantes", itemTypes: ["weapon"] }),
  Object.freeze({ id: "weapon.family.short-blade", label: "Famille : Lames courtes", itemTypes: ["weapon"] }),
  Object.freeze({ id: "weapon.family.polearm", label: "Famille : Armes d’hast", itemTypes: ["weapon"] }),
  Object.freeze({ id: "weapon.family.two-handed-sword", label: "Famille : Épées à deux mains", itemTypes: ["weapon"] }),
  Object.freeze({ id: "weapon.family.axe", label: "Famille : Haches", itemTypes: ["weapon"] }),
  Object.freeze({ id: "weapon.family.thrown", label: "Famille : Armes de jet", itemTypes: ["weapon"] }),
  Object.freeze({ id: "weapon.family.bow", label: "Famille : Arcs", itemTypes: ["weapon"] }),
  Object.freeze({ id: "weapon.family.crossbow", label: "Famille : Arbalètes", itemTypes: ["weapon"] }),
  Object.freeze({ id: "weapon.family.firearm", label: "Famille : Armes à poudre", itemTypes: ["weapon"] }),
  Object.freeze({ id: "weapon.defensive", label: "Arme défensive", itemTypes: ["weapon"] }),
  Object.freeze({ id: "weapon.shield", label: "Bouclier", itemTypes: ["weapon"] }),

  // Damage nature is intentionally descriptive: some wound effects ask the GM to use it.
  Object.freeze({ id: "damage.slashing", label: "Dégâts : Tranchants", itemTypes: ["weapon"] }),
  Object.freeze({ id: "damage.piercing", label: "Dégâts : Perforants", itemTypes: ["weapon"] }),
  Object.freeze({ id: "damage.bludgeoning", label: "Dégâts : Contondants", itemTypes: ["weapon"] }),

  // Armor location/type distinctions used by the equipment chapter.
  Object.freeze({ id: "armor.body", label: "Corps", itemTypes: ["armor"] }),
  Object.freeze({ id: "armor.helmet", label: "Casque", itemTypes: ["armor"] }),
  Object.freeze({ id: "armor.shield", label: "Bouclier", itemTypes: ["armor"] }),

  // Magic skills/sources appearing in the final spell corpus.
  Object.freeze({ id: "magic.metantropie", label: "Magie : Métantropie", itemTypes: ["spell"] }),
  Object.freeze({ id: "magic.ethereve", label: "Magie : Éthérêve", itemTypes: ["spell"] }),
  Object.freeze({ id: "magic.signentropie", label: "Magie : Signentropie", itemTypes: ["spell"] }),
  Object.freeze({ id: "magic.voie-des-arts", label: "Magie : Voie des arts", itemTypes: ["spell"] })
]);


/**
 * Display families for owned weapons.
 *
 * They are derived from the existing semantic tags instead of adding another
 * persisted field to weapon Items. The first matching family wins, then combat
 * usage tags provide a sensible fallback for custom weapons.
 */
export const ARKHANVAL_WEAPON_FAMILIES = Object.freeze([
  // Explicit families are kept alphabetically for a predictable GM-facing catalogue.
  Object.freeze({ id: "crossbow", label: "Arbalètes", tags: ["weapon.family.crossbow"] }),
  Object.freeze({ id: "bow", label: "Arcs", tags: ["weapon.family.bow"] }),
  Object.freeze({ id: "firearm", label: "Armes à poudre", tags: ["weapon.family.firearm"] }),
  Object.freeze({ id: "blunt", label: "Armes contondantes", tags: ["weapon.family.blunt"] }),
  Object.freeze({ id: "polearm", label: "Armes d’hast", tags: ["weapon.family.polearm"] }),
  Object.freeze({ id: "thrown-family", label: "Armes de jet", tags: ["weapon.family.thrown"] }),
  Object.freeze({ id: "two-handed-sword", label: "Épées à deux mains", tags: ["weapon.family.two-handed-sword"] }),
  Object.freeze({ id: "one-handed-sword", label: "Épées à une main", tags: ["weapon.family.one-handed-sword"] }),
  Object.freeze({ id: "axe", label: "Haches", tags: ["weapon.family.axe"] }),
  Object.freeze({ id: "short-blade", label: "Lames courtes", tags: ["weapon.family.short-blade"] }),
  Object.freeze({ id: "defensive", label: "Armes défensives", tags: ["weapon.defensive", "weapon.shield"] }),
  Object.freeze({ id: "one-handed", label: "Autres armes à une main", tags: ["combat.one-handed"] }),
  Object.freeze({ id: "two-handed", label: "Autres armes à deux mains", tags: ["combat.two-handed"] }),
  Object.freeze({ id: "thrown", label: "Armes de jet", tags: ["combat.thrown"] }),
  Object.freeze({ id: "ranged", label: "Armes de tir", tags: ["combat.ranged"] }),
  Object.freeze({ id: "unarmed", label: "Armes de mains nues", tags: ["combat.unarmed"] }),
  Object.freeze({ id: "other", label: "Autres armes", tags: [] })
]);

export function weaponFamilyFromTags(tags = []) {
  const orderedTags = Array.from(tags ?? []).map((tag) => String(tag));
  const ownedTags = new Set(orderedTags);
  const fallback = ARKHANVAL_WEAPON_FAMILIES.at(-1);

  // Explicit weapon.family.* tags preserve their persisted order. This lets
  // custom content declare several families while keeping the first selected
  // family as the single display group used by sheets and combat pickers.
  for (const tag of orderedTags.filter((entry) => entry.startsWith("weapon.family."))) {
    const index = ARKHANVAL_WEAPON_FAMILIES.findIndex((family) => family.tags.includes(tag));
    if (index >= 0) {
      const family = ARKHANVAL_WEAPON_FAMILIES[index];
      return { id: family.id, label: family.label, order: index };
    }
  }

  // Older/custom weapons without an explicit family keep the existing
  // semantic fallbacks (defensive, combat usage, etc.).
  for (let index = 0; index < ARKHANVAL_WEAPON_FAMILIES.length - 1; index += 1) {
    const family = ARKHANVAL_WEAPON_FAMILIES[index];
    if (family.tags.some((tag) => ownedTags.has(tag))) {
      return { id: family.id, label: family.label, order: index };
    }
  }

  return {
    id: fallback.id,
    label: fallback.label,
    order: ARKHANVAL_WEAPON_FAMILIES.length - 1
  };
}

export const ARKHANVAL_RULE_CONTEXTS = Object.freeze([
  Object.freeze({ selector: "any", label: "Toutes les actions compatibles" }),
  Object.freeze({ selector: "combat", label: "Combat — général" }),
  Object.freeze({ selector: "combat.melee", label: "Combat — mêlée" }),
  Object.freeze({ selector: "combat.ranged", label: "Combat — tir" }),
  Object.freeze({ selector: "combat.thrown", label: "Combat — lancer" }),
  Object.freeze({ selector: "combat.unarmed", label: "Combat — mains nues" }),
  Object.freeze({ selector: "combat.defensive-weapon", label: "Combat — arme défensive" }),
  Object.freeze({ selector: "magic", label: "Magie — général" }),
  Object.freeze({ selector: "resistance.magic", label: "Résistance — magie" }),
  Object.freeze({ selector: "book", label: "Lecture / apprentissage" })
]);

export function ruleEffect(effectId) {
  return ARKHANVAL_RULE_EFFECTS.find((entry) => entry.id === effectId) ?? null;
}

export function knownTag(tagId) {
  return ARKHANVAL_TAG_CATALOG.find((entry) => entry.id === tagId) ?? null;
}

export function tagOptionsForItemType(itemType) {
  return ARKHANVAL_TAG_CATALOG.filter((entry) => entry.itemTypes.includes(itemType));
}

export function normalizeCustomTag(value) {
  const raw = String(value ?? "")
    .trim()
    .replace(/^tag:/i, "")
    .replace(/^custom\./i, "");
  if (!raw) return "";

  const slug = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return slug ? `custom.${slug}` : "";
}

export function customTagLabel(tag) {
  const value = String(tag ?? "");
  return value.startsWith("custom.") ? value.slice("custom.".length) : value;
}

export function buildRuleSelectorOptions() {
  const options = ARKHANVAL_RULE_CONTEXTS.map((entry) => ({
    value: entry.selector,
    label: entry.label,
    group: "Contexte"
  }));

  for (const archetype of ARKHANVAL_ARCHETYPES) {
    for (const skill of archetype.skills) {
      options.push({
        value: `skill:${skill.identifier}`,
        label: `Compétence — ${game.i18n.localize(archetype.labelKey)} : ${game.i18n.localize(skill.labelKey)}`,
        group: "Compétence"
      });
    }
  }

  for (const tag of ARKHANVAL_TAG_CATALOG) {
    options.push({
      value: `tag:${tag.id}`,
      label: `Tag — ${tag.label}`,
      group: "Tag système"
    });
  }

  for (const resource of [
    ["ark:arksonge.rank", "Ressource — Arksonge (rang)"],
    ["ark:arkentropie.rank", "Ressource — Arkentropie (rang)"],
    ["ark:arkoeur.rank", "Ressource — Arkœur (rang)"],
    ["ark:arksonge.circles", "Ressource — Arksonge (cercles)"],
    ["ark:arkentropie.circles", "Ressource — Arkentropie (cercles)"],
    ["ark:arkoeur.circles", "Ressource — Arkœur (cercles)"]
  ]) {
    options.push({
      value: resource[0],
      label: resource[1],
      group: "Ressource"
    });
  }

  options.push(
    {
      value: "__parameterSkill__",
      label: "Paramètre — compétence…",
      group: "Paramétré"
    },
    {
      value: "__parameterTag__",
      label: "Paramètre — tag / famille…",
      group: "Paramétré"
    }
  );

  return options;
}

export function selectorUsesCustomTag(selector) {
  if (!String(selector ?? "").startsWith("tag:")) return false;
  const tag = String(selector).slice(4);
  return !knownTag(tag);
}

export function selectorCustomTagLabel(selector) {
  if (!selectorUsesCustomTag(selector)) return "";
  return customTagLabel(String(selector).slice(4));
}

export function buildCustomTagSelector(value) {
  const tag = normalizeCustomTag(value);
  return tag ? `tag:${tag}` : "";
}
