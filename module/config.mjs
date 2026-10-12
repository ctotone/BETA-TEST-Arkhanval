/**
 * Arkhanval structural configuration.
 *
 * Keep only stable system-level concepts here. Editorial content belongs in
 * Items/Compendiums, not in this file.
 */

export function buildSkillIdentifier(archetypeId, skillName) {
  const family = String(archetypeId ?? "").trim().toLowerCase();
  const slug = String(skillName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  if (!family || !slug) return "";
  return `arkhanval.skill.${family}.${slug}`;
}

export const ARKHANVAL_ARCHETYPES = Object.freeze([
  {
    id: "artisan",
    labelKey: "ARKHANVAL.Archetypes.Artisan",
    side: "left",
    skills: [
      { identifier: "arkhanval.skill.artisan.bricolage", labelKey: "ARKHANVAL.Skills.Bricolage", labelSize: "normal" },
      { identifier: "arkhanval.skill.artisan.cuisine", labelKey: "ARKHANVAL.Skills.Cuisine", labelSize: "normal" },
      { identifier: "arkhanval.skill.artisan.orfevrerie", labelKey: "ARKHANVAL.Skills.Goldsmithing", labelSize: "normal" },
      { identifier: "arkhanval.skill.artisan.travail-bois", labelKey: "ARKHANVAL.Skills.Woodworking", labelSize: "normal" },
      { identifier: "arkhanval.skill.artisan.travail-cuir", labelKey: "ARKHANVAL.Skills.Leatherworking", labelSize: "normal" },
      { identifier: "arkhanval.skill.artisan.travail-metal", labelKey: "ARKHANVAL.Skills.Metalworking", labelSize: "normal" },
      { identifier: "arkhanval.skill.artisan.travail-de-la-pierre", labelKey: "ARKHANVAL.Skills.Stoneworking", labelSize: "compact" }
    ]
  },
  {
    id: "artiste",
    labelKey: "ARKHANVAL.Archetypes.Artiste",
    side: "left",
    skills: [
      { identifier: "arkhanval.skill.artiste.chant", labelKey: "ARKHANVAL.Skills.Singing", labelSize: "normal" },
      { identifier: "arkhanval.skill.artiste.comedie", labelKey: "ARKHANVAL.Skills.Acting", labelSize: "normal" },
      { identifier: "arkhanval.skill.artiste.danse", labelKey: "ARKHANVAL.Skills.Dancing", labelSize: "normal" },
      { identifier: "arkhanval.skill.artiste.dessin-peinture", labelKey: "ARKHANVAL.Skills.DrawingPainting", labelSize: "compact" },
      { identifier: "arkhanval.skill.artiste.musique", labelKey: "ARKHANVAL.Skills.Music", labelSize: "normal" },
      { identifier: "arkhanval.skill.artiste.poesie", labelKey: "ARKHANVAL.Skills.Poetry", labelSize: "normal" },
      { identifier: "arkhanval.skill.artiste.sculpture", labelKey: "ARKHANVAL.Skills.Sculpture", labelSize: "normal" },
      { identifier: "arkhanval.skill.artiste.voie-des-arts", labelKey: "ARKHANVAL.Skills.WayOfArts", labelSize: "compact" }
    ]
  },
  {
    id: "combattant",
    labelKey: "ARKHANVAL.Archetypes.Combattant",
    side: "left",
    skills: [
      { identifier: "arkhanval.skill.combattant.armes-1-main", labelKey: "ARKHANVAL.Skills.OneHandedWeapons", labelSize: "normal" },
      { identifier: "arkhanval.skill.combattant.armes-a-deux-mains", labelKey: "ARKHANVAL.Skills.TwoHandedWeapons", labelSize: "compact" },
      { identifier: "arkhanval.skill.combattant.armes-jet", labelKey: "ARKHANVAL.Skills.ThrownWeapons", labelSize: "normal" },
      { identifier: "arkhanval.skill.combattant.armes-tir", labelKey: "ARKHANVAL.Skills.RangedWeapons", labelSize: "normal" },
      { identifier: "arkhanval.skill.combattant.art-combat", labelKey: "ARKHANVAL.Skills.CombatArt", labelSize: "normal" },
      { identifier: "arkhanval.skill.combattant.mains-nues", labelKey: "ARKHANVAL.Skills.Unarmed", labelSize: "normal" }
    ]
  },
  {
    id: "erudit",
    labelKey: "ARKHANVAL.Archetypes.Erudit",
    side: "left",
    skills: [
      { identifier: "arkhanval.skill.erudit.alchimie", labelKey: "ARKHANVAL.Skills.Alchemy", labelSize: "normal" },
      { identifier: "arkhanval.skill.erudit.botanique", labelKey: "ARKHANVAL.Skills.Botany", labelSize: "normal" },
      { identifier: "arkhanval.skill.erudit.histoires-legendes", labelKey: "ARKHANVAL.Skills.HistoryLegends", labelSize: "compact" },
      { identifier: "arkhanval.skill.erudit.lecture-ecriture", labelKey: "ARKHANVAL.Skills.ReadingWriting", labelSize: "compact" },
      { identifier: "arkhanval.skill.erudit.linguistique", labelKey: "ARKHANVAL.Skills.Linguistics", labelSize: "normal" },
      { identifier: "arkhanval.skill.erudit.medecine", labelKey: "ARKHANVAL.Skills.Medicine", labelSize: "normal" },
      { identifier: "arkhanval.skill.erudit.zoologie", labelKey: "ARKHANVAL.Skills.Zoology", labelSize: "normal" }
    ]
  },
  {
    id: "explorateur",
    labelKey: "ARKHANVAL.Archetypes.Explorateur",
    side: "right",
    skills: [
      { identifier: "arkhanval.skill.explorateur.competences-athletiques", labelKey: "ARKHANVAL.Skills.Athletics", labelSize: "tight" },
      { identifier: "arkhanval.skill.explorateur.detection-vigilance", labelKey: "ARKHANVAL.Skills.DetectionVigilance", labelSize: "compact" },
      { identifier: "arkhanval.skill.explorateur.dressage-equitation", labelKey: "ARKHANVAL.Skills.AnimalRiding", labelSize: "compact" },
      { identifier: "arkhanval.skill.explorateur.natation", labelKey: "ARKHANVAL.Skills.Swimming", labelSize: "normal" },
      { identifier: "arkhanval.skill.explorateur.navigation", labelKey: "ARKHANVAL.Skills.Navigation", labelSize: "normal" },
      { identifier: "arkhanval.skill.explorateur.survie", labelKey: "ARKHANVAL.Skills.Survival", labelSize: "normal" }
    ]
  },
  {
    id: "magicien",
    labelKey: "ARKHANVAL.Archetypes.Magicien",
    side: "right",
    skills: [
      { identifier: "arkhanval.skill.magicien.concentration", labelKey: "ARKHANVAL.Skills.Concentration", labelSize: "normal" },
      { identifier: "arkhanval.skill.magicien.metantropie", labelKey: "ARKHANVAL.Skills.Metantropie", labelSize: "normal" },
      { identifier: "arkhanval.skill.magicien.empathie-intuition", labelKey: "ARKHANVAL.Skills.EmpathyIntuition", labelSize: "compact" },
      { identifier: "arkhanval.skill.magicien.ethereve", labelKey: "ARKHANVAL.Skills.Ethereve", labelSize: "normal" },
      { identifier: "arkhanval.skill.magicien.signentropie", labelKey: "ARKHANVAL.Skills.Signentropie", labelSize: "normal" }
    ]
  },
  {
    id: "roublard",
    labelKey: "ARKHANVAL.Archetypes.Roublard",
    side: "right",
    skills: [
      { identifier: "arkhanval.skill.roublard.baratin", labelKey: "ARKHANVAL.Skills.Bluff", labelSize: "normal" },
      { identifier: "arkhanval.skill.roublard.commerce", labelKey: "ARKHANVAL.Skills.Trade", labelSize: "normal" },
      { identifier: "arkhanval.skill.roublard.connaissance-de-la-rue", labelKey: "ARKHANVAL.Skills.StreetKnowledge", labelSize: "compact" },
      { identifier: "arkhanval.skill.roublard.crochetage", labelKey: "ARKHANVAL.Skills.Lockpicking", labelSize: "normal" },
      { identifier: "arkhanval.skill.roublard.discretion", labelKey: "ARKHANVAL.Skills.Stealth", labelSize: "normal" },
      { identifier: "arkhanval.skill.roublard.jeu", labelKey: "ARKHANVAL.Skills.Gambling", labelSize: "normal" }
    ]
  },
  {
    id: "stratege",
    labelKey: "ARKHANVAL.Archetypes.Stratege",
    side: "right",
    skills: [
      { identifier: "arkhanval.skill.stratege.convaincre-argumenter", labelKey: "ARKHANVAL.Skills.Persuasion", labelSize: "tight" },
      { identifier: "arkhanval.skill.stratege.discours-eloquence", labelKey: "ARKHANVAL.Skills.SpeechEloquence", labelSize: "compact" },
      { identifier: "arkhanval.skill.stratege.gestion-organisation", labelKey: "ARKHANVAL.Skills.Management", labelSize: "tight" },
      { identifier: "arkhanval.skill.stratege.intimidation", labelKey: "ARKHANVAL.Skills.Intimidation", labelSize: "normal" },
      { identifier: "arkhanval.skill.stratege.tactique-strategie", labelKey: "ARKHANVAL.Skills.TacticsStrategy", labelSize: "compact" }
    ]
  }
]);

export const ARKHANVAL_ARCHETYPE_IDS = Object.freeze(
  ARKHANVAL_ARCHETYPES.map((archetype) => archetype.id)
);

const MAGIC_SKILL_LABEL_KEYS = Object.freeze([
  "ARKHANVAL.Skills.Metantropie",
  "ARKHANVAL.Skills.Ethereve",
  "ARKHANVAL.Skills.WayOfArts",
  "ARKHANVAL.Skills.Signentropie",
  "ARKHANVAL.Skills.Concentration"
]);

export const ARKHANVAL_MAGIC_SKILLS = Object.freeze(
  MAGIC_SKILL_LABEL_KEYS
    .map((labelKey) => ARKHANVAL_ARCHETYPES
      .flatMap((archetype) => archetype.skills)
      .find((skill) => skill.labelKey === labelKey))
    .filter(Boolean)
);

export const ARKHANVAL_ARKS = Object.freeze([
  { id: "arksonge", label: "Arksonge" },
  { id: "arkentropie", label: "Arkentropie" },
  { id: "arkoeur", label: "Arkœur" }
]);

export const ARKHANVAL_COMBAT_TECHNIQUES = Object.freeze([
  { id: "none", labelKey: "ARKHANVAL.CombatTechniques.None", defaultFdModifier: 0 },
  { id: "feinte", labelKey: "ARKHANVAL.CombatTechniques.Feinte", defaultFdModifier: 1 },
  { id: "mode-agressif", labelKey: "ARKHANVAL.CombatTechniques.AggressiveMode", defaultFdModifier: 2 },
  { id: "posture-defensive", labelKey: "ARKHANVAL.CombatTechniques.DefensivePosture", defaultFdModifier: -1 },
  { id: "viser", labelKey: "ARKHANVAL.CombatTechniques.Aim", defaultFdModifier: -2 },
  { id: "localiser", labelKey: "ARKHANVAL.CombatTechniques.Localize", defaultFdModifier: 1 },
  { id: "prise-mains-nues", labelKey: "ARKHANVAL.CombatTechniques.UnarmedGrapple", defaultFdModifier: 0 },
  { id: "mode-tactique", labelKey: "ARKHANVAL.CombatTechniques.TacticalMode", defaultFdModifier: 1 },
  { id: "coups-speciaux", labelKey: "ARKHANVAL.CombatTechniques.SpecialStrikes", defaultFdModifier: 2 }
]);

/**
 * Livre des règles final, chapitre combat: capacity by Arkœur rank.
 */
export const WOUND_CAPACITY_BY_ARKOEUR = Object.freeze({
  1: Object.freeze({ light: 3, serious: 2, critical: 1 }),
  2: Object.freeze({ light: 4, serious: 2, critical: 1 }),
  3: Object.freeze({ light: 4, serious: 2, critical: 2 }),
  4: Object.freeze({ light: 4, serious: 3, critical: 2 }),
  5: Object.freeze({ light: 5, serious: 3, critical: 2 }),
  6: Object.freeze({ light: 5, serious: 3, critical: 3 }),
  7: Object.freeze({ light: 5, serious: 4, critical: 3 }),
  8: Object.freeze({ light: 6, serious: 4, critical: 3 }),
  9: Object.freeze({ light: 6, serious: 4, critical: 4 }),
  10: Object.freeze({ light: 6, serious: 5, critical: 5 })
});

export const WOUND_SEVERITIES = Object.freeze(["light", "serious", "critical"]);

export const ITEM_TYPES = Object.freeze([
  "weapon",
  "armor",
  "book",
  "skill",
  "equipment",
  "wound",
  "people",
  "spell",
  "specialty",
  "state",
  "work",
  "trait"
]);
