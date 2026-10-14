import { ARKHANVAL_ARCHETYPES } from "./config.mjs";
import { CREATION_SPECIALTIES, getCreationSpecialty } from "./creation-specialties.mjs";

const CREATION_FLAG_SCOPE = "arkhanval";
const CREATION_FLAG_KEY = "creation";
const CREATION_STATE_VERSION = 14;

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const CREATION_APPS = new Map();

const CREATION_STEP_ORDER = Object.freeze(["profile", "people", "archetypes", "skills", "summary"]);

const CREATION_STEP_LABELS = Object.freeze({
  profile: "Profil",
  people: "1. Peuple & Arks",
  archetypes: "2. Archétypes",
  skills: "3. Compétences",
  summary: "Récapitulatif"
});

function stepIndex(step) {
  return CREATION_STEP_ORDER.indexOf(step);
}

function earlierStep(first, second) {
  if (!first) return second;
  if (!second) return first;
  return stepIndex(first) <= stepIndex(second) ? first : second;
}

function normalizeCreationState(raw) {
  const base = {
    version: CREATION_STATE_VERSION,
    status: "entry",
    step: "entry",
    profile: null,
    people: null,
    arks: null,
    archetypes: [],
    skills: {
      ranks: {},
      specialties: [],
      activeArchetype: "",
      pane: "skills",
      specialtyView: "primary"
    },
    furthestStep: "profile",
    invalidFrom: null
  };

  const state = foundry.utils.mergeObject(base, raw ?? {}, {
    inplace: false,
    insertKeys: true,
    overwrite: true
  });

  if (state.status === "guided" && stepIndex(state.step) >= 0) {
    const currentIndex = stepIndex(state.step);
    const furthestIndex = stepIndex(state.furthestStep);
    if (furthestIndex < currentIndex) state.furthestStep = state.step;
  }

  const skillState = state.skills && typeof state.skills === "object"
    ? state.skills
    : {};
  const normalizedRanks = {};
  if (skillState.ranks && typeof skillState.ranks === "object") {
    for (const [key, value] of Object.entries(skillState.ranks)) {
      const safeKey = key.startsWith("arkhanval.skill.")
        ? skillRankStorageKey(key)
        : key;
      normalizedRanks[safeKey] = value;
    }
  }

  state.skills = {
    ranks: normalizedRanks,
    specialties: Array.isArray(skillState.specialties)
      ? skillState.specialties.filter((id) => typeof id === "string")
      : [],
    activeArchetype: typeof skillState.activeArchetype === "string"
      ? skillState.activeArchetype
      : "",
    pane: ["skills", "specialties"].includes(skillState.pane)
      ? skillState.pane
      : "skills",
    specialtyView: typeof skillState.specialtyView === "string"
      ? skillState.specialtyView
      : "primary"
  };

  state.version = CREATION_STATE_VERSION;
  return state;
}

function isStepNavigable(state, step) {
  const targetIndex = stepIndex(step);
  if (targetIndex < 0) return false;

  const furthestIndex = stepIndex(state.furthestStep);
  if (targetIndex > furthestIndex) return false;

  if (!state.invalidFrom) return true;
  return targetIndex <= stepIndex(state.invalidFrom);
}

function markStepReached(state, step) {
  if (stepIndex(step) > stepIndex(state.furthestStep)) return step;
  return state.furthestStep;
}



const CREATION_ARKS = Object.freeze([
  Object.freeze({
    id: "arkoeur",
    label: "Arkœur",
    image: "systems/arkhanval/assets/icones/ark/arkoeur.webp"
  }),
  Object.freeze({
    id: "arkentropie",
    label: "Arkentropie",
    image: "systems/arkhanval/assets/icones/ark/arkentropie.webp"
  }),
  Object.freeze({
    id: "arksonge",
    label: "Arksonge",
    image: "systems/arkhanval/assets/icones/ark/arksonge.webp"
  })
]);

const PEOPLE_ARK_RULES = Object.freeze({
  arkheigryphes: Object.freeze({
    mode: "fixed",
    base: Object.freeze({ arkoeur: 4, arkentropie: 0, arksonge: 0 })
  }),
  celminoens: Object.freeze({
    mode: "fixed",
    base: Object.freeze({ arkoeur: 3, arkentropie: 0, arksonge: 1 })
  }),
  deskaleides: Object.freeze({
    mode: "fixed",
    base: Object.freeze({ arkoeur: 2, arkentropie: 2, arksonge: 1 })
  }),
  egares: Object.freeze({
    mode: "manual-mj"
  }),
  elfiniens: Object.freeze({
    mode: "elfinien-split"
  }),
  essilfides: Object.freeze({
    mode: "fixed",
    base: Object.freeze({ arkoeur: 4, arkentropie: 0, arksonge: 0 })
  }),
  humains: Object.freeze({
    mode: "human-free"
  }),
  krommholds: Object.freeze({
    mode: "krommhold-range"
  }),
  orcaliens: Object.freeze({
    mode: "fixed",
    base: Object.freeze({ arkoeur: 4, arkentropie: 0, arksonge: 0 })
  }),
  paleciens: Object.freeze({
    mode: "palecien-origin"
  }),
  telluriens: Object.freeze({
    mode: "fixed",
    base: Object.freeze({ arkoeur: 4, arkentropie: 0, arksonge: 0 })
  }),
  therianthropes: Object.freeze({
    mode: "therianthrope-manual"
  }),
  wircamens: Object.freeze({
    mode: "fixed",
    base: Object.freeze({ arkoeur: 2, arkentropie: 2, arksonge: 0 })
  })
});

function emptyArkRanks() {
  return { arkoeur: 0, arkentropie: 0, arksonge: 0 };
}

function emptyArkCircles() {
  return { arkoeur: 0, arkentropie: 0, arksonge: 0 };
}

function defaultArkSetup(peopleId) {
  return {
    peopleId,
    choice: null,
    natureArk: null,
    manualRanks: emptyArkRanks(),
    circles: emptyArkCircles(),
    mjConfirmed: false,
    rollsAcknowledged: false
  };
}

function arkRuleFor(peopleId) {
  return PEOPLE_ARK_RULES[peopleId] ?? null;
}

function arkRanksFor(peopleId, setup) {
  const rule = arkRuleFor(peopleId);
  if (!rule) return emptyArkRanks();

  switch (rule.mode) {
    case "fixed":
      return { ...rule.base };

    case "human-free": {
      const ranks = { arkoeur: 2, arkentropie: 0, arksonge: 0 };
      if (CREATION_ARKS.some((entry) => entry.id === setup?.choice)) {
        ranks[setup.choice] += 1;
      }
      return ranks;
    }

    case "elfinien-split": {
      const ranks = { arkoeur: 2, arkentropie: 0, arksonge: 0 };
      if (setup?.choice === "entropie2") ranks.arkentropie = 2;
      if (setup?.choice === "split") {
        ranks.arkentropie = 1;
        ranks.arksonge = 1;
      }
      if (setup?.choice === "songe2") ranks.arksonge = 2;
      return ranks;
    }

    case "krommhold-range":
      return {
        arkoeur: [2, 3, 4].includes(Number(setup?.choice)) ? Number(setup.choice) : 0,
        arkentropie: 0,
        arksonge: 0
      };

    case "palecien-origin":
      return {
        arkoeur: 3,
        arkentropie: setup?.choice === "aquatic" ? 1 : 0,
        arksonge: setup?.choice === "surface" ? 1 : 0
      };

    case "manual-mj":
    case "therianthrope-manual":
      return Object.fromEntries(
        CREATION_ARKS.map((ark) => [
          ark.id,
          Math.max(0, Math.min(10, Number(setup?.manualRanks?.[ark.id]) || 0))
        ])
      );

    default:
      return emptyArkRanks();
  }
}

function arkChoiceComplete(peopleId, setup) {
  const rule = arkRuleFor(peopleId);
  if (!rule) return false;

  switch (rule.mode) {
    case "fixed":
      return true;
    case "human-free":
      return CREATION_ARKS.some((entry) => entry.id === setup?.choice);
    case "elfinien-split":
      return ["entropie2", "split", "songe2"].includes(setup?.choice);
    case "krommhold-range":
      return [2, 3, 4].includes(Number(setup?.choice));
    case "palecien-origin":
      return ["surface", "aquatic"].includes(setup?.choice);
    case "manual-mj":
      return Boolean(setup?.mjConfirmed);
    case "therianthrope-manual":
      return Boolean(setup?.mjConfirmed)
        && ["arkentropie", "arksonge"].includes(setup?.natureArk);
    default:
      return false;
  }
}

