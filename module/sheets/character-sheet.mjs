import {
  ARKHANVAL_ARCHETYPES,
  ARKHANVAL_ARKS,
  ARKHANVAL_COMBAT_TECHNIQUES,
  WOUND_CAPACITY_BY_ARKOEUR,
  buildSkillIdentifier
} from "../config.mjs";
import {
  experienceSourceFromRollRequest,
  promptActionResolutionMode,
  promptSkillRoll
} from "../resolution/dialog.mjs";
import {
  progressionGainFromQr,
  resolveRoll
} from "../resolution/engine.mjs";
import {
  postResolutionChatMessage
} from "../resolution/chat.mjs";
import {
  findActorSkill,
  listActorSkills
} from "../resolution/skills.mjs";
import {
  bindProgressionSurface,
  createProgressionSession,
  progressionRevision,
  renderProgressionContent,
  spendArkCircle
} from "../progression.mjs";
import {
  ARK_TABLES,
  promptArkRollRequest,
  rollArkTable
} from "../arks.mjs";
import {
  isCreationRoutingActive,
  openCharacterCreation
} from "../creation-wizard.mjs";
import {
  captureCombatRollContext,
  isDirectCombatSkill
} from "../combat/context.mjs";
import {
  weaponFamilyFromTags
} from "../rules/catalog.mjs";
import {
  buildProtectionRuleModifiers,
  persistentStateFdModifier
} from "../rules/evaluator.mjs";
import {
  VANILLA_STATE_DEFINITIONS
} from "../states.mjs";
import { enrichArkhanvalHTML } from "../richtext.mjs";
import { workChatContext } from "../work.mjs";
import { bookChatContext } from "../book.mjs";
import { openStateManagerWindow } from "../state-manager.mjs";
import {
  buildSpellResolutionChatContent,
  captureSpellCaster,
  captureSpellTargets,
  createSpellFinalChatMessage
} from "../magic/chat.mjs";
import {
  cancelSpellIncantation,
  adjustSpellIncantationProgress,
  incantationChatContext,
  prepareIncantationView,
  startSpellIncantation
} from "../magic/incantation.mjs";

const SHEET_WIDTH = 830;
const SHEET_AUTO_FIT_MIN = 0.90;
const SHEET_AUTO_FIT_MAX = 1.20;

const WOUND_TRACKS = Object.freeze([
  { id: "light", count: 6, labelKey: "ARKHANVAL.Wounds.LightLabel", rangeKey: "ARKHANVAL.Wounds.LightRange" },
  { id: "serious", count: 5, labelKey: "ARKHANVAL.Wounds.SeriousLabel", rangeKey: "ARKHANVAL.Wounds.SeriousRange" },
  { id: "critical", count: 5, labelKey: "ARKHANVAL.Wounds.CriticalLabel", rangeKey: "ARKHANVAL.Wounds.CriticalRange" }
]);



function actorField(path) {
  return `system.${path}`;
}

function prepareCombatTechniqueOptions(actor) {
  const current = String(actor.system.combat?.technique ?? "none") || "none";
  return ARKHANVAL_COMBAT_TECHNIQUES.map((technique) => ({
    id: technique.id,
    label: game.i18n.localize(technique.labelKey),
    selected: technique.id === current
  }));
}

function combatTechniqueLabel(techniqueId) {
  const entry = ARKHANVAL_COMBAT_TECHNIQUES.find((technique) => technique.id === techniqueId);
  if (!entry) return String(techniqueId ?? "").trim();
  return game.i18n.localize(entry.labelKey);
}

function combatTechniqueWhisperRecipients(actor) {
  return Array.from(game.users?.values?.() ?? [])
    .filter((user) => Boolean(user?.isGM) || actor?.testUserPermission?.(user, "OWNER"))
    .map((user) => String(user.id ?? ""))
    .filter(Boolean)
    .filter((id, index, array) => array.indexOf(id) === index);
}

function actorIsInActiveCombat(actor) {
  const combat = game.combat;
  if (!combat?.started) return false;

  return Array.from(combat.combatants ?? [])
    .some((combatant) =>
      String(combatant?.actorId ?? combatant?.actor?.id ?? "") === String(actor?.id ?? "")
    );
}

async function postCombatTechniqueChangeMessage(actor, previousTechniqueId, nextTechniqueId) {
  const ChatMessageClass = globalThis.foundry?.documents?.ChatMessage ?? globalThis.ChatMessage ?? null;
  if (!ChatMessageClass) return;

  const whisper = combatTechniqueWhisperRecipients(actor);
  if (!whisper.length) return;

  const previousLabel = combatTechniqueLabel(previousTechniqueId || "none");
  const nextLabel = combatTechniqueLabel(nextTechniqueId || "none");
  const summary = game.i18n.format("ARKHANVAL.Notifications.CombatTechniqueChanged", { oldLabel: previousLabel, newLabel: nextLabel });
  const actorName = String(actor?.name ?? "Personnage");

  await ChatMessageClass.create({
    speaker: { alias: "Arkhanval — Technique" },
    whisper,
    content: `
      <article class="arkhanval-technique-change-note arkhanval-chat-card arkhanval-chat-card--notice arkhanval-notice-card">
        <header class="arkhanval-notice-card__hero">
          <div class="arkhanval-notice-card__portrait"><img src="${foundry.utils.escapeHTML(String(actor?.img ?? "").trim() || "icons/svg/mystery-man.svg")}" alt="${foundry.utils.escapeHTML(actorName)}" loading="lazy"></div>
          <div class="arkhanval-notice-card__heading">
            <h3 class="arkhanval-notice-card__title">Changement de technique</h3>
            <span class="arkhanval-notice-card__actor">${foundry.utils.escapeHTML(actorName)}</span>
          </div>
        </header>
        <section class="arkhanval-notice-card__panel arkhanval-technique-change-note__summary">${foundry.utils.escapeHTML(summary)}</section>
      </article>
    `.trim()
  });
}

function getItemValue(item, path, fallback = "") {
  return foundry.utils.getProperty(item?.system ?? {}, path) ?? fallback;
}
function normalizeLookupName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function preferredIncantationSkill(actor, incantation) {
  const identifier = String(incantation?.castingSkill ?? "").trim();
  if (!identifier) return null;
  return findActorSkill(actor, { identifier });
}

function prepareSpellCastingSkillOptions(spell, actor) {
  const selected = String(spell?.system?.castingSkill ?? "").trim();
  const actorSkills = listActorSkills(actor);
  const seen = new Set();
  const options = [];

  for (const skill of actorSkills) {
    const identifier = String(skill?.identifier ?? "").trim();
    if (!identifier || seen.has(identifier)) continue;
    seen.add(identifier);
    options.push({
      identifier,
      label: `${skill.archetypeLabel} — ${skill.name}`,
      selected: identifier === selected
    });
  }

  if (selected && !seen.has(selected)) {
    options.unshift({
      identifier: selected,
      label: selected,
      selected: true
    });
  }

  return [
    { identifier: "", label: "— Choisir —", selected: !selected },
    ...options
  ];
}

function spellAcquisitionStatus(spell) {
  return String(spell?.system?.acquisitionStatus ?? "mastered") === "learning"
    ? "learning"
    : "mastered";
}

function proposedLearningTarget(spell) {
  return Math.max(0, Math.trunc(Number(spell?.system?.fd) || 0)) * 5;
}

async function promptArkActionMode(arkLabel) {
  const label = String(arkLabel ?? "Ark").trim() || "Ark";
  const choice = await DialogV2.wait({
    window: { title: label },
    classes: ["arkhanval", "arkhanval-popup-dialog", "arkhanval-popup-dialog--choice"],
    content: `
      <div class="arkhanval-phase04-dialog arkhanval-ark-action-dialog">
        <p>Choisissez l’action à effectuer pour <strong>${foundry.utils.escapeHTML(label)}</strong>.</p>
      </div>
    `,
    modal: true,
    rejectClose: false,
    buttons: [
      {
        action: "roll",
        label: `Faire un jet d’${label}`,
        icon: "fa-solid fa-dice",
        class: "arkhanval-popup-action--secondary"
      },
      {
        action: "table",
        label: "Faire un tirage sur la table",
        icon: "fa-solid fa-table-list",
        class: "arkhanval-popup-action--secondary"
      }
    ]
  });

  return choice === "roll" || choice === "table" ? choice : null;
}

async function promptSpellAcquisitionMode(spell) {
  const target = proposedLearningTarget(spell);
  const choice = await DialogV2.wait({
    window: { title: `Ajouter — ${String(spell?.name ?? "Sortilège")}` },
    classes: ["arkhanval", "arkhanval-popup-dialog", "arkhanval-popup-dialog--choice"],
    content: `
      <div class="arkhanval-phase04-dialog">
        <p><strong>${foundry.utils.escapeHTML(String(spell?.name ?? "Sortilège"))}</strong></p>
        <p>Comment ce sortilège doit-il être ajouté à la fiche ?</p>
        <p><strong>Sortilège connu</strong> — utilisable normalement.</p>
        <p><strong>Sortilège en apprentissage</strong> — la progression d’XP reste entièrement gérée par le joueur et le MJ.</p>
        ${target > 0
          ? `<p><small>XP d’apprentissage requis proposé : ${target}. Cette valeur reste modifiable sur la fiche.</small></p>`
          : ""}
      </div>
    `,
    modal: true,
    rejectClose: false,
    buttons: [
      {
        action: "mastered",
        label: "Sortilège connu",
        icon: "fa-solid fa-book-open",
        default: true
      },
      {
        action: "learning",
        label: "Sortilège en apprentissage",
        icon: "fa-solid fa-graduation-cap"
      },
      {
        action: "cancel",
        label: "Annuler",
        icon: "fa-solid fa-xmark"
      }
    ]
  });

  return ["mastered", "learning"].includes(String(choice)) ? String(choice) : null;
}


