import { showEvaluatedRoll } from "./integrations/dice-so-nice.mjs";
import { ARKHANVAL_ARCHETYPES, ARKHANVAL_ARKS } from "./config.mjs";
import { buildResolutionChatContent, documentSafeClone } from "./resolution/chat.mjs";
import { rerollSelectedD10 } from "./resolution/engine.mjs";
import { advanceArk } from "./arks.mjs";
import { cancelSpellIncantation, recordIncantationContribution } from "./magic/incantation.mjs";
import { recordWorkProgress } from "./work.mjs";
import { recordBookProgress } from "./book.mjs";
import { dispatchChatProgressionAction, registerChatProgressionAction, userCanProgressActor } from "./chat-actions.mjs";

const { DialogV2 } = foundry.applications.api;

const SKILL_COSTS = Object.freeze({
  primary: Object.freeze([5, 10, 15, 20, 25, 30]),
  secondary: Object.freeze([10, 20, 30, 40, 50, 60])
});


function bookCompletionNoticeContent(content) {
  const source = String(content ?? "");
  const notice = `
      <section class="arkhanval-resolution-card__book-completed-notice">
        La lecture est terminée. Le Maître du jeu va t’indiquer ce que cette lecture t’a apporté.
      </section>
    `;
  return source.replace(
    /<section class="arkhanval-resolution-card__book-progress">[\s\S]*?<\/section>/,
    notice.trim()
  );
}

const EXPERIENCE_DIE = Object.freeze({
  1: { type: "archetype", id: "artisan" },
  2: { type: "archetype", id: "artiste" },
  3: { type: "archetype", id: "combattant" },
  4: { type: "archetype", id: "erudit" },
  5: { type: "archetype", id: "explorateur" },
  6: { type: "archetype", id: "magicien" },
  7: { type: "archetype", id: "roublard" },
  8: { type: "archetype", id: "stratege" },
  9: { type: "ark", id: "arkentropie" },
  10: { type: "ark", id: "arkoeur" },
  11: { type: "ark", id: "arksonge" },
  12: { type: "choice", id: "arkhanval" }
});
const SPECIALTIES_BY_ARCHETYPE = Object.freeze({
  artisan: Object.freeze([
    "Affinité empathique avec un matériau",
    "Doué avec ses mains",
    "Jamais d’erreur",
    "Maître armurier",
    "Maître artisan",
    "Perfectionnement",
    "Rattraper le coup"
  ]),
  artiste: Object.freeze([
    "Art de la séduction",
    "Connaissance des arts",
    "Improvisateur",
    "Monomane",
    "Passionné",
    "Sens du spectacle",
    "Totale maîtrise"
  ]),
  combattant: Object.freeze([
    "Armes de prédilection",
    "Arts martiaux",
    "Cavalier émérite",
    "Dégâts augmentés",
    "Expert au bouclier",
    "Expert en arme de défense",
    "Maître d’armes",
    "Redoutable efficacité",
    "Sans gêne",
    "Science de l’esquive",
    "Second usage de l’arme",
    "Tireur d’élite",
    "Usage multiple",
    "Vision périphérique"
  ]),
  erudit: Object.freeze([
    "Défier la logique",
    "Doué",
    "Grand lecteur",
    "Grande maîtrise",
    "Grand pédagogue",
    "Grand orateur",
    "Hypermnésie",
    "Monomane",
    "Savant",
    "Soif de connaissance"
  ]),
  explorateur: Object.freeze([
    "6e sens",
    "Comme un poisson dans l’eau",
    "Instinct de survie",
    "Maîtrise avancée",
    "Monture extraordinaire",
    "Pied marin",
    "Polyvalent",
    "Résistant",
    "Seconde chance",
    "Observateur"
  ]),
  magicien: Object.freeze([
    "Contrôle mental",
    "Expert",
    "Grand pouvoir",
    "Je vois tout, je sais tout, j’entends tout",
    "Magie discrète",
    "Magie surpuissante",
    "Monomane",
    "Naturellement doué",
    "Quête d’absolu",
    "Résistance magique",
    "Sens de la magie",
    "Sommeil du juste",
    "Sortilèges plus rapides"
  ]),
  roublard: Object.freeze([
    "Chance insolente",
    "Maîtrise avancée",
    "Incognito",
    "Pickpocket",
    "Rapide comme le vent",
    "Savoir rebondir",
    "Souplesse du serpent",
    "Tours de passe-passe",
    "Voltigeur"
  ]),
  stratege: Object.freeze([
    "Changer la donne",
    "De la théorie à la pratique",
    "Défier la logique",
    "Lecteur chevronné",
    "Leader-né",
    "Monomane",
    "Perfectionnement",
    "Planificateur",
    "Savantes déductions"
  ])
});

const PROGRESSION_DIALOGS = new WeakMap();


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function primaryArchetypeIds(actor) {
  return Array.from(actor.system.archetypes?.primary ?? []).filter(Boolean).slice(0, 2);
}

export function isPrimaryArchetype(actor, archetypeId) {
  return primaryArchetypeIds(actor).includes(archetypeId);
}

export function skillXpCostForNextRank(currentRank, primary) {
  const target = Math.max(1, Math.trunc(Number(currentRank) || 0) + 1);
  const index = Math.min(target, 6) - 1;
  return SKILL_COSTS[primary ? "primary" : "secondary"][index];
}

export function specialtyXpCost(actor, archetypeId) {
  return isPrimaryArchetype(actor, archetypeId) ? 20 : 30;
}

export function experienceDieFace(value) {
  return EXPERIENCE_DIE[Math.trunc(Number(value))] ?? null;
}

async function rollDie(faces) {
  const RollClass = globalThis.foundry?.dice?.Roll ?? globalThis.Roll;
  if (!RollClass) throw new Error("API Roll de Foundry indisponible.");
  const roll = await new RollClass(`1d${faces}`).evaluate();
  await showEvaluatedRoll(roll);
  return Number(roll.total);
}

async function ensureSkillItem(actor, skill) {
  if (skill.itemId) {
    const existing = actor.items.get(skill.itemId);
    if (existing?.type === "skill") return existing;
  }
  // Après une création d'Item réussie mais une mise à jour Chat échouée,
  // la source initiale n'a pas forcément encore d'itemId : retrouver l'Item existant.
  const existingByIdentity = actor.items.find?.(item => item.type === "skill"
    && (skill.identifier
      ? item.system.identifier === skill.identifier
      : item.name === skill.name && item.system.archetype === skill.archetype));
  if (existingByIdentity) return existingByIdentity;

  const [created] = await actor.createEmbeddedDocuments("Item", [{
    name: skill.name,
    type: "skill",
    system: {
      identifier: skill.identifier,
      archetype: skill.archetype,
      rank: Number(skill.rank) || 0,
      xp: Number(skill.xp) || 0
    }
  }], { render: false });

  return created;
}

export async function addSkillExperience(actor, skill, amount = 1) {
  const item = await ensureSkillItem(actor, skill);
  const next = Math.max(0, (Number(item.system.xp) || 0) + Math.trunc(Number(amount) || 0));
  await item.update({ "system.xp": next });
  return { item, value: next };
}

export async function addArchetypeExperience(actor, archetypeId, amount = 1) {
  const current = Number(actor.system.archetypes?.xp?.[archetypeId]) || 0;
  const next = Math.max(0, current + Math.trunc(Number(amount) || 0));
  await actor.update(
    { [`system.archetypes.xp.${archetypeId}`]: next }
  );
  return next;
}

export async function addArkCircles(actor, arkId, amount = 1) {
  const current = Number(actor.system.arks?.[arkId]?.circles) || 0;
  const next = Math.min(10, Math.max(0, current + Math.trunc(Number(amount) || 0)));
  await actor.update(
    { [`system.arks.${arkId}.circles`]: next }
  );
  return next;
}

export async function spendArkCircle(actor, arkId) {
  // Les données restent conservées en PJ ↔ PNJ ; une vue PNJ ne dépense jamais de cercle.
  if (actor?.getFlag?.("arkhanval", "viewMode") === "npc") return false;
  const current = Number(actor.system.arks?.[arkId]?.circles) || 0;
  if (current <= 0) return false;
  await actor.update(
    { [`system.arks.${arkId}.circles`]: current - 1 }
  );
  return true;
}

export async function promptSkillAdvance(actor, skill) {
  const existingItem = skill.itemId ? actor.items.get(skill.itemId) : null;
  if (existingItem && !existingItem.isOwner && !actor.isOwner) return false;
  if (!existingItem && !actor.isOwner) return false;

  const rank = Number(existingItem?.system.rank ?? skill.rank) || 0;
  const xp = Number(existingItem?.system.xp ?? skill.xp) || 0;
  const archetypeId = existingItem?.system.archetype ?? skill.archetype;
  const primary = isPrimaryArchetype(actor, archetypeId);
  const cost = skillXpCostForNextRank(rank, primary);
  const canAdvance = xp >= cost;
  const xpStatus = canAdvance
    ? `reliquat après progression : <strong>${xp - cost}</strong>`
    : `XP manquants : <strong>${cost - xp}</strong>`;

  const result = await DialogV2.wait({
    window: { title: `Progression — ${skill.name}` },
    content: `
      <div class="arkhanval-phase04-dialog">
        <p><strong>${escapeHtml(skill.name)}</strong></p>
        <p>Rang ${rank} → <strong>${rank + 1}</strong></p>
        <p>${primary ? "Compétence principale" : "Compétence secondaire"} : <strong>${cost} XP</strong></p>
        <p>XP disponible : ${xp} · ${xpStatus}</p>
        ${canAdvance ? "" : "<p><small>Progression impossible avec l’XP disponible.</small></p>"}
      </div>
    `,
    modal: true,
    rejectClose: false,
    buttons: [
      {
        action: "close",
        label: "Fermer",
        icon: "fa-solid fa-xmark",
        default: !canAdvance
      },
      ...(canAdvance
        ? [{
            action: "advance",
            label: "Monter le rang",
            icon: "fa-solid fa-arrow-up",
            default: true
          }]
        : [])
    ]
  });

  if (result !== "advance") return false;

  const item = existingItem ?? await ensureSkillItem(actor, skill);
  await item.update({
    "system.rank": rank + 1,
    "system.xp": xp - cost
  });

  ui.notifications?.info?.(`Arkhanval | ${skill.name} passe au rang ${rank + 1}.`);
  return true;
}