function arkCirclesTotal(setup) {
  return CREATION_ARKS.reduce(
    (sum, ark) => sum + (Number(setup?.circles?.[ark.id]) || 0),
    0
  );
}

function arkNeedsRollAcknowledgement(ranks) {
  return (Number(ranks?.arkentropie) || 0) > 0
    || (Number(ranks?.arksonge) || 0) > 0;
}

function arkSetupStatus(peopleId, setup) {
  const ranks = arkRanksFor(peopleId, setup);
  const choiceComplete = arkChoiceComplete(peopleId, setup);
  const circlesTotal = arkCirclesTotal(setup);
  const circlesComplete = circlesTotal === 2;
  const needsRollAcknowledgement = arkNeedsRollAcknowledgement(ranks);
  const rollsComplete = !needsRollAcknowledgement || Boolean(setup?.rollsAcknowledged);

  return {
    ranks,
    choiceComplete,
    circlesTotal,
    circlesComplete,
    needsRollAcknowledgement,
    rollsComplete,
    valid: choiceComplete && circlesComplete && rollsComplete
  };
}

function arkModeContext(peopleId, setup) {
  const rule = arkRuleFor(peopleId);
  const mode = rule?.mode ?? "";
  const choice = setup?.choice ?? null;
  const natureArk = setup?.natureArk ?? null;

  return {
    mode,
    isFixed: mode === "fixed",
    isHumanFree: mode === "human-free",
    isElfinienSplit: mode === "elfinien-split",
    isKrommholdRange: mode === "krommhold-range",
    isPalecienOrigin: mode === "palecien-origin",
    isManualMj: mode === "manual-mj",
    isTherianthropeManual: mode === "therianthrope-manual",

    humanArkoeur: choice === "arkoeur",
    humanArkentropie: choice === "arkentropie",
    humanArksonge: choice === "arksonge",

    elfinienEntropie2: choice === "entropie2",
    elfinienSplit: choice === "split",
    elfinienSonge2: choice === "songe2",

    krommhold2: choice === "2",
    krommhold3: choice === "3",
    krommhold4: choice === "4",

    palecienSurface: choice === "surface",
    palecienAquatic: choice === "aquatic",

    natureArkentropie: natureArk === "arkentropie",
    natureArksonge: natureArk === "arksonge",

    mjConfirmed: Boolean(setup?.mjConfirmed),
    rollsAcknowledged: Boolean(setup?.rollsAcknowledged)
  };
}

function invalidateFromPeopleIfNeeded(state) {
  if (stepIndex(state.furthestStep) <= stepIndex("people")) return state.invalidFrom;
  return earlierStep(state.invalidFrom, "people");
}




const CREATION_SKILL_COSTS = Object.freeze({
  0: 0,
  1: 1,
  2: 3,
  3: 5,
  4: 7,
  5: 10
});

const DESKALEIDE_FREE_SKILL = "arkhanval.skill.magicien.metantropie";
const KROMMHOLD_BONUS_SKILL = "arkhanval.skill.explorateur.detection-vigilance";

function skillRankStorageKey(identifier) {
  return String(identifier ?? "").replaceAll(".", "__");
}

function creationSkillDefinition(identifier) {
  for (const archetype of ARKHANVAL_ARCHETYPES) {
    const skill = archetype.skills.find((entry) => entry.identifier === identifier);
    if (skill) return { ...skill, archetype: archetype.id };
  }
  return null;
}

function creationSkillCost(rank) {
  return CREATION_SKILL_COSTS[Number(rank)] ?? Number.POSITIVE_INFINITY;
}

function creationSkillGrant(peopleId, identifier) {
  if (peopleId === "deskaleides" && identifier === DESKALEIDE_FREE_SKILL) {
    return {
      freeRank: 3,
      postCreationBonus: 0,
      label: "Rang 3 offert par le peuple"
    };
  }

  if (peopleId === "krommholds" && identifier === KROMMHOLD_BONUS_SKILL) {
    return {
      freeRank: 0,
      postCreationBonus: 1,
      label: "+1 rang après la création"
    };
  }

  return {
    freeRank: 0,
    postCreationBonus: 0,
    label: ""
  };
}

function creationSkillRank(state, identifier) {
  const stored = Number(state.skills?.ranks?.[skillRankStorageKey(identifier)]);
  const grant = creationSkillGrant(state.people, identifier);
  if (!Number.isFinite(stored)) return grant.freeRank;
  return Math.max(grant.freeRank, Math.max(0, Math.trunc(stored)));
}

function creationSkillPaidCost(state, identifier) {
  const rank = creationSkillRank(state, identifier);
  const grant = creationSkillGrant(state.people, identifier);
  return Math.max(
    0,
    creationSkillCost(rank) - creationSkillCost(grant.freeRank)
  );
}

function creationSkillNextCost(state, identifier) {
  const profile = CREATION_PROFILES[state.profile];
  const rank = creationSkillRank(state, identifier);
  if (!profile || rank >= profile.maxRank) return null;

  const grant = creationSkillGrant(state.people, identifier);
  const currentPaid = Math.max(
    0,
    creationSkillCost(rank) - creationSkillCost(grant.freeRank)
  );
  const nextPaid = Math.max(
    0,
    creationSkillCost(rank + 1) - creationSkillCost(grant.freeRank)
  );

  return Math.max(0, nextPaid - currentPaid);
}

function creationSkillBudget(state) {
  const profile = CREATION_PROFILES[state.profile];
  const base = Number(profile?.points) || 0;
  const skillBonus = state.people === "humains" ? 5 : 0;

  let spent = 0;
  for (const archetype of ARKHANVAL_ARCHETYPES) {
    for (const skill of archetype.skills) {
      spent += creationSkillPaidCost(state, skill.identifier);
    }
  }

  const maxRank = Number(profile?.maxRank) || 0;
  const total = base + skillBonus;
  const withinBudget = spent <= total;

  const rankOverflow = ARKHANVAL_ARCHETYPES
    .flatMap((entry) => entry.skills)
    .some((skill) => creationSkillRank(state, skill.identifier) > maxRank);

  // The Human +5 is explicitly limited to skills. It is consumed first,
  // so remaining base-profile points may still be kept aside for spells.
  const baseSpent = Math.max(0, spent - skillBonus);
  const baseRemaining = Math.max(0, base - baseSpent);
  const unusedSkillBonus = Math.max(0, skillBonus - spent);

  return {
    base,
    skillBonus,
    total,
    spent,
    remaining: Math.max(0, total - spent),
    baseRemaining,
    unusedSkillBonus,
    maxRank,
    withinBudget,
    rankOverflow,
    valid: withinBudget && !rankOverflow
  };
}

function selectedSpecialtyIds(state) {
  return Array.isArray(state.skills?.specialties)
    ? state.skills.specialties.filter((id) => getCreationSpecialty(id))
    : [];
}

function specialtySelectionStatus(state) {
  const profile = CREATION_PROFILES[state.profile];
  const required = Number(profile?.specialties) || 0;
  const selected = selectedSpecialtyIds(state);
  const primary = selectedArchetypes(state);

  const secondaryCount = selected.reduce((count, id) => {
    const specialty = getCreationSpecialty(id);
    return count + (specialty && !primary.includes(specialty.archetype) ? 1 : 0);
  }, 0);

  const allowedSecondary = state.profile === "veteran" ? 1 : 0;

  return {
    selected,
    count: selected.length,
    required,
    remaining: Math.max(0, required - selected.length),
    secondaryCount,
    allowedSecondary,
    valid: selected.length === required && secondaryCount <= allowedSecondary
  };
}

function skillsStepStatus(state) {
  const budget = creationSkillBudget(state);
  const specialties = specialtySelectionStatus(state);
  return {
    budget,
    specialties,
    valid: budget.valid && specialties.valid
  };
}

function invalidateFromSkillsIfNeeded(state) {
  if (stepIndex(state.furthestStep) <= stepIndex("skills")) return state.invalidFrom;
  return earlierStep(state.invalidFrom, "skills");
}

function finalCreationStatus(state) {
  const profile = CREATION_PROFILES[state.profile];
  const people = CREATION_PEOPLES.find((entry) => entry.id === state.people);
  const arkSetup = state.arks?.peopleId === state.people
    ? state.arks
    : defaultArkSetup(state.people);
  const arks = people ? arkSetupStatus(people.id, arkSetup) : null;
  const archetypes = archetypeSelectionStatus(state);
  const skills = skillsStepStatus(state);

  return {
    profile,
    people,
    arkSetup,
    arks,
    archetypes,
    skills,
    valid: Boolean(profile && people && arks?.valid && archetypes.complete && skills.valid)
  };
}