function prepareArchetypes(actor) {
  const skillItems = actor.items.filter((item) => item.type === "skill");
  const isNamedCustomSkill = (item, archetypeId) =>
    item.system.archetype === archetypeId &&
    !resolveCanonicalSkill(item) &&
    String(item.name ?? "").trim().length > 0;

  // Phase 05B C06: archetype cards show only real skills.
  // Each visual pair shares the height required by the fuller card; the shorter
  // card simply keeps unused paper space and receives no synthetic skill rows.
  const pairedArchetypeIds = Object.freeze([
    ["artisan", "explorateur"],
    ["artiste", "magicien"],
    ["combattant", "roublard"],
    ["erudit", "stratege"]
  ]);
  const visualRowsByArchetype = new Map();

  const realSkillCountByArchetype = new Map(
    ARKHANVAL_ARCHETYPES.map((entry) => {
      const customCount = skillItems.filter((item) =>
        isNamedCustomSkill(item, entry.id)
      ).length;
      return [entry.id, entry.skills.length + customCount];
    })
  );

  for (const pair of pairedArchetypeIds) {
    const targetRows = Math.max(
      ...pair.map((id) => realSkillCountByArchetype.get(id) ?? 0)
    );
    for (const id of pair) visualRowsByArchetype.set(id, targetRows);
  }

  return ARKHANVAL_ARCHETYPES.map((archetype, archetypeIndex) => {
    const archetypeSkillItems = skillItems.filter(
      (item) => item.system.archetype === archetype.id
    );

    // Canonical association is identifier-first, with a normalized-name fallback.
    // This lets manually-created skill Items with a canonical name populate the
    // canonical row instead of being rendered as duplicate custom skills.
    const canonicalItemsByIdentifier = new Map();
    for (const item of archetypeSkillItems) {
      const canonical = resolveCanonicalSkill(item);
      if (!canonical) continue;

      const current = canonicalItemsByIdentifier.get(canonical.identifier);
      const currentHasCanonicalIdentifier =
        current?.system.identifier === canonical.identifier;
      const itemHasCanonicalIdentifier =
        item.system.identifier === canonical.identifier;

      if (!current || (!currentHasCanonicalIdentifier && itemHasCanonicalIdentifier)) {
        canonicalItemsByIdentifier.set(canonical.identifier, item);
      }
    }

    // Every canonical skill is projected directly from configuration.
    const fixedRows = archetype.skills.map((skill, index) => {
      const item = canonicalItemsByIdentifier.get(skill.identifier);
      return {
        index: index + 1,
        labelKey: skill.labelKey,
        labelSize: skill.labelSize,
        itemId: item?.id ?? "",
        itemName: game.i18n.localize(skill.labelKey),
        identifier: skill.identifier,
        archetypeId: archetype.id,
        rank: item?.system.rank ?? "",
        xp: item?.system.xp ?? "",
        isCustom: false
      };
    });

    // Custom skills are real Embedded Items. There is deliberately no visual
    // slot limit: every custom skill attached to this archetype is rendered.
    const customRows = archetypeSkillItems
      .filter((item) =>
        isNamedCustomSkill(item, archetype.id)
      )
      .map((item, index) => ({
        index: fixedRows.length + index + 1,
        labelKey: null,
        labelSize: null,
        itemId: item.id,
        itemName: item.name,
        identifier: item.system.identifier ?? "",
        archetypeId: archetype.id,
        rank: item.system.rank ?? 0,
        xp: item.system.xp ?? 0,
        isCustom: true
      }));

    const realSkillRowCount = fixedRows.length + customRows.length;

    return {
      ...archetype,
      displayIndex: archetypeIndex + 1,
      label: game.i18n.localize(archetype.labelKey),
      xp: {
        name: actorField(`archetypes.xp.${archetype.id}`),
        value: actor.system.archetypes?.xp?.[archetype.id] ?? 0
      },
      skills: [...fixedRows, ...customRows],
      realSkillRowCount,
      skillRowCount: visualRowsByArchetype.get(archetype.id) ?? realSkillRowCount
    };
  });
}

function prepareArkTracks(actor) {
  return ARKHANVAL_ARKS.map((ark, arkIndex) => {
    const circles = Number(actor.system.arks?.[ark.id]?.circles) || 0;
    return {
      ...ark,
      displayIndex: 9 + arkIndex,
      rankName: actorField(`arks.${ark.id}.rank`),
      rankValue: actor.system.arks?.[ark.id]?.rank ?? 0,
      hasTable: Boolean(ARK_TABLES[ark.id]),
      marks: Array.from({ length: 10 }, (_, index) => {
        const mark = index + 1;
        return {
          index: mark,
          checked: mark <= circles
        };
      })
    };
  });
}

function prepareWoundTracks(actor) {
  const wounds = actor.items.filter((item) => item.type === "wound");

  return WOUND_TRACKS.map((track) => {
    const entries = wounds.filter((item) => item.system.severity === track.id);
    const count = entries.length;
    const capacity = actor.system.woundCapacity?.[track.id] ?? null;

    const availableMarks = Math.max(capacity ?? 0, count);

    return {
      ...track,
      countCurrent: count,
      capacity,
      marks: Array.from({ length: track.count }, (_, index) => ({
        index: index + 1,
        checked: index < count,
        available: index < availableMarks,
        itemId: entries[index]?.id ?? ""
      }))
    };
  });
}

function prepareItemSummary(item) {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    identifier: item.system.identifier ?? "",
    description: item.system.description ?? ""
  };
}

function distributeSpecialtiesByPrimary(items, primary) {
  const primaryLeft = String(primary?.[0] ?? "");
  const primaryRight = String(primary?.[1] ?? "");
  const left = [];
  const right = [];
  let fallbackSide = "left";

  for (const item of items) {
    const archetypeId = String(item.system?.archetype ?? "");
    if (primaryLeft && archetypeId === primaryLeft) {
      left.push(item);
      continue;
    }
    if (primaryRight && archetypeId === primaryRight) {
      right.push(item);
      continue;
    }

    if (fallbackSide === "left") left.push(item);
    else right.push(item);
    fallbackSide = fallbackSide === "left" ? "right" : "left";
  }

  return [left, right];
}

function preparePrimaryArchetypeSlots(primary) {
  const selected = Array.from(primary ?? []).slice(0, 2);

  return [0, 1].map((index) => ({
    index,
    value: selected[index] ?? "",
    options: ARKHANVAL_ARCHETYPES.map((archetype) => ({
      id: archetype.id,
      label: game.i18n.localize(archetype.labelKey),
      selected: archetype.id === selected[index]
    }))
  }));
}

function prepareSpecialtyHeading(archetypeId) {
  const archetype = ARKHANVAL_ARCHETYPES.find((entry) => entry.id === archetypeId);
  if (!archetype) return "Spécialité";

  const label = game.i18n.localize(archetype.labelKey);
  const normalizedInitial = String(label)
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .charAt(0)
    .toLowerCase();
  const elision = "aeiouyh".includes(normalizedInitial);
  return `Spécialité ${elision ? "d’" : "de "}${label}`;
}