export async function promptSpecialtyPurchase(actor, archetypeId) {
  const archetype = ARKHANVAL_ARCHETYPES.find((entry) => entry.id === archetypeId);
  if (!archetype) return false;

  const currentXp = Number(actor.system.archetypes?.xp?.[archetypeId]) || 0;
  const cost = specialtyXpCost(actor, archetypeId);

  if (currentXp < cost) {
    ui.notifications?.info?.(
      `Arkhanval | ${currentXp} XP disponibles dans ${game.i18n.localize(archetype.labelKey)}, ${cost} XP requis.`
    );
    return false;
  }

  const result = await DialogV2.input({
    window: { title: `Acquérir une spécialité — ${game.i18n.localize(archetype.labelKey)}` },
    content: `
      <div class="arkhanval-phase04-dialog">
        <p>Coût : <strong>${cost} XP</strong> · disponible : ${currentXp}</p>
        <label>
          <span>Nom de la spécialité</span>
          <input type="text" name="name" required autofocus>
        </label>
        <p><small>Le système crée uniquement l’Item. Les effets particuliers restent appliqués selon leur règle propre.</small></p>
      </div>
    `,
    modal: true,
    rejectClose: false,
    ok: {
      label: "Acquérir",
      icon: "fa-solid fa-plus"
    }
  });

  if (!result) return false;
  const name = String(result.name ?? "").trim();
  if (!name) return false;

  await actor.createEmbeddedDocuments("Item", [{
    name,
    type: "specialty",
    system: { archetype: archetypeId }
  }], { render: false });

  await actor.update(
    { [`system.archetypes.xp.${archetypeId}`]: currentXp - cost }
  );

  ui.notifications?.info?.(`Arkhanval | Spécialité « ${name} » acquise.`);
  return true;
}