function creationPeopleSelections(state) {
  const selections = [];
  if (state.arks?.choice !== null && state.arks?.choice !== undefined) {
    selections.push({ key: "choice", value: String(state.arks.choice) });
  }
  if (state.arks?.natureArk) {
    selections.push({ key: "natureArk", value: String(state.arks.natureArk) });
  }
  return selections;
}

function finalCreationSkillEntries(state) {
  const entries = [];
  for (const archetype of ARKHANVAL_ARCHETYPES) {
    for (const skill of archetype.skills) {
      const paidRank = creationSkillRank(state, skill.identifier);
      const grant = creationSkillGrant(state.people, skill.identifier);
      const finalRank = paidRank + grant.postCreationBonus;
      if (finalRank <= 0) continue;

      entries.push({
        identifier: skill.identifier,
        archetype: archetype.id,
        name: game.i18n.localize(skill.labelKey),
        paidRank,
        finalRank,
        cost: creationSkillPaidCost(state, skill.identifier),
        grantLabel: grant.label
      });
    }
  }
  return entries;
}

function finalCreationSpecialtyEntries(state) {
  return selectedSpecialtyIds(state)
    .map((identifier) => getCreationSpecialty(identifier))
    .filter(Boolean);
}

function creationRemainderNote(state) {
  const budget = creationSkillBudget(state);
  if (budget.remaining <= 0) return "";

  const lines = [
    `Création guidée — ${budget.remaining} ${
      budget.remaining === 1 ? "point non dépensé" : "points non dépensés"
    }.`
  ];

  if (budget.unusedSkillBonus > 0) {
    lines.push(
      `Dont ${budget.unusedSkillBonus} ${
        budget.unusedSkillBonus === 1 ? "point du bonus humain réservé" : "points du bonus humain réservés"
      } aux compétences.`
    );
  }

  if (selectedArchetypes(state).includes("magicien") && budget.baseRemaining > 0) {
    lines.push(
      `${budget.baseRemaining} ${
        budget.baseRemaining === 1 ? "point de base potentiellement disponible" : "points de base potentiellement disponibles"
      } pour des sortilèges.`
    );
  }

  return lines.join(" ");
}

async function upsertCreationPeople(actor, state, people) {
  const identifier = `arkhanval.people.${people.id}`;
  const existing = actor.items.find(
    (item) => item.type === "people" && item.system.identifier === identifier
  ) ?? actor.items.find((item) => item.type === "people");

  const selections = creationPeopleSelections(state);

  if (existing) {
    await existing.update({
      name: people.label,
      "system.identifier": identifier,
      "system.description": people.mechanics,
      "system.selections": selections
    }, { render: false });
    return existing;
  }

  const [created] = await actor.createEmbeddedDocuments(
    "Item",
    [{
      name: people.label,
      type: "people",
      system: {
        identifier,
        description: people.mechanics,
        selections
      }
    }],
    { render: false }
  );
  return created;
}

async function upsertCreationSkills(actor, entries) {
  const createData = [];

  for (const entry of entries) {
    const existing = actor.items.find(
      (item) => item.type === "skill" && item.system.identifier === entry.identifier
    );

    if (existing) {
      await existing.update({
        name: entry.name,
        "system.identifier": entry.identifier,
        "system.archetype": entry.archetype,
        "system.rank": entry.finalRank
      }, { render: false });
      continue;
    }

    createData.push({
      name: entry.name,
      type: "skill",
      system: {
        identifier: entry.identifier,
        archetype: entry.archetype,
        rank: entry.finalRank,
        xp: 0
      }
    });
  }

  if (createData.length) {
    await actor.createEmbeddedDocuments("Item", createData, { render: false });
  }
}

async function upsertCreationSpecialties(actor, entries) {
  const existingByIdentifier = new Map();

  for (const item of actor.items.filter((entry) => entry.type === "specialty")) {
    const identifier = item.system.identifier;
    if (!identifier) continue;
    const bucket = existingByIdentifier.get(identifier) ?? [];
    bucket.push(item);
    existingByIdentifier.set(identifier, bucket);
  }

  const usedByIdentifier = new Map();
  const createData = [];

  for (const entry of entries) {
    const used = usedByIdentifier.get(entry.id) ?? 0;
    const existing = existingByIdentifier.get(entry.id)?.[used] ?? null;
    usedByIdentifier.set(entry.id, used + 1);

    if (existing) {
      await existing.update({
        name: entry.name,
        "system.identifier": entry.id,
        "system.archetype": entry.archetype,
        "system.repeatable": Boolean(entry.repeatable),
        "system.description": entry.description
      }, { render: false });
      continue;
    }

    createData.push({
      name: entry.name,
      type: "specialty",
      system: {
        identifier: entry.id,
        archetype: entry.archetype,
        repeatable: Boolean(entry.repeatable),
        description: entry.description
      }
    });
  }

  if (createData.length) {
    await actor.createEmbeddedDocuments("Item", createData, { render: false });
  }
}


const CREATION_ARCHETYPES = Object.freeze([
  Object.freeze({
    id: "artisan",
    label: "Artisan",
    image: "systems/arkhanval/assets/icones/archetype/artisan.webp",
    summary: "Habileté manuelle, fabrication, réparation et travail des matériaux.",
    skills: Object.freeze([
      "Bricolage",
      "Cuisine",
      "Orfèvrerie",
      "Travail du cuir",
      "Travail du bois",
      "Travail du métal",
      "Travail de la pierre"
    ])
  }),
  Object.freeze({
    id: "artiste",
    label: "Artiste",
    image: "systems/arkhanval/assets/icones/archetype/artiste.webp",
    summary: "Création, interprétation et expression artistique, jusqu’à la Voie des arts.",
    skills: Object.freeze([
      "Chant",
      "Comédie",
      "Danse",
      "Dessin & peinture",
      "Musique",
      "Poésie",
      "Sculpture",
      "Voie des arts"
    ])
  }),
  Object.freeze({
    id: "combattant",
    label: "Combattant",
    image: "systems/arkhanval/assets/icones/archetype/combattant.webp",
    summary: "Maîtrise du combat, des armes et des affrontements au corps à corps.",
    skills: Object.freeze([
      "Armes à une main",
      "Armes à deux mains",
      "Armes de jet",
      "Armes de tir",
      "Art du combat",
      "Mains nues"
    ])
  }),
  Object.freeze({
    id: "erudit",
    label: "Érudit",
    image: "systems/arkhanval/assets/icones/archetype/erudit.webp",
    summary: "Savoirs, étude, raisonnement, médecine et compréhension du monde.",
    skills: Object.freeze([
      "Alchimie",
      "Botanique",
      "Histoire & légendes",
      "Lecture & écriture",
      "Linguistique",
      "Médecine",
      "Zoologie"
    ])
  }),
  Object.freeze({
    id: "explorateur",
    label: "Explorateur",
    image: "systems/arkhanval/assets/icones/archetype/explorateur.webp",
    summary: "Adaptation, observation, déplacement, endurance et survie.",
    skills: Object.freeze([
      "Compétences athlétiques",
      "Détection & vigilance",
      "Dressage & équitation",
      "Natation",
      "Navigation",
      "Survie"
    ])
  }),
  Object.freeze({
    id: "magicien",
    label: "Magicien",
    image: "systems/arkhanval/assets/icones/archetype/magicien.webp",
    summary: "Compréhension et usage des forces magiques et des mystères d’Arkhanval.",
    skills: Object.freeze([
      "Concentration",
      "Éthérêve",
      "Empathie & intuition",
      "Métantropie",
      "Signentropie"
    ])
  }),
  Object.freeze({
    id: "roublard",
    label: "Roublard",
    image: "systems/arkhanval/assets/icones/archetype/roublard.webp",
    summary: "Ruse, discrétion, débrouillardise et aisance dans les milieux urbains.",
    skills: Object.freeze([
      "Baratin",
      "Commerce",
      "Connaissance de la rue",
      "Crochetage",
      "Discrétion",
      "Jeu"
    ])
  }),
  Object.freeze({
    id: "stratege",
    label: "Stratège",
    image: "systems/arkhanval/assets/icones/archetype/stratege.webp",
    summary: "Analyse, planification, organisation, influence et tactique.",
    skills: Object.freeze([
      "Convaincre & argumenter",
      "Discours & éloquence",
      "Intimidation",
      "Gestion & organisation",
      "Tactique & stratégie"
    ])
  })
]);

function selectedArchetypes(state) {
  const values = Array.isArray(state?.archetypes) ? state.archetypes : [];
  return values.filter((id, index) =>
    CREATION_ARCHETYPES.some((entry) => entry.id === id)
    && values.indexOf(id) === index
  ).slice(0, 2);
}

function archetypeSelectionStatus(state) {
  const selected = selectedArchetypes(state);
  return {
    selected,
    count: selected.length,
    complete: selected.length === 2
  };
}