function normalizeSkillName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function resolveCanonicalSkill(item) {
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

function computeEquippedArmor(actor) {
  return actor.items
    .filter((item) => item.type === "armor" && item.system.equipped)
    .reduce((total, item) => total + (Number(item.system.protection?.current) || 0), 0);
}

function computeProtectionDisplay(actor) {
  const base = Math.max(0, Number(computeEquippedArmor(actor)) || 0);

  // A character sheet has no active combat context. Calling the protection
  // consumer without selectors therefore exposes only unconditional
  // (selector = "any") protection.flat rules carried by always-on sources.
  const protectionRules = buildProtectionRuleModifiers(actor);
  const modifier = Math.trunc(Number(protectionRules.flatModifier) || 0);
  const effective = Math.max(0, base + modifier);

  let display = String(base);
  if (modifier > 0) display = `${base} + ${modifier}`;
  else if (modifier < 0) display = `${base} - ${Math.abs(modifier)}`;

  return {
    base,
    modifier,
    effective,
    display
  };
}

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * Arkhanval character sheet backed by the durable data architecture.
 *
 * The validated visual composition is preserved. Reusable content is projected
 * from Embedded Items instead of being duplicated under Actor.system.
 */
// Confirmation commune Arkhanval : blocs et actions partageant les tokens globaux.
async function confirmActorItemDeletion(item) {
  const safeName = foundry.utils.escapeHTML(item.name);
  const choice = await DialogV2.wait({
    window: { title: "Arkhanval | Confirmation" },
    classes: ["arkhanval", "arkhanval-confirm-dialog"],
    content: `<section class="arkhanval-confirm-panel arkhanval-confirm-panel--danger">
      <h3><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Confirmer la suppression</h3>
      <div class="arkhanval-confirm-panel__body">
        <strong>Supprimer « ${safeName} » ?</strong>
        <small>Cet objet sera définitivement supprimé de votre personnage.</small>
      </div>
    </section>`,
    modal: true,
    rejectClose: false,
    buttons: [
      { action: "cancel", label: "Annuler", default: true },
      { action: "delete", label: "Supprimer", icon: "fa-solid fa-trash", class: "arkhanval-confirm-danger" }
    ]
  });
  return choice === "delete";
}

export class ArkhanvalCharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["arkhanval", "arkhanval-character-sheet"],
    position: {
      width: 976,
      height: 900
    },
    form: {
      handler: this.#handleSubmit,
      closeOnSubmit: false,
      submitOnChange: true
    },
    window: {
      resizable: true
    }
  };

  static PARTS = {
    body: {
      template: "systems/arkhanval/templates/actor/character-sheet.hbs"
    }
  };

  static TABS = {
    sheet: {
      initial: "character",
      tabs: [
        { id: "character", label: "Personnage", icon: "fa-solid fa-user" },
        { id: "equipment", label: "Équipement", icon: "fa-solid fa-briefcase" },
        { id: "spells", label: "Sortilège", icon: "fa-solid fa-book-open" },
        { id: "progression", label: "Progression", icon: "fa-solid fa-arrow-trend-up" }
      ]
    }
  };

  _sheetScale = SHEET_AUTO_FIT_MAX;
  _sheetResizeObserver = null;
  _pendingScrollPosition = null;
  _collapsedSpellIds = new Set();
  _advancedUnlocked = false;
  _progressionSession = null;
  _progressionRevision = null;
  _progressionSyncHooks = null;

  /** Keep Page 4 current when Ark circles or XP arrive through Chat, another
   * sheet or an embedded Item while this sheet remains open. No polling and no
   * re-render of the other three pages.
   */
  _installProgressionSync() {
    if (this._progressionSyncHooks) return;
    const updateActor = (actor) => {
      if (actor?.uuid === this.actor?.uuid) this._refreshProgressionIfChanged();
    };
    const updateItem = (item) => {
      if (item?.parent?.uuid === this.actor?.uuid) this._refreshProgressionIfChanged();
    };
    this._progressionSyncHooks = [
      ["updateActor", Hooks.on("updateActor", updateActor)],
      ["updateItem", Hooks.on("updateItem", updateItem)],
      ["createItem", Hooks.on("createItem", updateItem)],
      ["deleteItem", Hooks.on("deleteItem", updateItem)]
    ];
  }

  _removeProgressionSync() {
    for (const [event, id] of this._progressionSyncHooks ?? []) Hooks.off(event, id);
    this._progressionSyncHooks = null;
    this._progressionRevision = null;
  }

  _refreshProgressionIfChanged() {
    const revision = progressionRevision(this.actor);
    if (revision === this._progressionRevision) return;
    this._progressionRevision = revision;

    // A basket being prepared must not be erased or silently rebased: the
    // existing snapshot guard will reject a stale basket upon validation.
    const session = this._progressionSession;
    if (!session || session.committing || session.operations.length) return;
    const current = this.element?.querySelector("[data-progression-content]");
    if (!current) return;

    const wrapper = current.ownerDocument.createElement("div");
    wrapper.innerHTML = renderProgressionContent(this.actor, session.operations);
    const next = wrapper.firstElementChild;
    if (!next) return;
    const scroll = current.closest(".arkhanval-sheet-scroll");
    const scrollTop = scroll?.scrollTop;
    current.replaceWith(next);
    if (this.isEditable) {
      bindProgressionSurface(next, this.actor, session, {
        onRefresh: () => this.render({ force: false })
      });
    } else {
      for (const control of next.querySelectorAll("button, select")) control.disabled = true;
    }
    if (scroll && scrollTop !== undefined) scroll.scrollTop = scrollTop;
  }

  // La protection porte sur la fiche Actor uniquement, jamais sur les Items
  // ouverts séparément ni sur les workflows automatiques.
  _applyAdvancedProtection() {
    const root = this.element;
    if (!root) return;
    const permitted = this.isEditable;
    const unlocked = permitted && this._advancedUnlocked;
    const locks = root.querySelectorAll("[data-advanced-lock]");
    for (const lock of locks) {
      lock.disabled = !permitted;
      lock.setAttribute("aria-pressed", String(unlocked));
      lock.setAttribute("aria-label", unlocked ? "Verrouiller la fiche" : "Déverrouiller la fiche");
      lock.title = unlocked ? "Verrouiller la fiche" : "Déverrouiller la fiche";
      lock.innerHTML = `<i class="fa-solid ${unlocked ? "fa-lock-open" : "fa-lock"}" aria-hidden="true"></i>`;
      lock.classList.toggle("is-unlocked", unlocked);
    }
    const targets = root.querySelectorAll([
      "[data-skill-field]", "[data-ark-circle]", "[data-ark-rank]",
      "[data-primary-archetype-slot]", ".arkhanval-archetype-xp input",
      '[data-item-field="learningXp"]', '[data-item-field="learningTarget"]',
      '[data-advanced-work-edit]', '[data-advanced-incantation-edit]'
    ].join(","));
    for (const control of targets) {
      control.disabled = !unlocked;
      if (!unlocked && permitted) {
        if (!control.hasAttribute("data-advanced-original-title")) {
          control.dataset.advancedOriginalTitle = control.getAttribute("title") ?? "";
        }
        control.title = "Modification protégée\nDéverrouillez la fiche pour y accéder";
      } else if (control.hasAttribute("data-advanced-original-title")) {
        control.title = control.dataset.advancedOriginalTitle;
        delete control.dataset.advancedOriginalTitle;
      }
    }
    // Les cercles sont des cases invisibles placées dans un label visible :
    // l'infobulle doit porter sur le label survolé, pas seulement sur l'input.
    for (const input of root.querySelectorAll("[data-ark-circle]")) {
      const label = input.closest(".arkhanval-ark-mark");
      if (!label) continue;
      if (!unlocked && permitted) {
        if (!label.hasAttribute("data-advanced-original-title")) {
          label.dataset.advancedOriginalTitle = label.getAttribute("title") ?? "";
        }
        label.title = "Modification protégée\nDéverrouillez la fiche pour y accéder";
      } else if (label.hasAttribute("data-advanced-original-title")) {
        label.title = label.dataset.advancedOriginalTitle;
        delete label.dataset.advancedOriginalTitle;
      }
    }
    // En mode avancé, la poubelle REMPLACE l'icône de l'Item dans
    // la première cellule existante. Aucun enfant/colonne supplémentaire.
    const itemRows = root.querySelectorAll([
      '.arkhanval-weapon-summary[data-item-id]',
      '.arkhanval-armor-summary[data-item-id]',
      '.arkhanval-ark-trait-row[data-item-id]',
      '.arkhanval-work-row[data-item-id]',
      '.arkhanval-possession-row[data-item-id]',
      '.arkhanval-library-row[data-item-id]'
    ].join(','));
    for (const row of itemRows) {
      const button = row.querySelector(':scope > .arkhanval-advanced-delete');
      if (!unlocked) {
        // L'icône d'origine est conservée en mémoire sur le bouton temporaire.
        if (button?._arkhanvalOriginalIcon) button.replaceWith(button._arkhanvalOriginalIcon);
        continue;
      }
      if (button) continue;
      const icon = row.firstElementChild;
      if (!icon) continue;
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      // Conserver les dimensions de l'icône de la famille d'Item.
      deleteButton.className = `arkhanval-advanced-delete ${icon.className ?? ''}`.trim();
      deleteButton.dataset.advancedDelete = row.dataset.itemId;
      const itemName = this.actor.items.get(row.dataset.itemId)?.name ?? 'cet objet';
      deleteButton.title = `Supprimer « ${itemName} » (confirmation requise)`;
      deleteButton.setAttribute('aria-label', deleteButton.title);
      deleteButton.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
      deleteButton._arkhanvalOriginalIcon = icon;
      deleteButton.addEventListener('click', (event) => this._onAdvancedDelete(event));
      icon.replaceWith(deleteButton);
    }
    root.classList.toggle("arkhanval-advanced-unlocked", unlocked);
  }

  async _onAdvancedDelete(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isEditable || !this._advancedUnlocked) return;
    const id = event.currentTarget.dataset.advancedDelete;
    const item = this.actor.items.get(id);
    if (!item || !["weapon", "armor", "trait", "work", "equipment", "book"].includes(item.type)) return;
    if (!await confirmActorItemDeletion(item)) return;
    // L'Item doit toujours appartenir à cet Actor au moment de la confirmation.
    if (!this.actor.items.get(id) || !this._advancedUnlocked) return;
    await this.actor.deleteEmbeddedDocuments("Item", [id]);
    await this.render({ force: false });
  }


  _canRender(options) {
    if (isCreationRoutingActive(this.actor)) {
      openCharacterCreation(this.actor);
      return false;
    }
    return super._canRender(options);
  }

  _applyAutoFit({ preserveScroll = false } = {}) {
    const shell = this.element?.querySelector(".arkhanval-sheet-shell");
    const scroll = this.element?.querySelector(".arkhanval-sheet-scroll");
    if (!shell || !scroll) return;

    const style = getComputedStyle(scroll);
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(style.paddingRight) || 0;
    const usableWidth = Math.max(
      0,
      scroll.clientWidth - paddingLeft - paddingRight
    );
    if (!usableWidth) return;

    const nextScale = Math.min(
      SHEET_AUTO_FIT_MAX,
      Math.max(SHEET_AUTO_FIT_MIN, usableWidth / SHEET_WIDTH)
    );

    const previousScale = this._sheetScale || SHEET_AUTO_FIT_MAX;
    if (Math.abs(nextScale - previousScale) < 0.002) {
      shell.style.setProperty(
        "--arkhanval-sheet-scale",
        previousScale.toFixed(4)
      );
      return;
    }

    const scrollTop = scroll.scrollTop;
    const scrollLeft = scroll.scrollLeft;

    this._sheetScale = nextScale;
    shell.style.setProperty(
      "--arkhanval-sheet-scale",
      nextScale.toFixed(4)
    );

    if (!preserveScroll || previousScale <= 0) return;

    const ratio = nextScale / previousScale;
    requestAnimationFrame(() => {
      if (!scroll.isConnected) return;
      scroll.scrollTop = scrollTop * ratio;
      scroll.scrollLeft = scrollLeft * ratio;
    });
  }

  _setupAutoFit() {
    this._sheetResizeObserver?.disconnect();
    this._sheetResizeObserver = null;

    const scroll = this.element?.querySelector(".arkhanval-sheet-scroll");
    if (!scroll) return;

    this._applyAutoFit();

    if (typeof ResizeObserver === "undefined") return;

    this._sheetResizeObserver = new ResizeObserver(() => {
      this._applyAutoFit({ preserveScroll: true });
    });
    this._sheetResizeObserver.observe(scroll);
  }

  static async #handleSubmit(event, form, formData, submitOptions = {}) {
    const submitData = this._prepareSubmitData(
      event,
      form,
      formData,
      submitOptions.updateData
    );

    const isRichTextChange = event?.type === "change"
      && event?.target?.localName === "prose-mirror";
    const operationOptions = event?.type === "change"
      ? { render: false }
      : {};

    await this._processSubmitData(event, form, submitData, operationOptions);

    // Regular fields stay render-silent to preserve the sheet UX, but the
    // display side of a toggled ProseMirror uses pre-enriched HTML prepared in
    // _prepareContext. Refresh after the persisted value is committed so the
    // newly enriched HTML is immediately visible when the editor closes.
    if (isRichTextChange) await this.render({ force: false });
  }

  async _preClose(options) {
    this._removeProgressionSync();
    this._sheetResizeObserver?.disconnect();
    this._sheetResizeObserver = null;

    if (this.isEditable && this.form) await this.submit();
    this._advancedUnlocked = false;
    return super._preClose(options);
  }

  async _preRender(context, options) {
    if (this.rendered) {
      const scroll = this.element?.querySelector(".arkhanval-sheet-scroll");
      if (scroll) {
        this._pendingScrollPosition = {
          top: scroll.scrollTop,
          left: scroll.scrollLeft
        };
      }
    }

    await super._preRender(context, options);
  }

  _restoreScrollPosition() {
    if (!this._pendingScrollPosition) return;

    const scroll = this.element?.querySelector(".arkhanval-sheet-scroll");
    if (!scroll) return;

    scroll.scrollTop = this._pendingScrollPosition.top;
    scroll.scrollLeft = this._pendingScrollPosition.left;
    this._pendingScrollPosition = null;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._restoreScrollPosition();

    const root = this.element;
    if (!root) return;

    this._setupAutoFit();
    for (const lock of root.querySelectorAll("[data-advanced-lock]")) lock.addEventListener("click", () => {
      if (!this.isEditable) return;
      this._advancedUnlocked = !this._advancedUnlocked;
      this._applyAdvancedProtection();
    });
    this._applyAdvancedProtection();

    for (const input of root.querySelectorAll("[data-actor-name]")) {
      input.addEventListener("change", (event) => this._onActorNameChange(event));
    }

    for (const control of root.querySelectorAll("[data-spell-toggle]")) {
      control.addEventListener("click", (event) => this._onSpellToggle(event));
    }

    // Each full render uses fresh Actor data. Subsequent updates can refresh
    // just the progression body while preserving the active page and scroll.
    this._progressionRevision = progressionRevision(this.actor);
    this._installProgressionSync();
    const progressionRoot = root.querySelector("[data-progression-content]");
    if (progressionRoot && this._progressionSession) {
      if (this.isEditable) {
        bindProgressionSurface(progressionRoot, this.actor, this._progressionSession, {
          onRefresh: () => this.render({ force: false })
        });
      } else {
        for (const control of progressionRoot.querySelectorAll("button, select")) control.disabled = true;
      }
    }

    // App V2 may reuse the sheet root across renders.
    // Abort the previous delegated listener before installing the new one so a
    // single click can never open several pre-roll dialogs.
    this._incantationListenerController?.abort();
    this._incantationListenerController = new AbortController();
    root.addEventListener("click", (event) => {
      const delegated = (currentTarget) => ({
        currentTarget,
        target: event.target,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation()
      });

      const start = event.target.closest?.("[data-spell-incantation-start]");
      if (start) return this._onSpellIncantationStart(delegated(start));

      const roll = event.target.closest?.("[data-spell-incantation-roll]");
      if (roll) return this._onSpellIncantationRoll(delegated(roll));

      const release = event.target.closest?.("[data-spell-incantation-release]");
      if (release) return this._onSpellIncantationRelease(delegated(release));

      const maintain = event.target.closest?.("[data-spell-incantation-maintain]");
      if (maintain) return this._onSpellIncantationMaintain(delegated(maintain));

      const cancel = event.target.closest?.("[data-spell-incantation-cancel]");
      if (cancel) return this._onSpellIncantationCancel(delegated(cancel));

      const master = event.target.closest?.("[data-spell-learning-master]");
      if (master) return this._onSpellLearningMaster(delegated(master));

      const workProgress = event.target.closest?.("[data-work-progress]");
      if (workProgress) return this._onWorkProgress(delegated(workProgress));

      const bookRead = event.target.closest?.("[data-book-read]");
      if (bookRead) return this._onBookRead(delegated(bookRead));
    }, { signal: this._incantationListenerController.signal });

    if (game.user?.isGM) {
      for (const control of root.querySelectorAll("[data-state-manager-open]")) {
        const openStateManager = () => openStateManagerWindow(this.actor, {
          onChange: () => this.render({ force: false })
        });
        control.addEventListener("click", openStateManager);
        control.addEventListener("keydown", (event) => {
          if (!["Enter", " "].includes(event.key)) return;
          event.preventDefault();
          openStateManager();
        });
      }
    }

    for (const control of root.querySelectorAll("[data-item-open]")) {
      control.addEventListener("click", (event) => this._onOpenEmbeddedItem(event));
    }

    for (const control of root.querySelectorAll("[data-item-create]")) {
      control.addEventListener("click", (event) => this._onCreateEmbeddedItem(event));
    }

    for (const control of root.querySelectorAll("[data-skill-action]")) {
      control.addEventListener("click", (event) => this._onSkillAction(event));
    }


    for (const input of root.querySelectorAll("[data-ark-action]")) {
      input.addEventListener("click", (event) => this._onArkAction(event));
    }

    for (const input of root.querySelectorAll("[data-wound-mark]")) {
      input.addEventListener("click", (event) => this._onWoundMarkClick(event));
    }

    if (!this.isEditable) return;

    for (const select of root.querySelectorAll("[data-primary-archetype-slot]")) {
      select.addEventListener("change", (event) => this._onPrimaryArchetypeChange(event));
    }

    for (const input of root.querySelectorAll("[data-people-field]")) {
      input.addEventListener("change", (event) => this._onPeopleChange(event));
    }

    for (const select of root.querySelectorAll("[data-combat-technique]")) {
      select.addEventListener("change", (event) => this._onCombatTechniqueChange(event));
    }

    for (const input of root.querySelectorAll("[data-skill-field]")) {
      input.addEventListener("change", (event) => this._onSkillFieldChange(event));
    }

    for (const input of root.querySelectorAll("[data-ark-circle]")) {
      input.addEventListener("change", (event) => this._onArkCircleChange(event));
    }

    for (const input of root.querySelectorAll("[data-ark-rank]")) {
      input.addEventListener("change", (event) => this._onArkRankChange(event));
    }

    for (const input of root.querySelectorAll("[data-wound-mark]")) {
      input.addEventListener("change", (event) => this._onWoundMarkChange(event));
    }

    for (const input of root.querySelectorAll("[data-actor-state]")) {
      input.addEventListener("change", (event) => this._onVanillaStateChange(event));
    }

    for (const input of root.querySelectorAll("[data-item-id][data-item-field]")) {
      input.addEventListener("change", (event) => this._onEmbeddedItemFieldChange(event));
    }
    for (const input of root.querySelectorAll("[data-advanced-work-edit]")) {
      input.addEventListener("change", (event) => this._onAdvancedWorkProgressChange(event));
    }
    for (const input of root.querySelectorAll("[data-advanced-incantation-edit]")) {
      input.addEventListener("change", (event) => this._onAdvancedIncantationChange(event));
    }
  }

  async _onDropItem(event, item) {
    if (item.type === "skill") {
      const archetype = item.system.archetype;
      const valid = ARKHANVAL_ARCHETYPES.some((entry) => entry.id === archetype);
      if (!valid) {
        ui.notifications?.warn?.(
          game.i18n.localize("ARKHANVAL.ItemSheet.SkillDropMissingArchetype")
        );
        return null;
      }

      // Existing Embedded Items are being sorted, not newly imported.
      if (item.parent !== this.actor) {
        const canonical = resolveCanonicalSkill(item);
        const identifier = canonical?.identifier
          ?? buildSkillIdentifier(archetype, item.name);

        if (identifier && item.system.identifier !== identifier) {
          item = await item.clone(
            { system: { identifier } },
            { keepId: false, save: false }
          );
        }
      }
    }

    if (item.type === "spell" && item.parent !== this.actor) {
      const acquisitionStatus = await promptSpellAcquisitionMode(item);
      if (!acquisitionStatus) return null;

      const learningTarget = acquisitionStatus === "learning"
        ? proposedLearningTarget(item)
        : 0;

      item = await item.clone(
        {
          system: {
            acquisitionStatus,
            learningXp: 0,
            learningTarget
          }
        },
        { keepId: false, save: false }
      );
    }

    return super._onDropItem(event, item);
  }

  async _onActorNameChange(event) {
    const input = event.currentTarget;
    const name = input.value.trim();
    if (!name || name === this.actor.name) return;

    await this.actor.update({ name });
  }

  _onSpellToggle(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const itemId = button.dataset.itemId;
    if (!itemId) return;

    const card = button.closest(".arkhanval-spell-card");
    const details = card?.querySelector("[data-spell-details]");
    if (!card || !details) return;

    const collapsing = !card.classList.contains("is-collapsed");
    card.classList.toggle("is-collapsed", collapsing);
    details.hidden = collapsing;

    if (collapsing) this._collapsedSpellIds.add(itemId);
    else this._collapsedSpellIds.delete(itemId);

    button.setAttribute("aria-expanded", String(!collapsing));
    button.title = game.i18n.localize(
      collapsing ? "ARKHANVAL.SpellFields.ShowDetails" : "ARKHANVAL.SpellFields.HideDetails"
    );

  }

  async _onOpenEmbeddedItem(event) {
    event.preventDefault();
    const itemId = event.currentTarget.dataset.itemId;
    if (!itemId) return;

    const item = this.actor.items.get(itemId);
    if (!item) return;

    await item.sheet.render({ force: true });
  }

  async _onCreateEmbeddedItem(event) {
    event.preventDefault();
    if (!this.isEditable) return;

    const control = event.currentTarget;
    const type = String(control.dataset.itemType ?? "").trim();
    const name = String(control.dataset.itemName ?? "").trim();
    if (!type || !name) return;

    const allowedTypes = new Set(["weapon", "armor", "equipment", "spell", "book", "work"]);
    if (!allowedTypes.has(type)) return;

    const [item] = await this.actor.createEmbeddedDocuments(
      "Item",
      [{ name, type }],
      { render: false }
    );
    if (!item) return;

    await item.sheet.render({ force: true });
  }

  async _onBookRead(event) {
    event.preventDefault();
    if (!this.isEditable) return;

    const bookId = String(event.currentTarget.dataset.itemId ?? "");
    const book = this.actor.items.get(bookId);
    if (!book || book.type !== "book") return;

    const current = Math.max(0, Math.trunc(Number(book.system.reading?.progress) || 0));
    const target = Math.max(0, Math.trunc(Number(book.system.reading?.required) || 0));
    const completed = Boolean(book.system.reading?.completed) || (target > 0 && current >= target);
    if (completed) return;

    try {
      const preferredSkill = findActorSkill(this.actor, {
        identifier: "arkhanval.skill.erudit.lecture-ecriture"
      });
      const request = await promptSkillRoll({
        actor: this.actor,
        skill: preferredSkill,
        combatContext: null,
        ruleContext: {
          contexts: ["book"],
          ruleSources: [book]
        },
        defaultFd: Number(book.system.reading?.fd) || 0,
        title: `Lire — ${book.name}`
      });
      if (!request) return;

      const result = await resolveRoll(request);

      if (request.ark?.boost) {
        const spent = await spendArkCircle(this.actor, request.ark.boost);
        if (!spent) {
          ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
          return;
        }
      }

      const experienceSource = experienceSourceFromRollRequest(this.actor, request);
      await postResolutionChatMessage(this.actor, result, {
        arkBoost: request.ark?.boost ?? "",
        experienceSource,
        book: bookChatContext(book)
      });
    } catch (error) {
      console.error("Arkhanval | Échec du jet de lecture", error);
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  }

  async _onWorkProgress(event) {
    event.preventDefault();
    if (!this.isEditable) return;

    const workId = String(event.currentTarget.dataset.itemId ?? "");
    const work = this.actor.items.get(workId);
    if (!work || work.type !== "work") return;
    if (String(work.system.status ?? "active") === "completed") return;

    try {
      const skillIdentifier = String(work.system.skillIdentifier ?? "").trim();
      const preferredSkill = skillIdentifier
        ? findActorSkill(this.actor, { identifier: skillIdentifier })
        : null;
      const request = await promptSkillRoll({
        actor: this.actor,
        skill: preferredSkill,
        combatContext: null,
        defaultFd: Number(work.system.fd) || 0,
        title: `Faire progresser — ${work.name}`
      });
      if (!request) return;

      const result = await resolveRoll(request);

      if (request.ark?.boost) {
        const spent = await spendArkCircle(this.actor, request.ark.boost);
        if (!spent) {
          ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
          return;
        }
      }

      const experienceSource = experienceSourceFromRollRequest(this.actor, request);
      await postResolutionChatMessage(this.actor, result, {
        arkBoost: request.ark?.boost ?? "",
        experienceSource,
        work: workChatContext(work)
      });
    } catch (error) {
      console.error("Arkhanval | Échec du jet de progression d’un travail", error);
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  }

  async _onSpellIncantationStart(event) {
    event.preventDefault();
    if (!this.isEditable) return;

    const spellId = String(event.currentTarget.dataset.itemId ?? "");
    const spell = this.actor.items.get(spellId);
    if (!spell || spell.type !== "spell") return;
    if (spellAcquisitionStatus(spell) !== "mastered") {
      ui.notifications?.warn?.("Arkhanval | Ce sortilège est encore en apprentissage.");
      return;
    }

    try {
      await startSpellIncantation(this.actor, spell);
    } catch (error) {
      console.error("Arkhanval | Échec du démarrage d'incantation", error);
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  }

  async _onSpellIncantationRoll(event) {
    event.preventDefault();
    if (!this.isEditable) return;

    const spellId = String(event.currentTarget.dataset.itemId ?? "");
    const spell = this.actor.items.get(spellId);
    const state = prepareIncantationView(this.actor, spell);
    if (!spell || !state) return;
    if (spellAcquisitionStatus(spell) !== "mastered" || state.ready) return;

    try {
      const preferredSkill = preferredIncantationSkill(this.actor, state);
      const request = await promptSkillRoll({
        actor: this.actor,
        skill: preferredSkill,
        combatContext: null,
        defaultFd: state.fd,
        title: `Incantation — ${spell.name}`,
        ruleContext: {
          contexts: ["magic"],
          tags: Array.from(spell.system.tags ?? []).map(String),
          ruleSources: [spell]
        }
      });
      if (!request) return;

      const result = await resolveRoll(request);

      if (request.ark?.boost) {
        const spent = await spendArkCircle(this.actor, request.ark.boost);
        if (!spent) {
          ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
          return;
        }
      }

      const contributionId = foundry.utils.randomID();
      const incantation = incantationChatContext(state, contributionId);

      await postResolutionChatMessage(this.actor, result, {
        arkBoost: request.ark?.boost ?? "",
        experienceSource: null,
        incantation
      });
    } catch (error) {
      console.error("Arkhanval | Échec du jet d'incantation", error);
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  }

  async _onSpellIncantationRelease(event) {
    event.preventDefault();
    if (!this.isEditable) return;

    const spellId = String(event.currentTarget.dataset.itemId ?? "");
    const spell = this.actor.items.get(spellId);
    const state = prepareIncantationView(this.actor, spell);
    if (!spell || !state) return;

    try {
      const resolutionMode = await promptActionResolutionMode({
        actionLabel: spell.name
      });
      if (!resolutionMode) return;

      const ChatMessageClass = globalThis.foundry?.documents?.ChatMessage ?? globalThis.ChatMessage;
      if (!ChatMessageClass) return;

      const premature = state.target > 0 && state.total < state.target;
      const spellDescriptionHtml = await enrichArkhanvalHTML(spell.system.description, spell);

      if (resolutionMode === "opposed") {
        const targetSnapshots = captureSpellTargets(game.user?.targets ?? []);
        if (!targetSnapshots.length) {
          ui.notifications?.warn?.("Arkhanval | Sélectionnez au moins une cible avant de libérer un sort avec opposition.");
          return;
        }
        const premature = state.target > 0 && state.total < state.target;
        const resolution = {
          mode: "opposed",
          status: targetSnapshots.length ? "awaiting-target-response" : "awaiting-target-selection",
          sessionId: String(state.id ?? ""),
          spellId,
          spellName: String(spell.name ?? ""),
          spellImg: String(spell.img ?? ""),
          spellDescriptionHtml,
          castingSkill: String(state.castingSkill ?? ""),
          fd: Number(state.fd) || 0,
          total: state.total,
          target: state.target,
          premature,
          caster: captureSpellCaster(this.actor),
          targets: targetSnapshots,
          responses: {},
          finalDecision: null
        };

        await ChatMessageClass.create({
          speaker: ChatMessageClass.getSpeaker({ actor: this.actor }),
          content: buildSpellResolutionChatContent(resolution),
          flags: {
            arkhanval: {
              spellResolution: resolution
            }
          }
        });
        return;
      }

      const resolution = {
        mode: "direct",
        status: "ready-to-resolve",
        sessionId: String(state.id ?? ""),
        spellId,
        spellName: String(spell.name ?? ""),
        spellImg: String(spell.img ?? ""),
        spellDescriptionHtml,
        castingSkill: String(state.castingSkill ?? ""),
        fd: Number(state.fd) || 0,
        total: state.total,
        target: state.target,
        premature,
        caster: captureSpellCaster(this.actor),
        targets: [],
        responses: {},
        finalDecision: null
      };

      await createSpellFinalChatMessage(resolution);
    } catch (error) {
      console.error("Arkhanval | Échec de la libération du sort", error);
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  }

  async _onSpellIncantationMaintain(event) {
    event.preventDefault();
    if (!this.isEditable) return;

    const spellId = String(event.currentTarget.dataset.itemId ?? "");
    const spell = this.actor.items.get(spellId);
    const state = prepareIncantationView(this.actor, spell);
    if (!spell || !state?.ready) return;

    const concentration = findActorSkill(this.actor, {
      identifier: "arkhanval.skill.magicien.concentration"
    });
    if (!concentration) {
      ui.notifications?.warn?.("Arkhanval | La compétence Concentration est introuvable sur ce personnage.");
      return;
    }

    try {
      const request = await promptSkillRoll({
        actor: this.actor,
        skill: concentration,
        combatContext: null,
        defaultFd: state.fd,
        title: `Maintenir — ${spell.name}`
      });
      if (!request) return;

      const result = await resolveRoll(request);
      if (request.ark?.boost) {
        const spent = await spendArkCircle(this.actor, request.ark.boost);
        if (!spent) {
          ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
          return;
        }
      }

      const experienceSource = experienceSourceFromRollRequest(this.actor, request);
      await postResolutionChatMessage(this.actor, result, {
        arkBoost: request.ark?.boost ?? "",
        experienceSource,
        spellMaintenance: {
          actorName: String(this.actor.name ?? "Le personnage"),
          spellId: String(spell.id ?? ""),
          spellName: String(spell.name ?? "")
        }
      });
    } catch (error) {
      console.error("Arkhanval | Échec du jet de maintien du sortilège", error);
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  }

  async _onSpellIncantationCancel(event) {
    event.preventDefault();
    if (!this.isEditable) return;

    const spellId = String(event.currentTarget.dataset.itemId ?? "");
    const spell = this.actor.items.get(spellId);
    const state = prepareIncantationView(this.actor, spell);
    if (!state) return;

    try {
      await cancelSpellIncantation(this.actor, spellId);
    } catch (error) {
      console.error("Arkhanval | Échec de l'annulation d'incantation", error);
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  }

  async _onSpellLearningMaster(event) {
    event.preventDefault();
    if (!this.isEditable) return;

    const spellId = String(event.currentTarget.dataset.itemId ?? "");
    const spell = this.actor.items.get(spellId);
    if (!spell || spell.type !== "spell" || spellAcquisitionStatus(spell) !== "learning") return;

    const xp = Math.max(0, Math.trunc(Number(spell.system.learningXp) || 0));
    const target = Math.max(0, Math.trunc(Number(spell.system.learningTarget) || 0));
    if (target <= 0 || xp < target) {
      ui.notifications?.warn?.("Arkhanval | L’objectif d’apprentissage n’est pas encore atteint.");
      return;
    }

    await spell.update({ "system.acquisitionStatus": "mastered" });
  }

  async _onAdvancedWorkProgressChange(event) {
    if (!this.isEditable || !this._advancedUnlocked) return;
    const id = String(event.currentTarget.dataset.itemId ?? "");
    const item = this.actor.items.get(id);
    if (item?.type !== "work") return;
    const row = event.currentTarget.closest(".arkhanval-work-row");
    const current = Number(row?.querySelector('[data-advanced-work-edit="current"]')?.value);
    const target = Number(row?.querySelector('[data-advanced-work-edit="target"]')?.value);
    if (![current, target].every((value) => Number.isInteger(value) && value >= 0 && value <= 99999)) {
      ui.notifications?.warn?.("Arkhanval | La progression du travail doit être un entier positif ou nul.");
      return;
    }
    const completed = target > 0 && current >= target;
    await item.update({
      "system.progress.current": current,
      "system.progress.target": target,
      "system.status": completed ? "completed" : "active"
    });
    await this.render({ force: false });
  }

  async _onAdvancedIncantationChange(event) {
    if (!this.isEditable || !this._advancedUnlocked) return;
    const spellId = String(event.currentTarget.dataset.itemId ?? "");
    const block = event.currentTarget.closest(".arkhanval-incantation-block");
    const total = Number(block?.querySelector('[data-advanced-incantation-edit="total"]')?.value);
    const target = Number(block?.querySelector('[data-advanced-incantation-edit="target"]')?.value);
    try {
      await adjustSpellIncantationProgress(this.actor, { spellId, total, target });
      await this.render({ force: false });
    } catch (error) {
      ui.notifications?.warn?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  }

  async _onSkillAction(event) {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) return;

    const control = event.currentTarget;
    const skill = findActorSkill(this.actor, {
      itemId: control.dataset.itemId ?? "",
      identifier: control.dataset.skillIdentifier ?? "",
      archetype: control.dataset.skillArchetype ?? ""
    });
    if (!skill) return;


    if (event.shiftKey) {
      if (!skill.itemId) return;

      const item = this.actor.items.get(skill.itemId);
      if (item) await item.sheet.render({ force: true });
      return;
    }

    try {
      // One preparation window: combat skills choose the mode before showing
      // the matching pre-roll, without opening an intermediate dialog.
      const combatMode = isDirectCombatSkill(skill.identifier)
        ? {
            getOppositionContext: () => captureCombatRollContext(
              this.actor,
              skill.identifier
            )
          }
        : null;

      const request = await promptSkillRoll({
        actor: this.actor,
        skill,
        combatMode
      });
      if (!request) return;

      let result = await resolveRoll(request);

      if (request.ark?.boost) {
        const spent = await spendArkCircle(this.actor, request.ark.boost);
        if (!spent) {
          ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
          return;
        }
      }


      const progressGain = request.progressive?.enabled
        ? progressionGainFromQr(result.qr)
        : null;

      const experienceSource = experienceSourceFromRollRequest(this.actor, request);

      await postResolutionChatMessage(this.actor, result, {
        progressGain,
        arkBoost: request.ark?.boost ?? "",
        experienceSource,
        combatContext: request.combat ?? null
      });
    } catch (error) {
      console.error("Arkhanval | Échec du jet de compétence", error);
      ui.notifications?.error?.(
        game.i18n.format("ARKHANVAL.Resolution.RollError", {
          message: error?.message ?? String(error)
        })
      );
    }
  }


  async _onArkAction(event) {
    const arkId = event.currentTarget.dataset.arkAction;
    if (!arkId) return;

    event.preventDefault();
    if (event.ctrlKey || event.metaKey) return;

    try {
      const ark = ARKHANVAL_ARKS.find((entry) => entry.id === arkId);
      if (!ark) return;

      if (ARK_TABLES[arkId]) {
        const mode = await promptArkActionMode(ark.label);
        if (!mode) return;
        if (mode === "table") {
          await rollArkTable(this.actor, arkId);
          return;
        }
      }

      const request = await promptArkRollRequest(this.actor, arkId);
      if (!request) return;

      let result = await resolveRoll(request);

      if (request.ark?.boost) {
        const spent = await spendArkCircle(this.actor, request.ark.boost);
        if (!spent) {
          ui.notifications?.warn?.("Arkhanval | Le cercle d’Ark choisi n’est plus disponible.");
          return;
        }
      }


      const experienceSource = experienceSourceFromRollRequest(this.actor, request);

      await postResolutionChatMessage(this.actor, result, {
        arkBoost: request.ark?.boost ?? "",
        experienceSource
      });
    } catch (error) {
      console.error("Arkhanval | Échec de l’action d’Ark", error);
      ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
    }
  }

  async _onWoundMarkClick(event) {
    if (!event.shiftKey) return;
    const itemId = event.currentTarget.dataset.woundItemId;
    if (!itemId) return;
    event.preventDefault();
    const item = this.actor.items.get(itemId);
    if (item) await item.sheet.render({ force: true });
  }

  _syncWoundTrackAvailability(rank) {
    const capacity = WOUND_CAPACITY_BY_ARKOEUR[rank] ?? {};

    for (const track of WOUND_TRACKS) {
      const current = this.actor.items.filter(
        (item) => item.type === "wound" && item.system.severity === track.id
      ).length;
      const available = Math.max(Number(capacity[track.id]) || 0, current);

      for (const input of this.element?.querySelectorAll(
        `[data-wound-severity="${track.id}"][data-wound-mark]`
      ) ?? []) {
        const index = Number(input.dataset.woundMark);
        const label = input.closest(".arkhanval-wound-mark");
        if (!label) continue;
        label.hidden = index > available;
        label.title = `${current} / ${Number(capacity[track.id]) || 0}`;
      }
    }
  }

  _onArkRankChange(event) {
    if (!this.isEditable || !this._advancedUnlocked) return;
    const input = event.currentTarget;
    if (input.dataset.arkRank !== "arkoeur") return;

    const rank = Number(input.value);
    this._syncWoundTrackAvailability(Number.isFinite(rank) ? rank : 0);
  }

  async _onPrimaryArchetypeChange(event) {
    if (!this.isEditable || !this._advancedUnlocked) return;
    const select = event.currentTarget;
    const slot = Number(select.dataset.primaryArchetypeSlot);
    if (!Number.isInteger(slot) || slot < 0 || slot > 1) return;

    const current = Array.from(this.actor.system.archetypes?.primary ?? []).slice(0, 2);
    const next = [...current];
    const value = select.value;

    if (value && next.some((id, index) => index !== slot && id === value)) {
      select.value = current[slot] ?? "";
      ui.notifications?.warn?.("Arkhanval | Les deux archétypes principaux doivent être différents.");
      return;
    }

    if (value) next[slot] = value;
    else next.splice(slot, 1);

    const normalized = next.filter(Boolean).slice(0, 2);
    await this.actor.update(
      { "system.archetypes.primary": normalized },
      { render: false }
    );
  }

  async _onPeopleChange(event) {
    const input = event.currentTarget;
    const name = input.value.trim();
    const peopleItems = this.actor.items.filter((item) => item.type === "people");
    const current = peopleItems[0];

    if (!name) {
      if (peopleItems.length) {
        await this.actor.deleteEmbeddedDocuments(
          "Item",
          peopleItems.map((item) => item.id),
          { render: false }
        );
      }
      return;
    }

    if (current) {
      await current.update({ name }, { render: false });
      return;
    }

    await this.actor.createEmbeddedDocuments(
      "Item",
      [{ name, type: "people" }],
      { render: false }
    );
  }

  async _onCombatTechniqueChange(event) {
    const select = event.currentTarget;
    const nextTechnique = String(select.value ?? "none") || "none";
    const previousTechnique = String(this.actor.system.combat?.technique ?? "none") || "none";

    await this.actor.update(
      { [actorField("combat.technique")]: nextTechnique },
      { render: false }
    );

    if (nextTechnique !== previousTechnique && actorIsInActiveCombat(this.actor)) {
      await postCombatTechniqueChangeMessage(this.actor, previousTechnique, nextTechnique);
    }
  }

  _bindSkillRowToItem(row, item) {
    if (!row || !item) return;
    for (const control of row.querySelectorAll("[data-skill-field], [data-skill-action]")) {
      control.dataset.itemId = item.id;
      if (control.matches("[data-skill-field]")) {
        control.disabled = !this.isEditable;
      }
      if (control.matches("[data-skill-action]")) {
        control.setAttribute(
          "aria-label",
          `${item.name} — ${game.i18n.localize("ARKHANVAL.Resolution.SkillClickHint")}`
        );
        const detail = row.querySelector("[data-skill-tooltip-detail]");
        if (detail) {
          detail.hidden = false;
          detail.classList.remove("arkhanval-skill-tooltip__action--unavailable");
        }
      }
    }
  }

  async _onSkillFieldChange(event) {
    if (!this.isEditable || !this._advancedUnlocked) return;
    const input = event.currentTarget;
    const row = input.closest(".arkhanval-skill-row");
    const field = input.dataset.skillField;
    const archetype = input.dataset.skillArchetype;
    const identifier = input.dataset.skillIdentifier ?? "";
    const isCustom = input.dataset.skillCustom === "true";
    const itemId = input.dataset.itemId;
    const current = itemId ? this.actor.items.get(itemId) : null;

    if (!["rank", "xp"].includes(field) || !archetype) return;

    const value = input.value === "" ? 0 : Number(input.value);
    if (!Number.isFinite(value)) return;

    if (current) {
      await current.update({ [`system.${field}`]: value }, { render: false });
      return;
    }

    // Custom skills always correspond to real Embedded Items; a missing custom Item cannot be edited here.
    if (isCustom) return;

    const name = (input.dataset.skillName ?? "").trim();
    if (!name || !identifier) return;

    const system = {
      identifier: identifier || buildSkillIdentifier(archetype, name),
      archetype,
      rank: 0,
      xp: 0,
      [field]: value
    };

    const [created] = await this.actor.createEmbeddedDocuments(
      "Item",
      [{ name, type: "skill", system }],
      { render: false }
    );

    this._bindSkillRowToItem(row, created);
  }

  async _onArkCircleChange(event) {
    if (!this.isEditable || !this._advancedUnlocked) return;
    const input = event.currentTarget;
    const ark = input.dataset.ark;
    const index = Number(input.dataset.arkCircle);
    if (!ark || !Number.isInteger(index)) return;

    const current = Number(this.actor.system.arks?.[ark]?.circles) || 0;
    const desired = current === index ? Math.max(0, index - 1) : index;

    await this.actor.update(
      { [`system.arks.${ark}.circles`]: desired },
      { render: false }
    );

    // No full sheet render: keep the visible cumulative track in sync locally.
    for (const mark of this.element?.querySelectorAll("[data-ark-circle]") ?? []) {
      if (mark.dataset.ark !== ark) continue;
      mark.checked = Number(mark.dataset.arkCircle) <= desired;
    }
  }

  async _onWoundMarkChange(event) {
    const input = event.currentTarget;
    const severity = input.dataset.woundSeverity;
    const index = Number(input.dataset.woundMark);
    if (!severity || !Number.isInteger(index)) return;

    const existing = this.actor.items.filter(
      (item) => item.type === "wound" && item.system.severity === severity
    );
    const current = existing.length;
    const desired = current === index ? Math.max(0, index - 1) : index;

    if (desired > current) {
      const label = game.i18n.localize(`ARKHANVAL.Wounds.${{
        light: "LightLabel",
        serious: "SeriousLabel",
        critical: "CriticalLabel"
      }[severity]}`);

      const createData = Array.from({ length: desired - current }, () => ({
        name: label,
        type: "wound",
        system: { severity }
      }));
      await this.actor.createEmbeddedDocuments("Item", createData, { render: false });
    } else if (desired < current) {
      const deleteIds = existing
        .slice(desired)
        .map((item) => item.id);
      await this.actor.deleteEmbeddedDocuments("Item", deleteIds, { render: false });
    }

    // Same cumulative behavior as the Ark tracks, without a full re-render.
    for (const mark of this.element?.querySelectorAll("[data-wound-mark]") ?? []) {
      if (mark.dataset.woundSeverity !== severity) continue;
      mark.checked = Number(mark.dataset.woundMark) <= desired;
    }
  }

  async _onVanillaStateChange(event) {
    const input = event.currentTarget;
    const stateId = String(input.dataset.actorState ?? "");
    if (!VANILLA_STATE_DEFINITIONS.some((state) => state.id === stateId)) return;

    await this.actor.update({
      [`system.states.${stateId}`]: Boolean(input.checked)
    });

    const fdPenalty = persistentStateFdModifier(this.actor);
    for (const element of this.element?.querySelectorAll(".arkhanval-wound-field--fd-penalty") ?? []) {
      if ("value" in element) element.value = fdPenalty;
      else element.textContent = String(fdPenalty);
    }
  }

  async _onEmbeddedItemFieldChange(event) {
    if (["learningXp", "learningTarget"].includes(event.currentTarget.dataset.itemField)
      && (!this.isEditable || !this._advancedUnlocked)) return;
    const input = event.currentTarget;
    const itemId = input.dataset.itemId;
    const field = input.dataset.itemField;
    if (!itemId || !field) return;

    const item = this.actor.items.get(itemId);
    if (!item) return;

    let value;
    switch (input.dataset.itemValueType) {
      case "number":
        value = input.value === "" ? 0 : Number(input.value);
        if (!Number.isFinite(value)) return;
        break;
      case "boolean":
        value = Boolean(input.checked);
        break;
      default:
        value = input.value;
    }

    await item.update({ [`system.${field}`]: value }, { render: false });

    // Embedded spell descriptions are also ProseMirror fields. Their Item
    // update is intentionally render-silent, so refresh the Actor sheet once
    // the new HTML has been persisted in order to rebuild enrichedDescription.
    if (input.localName === "prose-mirror") {
      await this.render({ force: false });
      return;
    }

    if (item.type === "spell" && ["learningXp", "learningTarget"].includes(field)) {
      this.render();
      return;
    }

    if (item.type === "armor" && (field === "equipped" || field.startsWith("protection."))) {
      const protectionDisplay = computeProtectionDisplay(this.actor);
      for (const element of this.element?.querySelectorAll("[data-active-protection]") ?? []) {
        if ("value" in element && element.matches("input, output")) {
          element.value = protectionDisplay.display;
        } else {
          element.textContent = protectionDisplay.display;
        }

        element.title = protectionDisplay.modifier
          ? `Protection portée ${protectionDisplay.base}, modificateur ${protectionDisplay.modifier > 0 ? "+" : ""}${protectionDisplay.modifier}, protection effective ${protectionDisplay.effective}`
          : `Protection portée ${protectionDisplay.base}`;
      }

      if (field === "equipped") this.render();
    }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const peopleItems = this.actor.items.filter((item) => item.type === "people");
    const specialtyItems = this.actor.items.filter((item) => item.type === "specialty");
    const stateItems = this.actor.items
      .filter((item) => item.type === "state")
      .map(prepareItemSummary)
      .sort((left, right) => left.name.localeCompare(right.name, "fr", { sensitivity: "base" }));
    const primary = Array.from(this.actor.system.archetypes?.primary ?? []);
    const [specialtiesLeft, specialtiesRight] = distributeSpecialtiesByPrimary(specialtyItems, primary);

    const weaponRows = this.actor.items
      .filter((item) => item.type === "weapon")
      .map((item) => ({
        ...prepareItemSummary(item),
        img: String(item.img ?? ""),
        damage: String(item.system.damage ?? "").trim(),
        family: weaponFamilyFromTags(item.system.tags ?? [])
      }))
      .sort((left, right) =>
        (left.family.order - right.family.order) ||
        left.name.localeCompare(right.name, "fr", { sensitivity: "base" })
      );

    const weaponGroups = [];
    for (const weapon of weaponRows) {
      let group = weaponGroups.at(-1);
      if (!group || group.id !== weapon.family.id) {
        group = {
          id: weapon.family.id,
          label: weapon.family.label,
          items: []
        };
        weaponGroups.push(group);
      }
      group.items.push(weapon);
    }
    const armorTypeOrder = new Map([
      ["armor.helmet", 0],
      ["armor.body", 1],
      ["armor.shield", 2]
    ]);

    const armorRows = this.actor.items
      .filter((item) => item.type === "armor")
      .map((item) => {
        const tags = Array.from(item.system.tags ?? []).map(String);
        const typeOrder = tags.reduce(
          (best, tag) => Math.min(best, armorTypeOrder.get(tag) ?? Number.POSITIVE_INFINITY),
          Number.POSITIVE_INFINITY
        );

        return {
          ...prepareItemSummary(item),
          img: String(item.img ?? ""),
          protectionBase: Math.max(0, Number(item.system.protection?.base) || 0),
          protectionCurrent: Math.max(0, Number(item.system.protection?.current) || 0),
          equipped: Boolean(item.system.equipped),
          typeOrder
        };
      })
      .sort((left, right) => {
        if (left.equipped !== right.equipped) return left.equipped ? -1 : 1;
        if (left.typeOrder !== right.typeOrder) return left.typeOrder - right.typeOrder;
        return left.name.localeCompare(right.name, "fr", { sensitivity: "base" });
      });

    const firstUnequippedArmorIndex = armorRows.findIndex((item) => !item.equipped);
    if (firstUnequippedArmorIndex > 0) {
      armorRows[firstUnequippedArmorIndex].groupSeparatorBefore = true;
    }

    const protectionDisplay = computeProtectionDisplay(this.actor);

    const possessions = this.actor.items
      .filter((item) => item.type === "equipment")
      .map((item) => ({
        ...prepareItemSummary(item),
        img: String(item.img ?? ""),
        quantity: Math.max(0, Math.trunc(Number(item.system.quantity) || 0)),
        equipped: Boolean(item.system.equipped)
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "fr", { sensitivity: "base" }));
    const library = this.actor.items
      .filter((item) => item.type === "book")
      .map((item) => {
        const current = Math.max(0, Math.trunc(Number(item.system.reading?.progress) || 0));
        const target = Math.max(0, Math.trunc(Number(item.system.reading?.required) || 0));
        const completed = Boolean(item.system.reading?.completed) || (target > 0 && current >= target);
        return {
          ...prepareItemSummary(item),
          img: String(item.img ?? ""),
          current,
          target,
          progressLabel: `${current} / ${target}`,
          completed,
          statusLabel: completed ? "Terminé" : "En cours"
        };
      })
      .sort((left, right) => {
        if (left.completed !== right.completed) return left.completed ? 1 : -1;
        return left.name.localeCompare(right.name, "fr", { sensitivity: "base" });
      });
    const works = this.actor.items
      .filter((item) => item.type === "work")
      .map((item) => {
        const skillIdentifier = String(item.system.skillIdentifier ?? "").trim();
        const skill = skillIdentifier
          ? findActorSkill(this.actor, { identifier: skillIdentifier })
          : null;
        const current = Math.max(0, Math.trunc(Number(item.system.progress?.current) || 0));
        const target = Math.max(0, Math.trunc(Number(item.system.progress?.target) || 0));
        const completed = String(item.system.status ?? "active") === "completed";
        return {
          ...prepareItemSummary(item),
          img: String(item.img ?? ""),
          skillName: skill?.name ?? skillIdentifier ?? "",
          current,
          target,
          progressLabel: `${current} / ${target}`,
          completed,
          statusLabel: completed ? "Terminé" : "En cours"
        };
      })
      .sort((left, right) => {
        if (left.completed !== right.completed) return left.completed ? 1 : -1;
        return left.name.localeCompare(right.name, "fr", { sensitivity: "base" });
      });
    const activeLibrary = library.filter((item) => !item.completed);
    const completedLibrary = library.filter((item) => item.completed);
    const activeWorks = works.filter((item) => !item.completed);
    const completedWorks = works.filter((item) => item.completed);

    const arkTraits = this.actor.items
      .filter((item) => item.type === "trait" && ["arksonge", "arkentropie"].includes(String(item.system.origin ?? "")))
      .map((item) => ({
        ...prepareItemSummary(item),
        img: String(item.img ?? ""),
        origin: String(item.system.origin ?? ""),
        sourceKey: String(item.system.sourceKey ?? "")
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "fr", { sensitivity: "base" }));
    const arkTraitGroups = [
      { id: "arksonge", label: "Arksonge" },
      { id: "arkentropie", label: "Arkentropie" }
    ].map((group) => ({
      ...group,
      items: arkTraits.filter((item) => item.origin === group.id)
    }));

    const spells = await Promise.all(this.actor.items
      .filter((item) => item.type === "spell")
      .map(async (item, index) => {
        const acquisitionStatus = spellAcquisitionStatus(item);
        const learningXp = Math.max(0, Math.trunc(Number(item.system.learningXp) || 0));
        const learningTarget = Math.max(0, Math.trunc(Number(item.system.learningTarget) || 0));
        const learningProgressMax = Math.max(1, learningTarget);
        const learningProgressValue = Math.min(learningXp, learningProgressMax);
        return {
          id: item.id,
          uuid: item.uuid,
          index: index + 1,
          name: item.name,
          castingSkill: String(item.system.castingSkill ?? ""),
          castingSkillOptions: prepareSpellCastingSkillOptions(item, this.actor),
          magicPoints: item.system.magicPoints ?? 0,
          fd: item.system.fd ?? 0,
          range: item.system.range ?? "",
          area: item.system.area ?? "",
          duration: item.system.duration ?? "",
          acquisitionStatus,
          isLearning: acquisitionStatus === "learning",
          isMastered: acquisitionStatus === "mastered",
          learningXp,
          learningTarget,
          learningProgressMax,
          learningProgressValue,
          learningProgressLabel: `${learningXp} / ${learningTarget}`,
          canMaster: learningTarget > 0 && learningXp >= learningTarget,
          description: item.system.description ?? "",
          descriptionField: item.system.schema.fields.description,
          descriptionInputName: `embedded-spell-description-${item.id}`,
          descriptionDataset: {
            itemId: item.id,
            itemField: "description"
          },
          enrichedDescription: await enrichArkhanvalHTML(item.system.description, item),
          incantation: prepareIncantationView(this.actor, item),
          collapsed: this._collapsedSpellIds.has(item.id)
        };
      }));

    context.actor = this.actor;
    context.editable = this.isEditable;
    context.canManageStates = Boolean(game.user?.isGM);
    context.readOnly = !this.isEditable;
    context.systemFields = this.actor.system.schema.fields;
    context.enriched = {
      appearance: await enrichArkhanvalHTML(this.actor.system.identity?.appearance, this.actor),
      arksNotes: await enrichArkhanvalHTML(this.actor.system.notes?.arks, this.actor)
    };
    context.sheetWidth = SHEET_WIDTH;

    context.identity = {
      people: peopleItems.map((item) => item.name).join(", "),
      primaryArchetypeSlots: preparePrimaryArchetypeSlots(primary),
      origin: {
        name: actorField("identity.origin"),
        value: this.actor.system.identity?.origin ?? ""
      },
      combatTechnique: {
        name: actorField("combat.technique"),
        value: String(this.actor.system.combat?.technique ?? "none") || "none",
        options: prepareCombatTechniqueOptions(this.actor)
      }
    };

    context.archetypes = prepareArchetypes(this.actor);
    context.archetypeColumns = {
      left: context.archetypes.filter((archetype) => archetype.side === "left"),
      right: context.archetypes.filter((archetype) => archetype.side === "right")
    };
    context.arkTracks = prepareArkTracks(this.actor);
    context.woundTracks = prepareWoundTracks(this.actor);
    context.states = VANILLA_STATE_DEFINITIONS.map((state) => ({
      ...state,
      label: game.i18n.localize(state.labelKey),
      checked: Boolean(this.actor.system.states?.[state.id])
    }));
    context.stateItems = stateItems;

    context.arks = Object.fromEntries(
      ARKHANVAL_ARKS.map((ark) => [
        ark.id,
        {
          name: actorField(`arks.${ark.id}.rank`),
          value: this.actor.system.arks?.[ark.id]?.rank ?? 0
        }
      ])
    );

    context.wounds = {
      armor: protectionDisplay.base,
      armorDisplay: protectionDisplay.display,
      armorEffective: protectionDisplay.effective,
      armorModifier: protectionDisplay.modifier,
      fdPenalty: persistentStateFdModifier(this.actor)
    };

    context.specialties = {
      left: {
        heading: prepareSpecialtyHeading(primary[0]),
        items: specialtiesLeft.map(prepareItemSummary)
      },
      right: {
        heading: prepareSpecialtyHeading(primary[1]),
        items: specialtiesRight.map(prepareItemSummary)
      }
    };

    context.page2 = {
      appearance: {
        name: actorField("identity.appearance"),
        value: this.actor.system.identity?.appearance ?? ""
      },
      wealth: {
        electrum: {
          name: actorField("wealth.electrum"),
          value: this.actor.system.wealth?.electrum ?? 0
        },
        deniers: {
          name: actorField("wealth.deniers"),
          value: this.actor.system.wealth?.deniers ?? 0
        },
        sous: {
          name: actorField("wealth.sous"),
          value: this.actor.system.wealth?.sous ?? 0
        }
      },
      arksNotes: {
        name: actorField("notes.arks"),
        value: this.actor.system.notes?.arks ?? ""
      },
      arkTraitGroups,
      weaponGroups,
      armors: armorRows,
      works,
      activeWorks,
      completedWorks,
      hasWorks: works.length > 0,
      hasActiveWorks: activeWorks.length > 0,
      hasCompletedWorks: completedWorks.length > 0,
      hasActiveAndCompletedWorks: activeWorks.length > 0 && completedWorks.length > 0,
      possessions,
      library,
      activeLibrary,
      completedLibrary,
      hasLibrary: library.length > 0,
      hasActiveLibrary: activeLibrary.length > 0,
      hasCompletedLibrary: completedLibrary.length > 0,
      hasActiveAndCompletedLibrary: activeLibrary.length > 0 && completedLibrary.length > 0
    };

    context.spells = spells;
    this._progressionSession ??= createProgressionSession(this.actor);
    context.progressionHtml = renderProgressionContent(
      this.actor,
      this._progressionSession.committing ? [] : this._progressionSession.operations
    );
    return context;
  }
}