function progressionSkillEntries(actor) {
  return actor.items
    .filter((item) => item.type === "skill")
    .map((item) => {
      const rank = Number(item.system.rank) || 0;
      const xp = Number(item.system.xp) || 0;
      const primary = isPrimaryArchetype(actor, item.system.archetype);
      const cost = skillXpCostForNextRank(rank, primary);
      return {
        itemId: item.id,
        name: item.name,
        rank,
        nextRank: rank + 1,
        xp,
        cost,
        remaining: xp - cost,
        primary
      };
    })
    .filter((entry) => entry.xp >= entry.cost)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

function progressionArchetypeEntries(actor) {
  return ARKHANVAL_ARCHETYPES
    .map((archetype) => {
      const xp = Number(actor.system.archetypes?.xp?.[archetype.id]) || 0;
      const cost = specialtyXpCost(actor, archetype.id);
      return {
        id: archetype.id,
        label: game.i18n.localize(archetype.labelKey),
        xp,
        cost,
        remaining: xp - cost,
        specialties: SPECIALTIES_BY_ARCHETYPE[archetype.id] ?? []
      };
    })
    .filter((entry) => entry.xp >= entry.cost && entry.specialties.length);
}

function progressionArkEntries(actor) {
  return ARKHANVAL_ARKS
    .map((ark) => ({
      id: ark.id,
      label: ark.label,
      rank: Number(actor.system.arks?.[ark.id]?.rank) || 0,
      circles: Number(actor.system.arks?.[ark.id]?.circles) || 0
    }))
    .filter((entry) => entry.circles >= 10);
}

export function buildProgressionAvailability(actor) {
  const skills = progressionSkillEntries(actor);
  const archetypes = progressionArchetypeEntries(actor);
  const arks = progressionArkEntries(actor);
  return {
    skills,
    archetypes,
    arks,
    hasAny: Boolean(skills.length || archetypes.length || arks.length)
  };
}

// Le panier est purement local jusqu'à la validation explicite.
// Chaque réserve (compétence / archétype / cercles) conserve sa propre comptabilité.
function progressionSimulation(actor, operations, { strict = false } = {}) {
  const skills = new Map(actor.items.filter(i => i.type === "skill").map(i => [i.id, {
    item: i, rank: Number(i.system.rank) || 0, xp: Number(i.system.xp) || 0,
    initialXp: Number(i.system.xp) || 0, initialRank: Number(i.system.rank) || 0
  }]));
  const archetypes = new Map(ARKHANVAL_ARCHETYPES.map(a => [a.id, {
    xp: Number(actor.system.archetypes?.xp?.[a.id]) || 0,
    initialXp: Number(actor.system.archetypes?.xp?.[a.id]) || 0
  }]));
  const arks = new Map(ARKHANVAL_ARKS.map(a => [a.id, {
    rank: Number(actor.system.arks?.[a.id]?.rank) || 0,
    circles: Number(actor.system.arks?.[a.id]?.circles) || 0
  }]));
  const rows = [];
  const fail = (reason) => { if (strict) throw new Error(reason); return null; };
  for (let index = 0; index < operations.length; index++) {
    const op = operations[index];
    if (op.type === "skill") {
      const value = skills.get(op.id);
      if (!value || !value.item) return fail("Compétence introuvable.");
      const cost = skillXpCostForNextRank(value.rank, isPrimaryArchetype(actor, value.item.system.archetype));
      if (value.xp < cost) return fail(`XP insuffisants : ${value.item.name}.`);
      rows.push({ index, label: value.item.name, change: `Rang ${value.rank} → ${value.rank + 1}`, cost: `${cost} XP`, pool: value.item.name });
      value.rank++; value.xp -= cost;
    } else if (op.type === "specialty") {
      const value = archetypes.get(op.id);
      const allowed = SPECIALTIES_BY_ARCHETYPE[op.id] ?? [];
      if (!value || !allowed.includes(op.name)) return fail("Spécialité invalide.");
      if (actor.items.some(i => i.type === "specialty" && i.name === op.name && i.system.archetype === op.id)
          || operations.slice(0, index).some(p => p.type === "specialty" && p.id === op.id && p.name === op.name)) {
        return fail(`Spécialité déjà acquise ou préparée : ${op.name}.`);
      }
      const cost = specialtyXpCost(actor, op.id);
      if (value.xp < cost) return fail(`XP insuffisants pour ${op.name}.`);
      const name = game.i18n.localize(ARKHANVAL_ARCHETYPES.find(a => a.id === op.id).labelKey);
      rows.push({ index, label: `${name} — ${op.name}`, change: "Non acquise → acquise", cost: `${cost} XP`, pool: name });
      value.xp -= cost;
    } else if (op.type === "ark") {
      const value = arks.get(op.id);
      if (!value || value.circles < 10) return fail("Cercles d’Ark insuffisants.");
      const ark = ARKHANVAL_ARKS.find(a => a.id === op.id);
      rows.push({ index, label: ark.label, change: `Rang ${value.rank} → ${value.rank + 1}`, cost: "10 cercles", pool: ark.label });
      value.rank++; value.circles = 0;
    } else return fail("Opération de progression inconnue.");
  }
  return { skills, archetypes, arks, rows };
}

export function renderProgressionContent(actor, operations = []) {
  const simulation = progressionSimulation(actor, operations, { strict: true });
  const primaries = primaryArchetypeIds(actor);
  const state = buildProgressionAvailability(actor);
  const skills = [...simulation.skills.values()]
    .filter(v => v.xp >= skillXpCostForNextRank(v.rank, isPrimaryArchetype(actor, v.item.system.archetype)))
    .sort((a,b) => a.item.name.localeCompare(b.item.name, "fr"));
  const archetypes = ARKHANVAL_ARCHETYPES.map(a => ({ ...a, ...simulation.archetypes.get(a.id), specialties: SPECIALTIES_BY_ARCHETYPE[a.id] ?? [] }));
  const arks = ARKHANVAL_ARKS.map(a => ({ ...a, ...simulation.arks.get(a.id) })).filter(a => a.circles >= 10);
  const pools = [
    ...[...simulation.skills.values()].filter(v => v.initialXp || v.initialXp !== v.xp)
      .map(v => ({ label: v.item.name, initial: v.initialXp, remaining: v.xp, unit: "XP" })),
    ...archetypes.map(a => ({ label: game.i18n.localize(a.labelKey), initial: a.initialXp, remaining: a.xp, unit: "XP" }))
      .filter(v => v.initial || v.initial !== v.remaining)
  ];
  const skillRow = v => {
    const cost = skillXpCostForNextRank(v.rank, isPrimaryArchetype(actor, v.item.system.archetype));
    return `<div class="arkhanval-progression-row"><div class="arkhanval-progression-row__body"><strong>${escapeHtml(v.item.name)}</strong><small>Rang ${v.rank} → ${v.rank + 1} · Coût : ${cost} XP</small><small class="arkhanval-progression-balance">${v.xp} XP disponibles</small></div>
      <button type="button" data-progression-skill="${escapeHtml(v.item.id)}"><i class="fa-solid fa-plus" aria-hidden="true"></i> Préparer</button></div>`;
  };
  const archetypeBlock = a => {
    const localSkills = skills.filter(v => v.item.system.archetype === a.id);
    const acquired = new Set(actor.items.filter(i => i.type === "specialty" && i.system.archetype === a.id).map(i => i.name));
    for (const op of operations) if (op.type === "specialty" && op.id === a.id) acquired.add(op.name);
    const available = a.specialties.filter(name => !acquired.has(name));
    const canBuySpecialty = available.length && a.xp >= specialtyXpCost(actor, a.id);
    return `<div class="arkhanval-progression-archetype"><h4><img class="arkhanval-progression-icon" src="systems/arkhanval/assets/icones/archetype/${escapeHtml(a.id)}.webp" alt="" loading="lazy">${escapeHtml(game.i18n.localize(a.labelKey))}</h4>
      ${localSkills.length ? `<div class="arkhanval-progression-list">${localSkills.map(skillRow).join("")}</div>` : ""}
      ${canBuySpecialty ? `<div class="arkhanval-progression-row arkhanval-progression-row--specialty"><div class="arkhanval-progression-row__body"><strong>Acquérir une spécialité</strong><small>Coût : ${specialtyXpCost(actor,a.id)} XP · ${a.xp} XP disponibles</small>
        <select aria-label="Spécialité" data-progression-specialty-select="${escapeHtml(a.id)}">${available.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("")}</select></div>
        <button type="button" data-progression-specialty="${escapeHtml(a.id)}"><i class="fa-solid fa-plus" aria-hidden="true"></i> Préparer</button></div>` : ""}
      ${!localSkills.length && !canBuySpecialty ? `<p class="arkhanval-progression-muted">Aucune progression accessible actuellement.</p>` : ""}
    </div>`;
  };
  const primaryBlocks = archetypes.filter(a => primaries.includes(a.id)).map(archetypeBlock);
  const secondaryBlocks = archetypes.filter(a => !primaries.includes(a.id)).map(archetypeBlock)
    .filter((block, i) => {
      const a = archetypes.filter(a => !primaries.includes(a.id))[i];
      return skills.some(v => v.item.system.archetype === a.id) || a.specialties.some(name => !actor.items.some(it => it.type === "specialty" && it.system.archetype === a.id && it.name === name)) && a.xp >= specialtyXpCost(actor,a.id);
    });
  const otherSkills = skills.filter(v => !archetypes.some(a => a.id === v.item.system.archetype));
  return `<div class="arkhanval-progression-window" data-progression-content>
    <p class="arkhanval-progression-intro">Choisissez les évolutions de votre personnage. Elles ne seront appliquées qu'après validation.</p>
    <section class="arkhanval-progression-section arkhanval-progression-group" data-progression-group="primary"><h3><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> Archétypes principaux</h3>
      ${primaryBlocks.length ? primaryBlocks.join("") : "<p class=\"arkhanval-progression-muted\">Aucun archétype principal défini.</p>"}
    </section>
    <section class="arkhanval-progression-section arkhanval-progression-group" data-progression-group="arks"><h3><img class="arkhanval-progression-icon" src="systems/arkhanval/assets/icones/ark/arksonge.webp" alt="" loading="lazy"> Arks</h3>
      ${arks.length ? `<div class="arkhanval-progression-list">${arks.map(v => `<div class="arkhanval-progression-row"><img class="arkhanval-progression-icon" src="systems/arkhanval/assets/icones/ark/${escapeHtml(v.id)}.webp" alt="" loading="lazy"><div class="arkhanval-progression-row__body"><strong>${escapeHtml(v.label)}</strong><small>Rang ${v.rank} → ${v.rank + 1} · 10 cercles (repos ou méditation selon les règles)</small><small class="arkhanval-progression-balance">${v.circles}/10 cercles</small></div><button type="button" data-progression-ark="${escapeHtml(v.id)}"><i class="fa-solid fa-plus" aria-hidden="true"></i> Préparer</button></div>`).join("")}</div>` : "<p class=\"arkhanval-progression-muted\">Aucune progression d’Ark disponible.</p>"}
    </section>
    <section class="arkhanval-progression-section arkhanval-progression-group" data-progression-group="secondary"><h3><i class="fa-solid fa-book-open" aria-hidden="true"></i> Autres archétypes</h3>
      ${secondaryBlocks.join("")}${otherSkills.length ? `<div class="arkhanval-progression-list">${otherSkills.map(skillRow).join("")}</div>` : ""}
      ${!secondaryBlocks.length && !otherSkills.length ? "<p class=\"arkhanval-progression-muted\">Aucune progression disponible pour les autres archétypes.</p>" : ""}
    </section>
    <section class="arkhanval-progression-section arkhanval-progression-summary"><h3><i class="fa-solid fa-list-check" aria-hidden="true"></i> Progressions préparées <span class="arkhanval-progression-count">(${simulation.rows.length})</span></h3>
      ${simulation.rows.length ? `<div class="arkhanval-progression-list">${simulation.rows.map(r => `
        <div class="arkhanval-progression-row"><div class="arkhanval-progression-row__body"><strong>${escapeHtml(r.label)}</strong>
          <small>${escapeHtml(r.change)} · Coût : ${escapeHtml(r.cost)}</small></div>
          <button type="button" class="arkhanval-progression-remove" data-progression-remove="${r.index}">Retirer</button></div>`).join("")}</div>` : "<p class=\"arkhanval-progression-muted\">Aucune évolution préparée.</p>"}
      ${simulation.rows.length && pools.some(v => v.initial !== v.remaining) ? `<div class="arkhanval-progression-balances">${pools.filter(v => v.initial !== v.remaining).map(v => `<div><strong>${escapeHtml(v.label)}</strong><small>${v.initial} ${v.unit} au départ · ${v.initial - v.remaining} engagés · ${v.remaining} restants</small></div>`).join("")}</div>` : ""}
      <button class="arkhanval-progression-submit" type="button" data-progression-validate ${operations.length ? "" : "disabled"}>Valider les progressions</button>
    </section>
  </div>`;
}

async function commitProgression(actor, operations) {
  if (!actor.isOwner) throw new Error("Permissions insuffisantes sur le personnage.");
  // Une modification externe pendant la préparation invalide le panier plutôt que de dépenser sur une ancienne base.
  const baseline = progressionSimulation(actor, operations, { strict: true });
  const skills = [...baseline.skills.values()].filter(v => v.rank !== v.initialRank);
  const xp = [...baseline.archetypes.entries()].filter(([,v]) => v.xp !== v.initialXp);
  const arkOps = operations.filter(op => op.type === "ark");
  const specialties = operations.filter(op => op.type === "specialty");
  // Foundry ne propose pas de transaction ACID couvrant Actor et Embedded Items :
  // on revérifie intégralement avant écriture et on séquence les opérations, sans promettre de rollback sur erreur I/O.
  if (skills.length) await actor.updateEmbeddedDocuments("Item", skills.map(v => ({ _id: v.item.id, "system.rank": v.rank, "system.xp": v.xp })));
  if (xp.length) await actor.update(Object.fromEntries(xp.map(([id,v]) => [`system.archetypes.xp.${id}`, v.xp])));
  if (specialties.length) await actor.createEmbeddedDocuments("Item", specialties.map(op => ({ name: op.name, type: "specialty", system: { archetype: op.id } })));
  // Conserver la routine Ark existante et ses rappels de progression.
  for (const op of arkOps) {
    if (!(await advanceArk(actor, op.id, { confirm: false }))) throw new Error("La progression de l’Ark n’a pas abouti.");
  }
}

export function createProgressionSession(actor) {
  return {
    operations: [],
    snapshot: progressionSnapshot(actor),
    committing: false
  };
}

/**
 * Bind the common progression workflow to any rendered Arkhanval surface.
 * The same engine is used by the legacy DialogV2 entry point and by the
 * native Actor progression page present in the current system.
 */
export function bindProgressionSurface(root, actor, session, { onRefresh, onChange } = {}) {
  const content = root?.matches?.("[data-progression-content]")
    ? root
    : root?.querySelector?.("[data-progression-content]");
  if (!content || !session) return;

  const operations = session.operations;
  const refresh = async () => { await onRefresh?.(); };
  const add = async (op) => {
    // A new basket always starts from the Actor state visible at that moment.
    if (!operations.length) session.snapshot = progressionSnapshot(actor);
    operations.push(op);
    await refresh();
  };

  for (const button of content.querySelectorAll("[data-progression-skill]")) {
    button.addEventListener("click", () => add({ type: "skill", id: button.dataset.progressionSkill }));
  }

  for (const button of content.querySelectorAll("[data-progression-specialty]")) {
    button.addEventListener("click", async () => {
      const id = button.dataset.progressionSpecialty;
      const name = content.querySelector(`[data-progression-specialty-select="${id}"]`)?.value;
      if (name) await add({ type: "specialty", id, name });
    });
  }

  for (const button of content.querySelectorAll("[data-progression-ark]")) {
    button.addEventListener("click", () => add({ type: "ark", id: button.dataset.progressionArk }));
  }

  for (const button of content.querySelectorAll("[data-progression-remove]")) {
    button.addEventListener("click", async () => {
      operations.splice(Number(button.dataset.progressionRemove), 1);
      if (!operations.length) session.snapshot = progressionSnapshot(actor);
      await refresh();
    });
  }

  content.querySelector("[data-progression-validate]")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      // The basket is invalidated if another Actor update happened while it
      // was being prepared. This preserves the safety invariant.
      if (JSON.stringify(session.snapshot) !== JSON.stringify(progressionSnapshot(actor))) {
        throw new Error("Le personnage a changé depuis la préparation : annulez les choix en cours et préparez un nouveau panier.");
      }
      session.committing = true;
      await commitProgression(actor, operations);
      operations.length = 0;
      session.snapshot = progressionSnapshot(actor);
      session.committing = false;
      await onChange?.();
      await refresh();
      ui.notifications?.info?.("Arkhanval | Progression enregistrée.");
    } catch (error) {
      session.committing = false;
      console.error("Arkhanval | Validation de la progression", error);
      ui.notifications?.error?.(`Arkhanval | ${error.message} Si une écriture a échoué, vérifiez l’état du personnage avant de recommencer.`);
      button.disabled = false;
    }
  });
}

async function refreshProgressionDialog(dialog, actor, onChange, session) {
  const content = dialog.element?.querySelector?.("[data-progression-content]");
  if (!content) return;
  const fresh = document.createElement("div");
  fresh.innerHTML = renderProgressionContent(actor, session.operations);
  content.replaceWith(fresh.firstElementChild);
  bindProgressionSurface(dialog.element, actor, session, {
    onChange,
    onRefresh: () => refreshProgressionDialog(dialog, actor, onChange, session)
  });
}

/** Signature of the reserves that determine the progression surface.
 * Shared by the preparation basket and Actor sheet's live display sync.
 */
export function progressionRevision(actor) {
  return JSON.stringify(progressionSnapshot(actor));
}