function invalidateFromArchetypesIfNeeded(state) {
  if (stepIndex(state.furthestStep) <= stepIndex("archetypes")) return state.invalidFrom;
  return earlierStep(state.invalidFrom, "archetypes");
}


export const CREATION_PROFILES = Object.freeze({
  beginner: Object.freeze({
    id: "beginner",
    label: "Débutant",
    points: 40,
    maxRank: 3,
    specialties: 3
  }),
  experienced: Object.freeze({
    id: "experienced",
    label: "Expérimenté",
    points: 50,
    maxRank: 4,
    specialties: 4
  }),
  veteran: Object.freeze({
    id: "veteran",
    label: "Vieux briscard",
    points: 60,
    maxRank: 5,
    specialties: 5
  })
});

export const CREATION_PEOPLES = Object.freeze([
  Object.freeze({
    id: "arkheigryphes",
    label: "Arkheigryphes",
    image: "systems/arkhanval/assets/icones/peuples/peuple_arkheigryphes.webp",
    lore: "Hommes-lézards ou hommes-dragons, massifs et couverts d’écailles.",
    arks: "Arkœur 4",
    mechanics: "Armure naturelle 2 à 5 · +1d6 aux dégâts à mains nues · 6e sens."
  }),
  Object.freeze({
    id: "celminoens",
    label: "Celminoens",
    image: "systems/arkhanval/assets/icones/peuples/peuple_celminoens.webp",
    lore: "Pâles et sophistiqués, dandys désabusés au courage parfois surprenant.",
    arks: "Arkœur 3 · Arksonge 1",
    mechanics: "Résistance mentale renforcée · FD −2 contre peur et intimidation · gestion particulière des gains d’Arkentropie."
  }),
  Object.freeze({
    id: "deskaleides",
    label: "Deskaléides",
    image: "systems/arkhanval/assets/icones/peuples/peuple_deskaleides.webp",
    lore: "Magiciennes du chaos, expertes d’une magie qui marque leur corps.",
    arks: "Arkœur 2 · Arkentropie 2 · Arksonge 1",
    mechanics: "Métantropie rang 3 gratuite · deux tirages sur la table d’Arkentropie, résultat au choix."
  }),
  Object.freeze({
    id: "egares",
    label: "Égarés",
    image: "systems/arkhanval/assets/icones/peuples/peuple_egares.webp",
    lore: "Voyageurs venus d’autres mondes, déracinés puis parfois adoptés par Arkhanval.",
    arks: "À définir avec le MJ",
    mechanics: "Les ajustements dépendent du monde d’origine et de la nature du personnage."
  }),
  Object.freeze({
    id: "elfiniens",
    label: "Elfiniens",
    image: "systems/arkhanval/assets/icones/peuples/peuple_elfiniens.webp",
    lore: "Êtres méditatifs, éternellement jeunes, liés à la nuit et aux forêts.",
    arks: "Arkœur 2 · +2 points à répartir entre Arkentropie et Arksonge",
    mechanics: "+1 dé en Discrétion · accès à Quiddité · vision dans l’obscurité."
  }),
  Object.freeze({
    id: "essilfides",
    label: "Essilfides",
    image: "systems/arkhanval/assets/icones/peuples/peuple_essilfides.webp",
    lore: "Peuple végétal dont le corps reflète l’harmonie avec la nature.",
    arks: "Arkœur 4",
    mechanics: "Cercles orientables vers Arkentropie ou Arkœur · armure naturelle à définir avec le MJ · accès à Harmonie."
  }),
  Object.freeze({
    id: "humains",
    label: "Humains",
    image: "systems/arkhanval/assets/icones/peuples/peuple_humains.webp",
    lore: "Le peuple le plus répandu, installé jusque dans les régions les plus reculées.",
    arks: "Arkœur 2 · +1 point libre dans un Ark",
    mechanics: "+5 points de compétences à la création."
  }),
  Object.freeze({
    id: "krommholds",
    label: "Krömmholds",
    image: "systems/arkhanval/assets/icones/peuples/peuple_krommholds.webp",
    lore: "Humanoïdes aux traits animaux, nombreux dans les terres septentrionales.",
    arks: "Arkœur 2 à 4 selon l’espèce",
    mechanics: "Armure naturelle selon l’espèce · +1 rang de Détection & vigilance après la création."
  }),
  Object.freeze({
    id: "orcaliens",
    label: "Orcaliens",
    image: "systems/arkhanval/assets/icones/peuples/peuple_orcaliens.webp",
    lore: "Puissants, fiers et profondément attachés à l’honneur.",
    arks: "Arkœur 4",
    mechanics: "Armure naturelle 2 · +2 aux dégâts · +2 dés pour certaines résistances à la douleur et aux agressions physiques."
  }),
  Object.freeze({
    id: "paleciens",
    label: "Paléciens",
    image: "systems/arkhanval/assets/icones/peuples/peuple_paleciens.webp",
    lore: "Humanoïdes adaptés au monde aquatique, des profondeurs jusqu’à la surface.",
    arks: "Arkœur 3 · +1 Arksonge (surface) ou +1 Arkentropie (aquatique)",
    mechanics: "Aisance aquatique différente selon le mode de vie choisi."
  }),
  Object.freeze({
    id: "telluriens",
    label: "Telluriens",
    image: "systems/arkhanval/assets/icones/peuples/peuple_telluriens.webp",
    lore: "Êtres liés au monde minéral, la roche s’inscrivant jusque dans leur chair.",
    arks: "Arkœur 4",
    mechanics: "Armure naturelle 1 à 6 · accès possible à Tellurie · Tellurie incompatible avec l’archétype Magicien."
  }),
  Object.freeze({
    id: "therianthropes",
    label: "Thérianthropes",
    image: "systems/arkhanval/assets/icones/peuples/peuple_therianthropes.webp",
    lore: "Métamorphes capables de révéler une autre nature, parfois malgré eux.",
    arks: "Identiques à l’espèce d’origine",
    mechanics: "Choix d’un Ark lié à la nature du personnage · réglages à définir avec le MJ selon l’espèce d’origine."
  }),
  Object.freeze({
    id: "wircamens",
    label: "Wircamens",
    image: "systems/arkhanval/assets/icones/peuples/peuple_wircamens.webp",
    lore: "Réfugiés d’un monde mourant, profondément transformés par la magie d’Arkhanval.",
    arks: "Arkœur 2 · Arkentropie 2",
    mechanics: "Deux tirages lors d’un tirage d’Arkentropie · résistance mentale · vision nocturne."
  })
]);

function defaultCreationState() {
  return normalizeCreationState(null);
}

export function getCreationState(actor) {
  const state = actor?.getFlag?.(CREATION_FLAG_SCOPE, CREATION_FLAG_KEY);
  if (!state || typeof state !== "object") return null;
  return normalizeCreationState(state);
}

export function isCreationRoutingActive(actor) {
  const state = getCreationState(actor);
  return state?.status === "entry" || state?.status === "guided";
}

export function initializeCreationState(document) {
  if (!document || document.type !== "character") return;
  const existing = foundry.utils.getProperty(
    document,
    `flags.${CREATION_FLAG_SCOPE}.${CREATION_FLAG_KEY}`
  );

  const sourceUpdate = {
    "prototypeToken.actorLink": true
  };
  if (!existing) {
    sourceUpdate[`flags.${CREATION_FLAG_SCOPE}.${CREATION_FLAG_KEY}`] = defaultCreationState();
  }

  document.updateSource(sourceUpdate);
}

async function ensureLinkedPrototypeToken(actor) {
  if (!actor || actor.type !== "character") return;
  if (actor.prototypeToken?.actorLink === true) return;

  await actor.update({
    "prototypeToken.actorLink": true
  }, { render: false });

  if (actor.prototypeToken?.actorLink !== true) {
    throw new Error("Arkhanval | Impossible d'activer le lien du prototype de Token vers l'acteur.");
  }
}

async function saveCreationState(actor, patch) {
  const current = getCreationState(actor) ?? defaultCreationState();
  const next = normalizeCreationState(foundry.utils.mergeObject(current, patch, {
    inplace: false,
    insertKeys: true,
    overwrite: true
  }));
  await actor.setFlag(CREATION_FLAG_SCOPE, CREATION_FLAG_KEY, next);
  return next;
}

async function abandonCreation(actor) {
  await actor.unsetFlag(CREATION_FLAG_SCOPE, CREATION_FLAG_KEY);
}

function creationAppFor(actor) {
  return CREATION_APPS.get(actor.id) ?? null;
}