function progressionSnapshot(actor) {
  return {
    primary: primaryArchetypeIds(actor),
    skills: actor.items.filter(i => i.type === "skill").map(i => [i.id, i.system.rank, i.system.xp, i.system.archetype]).sort((a,b) => a[0].localeCompare(b[0])),
    specialties: actor.items.filter(i => i.type === "specialty").map(i => [i.id, i.name, i.system.archetype]).sort((a,b) => a[0].localeCompare(b[0])),
    xp: ARKHANVAL_ARCHETYPES.map(a => [a.id, actor.system.archetypes?.xp?.[a.id]]),
    arks: ARKHANVAL_ARKS.map(a => [a.id, actor.system.arks?.[a.id]?.rank, actor.system.arks?.[a.id]?.circles])
  };
}

export async function openProgressionWindow(actor, { onChange } = {}) {
  const existing = PROGRESSION_DIALOGS.get(actor);
  if (existing?.rendered) { existing.bringToFront(); return existing; }
  const session = createProgressionSession(actor);
  const dialog = new DialogV2({
    position: { width: 740, height: 700 },
    classes: ["arkhanval-progression-dialog"],
    window: { title: `Progression — ${actor.name}`, resizable: true },
    content: renderProgressionContent(actor, session.operations), modal: false,
    buttons: [{ action: "close", label: "Fermer sans appliquer", icon: "fa-solid fa-xmark", default: true }]
  });
  PROGRESSION_DIALOGS.set(actor, dialog);
  dialog.addEventListener("close", () => PROGRESSION_DIALOGS.delete(actor), { once: true });
  await dialog.render(true);
  bindProgressionSurface(dialog.element, actor, session, {
    onChange,
    onRefresh: () => refreshProgressionDialog(dialog, actor, onChange, session)
  });
  return dialog;
}

function allocationOptionsForChoice(actor, source) {
  const options = [];

  if (source.type === "skill") {
    options.push({
      value: "skill",
      label: `Compétence utilisée : ${source.skill.name}`
    });
  }

  for (const id of primaryArchetypeIds(actor)) {
    const archetype = ARKHANVAL_ARCHETYPES.find((entry) => entry.id === id);
    if (!archetype) continue;
    options.push({
      value: `archetype:${id}`,
      label: `Archétype principal : ${game.i18n.localize(archetype.labelKey)}`
    });
  }

  for (const ark of ARKHANVAL_ARKS) {
    options.push({
      value: `ark:${ark.id}`,
      label: `Cercle : ${ark.label}`
    });
  }

  return options;
}

function allocationOptionView(actor, source, option) {
  if (option.value === "skill" && source.type === "skill") {
    const item = source.skill.itemId ? actor.items.get(source.skill.itemId) : null;
    const rank = Number(item?.system.rank ?? source.skill.rank) || 0;
    const xp = Number(item?.system.xp ?? source.skill.xp) || 0;
    return {
      ...option,
      group: "Compétence",
      title: source.skill.name,
      detail: `Rang ${rank} · ${xp} XP`
    };
  }

  if (option.value.startsWith("archetype:")) {
    const id = option.value.split(":")[1];
    const archetype = ARKHANVAL_ARCHETYPES.find((entry) => entry.id === id);
    const xp = Number(actor.system.archetypes?.xp?.[id]) || 0;
    return {
      ...option,
      group: "Archétypes",
      title: archetype ? game.i18n.localize(archetype.labelKey) : id,
      detail: `${xp} XP`
    };
  }

  if (option.value.startsWith("ark:")) {
    const id = option.value.split(":")[1];
    const ark = ARKHANVAL_ARKS.find((entry) => entry.id === id);
    const circles = Number(actor.system.arks?.[id]?.circles) || 0;
    return {
      ...option,
      group: "Arks",
      title: ark?.label ?? id,
      detail: `${circles}/10 cercles`
    };
  }

  return { ...option, group: "Autres", title: option.label, detail: "" };
}

async function promptAllocation(title, options, actor, source) {
  if (!options.length) return null;

  const views = options.map((option) => allocationOptionView(actor, source, option));
  const groupOrder = ["Compétence", "Archétypes", "Arks", "Autres"];
  const sections = groupOrder
    .map((group) => {
      const entries = views.filter((entry) => entry.group === group);
      if (!entries.length) return "";

      const rows = entries.map((entry) => `
        <label class="arkhanval-xp-choice">
          <input type="radio" name="allocation" value="${escapeHtml(entry.value)}">
          <span class="arkhanval-xp-choice__body">
            <strong>${escapeHtml(entry.title)}</strong>
            ${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ""}
          </span>
        </label>
      `).join("");

      return `
        <section class="arkhanval-xp-choice-group">
          <h3>${escapeHtml(group)}</h3>
          <div class="arkhanval-xp-choice-list">${rows}</div>
        </section>
      `;
    })
    .join("");

  const result = await DialogV2.input({
    window: { title },
    classes: ["arkhanval", "arkhanval-popup-dialog", "arkhanval-popup-dialog--allocation"],
    content: `
      <div class="arkhanval-phase04-dialog arkhanval-xp-allocation-dialog">
        <p>Choisissez la destination du point gagné.</p>
        ${sections}
      </div>
    `,
    modal: true,
    rejectClose: false,
    ok: {
      label: "Valider le choix",
      icon: "fa-solid fa-check"
    }
  });

  if (!result) return null;
  return String(result.allocation ?? "");
}

async function applyAllocation(actor, source, allocation, contributionId = null) {
  if (!allocation) return null;
  if (contributionId && !/^[a-zA-Z0-9_-]{1,64}$/.test(contributionId)) {
    throw new Error("Identifiant de gain XP invalide.");
  }
  if (contributionId) {
    // La valeur métier et son marqueur sont écrits dans une seule mise à jour du Document.
    // Une reprise après erreur Chat ne peut pas attribuer le même gain deux fois.
    const skillItem = allocation === "skill" && source.type === "skill"
      ? await ensureSkillItem(actor, source.skill) : null;
    const target = skillItem ?? actor;
    const ledger = target.getFlag?.("arkhanval", "experienceGainLedger")
      ?? target.flags?.arkhanval?.experienceGainLedger ?? {};
    if (ledger[contributionId]) return ledger[contributionId];
    const summary = describeAllocation(actor, source, allocation);
    const updates = { "flags.arkhanval.experienceGainLedger": { ...ledger, [contributionId]: summary } };
    if (skillItem) {
      updates["system.xp"] = Math.max(0, (Number(skillItem.system.xp) || 0) + 1);
      await skillItem.update(updates);
      return summary;
    }
    if (allocation.startsWith("archetype:")) {
      const id = allocation.split(":")[1];
      if (!ARKHANVAL_ARCHETYPES.some(entry => entry.id === id)) throw new Error("Archétype XP invalide.");
      updates[`system.archetypes.xp.${id}`] = (Number(actor.system.archetypes?.xp?.[id]) || 0) + 1;
    } else if (allocation.startsWith("ark:")) {
      const id = allocation.split(":")[1];
      if (!ARKHANVAL_ARKS.some(entry => entry.id === id)) throw new Error("Ark XP invalide.");
      const before = Number(actor.system.arks?.[id]?.circles) || 0;
      updates[`system.arks.${id}.circles`] = Math.min(10, before + 1);
      if (before >= 10) {
        return await (async () => {
          const fullSummary = `${ARKHANVAL_ARKS.find(entry => entry.id === id).label} est déjà à 10 cercles`;
          updates["flags.arkhanval.experienceGainLedger"] = { ...ledger, [contributionId]: fullSummary };
          await actor.update(updates);
          return fullSummary;
        })();
      }
    } else throw new Error("Attribution XP invalide.");
    await actor.update(updates);
    return summary;
  }

  if (allocation === "skill" && source.type === "skill") {
    await addSkillExperience(actor, source.skill, 1);
    return `+1 XP : ${source.skill.name}`;
  }

  if (allocation.startsWith("archetype:")) {
    const id = allocation.split(":")[1];
    await addArchetypeExperience(actor, id, 1);
    const archetype = ARKHANVAL_ARCHETYPES.find((entry) => entry.id === id);
    return `+1 XP : ${archetype ? game.i18n.localize(archetype.labelKey) : id}`;
  }

  if (allocation.startsWith("ark:")) {
    const id = allocation.split(":")[1];
    const before = Number(actor.system.arks?.[id]?.circles) || 0;
    const after = await addArkCircles(actor, id, 1);
    const ark = ARKHANVAL_ARKS.find((entry) => entry.id === id);
    return after > before
      ? `+1 cercle : ${ark?.label ?? id}`
      : `${ark?.label ?? id} est déjà à 10 cercles`;
  }

  return null;
}

function describeAllocation(actor, source, allocation) {
  if (allocation === "skill" && source.type === "skill") {
    return `+1 XP : ${source.skill.name}`;
  }

  if (allocation?.startsWith("archetype:")) {
    const id = allocation.split(":")[1];
    const archetype = ARKHANVAL_ARCHETYPES.find((entry) => entry.id === id);
    return `+1 XP : ${archetype ? game.i18n.localize(archetype.labelKey) : id}`;
  }

  if (allocation?.startsWith("ark:")) {
    const id = allocation.split(":")[1];
    const ark = ARKHANVAL_ARKS.find((entry) => entry.id === id);
    return `+1 cercle : ${ark?.label ?? id}`;
  }

  return "Aucun gain.";
}

function experienceGainDescriptor(actor, source, face) {
  const result = experienceDieFace(face);
  if (!result) return { kind: "none", text: "Aucun gain." };

  if (result.type === "ark") {
    const allocation = `ark:${result.id}`;
    return {
      kind: "direct",
      allocation,
      text: describeAllocation(actor, source, allocation)
    };
  }

  if (result.type === "choice") {
    return {
      kind: "choice",
      options: allocationOptionsForChoice(actor, source),
      text: "Un gain au choix est disponible."
    };
  }

  const primary = primaryArchetypeIds(actor).includes(result.id);
  if (!primary) {
    const archetype = ARKHANVAL_ARCHETYPES.find((entry) => entry.id === result.id);
    return {
      kind: "none",
      text: `${archetype ? game.i18n.localize(archetype.labelKey) : result.id} n’est pas un archétype principal : aucun gain.`
    };
  }

  if (source.type === "ark") {
    const allocation = `ark:${source.arkId}`;
    return {
      kind: "direct",
      allocation,
      text: describeAllocation(actor, source, allocation)
    };
  }

  if (source.type === "skill") {
    const options = [
      {
        value: "skill",
        label: `Compétence utilisée : ${source.skill.name}`
      },
      {
        value: `archetype:${source.skill.archetype}`,
        label: "Archétype lié à la compétence"
      }
    ];
    return {
      kind: "choice",
      options,
      text: "Un point d’expérience est disponible : choisissez son attribution."
    };
  }

  return { kind: "none", text: "Aucun gain." };
}

function experienceSymbolAsset(face) {
  const value = Math.max(1, Math.min(12, Math.trunc(Number(face)) || 0));
  return `systems/arkhanval/assets/dices/symbole_${String(value).padStart(2, "0")}.webp`;
}

function experienceDieAsset() {
  return "systems/arkhanval/assets/dices/dice_arkhanval.webp";
}

function experiencePortraitAsset(actor) {
  const img = String(actor?.img ?? "").trim();
  return img || "icons/svg/mystery-man.svg";
}

function experienceCardContent(actor, face, descriptor, appliedSummary = "") {
  const applied = Boolean(appliedSummary);
  const actionLabel = applied
    ? escapeHtml(game.i18n.localize("ARKHANVAL.Phase04.ExperienceGainApplied"))
    : descriptor.kind === "direct"
      ? escapeHtml(game.i18n.localize("ARKHANVAL.Phase04.ApplyExperienceGain"))
      : descriptor.kind === "choice"
        ? escapeHtml(game.i18n.localize("ARKHANVAL.Phase04.ChooseExperienceGain"))
        : "";
  const actionData = !applied && descriptor.kind === "direct"
    ? 'data-arkhanval-experience-apply'
    : !applied && descriptor.kind === "choice"
      ? 'data-arkhanval-experience-choose'
      : "";
  const actionState = applied ? ' disabled aria-disabled="true"' : "";
  const actorName = escapeHtml(String(actor?.name ?? "Personnage"));
  const infoText = escapeHtml(appliedSummary || descriptor.text || "");

  return `
    <article class="arkhanval-experience-card arkhanval-chat-card arkhanval-chat-card--experience">
      <section class="arkhanval-experience-card__shell">
        <header class="arkhanval-experience-card__hero">
          <div class="arkhanval-experience-card__portrait-wrap">
            <img class="arkhanval-experience-card__portrait" src="${escapeHtml(experiencePortraitAsset(actor))}" alt="${actorName}" loading="lazy">
          </div>
          <div class="arkhanval-experience-card__hero-main">
            <h3 class="arkhanval-experience-card__title">Jet d’expérience</h3>
          </div>
          <div class="arkhanval-experience-card__die-wrap">
            <img class="arkhanval-experience-card__die-icon" src="${escapeHtml(experienceDieAsset())}" alt="Dé d’expérience" loading="lazy">
          </div>
        </header>

        <section class="arkhanval-experience-card__outcome">
          <div class="arkhanval-experience-card__symbol-wrap">
            <img class="arkhanval-experience-card__symbol" src="${escapeHtml(experienceSymbolAsset(face))}" alt="Résultat ${face}" loading="lazy">
          </div>
          <div class="arkhanval-experience-card__value">${Math.max(1, Math.min(12, Math.trunc(Number(face)) || 0))}</div>
          <div class="arkhanval-experience-card__text"><p>${infoText}</p></div>
        </section>

        ${actionLabel
          ? `<div class="arkhanval-experience-card__actions"><button type="button" ${actionData}${actionState}>${actionLabel}</button></div>`
          : ""}
      </section>
    </article>
  `;
}

async function postExperienceMessage(actor, source, face, sourceMessageId = null) {
  const ChatMessageClass = globalThis.foundry?.documents?.ChatMessage ?? globalThis.ChatMessage;
  if (!ChatMessageClass) return null;

  const descriptor = experienceGainDescriptor(actor, source, face);

  return ChatMessageClass.create({
    speaker: ChatMessageClass.getSpeaker({ actor }),
    content: experienceCardContent(actor, face, descriptor),
    flags: {
      arkhanval: {
        experienceGain: {
          source,
          face,
          sourceMessageId: String(sourceMessageId ?? ""),
          applied: false,
          summary: ""
        }
      }
    }
  });
}

/**
 * Roll the single experience die attached to a completed action.
 * No gain is applied here: the result card gives the player an explicit action.
 */
export async function resolveExperienceDie(actor, source, sourceMessageId = null) {
  const face = await rollDie(12);
  const message = await postExperienceMessage(actor, source, face, sourceMessageId);
  return { face, result: experienceDieFace(face), message };
}