export function openCharacterCreation(actor) {
  if (!actor || actor.type !== "character") return null;

  let app = creationAppFor(actor);
  if (!app) {
    app = new ArkhanvalCharacterCreation(actor);
    CREATION_APPS.set(actor.id, app);
  }

  if (app.rendered) app.bringToFront();
  else app.render({ force: true });
  return app;
}

export class ArkhanvalCharacterCreation extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({
      id: `arkhanval-character-creation-${actor.id}`,
      ...options
    });
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    tag: "section",
    classes: ["arkhanval", "arkhanval-character-creation"],
    position: {
      width: 920,
      height: 700
    },
    window: {
      resizable: true,
      title: "Création de personnage Arkhanval",
      icon: "fa-solid fa-user-plus"
    },
    actions: {
      directSheet: this.#onDirectSheet,
      guidedCreation: this.#onGuidedCreation,
      npcCreation: this.#onNpcCreation,
      chooseProfile: this.#onChooseProfile,
      nextFromProfile: this.#onNextFromProfile,
      choosePeople: this.#onChoosePeople,
      chooseArkOption: this.#onChooseArkOption,
      adjustManualArk: this.#onAdjustManualArk,
      adjustArkCircle: this.#onAdjustArkCircle,
      toggleArkConfirmation: this.#onToggleArkConfirmation,
      nextFromPeople: this.#onNextFromPeople,
      toggleArchetype: this.#onToggleArchetype,
      nextFromArchetypes: this.#onNextFromArchetypes,
      setSkillsPane: this.#onSetSkillsPane,
      setSkillArchetype: this.#onSetSkillArchetype,
      adjustCreationSkill: this.#onAdjustCreationSkill,
      adjustCreationSpecialty: this.#onAdjustCreationSpecialty,
      removeCreationSpecialty: this.#onRemoveCreationSpecialty,
      resetCreationSkills: this.#onResetCreationSkills,
      nextFromSkills: this.#onNextFromSkills,
      finalizeCreation: this.#onFinalizeCreation,
      navigateStep: this.#onNavigateStep,
      backToSkills: this.#onBackToSkills,
      backToArchetypes: this.#onBackToArchetypes,
      backToArks: this.#onBackToArks,
      backToProfile: this.#onBackToProfile,
      backToEntry: this.#onBackToEntry
    }
  };

  static PARTS = {
    body: {
      template: "systems/arkhanval/templates/apps/character-creation.hbs"
    }
  };

  static async #onDirectSheet() {
    if (!this.actor?.isOwner) return;
    await ensureLinkedPrototypeToken(this.actor);
    await abandonCreation(this.actor);
    await this.close();
    this.actor.sheet?.render({ force: true });
  }

  static async #onGuidedCreation() {
    if (!this.actor?.isOwner) return;
    await saveCreationState(this.actor, {
      status: "guided",
      step: "profile",
      furthestStep: "profile"
    });
    this.render({ force: true });
  }

  static async #onNpcCreation() {
    if (!this.actor?.isOwner || !game.user?.isGM) return;
    const choice = await DialogV2.wait({
      window: { title: "Création de PNJ — Prototype Token" },
      classes: ["arkhanval", "arkhanval-popup-dialog", "arkhanval-popup-dialog--choice"],
      content: `<div class="arkhanval-phase04-dialog"><p>Comment les futurs tokens de ce PNJ seront-ils liés à sa fiche ?</p>
        <p><strong>Lié :</strong> personnage unique, état commun à tous ses tokens.</p>
        <p><strong>Non lié :</strong> exemplaires indépendants (créatures, gardes, meute).</p></div>`,
      modal: true,
      rejectClose: false,
      buttons: [
        { action: "linked", label: "Token lié", icon: "fa-solid fa-link", default: true },
        { action: "unlinked", label: "Token non lié", icon: "fa-solid fa-link-slash" },
        { action: "cancel", label: "Annuler", icon: "fa-solid fa-xmark" }
      ]
    });
    if (choice !== "linked" && choice !== "unlinked") return;
    await this.actor.update({
      "prototypeToken.actorLink": choice === "linked",
      "flags.arkhanval.viewMode": "npc"
    }, { render: false });
    await abandonCreation(this.actor);
    await this.close();
    await this.actor.sheet?.render({ force: true });
  }

  static async #onChooseProfile(event, target) {
    if (!this.actor?.isOwner) return;
    const profileId = target?.dataset?.profile;
    if (!CREATION_PROFILES[profileId]) return;

    const state = getCreationState(this.actor) ?? defaultCreationState();
    const changed = Boolean(state.profile && state.profile !== profileId);
    const reachedSkills = stepIndex(state.furthestStep) >= stepIndex("skills");

    await saveCreationState(this.actor, {
      status: "guided",
      step: "profile",
      profile: profileId,
      invalidFrom: changed && reachedSkills
        ? earlierStep(state.invalidFrom, "skills")
        : state.invalidFrom
    });
    this.render({ force: true });
  }

  static async #onNextFromProfile() {
    if (!this.actor?.isOwner) return;
    const state = getCreationState(this.actor) ?? defaultCreationState();
    if (!CREATION_PROFILES[state.profile]) return;

    await saveCreationState(this.actor, {
      status: "guided",
      step: "people",
      furthestStep: markStepReached(state, "people")
    });
    this.render({ force: true });
  }

  static async #onChoosePeople(event, target) {
    if (!this.actor?.isOwner) return;
    const peopleId = target?.dataset?.people;
    if (!CREATION_PEOPLES.some((entry) => entry.id === peopleId)) return;

    const state = getCreationState(this.actor) ?? defaultCreationState();
    const changed = Boolean(state.people && state.people !== peopleId);
    const reachedBeyondPeople = stepIndex(state.furthestStep) > stepIndex("people");

    await saveCreationState(this.actor, {
      status: "guided",
      step: "people",
      people: peopleId,
      arks: changed || !state.arks
        ? defaultArkSetup(peopleId)
        : state.arks,
      invalidFrom: changed && reachedBeyondPeople
        ? earlierStep(state.invalidFrom, "people")
        : state.invalidFrom
    });
    this.render({ force: true });
  }

  static async #onChooseArkOption(event, target) {
    if (!this.actor?.isOwner) return;
    const state = getCreationState(this.actor) ?? defaultCreationState();
    if (!state.people) return;

    const setup = state.arks?.peopleId === state.people
      ? foundry.utils.deepClone(state.arks)
      : defaultArkSetup(state.people);

    const field = target?.dataset?.arkField;
    const value = target?.dataset?.arkValue;
    if (!["choice", "natureArk"].includes(field) || !value) return;

    setup[field] = value;
    setup.rollsAcknowledged = false;

    await saveCreationState(this.actor, {
      status: "guided",
      step: "people",
      arks: setup,
      invalidFrom: invalidateFromPeopleIfNeeded(state)
    });
    this.render({ force: true });
  }

  static async #onAdjustManualArk(event, target) {
    if (!this.actor?.isOwner) return;
    const state = getCreationState(this.actor) ?? defaultCreationState();
    if (!state.people) return;

    const rule = arkRuleFor(state.people);
    if (!["manual-mj", "therianthrope-manual"].includes(rule?.mode)) return;

    const arkId = target?.dataset?.ark;
    const delta = Number(target?.dataset?.delta);
    if (!CREATION_ARKS.some((entry) => entry.id === arkId) || ![-1, 1].includes(delta)) return;

    const setup = state.arks?.peopleId === state.people
      ? foundry.utils.deepClone(state.arks)
      : defaultArkSetup(state.people);

    const current = Number(setup.manualRanks?.[arkId]) || 0;
    setup.manualRanks[arkId] = Math.max(0, Math.min(10, current + delta));
    setup.mjConfirmed = false;
    setup.rollsAcknowledged = false;

    await saveCreationState(this.actor, {
      status: "guided",
      step: "people",
      arks: setup,
      invalidFrom: invalidateFromPeopleIfNeeded(state)
    });
    this.render({ force: true });
  }

  static async #onAdjustArkCircle(event, target) {
    if (!this.actor?.isOwner) return;
    const state = getCreationState(this.actor) ?? defaultCreationState();
    if (!state.people) return;

    const arkId = target?.dataset?.ark;
    const delta = Number(target?.dataset?.delta);
    if (!CREATION_ARKS.some((entry) => entry.id === arkId) || ![-1, 1].includes(delta)) return;

    const setup = state.arks?.peopleId === state.people
      ? foundry.utils.deepClone(state.arks)
      : defaultArkSetup(state.people);

    const current = Number(setup.circles?.[arkId]) || 0;
    const total = arkCirclesTotal(setup);
    if (delta > 0 && total >= 2) return;

    setup.circles[arkId] = Math.max(0, Math.min(2, current + delta));

    await saveCreationState(this.actor, {
      status: "guided",
      step: "people",
      arks: setup,
      invalidFrom: invalidateFromPeopleIfNeeded(state)
    });
    this.render({ force: true });
  }

  static async #onToggleArkConfirmation(event, target) {
    if (!this.actor?.isOwner) return;
    const state = getCreationState(this.actor) ?? defaultCreationState();
    if (!state.people) return;

    const setup = state.arks?.peopleId === state.people
      ? foundry.utils.deepClone(state.arks)
      : defaultArkSetup(state.people);

    const field = target?.dataset?.confirmation;
    if (!["mjConfirmed", "rollsAcknowledged"].includes(field)) return;
    setup[field] = !Boolean(setup[field]);

    await saveCreationState(this.actor, {
      status: "guided",
      step: "people",
      arks: setup,
      invalidFrom: invalidateFromPeopleIfNeeded(state)
    });
    this.render({ force: true });
  }

  static async #onNextFromPeople() {
    if (!this.actor?.isOwner) return;
    const state = getCreationState(this.actor) ?? defaultCreationState();
    if (!state.people) return;

    const setup = state.arks?.peopleId === state.people
      ? state.arks
      : defaultArkSetup(state.people);
    const status = arkSetupStatus(state.people, setup);
    if (!status.valid) return;

    await saveCreationState(this.actor, {
      status: "guided",
      step: "archetypes",
      furthestStep: markStepReached(state, "archetypes"),
      invalidFrom: state.invalidFrom === "people" ? null : state.invalidFrom
    });
    this.render({ force: true });
  }

  static async #onToggleArchetype(event, target) {
    if (!this.actor?.isOwner) return;
    const archetypeId = target?.dataset?.archetype;
    if (!CREATION_ARCHETYPES.some((entry) => entry.id === archetypeId)) return;

    const state = getCreationState(this.actor) ?? defaultCreationState();
    const selected = selectedArchetypes(state);
    const existingIndex = selected.indexOf(archetypeId);

    if (existingIndex >= 0) {
      selected.splice(existingIndex, 1);
    } else {
      if (selected.length >= 2) return;
      selected.push(archetypeId);
    }

    await saveCreationState(this.actor, {
      status: "guided",
      step: "archetypes",
      archetypes: selected,
      invalidFrom: invalidateFromArchetypesIfNeeded(state)
    });
    this.render({ force: true });
  }

  static async #onNextFromArchetypes() {
    if (!this.actor?.isOwner) return;
    const state = getCreationState(this.actor) ?? defaultCreationState();
    const archetypes = archetypeSelectionStatus(state);
    if (!archetypes.complete) return;

    const activeArchetype = state.skills.activeArchetype
      || archetypes.selected[0]
      || "artisan";

    await saveCreationState(this.actor, {
      status: "guided",
      step: "skills",
      furthestStep: markStepReached(state, "skills"),
      invalidFrom: state.invalidFrom === "archetypes" ? null : state.invalidFrom,
      skills: {
        ...state.skills,
        activeArchetype,
        pane: state.skills.pane || "skills",
        specialtyView: "primary"
      }
    });
    this.render({ force: true });
  }

  static async #onSetSkillsPane(event, target) {
    if (!this.actor?.isOwner) return;
    const pane = target?.dataset?.pane;
    if (!["skills", "specialties"].includes(pane)) return;

    const state = getCreationState(this.actor) ?? defaultCreationState();
    await saveCreationState(this.actor, {
      status: "guided",
      step: "skills",
      skills: {
        ...state.skills,
        pane,
        specialtyView: pane === "specialties" ? "primary" : state.skills.specialtyView
      }
    });
    this.render({ force: true });
  }

  static async #onSetSkillArchetype(event, target) {
    if (!this.actor?.isOwner) return;
    const archetypeId = target?.dataset?.archetype;
    if (!ARKHANVAL_ARCHETYPES.some((entry) => entry.id === archetypeId)) return;

    const state = getCreationState(this.actor) ?? defaultCreationState();
    const primary = selectedArchetypes(state);
    const inSpecialties = state.skills.pane === "specialties";
    const specialtyView = inSpecialties
      ? (primary.includes(archetypeId) ? "primary" : archetypeId)
      : state.skills.specialtyView;

    await saveCreationState(this.actor, {
      status: "guided",
      step: "skills",
      skills: {
        ...state.skills,
        activeArchetype: archetypeId,
        specialtyView
      }
    });
    this.render({ force: true });
  }

  static async #onAdjustCreationSkill(event, target) {
    if (!this.actor?.isOwner) return;
    const identifier = target?.dataset?.skill;
    const delta = Number(target?.dataset?.delta);
    const definition = creationSkillDefinition(identifier);
    if (!definition || ![-1, 1].includes(delta)) return;

    const state = getCreationState(this.actor) ?? defaultCreationState();
    const profile = CREATION_PROFILES[state.profile];
    if (!profile) return;

    const current = creationSkillRank(state, identifier);
    const grant = creationSkillGrant(state.people, identifier);
    const next = current + delta;

    if (next < grant.freeRank || next > profile.maxRank) return;

    const storageKey = skillRankStorageKey(identifier);
    const ranks = { ...state.skills.ranks, [storageKey]: next };
    const candidate = normalizeCreationState({
      ...state,
      skills: {
        ...state.skills,
        ranks
      }
    });

    if (!creationSkillBudget(candidate).withinBudget) return;

    await saveCreationState(this.actor, {
      status: "guided",
      step: "skills",
      skills: {
        ...state.skills,
        ranks
      },
      invalidFrom: invalidateFromSkillsIfNeeded(state)
    });
    this.render({ force: true });
  }

  static async #onAdjustCreationSpecialty(event, target) {
    if (!this.actor?.isOwner) return;
    const specialtyId = target?.dataset?.specialty;
    const delta = Number(target?.dataset?.delta);
    const specialty = getCreationSpecialty(specialtyId);
    if (!specialty || ![-1, 1].includes(delta)) return;

    const state = getCreationState(this.actor) ?? defaultCreationState();
    const status = specialtySelectionStatus(state);
    const primary = selectedArchetypes(state);
    const selected = [...status.selected];

    if (delta > 0) {
      if (selected.length >= status.required) return;
      const isSecondary = !primary.includes(specialty.archetype);
      if (isSecondary && status.secondaryCount >= status.allowedSecondary) return;
      selected.push(specialtyId);
    } else {
      const index = selected.lastIndexOf(specialtyId);
      if (index < 0) return;
      selected.splice(index, 1);
    }

    await saveCreationState(this.actor, {
      status: "guided",
      step: "skills",
      skills: {
        ...state.skills,
        specialties: selected
      },
      invalidFrom: invalidateFromSkillsIfNeeded(state)
    });
    this.render({ force: true });
  }


  static async #onRemoveCreationSpecialty(event, target) {
    if (!this.actor?.isOwner) return;
    const specialtyId = target?.dataset?.specialty;
    const specialty = getCreationSpecialty(specialtyId);
    if (!specialty) return;

    const state = getCreationState(this.actor) ?? defaultCreationState();
    const selected = [...selectedSpecialtyIds(state)];
    const index = selected.lastIndexOf(specialtyId);
    if (index < 0) return;
    selected.splice(index, 1);

    await saveCreationState(this.actor, {
      status: "guided",
      step: "skills",
      skills: {
        ...state.skills,
        specialties: selected
      },
      invalidFrom: invalidateFromSkillsIfNeeded(state)
    });
    this.render({ force: true });
  }

  static async #onResetCreationSkills() {
    if (!this.actor?.isOwner) return;

    const state = getCreationState(this.actor) ?? defaultCreationState();
    const hasSkillAllocation = creationSkillBudget(state).spent > 0;
    const hasSpecialties = selectedSpecialtyIds(state).length > 0;
    if (!hasSkillAllocation && !hasSpecialties) return;

    const confirmed = await DialogV2.confirm({
      window: {
        title: "Réinitialiser l’étape"
      },
      classes: ["arkhanval", "arkhanval-popup-dialog", "arkhanval-popup-dialog--confirm"],
      content: `
        <p>Réinitialiser toutes les compétences et spécialités choisies dans cette étape&nbsp;?</p>
        <p>Le profil, le peuple, les Arks et les archétypes principaux seront conservés.</p>
      `,
      rejectClose: false,
      modal: true,
      yes: {
        label: "Réinitialiser",
        icon: "fa-solid fa-arrow-rotate-left"
      },
      no: {
        label: "Annuler"
      }
    });

    if (!confirmed) return;

    const resetState = normalizeCreationState({
      ...state,
      status: "guided",
      step: "skills",
      skills: {
        ...state.skills,
        ranks: {},
        specialties: []
      },
      invalidFrom: invalidateFromSkillsIfNeeded(state)
    });

    // Important: setFlag ultimately uses a Foundry document update and may
    // deep-merge nested objects. Emptying `skills.ranks` through a normal
    // patch can therefore leave the old rank keys in place.
    //
    // For this deliberately destructive reset action only, remove the whole
    // temporary creation flag first, then write the complete cleaned state.
    await this.actor.unsetFlag(CREATION_FLAG_SCOPE, CREATION_FLAG_KEY);
    await this.actor.setFlag(CREATION_FLAG_SCOPE, CREATION_FLAG_KEY, resetState);

    this.render({ force: true });
  }

  static async #onNextFromSkills() {
    if (!this.actor?.isOwner) return;

    const state = getCreationState(this.actor) ?? defaultCreationState();
    if (!finalCreationStatus(state).valid) return;

    await saveCreationState(this.actor, {
      status: "guided",
      step: "summary",
      furthestStep: markStepReached(state, "summary"),
      invalidFrom: state.invalidFrom === "skills" ? null : state.invalidFrom
    });

    this.render({ force: true });
  }

  static async #onFinalizeCreation() {
    if (!this.actor?.isOwner || this._finalizing) return;

    const state = getCreationState(this.actor) ?? defaultCreationState();
    const status = finalCreationStatus(state);
    if (!status.valid) {
      ui.notifications?.warn?.("Arkhanval | La création doit être entièrement valide avant finalisation.");
      return;
    }

    const remainingPoints = status.skills.budget.remaining;
    if (remainingPoints > 0) {
      const label = remainingPoints === 1 ? "point non dépensé" : "points non dépensés";
      const confirmed = await DialogV2.confirm({
        window: {
          title: "Points de création non dépensés"
        },
        classes: ["arkhanval", "arkhanval-popup-dialog", "arkhanval-popup-dialog--confirm"],
        content: `
          <p>Il reste <strong>${remainingPoints} ${label}</strong>.</p>
          <p>Cette information sera conservée dans les notes du personnage après finalisation.</p>
        `,
        rejectClose: false,
        modal: true,
        yes: {
          label: "Finaliser quand même",
          icon: "fa-solid fa-check"
        },
        no: {
          label: "Retour"
        }
      });

      if (!confirmed) return;
    }

    this._finalizing = true;

    try {
      await ensureLinkedPrototypeToken(this.actor);

      const arkRanks = status.arks.ranks;
      const circles = status.arkSetup?.circles ?? {};
      const skillEntries = finalCreationSkillEntries(state);
      const specialtyEntries = finalCreationSpecialtyEntries(state);

      await this.actor.update({
        "system.archetypes.primary": status.archetypes.selected,
        "system.arks.arkoeur.rank": Number(arkRanks.arkoeur) || 0,
        "system.arks.arkoeur.circles": Number(circles.arkoeur) || 0,
        "system.arks.arkentropie.rank": Number(arkRanks.arkentropie) || 0,
        "system.arks.arkentropie.circles": Number(circles.arkentropie) || 0,
        "system.arks.arksonge.rank": Number(arkRanks.arksonge) || 0,
        "system.arks.arksonge.circles": Number(circles.arksonge) || 0,
        "system.notes.creation": creationRemainderNote(state)
      }, { render: false });

      await upsertCreationPeople(this.actor, state, status.people);
      await upsertCreationSkills(this.actor, skillEntries);
      await upsertCreationSpecialties(this.actor, specialtyEntries);

      await abandonCreation(this.actor);

      ui.notifications?.info?.("Arkhanval | Création du personnage finalisée.");
      await this.close();
      this.actor.sheet?.render({ force: true });
    } catch (error) {
      console.error("Arkhanval | Échec de finalisation de la création", error);
      ui.notifications?.error?.(
        "Arkhanval | La finalisation a échoué. Les choix du wizard sont conservés pour permettre une nouvelle tentative."
      );
    } finally {
      this._finalizing = false;
    }
  }

  static async #onNavigateStep(event, target) {
    if (!this.actor?.isOwner) return;
    const step = target?.dataset?.step;
    const state = getCreationState(this.actor) ?? defaultCreationState();
    if (!isStepNavigable(state, step)) return;

    await saveCreationState(this.actor, {
      status: "guided",
      step
    });
    this.render({ force: true });
  }

  static async #onBackToSkills() {
    if (!this.actor?.isOwner) return;
    await saveCreationState(this.actor, {
      status: "guided",
      step: "skills"
    });
    this.render({ force: true });
  }

  static async #onBackToArchetypes() {
    if (!this.actor?.isOwner) return;
    await saveCreationState(this.actor, {
      status: "guided",
      step: "archetypes"
    });
    this.render({ force: true });
  }

  static async #onBackToArks() {
    if (!this.actor?.isOwner) return;
    await saveCreationState(this.actor, {
      status: "guided",
      step: "people"
    });
    this.render({ force: true });
  }

  static async #onBackToProfile() {
    if (!this.actor?.isOwner) return;
    await saveCreationState(this.actor, {
      status: "guided",
      step: "profile"
    });
    this.render({ force: true });
  }

  static async #onBackToEntry() {
    if (!this.actor?.isOwner) return;
    await saveCreationState(this.actor, {
      status: "entry",
      step: "entry"
    });
    this.render({ force: true });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = getCreationState(this.actor) ?? defaultCreationState();
    const profile = state.profile ? CREATION_PROFILES[state.profile] ?? null : null;

    context.actor = this.actor;
    context.editable = Boolean(this.actor?.isOwner);
    context.canCreateNpc = Boolean(this.actor?.isOwner && game.user?.isGM);
    context.state = state;
    context.isEntry = state.status === "entry";
    context.isGuided = state.status === "guided";
    context.isProfileStep = state.status === "guided" && state.step === "profile";
    context.isPeopleStep = state.status === "guided" && state.step === "people";
    context.isArchetypeStep = state.status === "guided" && state.step === "archetypes";
    context.isSkillsStep = state.status === "guided" && state.step === "skills";
    context.isSummaryStep = state.status === "guided" && state.step === "summary";
    context.profile = profile;
    context.profiles = Object.values(CREATION_PROFILES).map((entry) => ({
      ...entry,
      selected: entry.id === state.profile
    }));

    const selectedPeople = state.people
      ? CREATION_PEOPLES.find((entry) => entry.id === state.people) ?? null
      : null;
    context.selectedPeople = selectedPeople;
    context.peoples = CREATION_PEOPLES.map((entry) => ({
      ...entry,
      selected: entry.id === state.people
    }));

    const arkSetup = selectedPeople
      ? (state.arks?.peopleId === selectedPeople.id
        ? state.arks
        : defaultArkSetup(selectedPeople.id))
      : null;
    const arkStatus = selectedPeople ? arkSetupStatus(selectedPeople.id, arkSetup) : null;
    const arkMode = selectedPeople ? arkModeContext(selectedPeople.id, arkSetup) : null;

    context.arkSetup = arkSetup;
    context.arkStatus = arkStatus;
    context.arkMode = arkMode;
    context.arkCards = selectedPeople
      ? CREATION_ARKS.map((ark) => ({
          ...ark,
          rank: arkStatus.ranks[ark.id],
          circles: Number(arkSetup?.circles?.[ark.id]) || 0,
          canRemoveCircle: (Number(arkSetup?.circles?.[ark.id]) || 0) > 0,
          canAddCircle: arkStatus.circlesTotal < 2,
          manual: ["manual-mj", "therianthrope-manual"].includes(arkMode.mode)
        }))
      : [];

    const archetypeStatus = archetypeSelectionStatus(state);
    context.archetypeStatus = archetypeStatus;
    context.archetypeCards = CREATION_ARCHETYPES.map((entry) => {
      const selected = archetypeStatus.selected.includes(entry.id);
      return {
        ...entry,
        selected,
        disabled: !selected && archetypeStatus.count >= 2
      };
    });
    context.selectedArchetypes = archetypeStatus.selected
      .map((id) => CREATION_ARCHETYPES.find((entry) => entry.id === id))
      .filter(Boolean);
    context.elfinienMagicianWarning = state.people === "elfiniens"
      && archetypeStatus.selected.includes("magicien");

    const skillsStatus = skillsStepStatus(state);
    const primaryArchetypes = archetypeStatus.selected;
    const activeSkillArchetype = ARKHANVAL_ARCHETYPES.some(
      (entry) => entry.id === state.skills.activeArchetype
    )
      ? state.skills.activeArchetype
      : archetypeStatus.selected[0] ?? "artisan";
    const activeArchetypeConfig = ARKHANVAL_ARCHETYPES.find(
      (entry) => entry.id === activeSkillArchetype
    ) ?? ARKHANVAL_ARCHETYPES[0];
    const activeArchetypeMeta = CREATION_ARCHETYPES.find(
      (entry) => entry.id === activeSkillArchetype
    );

    const specialtyView = state.skills.pane === "specialties"
      ? (
          state.skills.specialtyView === "primary"
          || primaryArchetypes.includes(state.skills.specialtyView)
            ? "primary"
            : state.skills.specialtyView
        )
      : state.skills.specialtyView;

    context.skillsStatus = skillsStatus;
    context.skillsPaneIsSkills = state.skills.pane !== "specialties";
    context.skillsPaneIsSpecialties = state.skills.pane === "specialties";
    context.isMagicianPrimary = primaryArchetypes.includes("magicien");
    context.specialtyDualPrimaryView = state.skills.pane === "specialties" && specialtyView === "primary";

    context.skillArchetypeTabs = CREATION_ARCHETYPES.map((entry) => {
      const isPrimary = primaryArchetypes.includes(entry.id);
      const canonicalArchetype = ARKHANVAL_ARCHETYPES.find((archetype) => archetype.id === entry.id);
      const purchasedSkillCount = canonicalArchetype?.skills.filter(
        (skill) => creationSkillPaidCost(state, skill.identifier) > 0
      ).length ?? 0;
      const specialtyActive = state.skills.pane === "specialties"
        ? (specialtyView === "primary" ? isPrimary : entry.id === specialtyView)
        : false;
      const specialtyLocked = state.skills.pane === "specialties"
        && !isPrimary
        && skillsStatus.specialties.allowedSecondary === 0;

      return {
        id: entry.id,
        label: entry.label,
        image: entry.image,
        active: state.skills.pane === "skills" ? entry.id === activeSkillArchetype : specialtyActive,
        primary: isPrimary,
        purchasedSkillCount,
        faded: state.skills.pane === "skills"
          ? entry.id !== activeSkillArchetype
          : (specialtyView === "primary" ? !isPrimary : entry.id !== specialtyView),
        specialtyLocked
      };
    });

    context.activeSkillArchetype = {
      id: activeSkillArchetype,
      label: activeArchetypeMeta?.label ?? activeSkillArchetype,
      image: activeArchetypeMeta?.image ?? "",
      primary: primaryArchetypes.includes(activeSkillArchetype)
    };

    context.creationSkillRows = activeArchetypeConfig.skills.map((skill) => {
      const rank = creationSkillRank(state, skill.identifier);
      const grant = creationSkillGrant(state.people, skill.identifier);
      const finalRank = rank + grant.postCreationBonus;
      const totalCost = creationSkillPaidCost(state, skill.identifier);
      const nextCost = creationSkillNextCost(state, skill.identifier);

      return {
        identifier: skill.identifier,
        name: game.i18n.localize(skill.labelKey),
        rank,
        finalRank,
        totalCost,
        nextCost,
        costDisplay: nextCost === null ? "—" : nextCost,
        grantLabel: grant.label,
        hasGrant: Boolean(grant.label),
        hasPostCreationBonus: grant.postCreationBonus > 0,
        canDecrease: rank > grant.freeRank,
        canIncrease: nextCost !== null
          && nextCost <= skillsStatus.budget.remaining
      };
    });

    const specialtyCounts = Object.fromEntries(
      CREATION_SPECIALTIES.map((entry) => [
        entry.id,
        skillsStatus.specialties.selected.filter((id) => id === entry.id).length
      ])
    );

    const buildSpecialtyPanel = (archetypeId) => {
      const meta = CREATION_ARCHETYPES.find((entry) => entry.id === archetypeId);
      const secondaryPanel = !primaryArchetypes.includes(archetypeId);

      return {
        id: archetypeId,
        label: meta?.label ?? archetypeId,
        image: meta?.image ?? "",
        primary: !secondaryPanel,
        rows: CREATION_SPECIALTIES
          .filter((entry) => entry.archetype === archetypeId)
          .map((entry) => {
            const count = specialtyCounts[entry.id] ?? 0;
            const secondaryBlocked = secondaryPanel
              && skillsStatus.specialties.secondaryCount >= skillsStatus.specialties.allowedSecondary;

            return {
              ...entry,
              count,
              selected: count > 0,
              primary: !secondaryPanel,
              canRemove: count > 0,
              canAdd: skillsStatus.specialties.count < skillsStatus.specialties.required
                && !secondaryBlocked
            };
          })
      };
    };

    const specialtyPanelIds = state.skills.pane === "specialties"
      ? (
          specialtyView === "primary"
            ? primaryArchetypes
            : [specialtyView]
        )
      : [];

    context.creationSpecialtyPanels = specialtyPanelIds.map(buildSpecialtyPanel);

    context.canResetSkills = skillsStatus.budget.spent > 0
      || skillsStatus.specialties.count > 0;

    context.selectedSpecialtySummary = skillsStatus.specialties.selected.map((id, index) => {
      const entry = getCreationSpecialty(id);
      return {
        index: index + 1,
        id,
        name: entry?.name ?? id,
        archetype: CREATION_ARCHETYPES.find((a) => a.id === entry?.archetype)?.label ?? entry?.archetype ?? "",
        secondary: entry ? !primaryArchetypes.includes(entry.archetype) : false
      };
    });

    const finalStatus = finalCreationStatus(state);
    const finalSkillEntries = finalCreationSkillEntries(state);
    const finalSpecialtyEntries = finalCreationSpecialtyEntries(state);

    context.finalCreationValid = finalStatus.valid;
    context.summaryProfile = finalStatus.profile;
    context.summaryPeople = finalStatus.people;
    context.summaryArks = selectedPeople && arkStatus
      ? CREATION_ARKS.map((ark) => {
          const circles = Number(arkSetup?.circles?.[ark.id]) || 0;
          return {
            ...ark,
            rank: arkStatus.ranks[ark.id],
            circles,
            circlesLabel: `${circles} ${circles === 1 ? "cercle" : "cercles"}`
          };
        })
      : [];
    context.summaryArchetypes = archetypeStatus.selected
      .map((id) => CREATION_ARCHETYPES.find((entry) => entry.id === id))
      .filter(Boolean);
    context.summarySkills = finalSkillEntries.map((entry) => ({
      ...entry,
      archetypeLabel: CREATION_ARCHETYPES.find((archetype) => archetype.id === entry.archetype)?.label ?? entry.archetype,
      hasGrant: Boolean(entry.grantLabel)
    }));
    context.summarySpecialties = finalSpecialtyEntries.map((entry) => ({
      ...entry,
      archetypeLabel: CREATION_ARCHETYPES.find((archetype) => archetype.id === entry.archetype)?.label ?? entry.archetype
    }));
    context.summarySkillSpent = skillsStatus.budget.spent;
    context.summarySkillTotal = skillsStatus.budget.total;
    context.summarySkillRemaining = skillsStatus.budget.remaining;
    context.summarySkillRemainingLabel = `${skillsStatus.budget.remaining} ${
      skillsStatus.budget.remaining === 1 ? "point non dépensé" : "points non dépensés"
    }`;
    context.summaryBaseRemaining = skillsStatus.budget.baseRemaining;
    context.summaryBaseRemainingLabel = `${skillsStatus.budget.baseRemaining} ${
      skillsStatus.budget.baseRemaining === 1 ? "point de base reste" : "points de base restent"
    } non dépensé${skillsStatus.budget.baseRemaining === 1 ? "" : "s"}`;
    context.summaryUnusedHumanBonus = skillsStatus.budget.unusedSkillBonus;
    context.summaryUnusedHumanBonusLabel = `${skillsStatus.budget.unusedSkillBonus} ${
      skillsStatus.budget.unusedSkillBonus === 1 ? "point" : "points"
    } du bonus humain réservé${skillsStatus.budget.unusedSkillBonus === 1 ? "" : "s"} aux compétences ${
      skillsStatus.budget.unusedSkillBonus === 1 ? "reste inutilisé" : "restent inutilisés"
    }`;
    context.summaryHasMagician = primaryArchetypes.includes("magicien");

    context.progressSteps = CREATION_STEP_ORDER.map((id) => {
      const reached = stepIndex(id) <= stepIndex(state.furthestStep);
      const accessible = isStepNavigable(state, id);
      const active = id === state.step;
      return {
        id,
        label: CREATION_STEP_LABELS[id],
        active,
        reached,
        clickable: context.editable && reached && accessible && !active,
        locked: !reached || !accessible
      };
    });
    return context;
  }

  async _onClose(options) {
    CREATION_APPS.delete(this.actor.id);
    return super._onClose(options);
  }
}