export async function promptArkRerollSelection(actor, result) {
  if (actor?.getFlag?.("arkhanval", "viewMode") === "npc") return null;
  let attemptIndex = result?.selectedAttemptIndex;
  if ((!Number.isInteger(attemptIndex) || attemptIndex < 0) && result?.attempts?.length === 1) {
    attemptIndex = 0;
  }
  if (!Number.isInteger(attemptIndex) || attemptIndex < 0) return null;

  const attempt = result.attempts?.[attemptIndex];
  const candidates = (attempt?.chains ?? [])
    .map((chain, index) => ({ chain, index }))
    .filter(({ chain }) => chain.initialFaces === 10);

  const arks = ARKHANVAL_ARKS
    .map((ark) => ({
      ...ark,
      circles: Number(actor.system.arks?.[ark.id]?.circles) || 0
    }))
    .filter((ark) => ark.circles > 0);

  if (candidates.length < 1 || !arks.length) return null;

  const arkOptions = arks
    .map((ark) => `<option value="${escapeHtml(ark.id)}">${escapeHtml(ark.label)} (${ark.circles})</option>`)
    .join("");

  const dice = candidates
    .map(({ chain, index }) => {
      const natural = chain.rolls?.[0]?.natural ?? "?";
      return `
        <label class="arkhanval-item-tags__choice arkhanval-ark-reroll-die-choice">
          <input class="arkhanval-item-tags__native-check" type="checkbox" name="die" value="${index}">
          <span class="arkhanval-item-tags__check" aria-hidden="true"></span>
          <span class="arkhanval-item-tags__choice-label">d10 : <strong>${natural}</strong></span>
        </label>
      `;
    })
    .join("");

  const formData = await DialogV2.input({
    window: { title: "Relance d’Ark" },
    classes: ["arkhanval", "arkhanval-popup-dialog", "arkhanval-popup-dialog--dice"],
    content: `
      <div class="arkhanval-phase04-dialog">
        <p>Choisissez <strong>1 ou 2 d10</strong> à relancer et l’Ark dont vous dépensez 1 cercle.</p>
        <label>
          <span>Ark dépensé</span>
          <select name="arkId">${arkOptions}</select>
        </label>
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

        const checkboxes = Array.from(form.querySelectorAll?.('input[name="die"][type="checkbox"]') ?? []);
        const okButton = dialog?.element?.querySelector?.('button[data-action="ok"]')
          ?? form.querySelector?.('button[data-action="ok"]')
          ?? form.querySelector?.('button[type="submit"]')
          ?? null;

        const refresh = () => {
          const selected = checkboxes.filter((checkbox) => checkbox.checked);
          const count = selected.length;
          if (okButton) okButton.disabled = count < 1 || count > 2;

          const atLimit = count >= 2;
          for (const checkbox of checkboxes) {
            checkbox.disabled = atLimit && !checkbox.checked;
          }
        };

        if (form.dataset.arkhanvalArkRerollBound !== "true") {
          form.dataset.arkhanvalArkRerollBound = "true";
          form.addEventListener("change", refresh);
        }
        refresh();
      };
      attach();
    }
  });

  if (!formData) return null;

  const selectedDice = Array.isArray(formData.die)
    ? formData.die
    : (formData.die === undefined || formData.die === null ? [] : [formData.die]);
  const indices = selectedDice
    .filter((value) => value !== false && value !== "" && value !== null)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));

  if (indices.length < 1 || indices.length > 2) return null;

  return {
    arkId: String(formData.arkId ?? ""),
    attemptIndex,
    chainIndices: indices
  };
}


function rerollChainSummary(result, attemptIndex, chainIndices) {
  const attempt = result?.attempts?.[Number(attemptIndex)] ?? null;
  const indices = Array.from(chainIndices ?? []).map(Number).filter(Number.isInteger);
  const rows = indices.map((index) => {
    const chain = attempt?.chains?.[index] ?? null;
    if (!chain) return "";
    const values = Array.from(chain?.rolls ?? [])
      .map((roll) => Number(roll?.natural))
      .filter(Number.isFinite);
    return values.length ? `d10 : ${values.join(" → ")}` : "d10 : ?";
  }).filter(Boolean);

  return {
    dice: rows.join("<br>") || "—",
    qr: Number(attempt?.qr) || 0
  };
}

/**
 * Compare the state before and after a post-roll reroll.
 * Once the new dice have been revealed the dialog must be resolved by choosing
 * which result is retained. This prevents free fishing by closing the dialog.
 */
export async function promptRerollResultChoice(
  previousResult,
  nextResult,
  { attemptIndex = null, chainIndices = [], title = "Choisir le résultat retenu" } = {}
) {
  const index = Number.isInteger(Number(attemptIndex))
    ? Number(attemptIndex)
    : Number(previousResult?.selectedAttemptIndex);
  const oldSummary = rerollChainSummary(previousResult, index, chainIndices);
  const newSummary = rerollChainSummary(nextResult, index, chainIndices);

  const choice = await DialogV2.wait({
    window: { title },
    classes: ["arkhanval", "arkhanval-popup-dialog", "arkhanval-popup-dialog--reroll"],
    content: `
      <div class="arkhanval-phase04-dialog arkhanval-reroll-compare">
        <p>La relance a été effectuée. Choisissez le résultat à conserver.</p>
        <div class="arkhanval-reroll-compare__results">
          <div>
            <strong>Ancien lancer</strong>
            <p>${oldSummary.dice}</p>
            <p>QR : <strong>${oldSummary.qr}</strong></p>
          </div>
          <div>
            <strong>Nouveau lancer</strong>
            <p>${newSummary.dice}</p>
            <p>QR : <strong>${newSummary.qr}</strong></p>
          </div>
        </div>
      </div>
    `,
    modal: true,
    // Once a reroll has been revealed it must be resolved. Closing the dialog
    // is therefore treated as keeping the NEW result (the default below): the
    // caller will still spend the Ark circle and mark the reroll as used.
    rejectClose: false,
    buttons: [
      {
        action: "old",
        label: "Conserver l’ancien résultat",
        icon: "fa-solid fa-rotate-left",
        class: "arkhanval-popup-action--secondary"
      },
      {
        action: "new",
        label: "Conserver le nouveau résultat",
        icon: "fa-solid fa-check",
        class: "arkhanval-popup-action--primary",
        default: true
      }
    ]
  });

  return choice === "old" ? "old" : "new";
}

export const PHASE04_PROGRESSION = Object.freeze({
  SKILL_COSTS,
  EXPERIENCE_DIE
});

// Un seul traitement par message/action sur le client d'autorité, avant toute attente.
const pendingProgression = new Set();
async function oncePerMessage(message, operation, fn) {
  const key = `${message.id}:${operation}`;
  if (pendingProgression.has(key)) throw new Error("Cette action est déjà en cours.");
  pendingProgression.add(key);
  try { return await fn(); }
  finally { pendingProgression.delete(key); }
}

function progressionActorFor(message, requester) {
  const actor = message.speakerActor
    ?? (message.speaker?.actor ? game.actors?.get(message.speaker.actor) : null);
  if (!actor || !userCanProgressActor(requester, actor)) {
    throw new Error("Vous ne contrôlez pas le personnage concerné.");
  }
  return actor;
}

registerChatProgressionAction("experience-roll", ({ message, requester }) => oncePerMessage(message, "experience-roll", async () => {
  const actor = progressionActorFor(message, requester);
  if (actor?.getFlag?.("arkhanval", "viewMode") === "npc") {
    throw new Error("Aucun dé d’expérience proposé en mode PNJ.");
  }
  const state = message.getFlag?.("arkhanval", "experience");
  if (!state) throw new Error("Aucun dé d’expérience sur cette carte.");
  if (state.used) return { alreadyUsed: true };
  const existingResult = Array.from(game.messages?.values?.() ?? []).find(entry =>
    entry.getFlag?.("arkhanval", "experienceGain")?.sourceMessageId === message.id);
  // Choisir l'XP clôt la relance d'Ark sur cette action, sur tous les clients.
  // Après une relance déjà terminée, l'XP reste possible si le résultat est éligible.
  const rerollBeforeXp = message.getFlag?.("arkhanval", "reroll") ?? null;
  const xpDecision = { "flags.arkhanval.experience.used": true };
  if (rerollBeforeXp && !rerollBeforeXp.used) xpDecision["flags.arkhanval.reroll.declined"] = true;
  if (existingResult) {
    await message.update(xpDecision);
    return { alreadyUsed: true };
  }
  await message.update(xpDecision);
  try {
    const result = await resolveExperienceDie(actor, state.source, message.id);
    return { face: result.face, messageId: result.message?.id ?? "" };
  } catch (error) {
    const created = Array.from(game.messages?.values?.() ?? []).some(entry =>
      entry.getFlag?.("arkhanval", "experienceGain")?.sourceMessageId === message.id);
    if (!created) {
      const rollback = { "flags.arkhanval.experience.used": false };
      if (rerollBeforeXp && !rerollBeforeXp.used) {
        rollback["flags.arkhanval.reroll.declined"] = Boolean(rerollBeforeXp.declined);
      }
      await message.update(rollback);
    }
    throw error;
  }
}));

registerChatProgressionAction("experience-apply", ({ message, requester, data }) => oncePerMessage(message, "experience-apply", async () => {
  const actor = progressionActorFor(message, requester);
  const latest = message.getFlag?.("arkhanval", "experienceGain");
  if (!latest) throw new Error("Gain d’expérience introuvable.");
  if (latest.applied) return { alreadyApplied: true };
  const descriptor = experienceGainDescriptor(actor, latest.source, latest.face);
  const allocation = descriptor.kind === "choice" ? String(data.allocation ?? "") : descriptor.allocation;
  if (descriptor.kind === "choice" && !descriptor.options?.some(entry => entry.value === allocation)) {
    throw new Error("Attribution XP non autorisée.");
  }
  if (descriptor.kind === "none" || !allocation) throw new Error("Aucun gain à appliquer.");
  const summary = await applyAllocation(actor, latest.source, allocation, message.id);
  await message.update({
    content: experienceCardContent(actor, latest.face, descriptor, summary),
    "flags.arkhanval.experienceGain.applied": true,
    "flags.arkhanval.experienceGain.summary": summary
  });
  return { summary };
}));

registerChatProgressionAction("work-save", ({ message, requester }) => oncePerMessage(message, "work-save", async () => {
  const actor = progressionActorFor(message, requester);
  const latest = message.getFlag?.("arkhanval", "work");
  if (!latest) throw new Error("Travail introuvable sur la carte.");
  if (latest.saved) return { alreadySaved: true };
  const updated = await recordWorkProgress(actor, {
    itemId: latest.itemId, qr: Number(latest.pendingQr) || 0, contributionId: message.id
  });
  const update = {
    "flags.arkhanval.work.saved": true,
    "flags.arkhanval.work.savedGain": updated.gain,
    "flags.arkhanval.work.savedCurrent": updated.current,
    "flags.arkhanval.work.savedStatus": updated.status
  };
  if (message.getFlag?.("arkhanval", "reroll")) update["flags.arkhanval.reroll.used"] = true;
  await message.update(update);
  return updated;
}));

registerChatProgressionAction("book-save", ({ message, requester }) => oncePerMessage(message, "book-save", async () => {
  const actor = progressionActorFor(message, requester);
  const latest = message.getFlag?.("arkhanval", "book");
  if (!latest) throw new Error("Lecture introuvable sur la carte.");
  if (latest.saved) return { alreadySaved: true };
  const updated = await recordBookProgress(actor, {
    itemId: latest.itemId, qr: Number(latest.pendingQr) || 0, contributionId: message.id
  });
  const update = {
    "flags.arkhanval.book.saved": true,
    "flags.arkhanval.book.savedGain": updated.gain,
    "flags.arkhanval.book.savedProgress": updated.progress,
    "flags.arkhanval.book.savedCompleted": updated.completed
  };
  if (updated.completed) update.content = bookCompletionNoticeContent(message.content);
  if (message.getFlag?.("arkhanval", "reroll")) update["flags.arkhanval.reroll.used"] = true;
  await message.update(update);
  return updated;
}));

// La notice d’incantation est un vrai ChatMessage whisper,
// jamais un flag d'une carte de résolution publique.
async function postPrivateIncantationNotice(message, actor, notice) {
  if (!notice) return null;
  const existing = Array.from(game.messages?.values?.() ?? []).find(entry =>
    String(entry.getFlag?.("arkhanval", "incantationPrivateNotice")?.sourceMessageId ?? "") === String(message.id)
  );
  if (existing) return existing;

  const ChatMessageClass = globalThis.foundry?.documents?.ChatMessage ?? globalThis.ChatMessage;
  if (!ChatMessageClass) throw new Error("API ChatMessage indisponible pour la notice privée.");
  const whisper = Array.from(game.users?.values?.() ?? [])
    .filter(user => user?.isGM || actor?.testUserPermission?.(user, "OWNER"))
    .map(user => String(user?.id ?? ""))
    .filter(Boolean);
  if (!whisper.length) throw new Error("Aucun destinataire autorisé pour la notice privée.");

  return ChatMessageClass.create({
    speaker: ChatMessageClass.getSpeaker({ actor }),
    whisper: [...new Set(whisper)],
    flags: { arkhanval: { incantationPrivateNotice: {
      sourceMessageId: String(message.id), actorId: String(actor.id ?? "")
    } } },
    content: `<article class="arkhanval-incantation-private-message arkhanval-chat-card arkhanval-chat-card--notice arkhanval-notice-card">
      <header class="arkhanval-notice-card__hero">
        <div class="arkhanval-notice-card__portrait"><img src="${escapeHtml(String(actor?.img ?? "").trim() || "icons/svg/mystery-man.svg")}" alt="${escapeHtml(actor.name)}" loading="lazy"></div>
        <div class="arkhanval-notice-card__heading">
          <h3 class="arkhanval-incantation-private-message__title arkhanval-notice-card__title">Suivi d’incantation</h3>
          <span class="arkhanval-notice-card__actor">${escapeHtml(actor.name)}</span>
        </div>
      </header>
      <section class="arkhanval-resolution-card__incantation-private-notice arkhanval-notice-card__panel">${escapeHtml(notice)}</section>
    </article>`
  });
}

registerChatProgressionAction("incantation-save", ({ message, requester }) => oncePerMessage(message, "incantation-save", async () => {
  const actor = progressionActorFor(message, requester);
  const latest = message.getFlag?.("arkhanval", "incantation");
  if (!latest) throw new Error("Incantation introuvable sur la carte.");
  if (latest.saved) return { alreadySaved: true };
  const updated = await recordIncantationContribution(actor, {
    spellId: latest.spellId, sessionId: latest.sessionId,
    contributionId: latest.contributionId, qr: Number(latest.pendingQr) || 0
  });
  if (!updated) throw new Error("Cette incantation n’est plus active ou a été remplacée.");
  const privateNotice = updated.status === "negative"
    ? `Progression négative : ${updated.total} / ${updated.target}.`
    : updated.status === "ready"
      ? `Objectif d’incantation atteint : ${updated.total} / ${updated.target}.` : "";
  // Publier d'abord la notice privée : si l'écriture de C01 échoue ensuite,
  // un nouvel essai retrouvera le même message et ne renverra pas deux notices.
  await postPrivateIncantationNotice(message, actor, privateNotice);
  const update = {
    "flags.arkhanval.incantation.saved": true
  };
  if (message.getFlag?.("arkhanval", "reroll")) update["flags.arkhanval.reroll.used"] = true;
  await message.update(update);
  return updated;
}));

export function activateExperienceChatMessage(message, html) {
  const canUseMessageAction = () => Boolean(userCanProgressActor(game.user, actorFromMessage()));
  const actorFromMessage = () => message.speakerActor
    ?? (message.speaker?.actor ? game.actors?.get(message.speaker.actor) : null);

  const experienceRollButton = html.querySelector?.("[data-arkhanval-experience-roll]");
  if (experienceRollButton) {
    const experience = message.getFlag?.("arkhanval", "experience") ?? null;

    if (!experience || experience.used) {
      experienceRollButton.disabled = true;
      experienceRollButton.textContent = game.i18n.localize("ARKHANVAL.Phase04.ExperienceDieRolled");
    } else if (!canUseMessageAction()) {
      experienceRollButton.disabled = true;
    } else {
      experienceRollButton.addEventListener("click", async () => {
        if (experienceRollButton.disabled) return;
        experienceRollButton.disabled = true;

        const latest = message.getFlag?.("arkhanval", "experience") ?? null;
        if (!latest || latest.used) {
          experienceRollButton.textContent = game.i18n.localize("ARKHANVAL.Phase04.ExperienceDieRolled");
          return;
        }

        const actor = actorFromMessage();
        if (!actor) {
          experienceRollButton.disabled = false;
          ui.notifications?.error?.("Arkhanval | Personnage introuvable pour le dé d’expérience.");
          return;
        }

        // Fermer immédiatement le choix de relance sur ce client pendant le tirage.
        const currentRerollButtons = Array.from(
          html.querySelectorAll?.("[data-arkhanval-ark-reroll-choice]") ?? []
        );
        for (const button of currentRerollButtons) button.disabled = true;

        try {
          await dispatchChatProgressionAction(message, "experience-roll");
          experienceRollButton.textContent = game.i18n.localize("ARKHANVAL.Phase04.ExperienceDieRolled");
        } catch (error) {
          console.error("Arkhanval | Échec du dé d’expérience", error);
          experienceRollButton.disabled = Boolean(message.getFlag?.("arkhanval", "experience")?.used);
          const currentExperience = message.getFlag?.("arkhanval", "experience") ?? null;
          const currentReroll = message.getFlag?.("arkhanval", "reroll") ?? null;
          if (!currentExperience?.used && currentReroll && !currentReroll.used && !currentReroll.declined) {
            for (const button of currentRerollButtons) button.disabled = false;
          }
          ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        }
      });
    }
  }

  const applyGainButton = html.querySelector?.("[data-arkhanval-experience-apply]");
  const chooseGainButton = html.querySelector?.("[data-arkhanval-experience-choose]");
  const gainButton = applyGainButton ?? chooseGainButton;

  if (gainButton) {
    const gain = message.getFlag?.("arkhanval", "experienceGain") ?? null;

    if (!gain || gain.applied || !canUseMessageAction()) {
      gainButton.disabled = true;
    } else {
      gainButton.addEventListener("click", async () => {
        if (gainButton.disabled) return;
        gainButton.disabled = true;

        const latest = message.getFlag?.("arkhanval", "experienceGain") ?? null;
        const actor = actorFromMessage();
        if (!latest || latest.applied || !actor) {
          if (!actor) ui.notifications?.error?.("Arkhanval | Personnage introuvable pour appliquer le gain.");
          return;
        }

        try {
          const descriptor = experienceGainDescriptor(actor, latest.source, latest.face);
          let allocation = descriptor.allocation ?? null;

          if (descriptor.kind === "choice") {
            allocation = await promptAllocation(
              "Dé d’expérience — choisir le gain",
              descriptor.options ?? [],
              actor,
              latest.source
            );
            if (!allocation) {
              gainButton.disabled = false;
              return;
            }
          }

          if (descriptor.kind === "none" || !allocation) {
            gainButton.disabled = true;
            return;
          }

          await dispatchChatProgressionAction(message, "experience-apply", { allocation });
        } catch (error) {
          console.error("Arkhanval | Échec de l’application du gain d’expérience", error);
          gainButton.disabled = false;
          ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        }
      });
    }
  }

  const rerollChoiceButtons = Array.from(
    html.querySelectorAll?.("[data-arkhanval-ark-reroll-choice]") ?? []
  );
  if (rerollChoiceButtons.length) {
    const rerollState = message.getFlag?.("arkhanval", "reroll") ?? null;
    const xpAlreadyChosen = Boolean(message.getFlag?.("arkhanval", "experience")?.used);
    const rerollActor = actorFromMessage();
    const incantationState = message.getFlag?.("arkhanval", "incantation") ?? null;
    const workState = message.getFlag?.("arkhanval", "work") ?? null;
    const bookState = message.getFlag?.("arkhanval", "book") ?? null;
    const canUseArkReroll = Boolean(
      game.user?.isGM
      || rerollActor?.isOwner
      || rerollActor?.testUserPermission?.(game.user, "OWNER")
    );

    const disableRerollChoices = () => {
      for (const button of rerollChoiceButtons) button.disabled = true;
    };

    if (!canUseArkReroll || xpAlreadyChosen) {
      rerollChoiceButtons[0]?.closest?.(".arkhanval-resolution-card__ark-choice")?.remove();
    } else if (!rerollState || rerollState.used || rerollState.declined || incantationState?.saved || workState?.saved || bookState?.saved) {
      disableRerollChoices();
    } else {
      for (const choiceButton of rerollChoiceButtons) {
        choiceButton.addEventListener("click", async () => {
          if (choiceButton.disabled) return;
          disableRerollChoices();

          const latest = message.getFlag?.("arkhanval", "reroll") ?? null;
          const actor = actorFromMessage();
          if (!latest || latest.used || latest.declined || message.getFlag?.("arkhanval", "experience")?.used || !actor) {
            if (!actor) ui.notifications?.error?.("Arkhanval | Personnage introuvable pour la relance d’Ark.");
            return;
          }

          const choice = String(choiceButton.dataset.arkhanvalArkRerollChoice ?? "");
          if (choice === "no") {
            try {
              const currentIncantation = message.getFlag?.("arkhanval", "incantation")
                ?? latest.chatOptions?.incantation
                ?? null;
              const currentWork = message.getFlag?.("arkhanval", "work")
                ?? latest.chatOptions?.work
                ?? null;
              const currentBook = message.getFlag?.("arkhanval", "book")
                ?? latest.chatOptions?.book
                ?? null;
              await message.update({
                content: buildResolutionChatContent(latest.result, {
                  ...(latest.chatOptions ?? {}),
                  // Ne pas réintroduire l'XP d'un PNJ lors du refus de relance.
                  experienceSource: actor?.getFlag?.("arkhanval", "viewMode") === "npc"
                    ? null : latest.chatOptions?.experienceSource ?? null,
                  arkRerollAvailable: false,
                  arkRerollDiceCount: 0,
                  incantation: currentIncantation,
                  work: currentWork,
                  book: currentBook,
                  chatActor: latest.chatOptions?.chatActor ?? null
                }),
                "flags.arkhanval.reroll.declined": true
              });
            } catch (error) {
              console.error("Arkhanval | Échec du refus de relance d’Ark", error);
              for (const button of rerollChoiceButtons) button.disabled = false;
              ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
            }
            return;
          }

          if (experienceRollButton) experienceRollButton.disabled = true;
          try {
            const reroll = await promptArkRerollSelection(actor, latest.result);
            if (!reroll) {
              for (const button of rerollChoiceButtons) button.disabled = false;
              return;
            }

            const available = Number(actor.system.arks?.[reroll.arkId]?.circles) || 0;
            if (available <= 0) {
              for (const button of rerollChoiceButtons) button.disabled = false;
              ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
              return;
            }

            const nextResult = await rerollSelectedD10(latest.result, reroll.chainIndices, {
              attemptIndex: reroll.attemptIndex
            });

            const retainedChoice = await promptRerollResultChoice(latest.result, nextResult, {
              attemptIndex: reroll.attemptIndex,
              chainIndices: reroll.chainIndices,
              title: "Relance d’Ark — résultat retenu"
            });
            const retainedResult = retainedChoice === "new" ? nextResult : latest.result;

            if (message.getFlag?.("arkhanval", "experience")?.used) {
              ui.notifications?.warn?.("Arkhanval | Le dé d’expérience a été lancé : la relance d’Ark n’est plus disponible.");
              return;
            }
            const spent = await spendArkCircle(actor, reroll.arkId);
            if (!spent) {
              for (const button of rerollChoiceButtons) button.disabled = false;
              ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
              return;
            }

            const rawExperienceSource = latest.chatOptions?.experienceSource ?? null;
            const experienceSource = retainedResult.experienceEligible
              && actor?.getFlag?.("arkhanval", "viewMode") !== "npc"
              ? rawExperienceSource
              : null;
            const previousCombat = message.getFlag?.("arkhanval", "combat") ?? null;
            const nextCombat = latest.chatOptions?.combatContext?.enabled
              ? {
                  ...(previousCombat ?? {}),
                  context: latest.chatOptions.combatContext,
                  attackerQr: retainedResult.qr,
                  attackResult: retainedResult,
                  chatOptions: {
                    ...(previousCombat?.chatOptions ?? {}),
                    progressGain: latest.chatOptions?.progressGain ?? null,
                    arkBoost: latest.chatOptions?.arkBoost ?? "",
                    arkReroll: nextResult.arkReroll ?? { arkId: reroll.arkId },
                    experienceSource,
                    arkRerollAvailable: false,
                    chatActor: latest.chatOptions?.chatActor ?? null
                  }
                }
              : null;

            const previousIncantation = message.getFlag?.("arkhanval", "incantation")
              ?? latest.chatOptions?.incantation
              ?? null;
            const nextIncantation = previousIncantation
              ? {
                  ...previousIncantation,
                  pendingQr: Number(retainedResult.qr) || 0,
                  result: documentSafeClone(retainedResult)
                }
              : null;

            const previousWork = message.getFlag?.("arkhanval", "work")
              ?? latest.chatOptions?.work
              ?? null;
            const nextWork = previousWork
              ? {
                  ...previousWork,
                  pendingQr: Number(retainedResult.qr) || 0,
                  result: documentSafeClone(retainedResult)
                }
              : null;

            const previousBook = message.getFlag?.("arkhanval", "book")
              ?? latest.chatOptions?.book
              ?? null;
            const nextBook = previousBook
              ? {
                  ...previousBook,
                  pendingQr: Number(retainedResult.qr) || 0,
                  result: documentSafeClone(retainedResult)
                }
              : null;

            const previousConcentration = message.getFlag?.("arkhanval", "concentration")
              ?? latest.chatOptions?.concentration
              ?? null;
            const nextConcentration = previousConcentration
              ? {
                  ...previousConcentration,
                  qr: Number(retainedResult.qr) || 0,
                  result: documentSafeClone(retainedResult)
                }
              : null;

            const chatOptions = {
              progressGain: latest.chatOptions?.progressGain ?? null,
              arkBoost: latest.chatOptions?.arkBoost ?? "",
              arkReroll: nextResult.arkReroll ?? { arkId: reroll.arkId },
              experienceSource,
              arkRerollAvailable: false,
              arkRerollDiceCount: 0,
              combatContext: latest.chatOptions?.combatContext ?? null,
              combatState: nextCombat,
              incantation: nextIncantation,
              work: nextWork,
              book: nextBook,
              concentration: nextConcentration,
              spellMaintenance: latest.chatOptions?.spellMaintenance ?? null,
              chatActor: latest.chatOptions?.chatActor ?? null
            };

            const update = {
              content: buildResolutionChatContent(retainedResult, chatOptions),
              "flags.arkhanval.reroll.used": true,
              "flags.arkhanval.reroll.result": documentSafeClone(retainedResult)
            };

            if (nextIncantation) {
              update["flags.arkhanval.incantation"] = documentSafeClone(nextIncantation);
            }
            if (nextWork) {
              update["flags.arkhanval.work"] = documentSafeClone(nextWork);
            }
            if (nextBook) {
              update["flags.arkhanval.book"] = documentSafeClone(nextBook);
            }
            if (chatOptions.concentration) {
              update["flags.arkhanval.concentration"] = documentSafeClone(chatOptions.concentration);
            }
            if (nextCombat) {
              update["flags.arkhanval.combat"] = documentSafeClone(nextCombat);
            }

            const previousExperience = message.getFlag?.("arkhanval", "experience") ?? null;
            // Un dé consommé appartient à l'action, pas au résultat retenu après relance.
            if (experienceSource || previousExperience?.used) {
              update["flags.arkhanval.experience"] = {
                source: experienceSource ?? previousExperience.source,
                used: Boolean(previousExperience?.used)
              };
            } else {
              update["flags.arkhanval.experience"] = null;
            }

            await message.update(update);
          } catch (error) {
            console.error("Arkhanval | Échec de la relance d’Ark", error);
            for (const button of rerollChoiceButtons) button.disabled = false;
            ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
          } finally {
            if (experienceRollButton) {
              const xp = message.getFlag?.("arkhanval", "experience") ?? null;
              experienceRollButton.disabled = !xp || Boolean(xp.used);
            }
          }
        });
      }
    }
  }

  const concentrationValidateButton = html.querySelector?.("[data-arkhanval-concentration-validate]");
  const concentrationState = message.getFlag?.("arkhanval", "concentration") ?? null;
  if (concentrationValidateButton) {
    const concentrationActor = actorFromMessage();
    const canValidateConcentration = Boolean(
      game.user?.isGM
      || concentrationActor?.isOwner
      || concentrationActor?.testUserPermission?.(game.user, "OWNER")
    );

    if (!canValidateConcentration) {
      concentrationValidateButton.remove();
    } else if (!concentrationState || concentrationState.validated) {
      concentrationValidateButton.disabled = true;
      concentrationValidateButton.textContent = "Jet de Concentration validé";
    } else {
      concentrationValidateButton.addEventListener("click", async () => {
        if (concentrationValidateButton.disabled) return;
        concentrationValidateButton.disabled = true;
        try {
          const latestConcentration = message.getFlag?.("arkhanval", "concentration") ?? null;
          const reroll = message.getFlag?.("arkhanval", "reroll") ?? null;
          const sourceResult = latestConcentration?.result ?? reroll?.result ?? null;
          const currentActor = actorFromMessage();
          if (!latestConcentration || latestConcentration.validated || !currentActor || !sourceResult) return;

          const finalQr = Number(sourceResult.qr) || 0;
          const success = finalQr > 0;

          if (!success) {
            for (const spellId of Array.from(latestConcentration.spellIds ?? [])) {
              await cancelSpellIncantation(currentActor, String(spellId));
            }
          }

          const nextConcentration = {
            ...latestConcentration,
            validated: true,
            qr: finalQr,
            outcome: success ? "success" : "failure"
          };
          await message.update({
            content: buildResolutionChatContent(
              sourceResult,
              {
                ...(reroll?.chatOptions ?? {}),
                experienceSource: currentActor?.getFlag?.("arkhanval", "viewMode") === "npc"
                  ? null : reroll?.chatOptions?.experienceSource ?? null,
                concentration: nextConcentration,
                arkRerollAvailable: false,
                arkRerollOffered: false
              }
            ),
            "flags.arkhanval.concentration": documentSafeClone(nextConcentration),
            ...(reroll ? { "flags.arkhanval.reroll.used": true } : {})
          });

          const sourceDamageMessage = game.messages?.get?.(String(latestConcentration.sourceDamageMessageId ?? "")) ?? null;
          if (sourceDamageMessage) {
            await sourceDamageMessage.update({
              "flags.arkhanval.damage.concentration.validated": true,
              "flags.arkhanval.damage.concentration.outcome": success ? "success" : "failure",
              "flags.arkhanval.damage.concentration.qr": finalQr
            });
          }
        } catch (error) {
          console.error("Arkhanval | Échec de validation du jet de Concentration", error);
          concentrationValidateButton.disabled = false;
          ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        }
      });
    }
  }

  const incantationSaveButton = html.querySelector?.("[data-arkhanval-incantation-progress-save]");
  const visibleIncantation = message.getFlag?.("arkhanval", "incantation") ?? null;
  if (incantationSaveButton) {
    const actor = actorFromMessage();
    const canSaveIncantation = Boolean(
      game.user?.isGM
      || actor?.isOwner
      || actor?.testUserPermission?.(game.user, "OWNER")
    );

    if (!canSaveIncantation) {
      incantationSaveButton.remove();
    } else if (!visibleIncantation || visibleIncantation.saved) {
      incantationSaveButton.disabled = true;
      incantationSaveButton.textContent = "Progression enregistrée";
    } else {
      incantationSaveButton.addEventListener("click", async () => {
        if (incantationSaveButton.disabled) return;
        incantationSaveButton.disabled = true;

        const latest = message.getFlag?.("arkhanval", "incantation") ?? null;
        const currentActor = actorFromMessage();
        if (!latest || latest.saved || !currentActor) return;

        try {
          await dispatchChatProgressionAction(message, "incantation-save");
          incantationSaveButton.textContent = "Progression enregistrée";
        } catch (error) {
          console.error("Arkhanval | Échec de l’enregistrement de la progression d’incantation", error);
          incantationSaveButton.disabled = false;
          ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        }
      });
    }
  }

  const workSaveButton = html.querySelector?.("[data-arkhanval-work-progress-save]");
  const visibleWork = message.getFlag?.("arkhanval", "work") ?? null;
  if (workSaveButton) {
    const actor = actorFromMessage();
    const canSaveWork = Boolean(
      game.user?.isGM
      || actor?.isOwner
      || actor?.testUserPermission?.(game.user, "OWNER")
    );

    if (!canSaveWork) {
      workSaveButton.remove();
    } else if (!visibleWork || visibleWork.saved) {
      workSaveButton.disabled = true;
      workSaveButton.textContent = "Progression enregistrée";
    } else {
      workSaveButton.addEventListener("click", async () => {
        if (workSaveButton.disabled) return;
        workSaveButton.disabled = true;
        // Enregistrer la progression vaut choix implicite de conserver le
        // résultat courant : aucun clic « Non » sur la relance d’Ark requis.
        for (const button of rerollChoiceButtons) button.disabled = true;

        const latest = message.getFlag?.("arkhanval", "work") ?? null;
        const currentActor = actorFromMessage();
        if (!latest || latest.saved || !currentActor) return;

        try {
          await dispatchChatProgressionAction(message, "work-save");
          workSaveButton.textContent = "Progression enregistrée";
        } catch (error) {
          console.error("Arkhanval | Échec de l’enregistrement de la progression du travail", error);
          workSaveButton.disabled = false;
          ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        }
      });
    }
  }

  const bookSaveButton = html.querySelector?.("[data-arkhanval-book-progress-save]");
  const visibleBook = message.getFlag?.("arkhanval", "book") ?? null;
  if (bookSaveButton) {
    const actor = actorFromMessage();
    const canSaveBook = Boolean(
      game.user?.isGM
      || actor?.isOwner
      || actor?.testUserPermission?.(game.user, "OWNER")
    );

    if (!canSaveBook) {
      bookSaveButton.remove();
    } else if (!visibleBook || visibleBook.saved) {
      bookSaveButton.disabled = true;
      bookSaveButton.textContent = "Progression enregistrée";
    } else {
      bookSaveButton.addEventListener("click", async () => {
        if (bookSaveButton.disabled) return;
        bookSaveButton.disabled = true;
        // Comme pour les travaux, enregistrer conserve implicitement le
        // résultat courant sans imposer un clic « Non » sur la relance d’Ark.
        for (const button of rerollChoiceButtons) button.disabled = true;

        const latest = message.getFlag?.("arkhanval", "book") ?? null;
        const currentActor = actorFromMessage();
        if (!latest || latest.saved || !currentActor) return;

        try {
          await dispatchChatProgressionAction(message, "book-save");
          bookSaveButton.textContent = "Progression enregistrée";
        } catch (error) {
          console.error("Arkhanval | Échec de l’enregistrement de la progression de lecture", error);
          bookSaveButton.disabled = false;
          ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
        }
      });
    }
  }

}
