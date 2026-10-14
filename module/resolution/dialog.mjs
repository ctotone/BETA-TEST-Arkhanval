import {
  buildResolutionPlan
} from "./engine.mjs";
import {
  ARKHANVAL_ARKS,
  ARKHANVAL_COMBAT_TECHNIQUES
} from "../config.mjs";
import {
  listActorSkills
} from "./skills.mjs";
import {
  buildCombatRuleModifiers,
  buildDamageRuleModifiers,
  buildSkillRollRuleModifiers
} from "../rules/evaluator.mjs";
import {
  weaponUsageTagForSkill
} from "../rules/catalog.mjs";

const { DialogV2 } = foundry.applications.api;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function readFormValue(formData, key, fallback = null) {
  if (!formData) return fallback;

  if (typeof formData.get === "function") {
    const value = formData.get(key);
    return value ?? fallback;
  }

  if (Object.prototype.hasOwnProperty.call(formData, key)) {
    const value = formData[key];
    return value ?? fallback;
  }

  return fallback;
}

function asNumber(formData, key, fallback = 0) {
  const value = Number(readFormValue(formData, key, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function asBoolean(formData, key) {
  const value = readFormValue(formData, key, false);
  return value === true || value === 1 || value === "1" || value === "true" || value === "on";
}

function integerSelectOptions(minimum, maximum, {
  selected = 0,
  signed = false
} = {}) {
  const rows = [];
  for (let value = minimum; value <= maximum; value += 1) {
    const label = signed && value > 0 ? `+${value}` : String(value);
    rows.push(
      `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`
    );
  }
  return rows.join("");
}

function resolutionDialogForm(dialog) {
  const root = dialog?.element ?? null;
  return dialog?.form
    ?? (root?.matches?.("form") ? root : root?.querySelector?.("form"))
    ?? null;
}


function skillRollSource(skill) {
  if (!skill) return null;
  const archetypeId = String(skill.archetype ?? "").trim();
  return {
    sourceType: "skill",
    key: `skill:${String(skill.key ?? skill.identifier ?? "")}`,
    skillKey: String(skill.key ?? ""),
    name: String(skill.name ?? "Compétence"),
    identifier: String(skill.identifier ?? ""),
    archetype: archetypeId,
    archetypeLabel: String(skill.archetypeLabel ?? "Compétences"),
    rank: Number(skill.rank) || 0,
    xp: Number(skill.xp) || 0,
    itemId: String(skill.itemId ?? ""),
    isCustom: Boolean(skill.isCustom),
    arkId: "",
    poolLimit: 5,
    rankBenefitsEnabled: true,
    icon: archetypeId
      ? `systems/arkhanval/assets/icones/archetype/${archetypeId}.webp`
      : "systems/arkhanval/assets/dices/dice_arkhanval.webp"
  };
}

function arkRollSource(actor, ark) {
  if (!ark) return null;
  const arkId = String(ark.id ?? "");
  return {
    sourceType: "ark",
    key: `ark:${arkId}`,
    skillKey: "",
    name: String(ark.label ?? "Ark"),
    identifier: `arkhanval.ark.${arkId}`,
    archetype: "ark",
    archetypeLabel: "Arks",
    rank: Number(actor?.system?.arks?.[arkId]?.rank) || 0,
    xp: 0,
    itemId: "",
    isCustom: false,
    arkId,
    poolLimit: 10,
    rankBenefitsEnabled: false,
    icon: `systems/arkhanval/assets/icones/ark/${arkId}.webp`
  };
}

function listActorRollSources(actor, skills = listActorSkills(actor)) {
  return [
    ...skills.map(skillRollSource).filter(Boolean),
    ...ARKHANVAL_ARKS.map((ark) => arkRollSource(actor, ark)).filter(Boolean)
  ];
}

function initialRollSource(sources, { skill = null, rollSource = null } = {}) {
  if (rollSource?.sourceType === "ark" || rollSource?.type === "ark" || rollSource?.arkId) {
    const arkId = String(rollSource.arkId ?? rollSource.id ?? "");
    const found = sources.find((entry) => entry.sourceType === "ark" && entry.arkId === arkId);
    if (found) return found;
  }

  if (rollSource?.key) {
    const found = sources.find((entry) => entry.key === String(rollSource.key));
    if (found) return found;
  }

  if (skill) {
    const skillKey = `skill:${String(skill.key ?? skill.identifier ?? "")}`;
    const byKey = sources.find((entry) => entry.key === skillKey);
    if (byKey) return byKey;

    const byIdentifier = sources.find(
      (entry) => entry.sourceType === "skill"
        && entry.identifier === String(skill.identifier ?? "")
    );
    if (byIdentifier) return byIdentifier;
  }

  return sources[0] ?? null;
}

function selectedRollSourceFromForm(formData, bySourceKey, fallback) {
  const key = String(readFormValue(formData, "primaryRollSource", fallback?.key ?? ""));
  return bySourceKey.get(key) ?? fallback ?? null;
}

function buildPrimaryRollSourceOptions(sources, current) {
  const rows = [];
  let group = null;

  for (const source of sources) {
    const nextGroup = source.sourceType === "ark"
      ? "Arks"
      : String(source.archetypeLabel || "Compétences");

    if (nextGroup !== group) {
      if (group !== null) rows.push("</optgroup>");
      rows.push(`<optgroup label="${escapeHtml(nextGroup)}">`);
      group = nextGroup;
    }

    const suffix = ` — rang ${Number(source.rank) || 0}`;
    const selected = source.key === current?.key ? " selected" : "";
    rows.push(
      `<option value="${escapeHtml(source.key)}"${selected}>` +
      `${escapeHtml(source.name)}${escapeHtml(suffix)}</option>`
    );
  }

  if (group !== null) rows.push("</optgroup>");
  return rows.join("");
}

function neutralSkillRuleModifiers(source) {
  return {
    baseSkillRank: Number(source?.rank) || 0,
    rankModifier: 0,
    effectiveSkillRank: Number(source?.rank) || 0,
    fdModifier: 0,
    d12Substitutions: 0,
    ignoredCriticalFailures: 0,
    extraDice: [],
    diceMultipliers: [],
    repeatCount: 1,
    repeatKeepMode: "none",
    criticalFailureThreshold: 1,
    autoSuccess: false,
    rerolls: 0,
    criticalRerolls: 0,
    contextualNotes: [],
    applied: [],
    notes: [],
    warnings: []
  };
}

export function experienceSourceFromRollRequest(actor, request) {
  const source = request?.rollSource ?? null;
  if (!source) return null;

  if (source.sourceType === "ark") {
    return {
      type: "ark",
      arkId: String(source.arkId ?? ""),
      arkLabel: String(source.name ?? "Ark")
    };
  }

  const skill = listActorSkills(actor).find(
    (entry) => String(entry.identifier ?? "") === String(source.identifier ?? "")
      && (!source.itemId || String(entry.itemId ?? "") === String(source.itemId))
  ) ?? null;

  return {
    type: "skill",
    skill: {
      itemId: String(skill?.itemId ?? source.itemId ?? ""),
      name: String(skill?.name ?? source.name ?? "Compétence"),
      identifier: String(skill?.identifier ?? source.identifier ?? ""),
      archetype: String(skill?.archetype ?? source.archetype ?? ""),
      rank: Number(skill?.rank ?? source.rank) || 0,
      xp: Number(skill?.xp ?? source.xp) || 0
    }
  };
}

function selectedSkillFromForm(formData, byKey) {
  const key = String(readFormValue(formData, "secondarySkill", ""));
  return key ? byKey.get(key) ?? null : null;
}

function combatTechniqueDefinition(actor, combatContext = null) {
  const frozenId = String(combatContext?.technique?.id ?? "");
  const id = frozenId || String(actor?.system?.combat?.technique ?? "none") || "none";
  const definition = ARKHANVAL_COMBAT_TECHNIQUES.find((entry) => entry.id === id)
    ?? ARKHANVAL_COMBAT_TECHNIQUES[0];
  if (!frozenId) return definition;
  return {
    ...definition,
    defaultFdModifier: Number(combatContext?.technique?.defaultFdModifier ?? definition?.defaultFdModifier) || 0
  };
}

function combatTechniqueHint(techniqueId) {
  switch (String(techniqueId ?? "none")) {
    case "feinte":
      return "Règle vanilla : FD +1. Le suivi entre les deux réussites reste manuel.";
    case "mode-agressif":
      return "Règle vanilla : FD +2. En cas de victoire, les dégâts peuvent passer à 2d10.";
    case "posture-defensive":
      return "Règle vanilla : FD -1. En cas de victoire, les dégâts sont réduits de 5.";
    case "viser":
      return "Règle vanilla : choisir FD -2 ou +1d10 de dégâts. Pour l’option +1d10, remettez ce modificateur à 0.";
    case "localiser":
      return "Règle vanilla : FD +1 à +3 selon la zone ciblée. Le MJ choisit la valeur appropriée.";
    case "prise-mains-nues":
      return "Aucun modificateur de FD générique imposé par la technique elle-même.";
    case "mode-tactique":
      return "Règle vanilla : FD +1. La conséquence tactique reste entièrement suivie par la table.";
    case "coups-speciaux":
      return "Règle vanilla : FD +2. La préparation et la résolution du coup spécial restent manuelles.";
    default:
      return "Aucune technique particulière : aucun modificateur de FD proposé.";
  }
}

function combatTechniqueBlock(actor, combatContext) {
  if (!combatContext?.enabled) return "";

  const technique = combatTechniqueDefinition(actor, combatContext);
  const selected = Number(technique?.defaultFdModifier) || 0;

  return `
    <section class="arkhanval-resolution-dialog__technique">
      <div class="arkhanval-resolution-dialog__technique-heading">
        <span>Technique employée</span>
        <strong>${escapeHtml(game.i18n.localize(technique.labelKey))}</strong>
      </div>
      <label class="arkhanval-resolution-dialog__technique-fd">
        <span>Validez la modification du FD</span>
        <select name="fdModifier">
          ${integerSelectOptions(-3, 3, { selected, signed: true })}
        </select>
      </label>
      <small>${escapeHtml(combatTechniqueHint(technique.id))}</small>
    </section>
  `;
}

function combatContextFromForm(formData, combatContext) {
  if (!combatContext?.enabled) return combatContext;

  const selectedWeaponId = String(readFormValue(formData, "combatWeaponId", ""));
  const weapons = Array.from(combatContext.weapons ?? []);
  const selectedWeapon = selectedWeaponId
    ? weapons.find((weapon) => weapon.id === selectedWeaponId) ?? null
    : null;

  return {
    ...combatContext,
    selectedWeaponId,
    selectedWeapon
  };
}

function ruleContextForRoll(skill, combat, baseRuleContext = null, actor = null) {
  const contexts = new Set(Array.from(baseRuleContext?.contexts ?? []).map(String));
  const tags = new Set(Array.from(baseRuleContext?.tags ?? []).map(String));
  const ruleSources = Array.from(baseRuleContext?.ruleSources ?? []);

  // Equipped armor and equipment are contextual persistent sources: their
  // declarative rules apply while they are worn/active, without making every
  // owned Item globally active. This is the same activation principle used by
  // selected weapons, books in reading workflows and spells being incanted.
  if (actor?.items) {
    const ownedItems = typeof actor.items.values === "function"
      ? Array.from(actor.items.values())
      : Array.from(actor.items ?? []);
    for (const item of ownedItems) {
      if (!item?.system?.equipped) continue;
      if (item.type !== "armor" && item.type !== "equipment") continue;
      ruleSources.push(item);
      for (const tag of Array.from(item.system?.tags ?? [])) tags.add(String(tag));
    }
  }

  if (combat?.enabled) {
    contexts.add("combat");
    for (const tag of Array.from(combat.selectedWeapon?.tags ?? [])) tags.add(String(tag));

    const selectedWeaponId = String(combat.selectedWeapon?.id ?? "");
    if (selectedWeaponId && actor?.items) {
      const weaponItem = typeof actor.items.get === "function"
        ? actor.items.get(selectedWeaponId)
        : Array.from(actor.items ?? []).find((item) => String(item?.id ?? "") === selectedWeaponId);
      if (weaponItem) ruleSources.push(weaponItem);
    }

    const usage = weaponUsageTagForSkill(
      combat?.skillIdentifier ?? skill?.identifier ?? ""
    );
    switch (usage) {
      case "combat.one-handed":
      case "combat.two-handed":
        contexts.add("combat.melee");
        break;
      case "combat.thrown":
        contexts.add("combat.thrown");
        break;
      case "combat.ranged":
        contexts.add("combat.ranged");
        break;
      case "combat.unarmed":
        contexts.add("combat.unarmed");
        contexts.add("combat.melee");
        break;
      default:
        break;
    }
  }

  return {
    contexts: Array.from(contexts),
    tags: Array.from(tags),
    ruleSources
  };
}

function requestFromForm(
  formData,
  initialSource,
  bySourceKey,
  bySkillKey,
  actor,
  combatContext = null,
  baseRuleContext = null
) {
  const source = selectedRollSourceFromForm(formData, bySourceKey, initialSource);
  if (!source) throw new Error("Source de jet introuvable.");

  const secondary = source.sourceType === "skill"
    ? selectedSkillFromForm(formData, bySkillKey)
    : null;

  // En mode PNJ, le rang d'Ark reste utilisable comme source de jet,
  // mais aucun cercle d'Ark ne peut être dépensé (même si le formulaire est forgé).
  const arkBoost = actor?.getFlag?.("arkhanval", "viewMode") === "npc"
    ? ""
    : String(readFormValue(formData, "arkBoost", ""));
  const diceModifier = asNumber(formData, "diceModifier", 0) + (arkBoost ? 2 : 0);
  const resolvedCombatBase = combatContextFromForm(formData, combatContext);

  // The workflow that requested the roll and the source actually used to
  // resolve it are intentionally separate. A combat card may request a martial
  // skill while the table chooses another skill or an Ark for narrative reasons.
  // The original combat context (target, weapon, technique, workflow skill)
  // therefore remains frozen while the chosen source drives the dice/rules.
  const activeTechnique = resolvedCombatBase?.enabled
    ? combatTechniqueDefinition(actor, resolvedCombatBase)
    : null;
  const techniqueFdModifier = resolvedCombatBase?.enabled
    ? asNumber(
        formData,
        "fdModifier",
        Number(activeTechnique?.defaultFdModifier) || 0
      )
    : 0;

  const resolvedCombat = resolvedCombatBase?.enabled
    ? {
        ...resolvedCombatBase,
        // Keep the workflow skill identifier frozen in the combat context.
        // The alternative source used to produce the QR is recorded separately.
        skillIdentifier: String(resolvedCombatBase.skillIdentifier ?? ""),
        rollSourceIdentifier: String(source.identifier ?? ""),
        rollSourceName: String(source.name ?? ""),
        rollSourceType: String(source.sourceType ?? ""),
        technique: {
          id: String(activeTechnique?.id ?? "none"),
          label: game.i18n.localize(activeTechnique?.labelKey ?? "ARKHANVAL.CombatTechniques.None"),
          fdModifier: techniqueFdModifier
        }
      }
    : resolvedCombatBase;

  const ruleContext = ruleContextForRoll(source, resolvedCombat, baseRuleContext, actor);

  // Ark rolls keep their historical Arkhanval semantics: wider pool limit and
  // no automatic skill-rank benefits. Skill-specific rules are not reinterpreted
  // as Ark rules merely because the same pre-roll UI is now shared.
  const rules = source.sourceType === "skill"
    ? buildSkillRollRuleModifiers(actor, {
        skillIdentifier: source.identifier,
        skillRank: Number(source.rank) || 0,
        tags: ruleContext.tags,
        contexts: ruleContext.contexts,
        ruleSources: ruleContext.ruleSources
      })
    : neutralSkillRuleModifiers(source);

  // Damage/combat effects belong to the workflow context. They may still be
  // relevant when the table resolves that action with an alternative source.
  const pendingDamageRules = resolvedCombat?.enabled
    ? buildDamageRuleModifiers(actor, {
        skillIdentifier: source.identifier,
        skillRank: Number(source.rank) || 0,
        tags: ruleContext.tags,
        contexts: ruleContext.contexts,
        ruleSources: ruleContext.ruleSources
      })
    : { flatModifier: 0, extraDice: [], ignoreProtection: false, applied: [], notes: [], warnings: [] };

  const pendingCombatRules = resolvedCombat?.enabled
    ? buildCombatRuleModifiers(actor, {
        skillIdentifier: source.identifier,
        skillRank: Number(source.rank) || 0,
        tags: ruleContext.tags,
        contexts: ruleContext.contexts,
        ruleSources: ruleContext.ruleSources
      })
    : { defenseOnly: false, applied: [], notes: [], warnings: [] };

  const specialtyNotes = [
    ...rules.notes,
    ...pendingDamageRules.notes,
    ...pendingCombatRules.notes,
    ...rules.warnings.map((warning) => `⚠ ${warning}`),
    ...pendingDamageRules.warnings.map((warning) => `⚠ ${warning}`),
    ...pendingCombatRules.warnings.map((warning) => `⚠ ${warning}`)
  ];

  const resolvedCombatWithDamageRules = resolvedCombat?.enabled
    ? {
        ...resolvedCombat,
        damageRules: {
          flatModifier: Number(pendingDamageRules.flatModifier) || 0,
          extraDice: Array.from(pendingDamageRules.extraDice ?? []).map(Number),
          ignoreProtection: Boolean(pendingDamageRules.ignoreProtection),
          applied: Array.from(pendingDamageRules.applied ?? []).map((entry) => ({ ...entry })),
          notes: Array.from(pendingDamageRules.notes ?? []).map(String),
          warnings: Array.from(pendingDamageRules.warnings ?? []).map(String)
        },
        combatRules: {
          defenseOnly: Boolean(pendingCombatRules.defenseOnly),
          applied: Array.from(pendingCombatRules.applied ?? []).map((entry) => ({ ...entry })),
          notes: Array.from(pendingCombatRules.notes ?? []).map(String),
          warnings: Array.from(pendingCombatRules.warnings ?? []).map(String)
        }
      }
    : resolvedCombat;

  const manualCriticalFailureThreshold = asBoolean(formData, "criticalFailureThresholdManual");
  const selectedCriticalFailureThreshold = asNumber(formData, "criticalFailureThreshold", 1);
  const effectiveCriticalFailureThreshold = manualCriticalFailureThreshold
    ? selectedCriticalFailureThreshold
    : Math.max(selectedCriticalFailureThreshold, Number(rules.criticalFailureThreshold) || 1);
  const manualDoubleRoll = String(readFormValue(formData, "doubleRoll", "none"));
  const repeatKeepMode = rules.repeatKeepMode !== "none"
    ? rules.repeatKeepMode
    : manualDoubleRoll;

  return {
    combat: resolvedCombatWithDamageRules,
    ruleContext,
    rollSource: {
      sourceType: String(source.sourceType ?? "skill"),
      key: String(source.key ?? ""),
      name: String(source.name ?? ""),
      identifier: String(source.identifier ?? ""),
      archetype: String(source.archetype ?? ""),
      rank: Number(source.rank) || 0,
      xp: Number(source.xp) || 0,
      itemId: String(source.itemId ?? ""),
      arkId: String(source.arkId ?? "")
    },
    skillName: source.name,
    skillIdentifier: source.identifier,
    primaryRank: rules.effectiveSkillRank,
    basePrimaryRank: Number(source.rank) || 0,
    secondarySkillName: secondary?.name ?? "",
    secondarySkillIdentifier: secondary?.identifier ?? "",
    secondaryRank: secondary ? secondary.rank : null,
    fd: asNumber(formData, "fd", 6),
    fdModifier: techniqueFdModifier + rules.fdModifier,
    diceModifier,
    extraDice: rules.extraDice,
    diceMultipliers: rules.diceMultipliers,
    specialtyNotes,
    resultModifier: asNumber(formData, "resultModifier", 0),
    d12Substitutions: asNumber(formData, "d12Substitutions", 0) + rules.d12Substitutions,
    criticalFailureThreshold: effectiveCriticalFailureThreshold,
    ignoredCriticalFailures: asNumber(formData, "ignoredCriticalFailures", 0) + rules.ignoredCriticalFailures,
    repeatCount: rules.repeatKeepMode !== "none" ? rules.repeatCount : (manualDoubleRoll === "none" ? 1 : 2),
    repeatKeepMode,
    doubleRoll: repeatKeepMode,
    autoSuccess: rules.autoSuccess,
    ruleRerolls: rules.rerolls,
    ruleCriticalRerolls: rules.criticalRerolls,
    chainMode: String(readFormValue(formData, "chainMode", "successes")),
    cumulativeTarget: asNumber(formData, "cumulativeTarget", 11),
    poolLimit: Number(source.poolLimit) || 5,
    rankBenefitsEnabled: source.rankBenefitsEnabled !== false,
    progressive: {
      enabled: asBoolean(formData, "progressiveEnabled")
    },
    ark: {
      id: source.sourceType === "ark" ? String(source.arkId ?? "") : "",
      boost: arkBoost
    }
  };
}

function buildSecondSkillOptions(skills, current) {
  const rows = [];
  let currentArchetype = null;
  const currentKey = String(current?.key ?? "");

  for (const skill of skills) {
    if (skill.archetype !== currentArchetype) {
      if (currentArchetype !== null) rows.push("</optgroup>");
      rows.push(`<optgroup label="${escapeHtml(skill.archetypeLabel)}">`);
      currentArchetype = skill.archetype;
    }

    const disabled = skill.rank <= 0 || String(skill.key) === currentKey ? " disabled" : "";
    const suffix = skill.rank <= 0 ? " — rang 0" : ` — rang ${skill.rank}`;
    rows.push(
      `<option value="${escapeHtml(skill.key)}" data-rank="${Number(skill.rank) || 0}"${disabled}>` +
      `${escapeHtml(skill.name)}${escapeHtml(suffix)}</option>`
    );
  }

  if (currentArchetype !== null) rows.push("</optgroup>");
  return rows.join("");
}

function automaticNotes(plan) {
  const notes = [];
  if (plan.rankFdModifier === -1) {
    notes.push(game.i18n.localize("ARKHANVAL.Resolution.AutoRank6"));
  }
  if (plan.suppressCriticalFailures) {
    notes.push(game.i18n.localize("ARKHANVAL.Resolution.AutoRank7"));
  }
  if (plan.rank8OpenNines) {
    notes.push(game.i18n.localize("ARKHANVAL.Resolution.AutoRank8"));
  }
  if (plan.secondaryRank !== null) {
    notes.push(
      game.i18n.format("ARKHANVAL.Resolution.AutoCoupled", {
        gap: plan.rankDifference
      })
    );
  }
  notes.push(...Array.from(plan.specialtyNotes ?? []));
  return notes;
}

function updatePreview(
  dialog,
  actor,
  initialSource,
  bySourceKey,
  bySkillKey,
  combatContext = null,
  ruleContext = null
) {
  const root = dialog?.element ?? null;
  const form = resolutionDialogForm(dialog);
  if (!root || !form) return;

  let formData = new FormData(form);
  const source = selectedRollSourceFromForm(formData, bySourceKey, initialSource);
  const automatic = root.querySelector("[data-resolution-automatic]");
  const automaticDetails = root.querySelector("[data-resolution-automatic-details]");
  const automaticTitle = root.querySelector("[data-resolution-automatic-title]");
  const cumulativeRow = root.querySelector("[data-resolution-cumulative-row]");
  const d12Input = form.elements.d12Substitutions;
  const criticalThreshold = form.elements.criticalFailureThreshold;
  const ignoredCriticals = form.elements.ignoredCriticalFailures;
  const cumulativeTarget = form.elements.cumulativeTarget;
  const secondarySelect = form.elements.secondarySkill;
  const sourceIcon = root.querySelector("[data-resolution-source-icon]");
  const poolMetric = root.querySelector("[data-resolution-pool]");
  const poolLabel = root.querySelector("[data-resolution-pool-label]");
  const fdMetric = root.querySelector("[data-resolution-fd]");
  const errorDisplay = root.querySelector("[data-resolution-error]");

  if (sourceIcon && source?.icon) sourceIcon.src = source.icon;

  if (secondarySelect) {
    const canCouple = source?.sourceType === "skill" && Number(source?.rank) > 0;
    secondarySelect.disabled = !canCouple;

    for (const option of Array.from(secondarySelect.options ?? [])) {
      if (!option.value) continue;
      const skill = bySkillKey.get(String(option.value)) ?? null;
      option.disabled = !canCouple
        || Number(skill?.rank) <= 0
        || String(option.value) === String(source?.skillKey ?? "");
    }

    if (!canCouple || String(secondarySelect.value) === String(source?.skillKey ?? "")) {
      secondarySelect.value = "";
    }
  }

  // Re-read the form after source-dependent controls have been normalized.
  formData = new FormData(form);
  const chainMode = String(readFormValue(formData, "chainMode", "successes"));
  if (cumulativeRow) cumulativeRow.hidden = chainMode !== "cumulative";
  if (cumulativeTarget) cumulativeTarget.disabled = chainMode !== "cumulative";

  try {
    const request = requestFromForm(
      formData,
      initialSource,
      bySourceKey,
      bySkillKey,
      actor,
      combatContext,
      ruleContext
    );
    const plan = buildResolutionPlan(request);

    if (d12Input) {
      d12Input.max = String(plan.availableD10ForSubstitution);
      d12Input.disabled = plan.availableD10ForSubstitution === 0;
      if (Number(d12Input.value) > plan.availableD10ForSubstitution) {
        d12Input.value = String(plan.availableD10ForSubstitution);
      }
    }

    if (criticalThreshold) {
      const manualMarker = form.elements.criticalFailureThresholdManual;
      if (String(manualMarker?.value ?? "0") !== "1") {
        criticalThreshold.value = String(plan.criticalFailureThreshold);
      }
      // Keep the advanced controls editable. Rank 7+ still neutralizes critical
      // failures in the engine; explain the resulting lack of effect in the UI.
      criticalThreshold.disabled = false;
    }
    if (ignoredCriticals) ignoredCriticals.disabled = false;
    const criticalNotice = root.querySelector("[data-resolution-critical-notice]");
    if (criticalNotice) criticalNotice.hidden = !plan.suppressCriticalFailures;

    const effectiveFdText = plan.effectiveFd === plan.fd
      ? `${plan.effectiveFd}`
      : `${plan.fd} → ${plan.effectiveFd}`;

    if (poolMetric) poolMetric.textContent = plan.poolLabel;
    if (poolLabel) poolLabel.textContent = plan.pool.length === 1 ? "Dé à lancer" : "Dés à lancer";
    if (fdMetric) fdMetric.textContent = effectiveFdText;
    if (errorDisplay) {
      errorDisplay.hidden = true;
      errorDisplay.textContent = "";
    }

    const notes = automaticNotes(plan);
    if (automatic) {
      automatic.innerHTML = notes
        .map((note) => `<li>${escapeHtml(note)}</li>`)
        .join("");
    }
    if (automaticDetails) {
      const hasAutomaticEffects = notes.length > 0;
      automaticDetails.hidden = !hasAutomaticEffects;
      automaticDetails.toggleAttribute("hidden", !hasAutomaticEffects);
    }
    if (automaticTitle) {
      automaticTitle.textContent = notes.length === 1
        ? "1 effet automatique appliqué"
        : `${notes.length} effets automatiques appliqués`;
    }
  } catch (error) {
    if (errorDisplay) {
      errorDisplay.hidden = false;
      errorDisplay.textContent = String(error?.message ?? error);
    }
    if (automatic) automatic.innerHTML = "";
    if (automaticDetails) automaticDetails.hidden = true;
    if (automaticTitle) automaticTitle.textContent = "0 effet automatique appliqué";
  }
}


function buildArkSpendOptions(actor) {
  if (actor?.getFlag?.("arkhanval", "viewMode") === "npc") return "";
  return ARKHANVAL_ARKS
    .map((ark) => ({
      ...ark,
      circles: Number(actor.system.arks?.[ark.id]?.circles) || 0
    }))
    .filter((ark) => ark.circles > 0)
    .map((ark) =>
      `<option value="${escapeHtml(ark.id)}">${escapeHtml(ark.label)} (${ark.circles})</option>`
    )
    .join("");
}


function combatWeaponRows(combatContext) {
  const weapons = Array.from(combatContext?.weapons ?? []);
  const rawDefaultWeaponId = combatContext?.defaultWeaponId;
  const hasDefaultWeapon = rawDefaultWeaponId !== null && rawDefaultWeaponId !== undefined;
  const defaultWeaponId = hasDefaultWeapon ? String(rawDefaultWeaponId) : "";

  const weaponOption = ({
    id = "",
    typeLabel = "Autre arme",
    name = "Arme",
    damage = "",
    img = "",
    compatible = true,
    iconClass = ""
  } = {}) => {
    const checked = hasDefaultWeapon && String(id) === defaultWeaponId ? " checked" : "";
    const compatibilityClass = compatible
      ? ""
      : " arkhanval-resolution-dialog__weapon-option--incompatible";
    return `
      <label class="arkhanval-resolution-dialog__weapon-option${compatibilityClass}">
        <input
          class="arkhanval-resolution-dialog__weapon-native-check"
          type="radio"
          name="combatWeaponId"
          value="${escapeHtml(id)}"${checked}
        >
        <span class="arkhanval-resolution-dialog__weapon-check" aria-hidden="true"></span>
        <span class="arkhanval-resolution-dialog__weapon-icon${iconClass ? ` ${iconClass}` : ""}">
          ${img
            ? `<img src="${escapeHtml(img)}" alt="">`
            : `<i class="fa-solid fa-hand-fist" aria-hidden="true"></i>`}
        </span>
        <span class="arkhanval-resolution-dialog__weapon-label">
          <span class="arkhanval-resolution-dialog__weapon-type">${escapeHtml(typeLabel)}</span>
          <span class="arkhanval-resolution-dialog__weapon-name">
            <strong>${escapeHtml(name)}</strong>
          </span>
        </span>
      </label>
    `;
  };

  const rows = [
    weaponOption({
      id: "",
      typeLabel: "Mains nues",
      name: "Sans arme",
      compatible: defaultWeaponId === "" || !hasDefaultWeapon,
      iconClass: "arkhanval-resolution-dialog__weapon-icon--empty"
    }),
    ...weapons.map((weapon) => weaponOption({
      id: weapon.id,
      typeLabel: weapon.family?.label ?? "Autre arme",
      name: weapon.name,
      damage: weapon.damage,
      img: weapon.img,
      compatible: weapon.compatible
    }))
  ];

  return rows.join("");
}

function targetOverviewBlock(combatContext) {
  const fallbackTargets = Array.from(game.user?.targets ?? []);
  const fallbackCount = fallbackTargets.length;
  const fallbackToken = fallbackTargets[0] ?? null;
  const fallbackImg = String(
    fallbackToken?.document?.texture?.src ??
    fallbackToken?.texture?.src ??
    fallbackToken?.actor?.img ??
    ""
  );

  const state = combatContext?.enabled ? combatContext.targetState : null;
  const count = combatContext?.enabled ? Number(combatContext.targetCount) || 0 : fallbackCount;

  if (state === "single" && combatContext?.target) {
    const tokenImg = String(combatContext.target.tokenImg ?? "");
    return `
      <div class="arkhanval-resolution-dialog__target-row">
        <span class="arkhanval-resolution-dialog__target-label"><strong>Votre cible</strong></span>
        <span class="arkhanval-resolution-dialog__target-icon">
          ${tokenImg ? `<img src="${escapeHtml(tokenImg)}" alt="Cible">` : `<i class="fa-solid fa-crosshairs" aria-hidden="true"></i>`}
        </span>
      </div>
    `;
  }

  if (!combatContext?.enabled && fallbackCount === 1) {
    return `
      <div class="arkhanval-resolution-dialog__target-row">
        <span class="arkhanval-resolution-dialog__target-label"><strong>Votre cible</strong></span>
        <span class="arkhanval-resolution-dialog__target-icon">
          ${fallbackImg ? `<img src="${escapeHtml(fallbackImg)}" alt="Cible">` : `<i class="fa-solid fa-crosshairs" aria-hidden="true"></i>`}
        </span>
      </div>
    `;
  }

  if ((state === "multiple" || !combatContext?.enabled) && count > 1) {
    const targetPortraits = Array.from(combatContext?.targets ?? []).slice(0, 3).map((target) => `
      <span class="arkhanval-resolution-dialog__target-icon"
            title="${escapeHtml(target.name ?? "Cible")}">
        ${target.tokenImg
          ? `<img src="${escapeHtml(target.tokenImg)}" alt="${escapeHtml(target.name ?? "Cible")}">`
          : `<i class="fa-solid fa-crosshairs" aria-hidden="true"></i>`}
      </span>
    `).join("");
    return `
      <div class="arkhanval-resolution-dialog__target-row arkhanval-resolution-dialog__target-row--multiple">
        <span class="arkhanval-resolution-dialog__target-label"><strong>Vos cibles (${count})</strong></span>
        <span class="arkhanval-resolution-dialog__target-portraits">
          ${targetPortraits || `<i class="fa-solid fa-users" aria-hidden="true"></i>`}
          ${count > 3 ? `<small>+${count - 3}</small>` : ""}
        </span>
      </div>
    `;
  }

  if (state === "invalid") {
    return `
      <div class="arkhanval-resolution-dialog__target-row arkhanval-resolution-dialog__target-row--warning">
        <span class="arkhanval-resolution-dialog__target-icon"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i></span>
        <span><strong>Cible non exploitable</strong></span>
      </div>
    `;
  }

  return `
    <div class="arkhanval-resolution-dialog__target-row arkhanval-resolution-dialog__target-row--none">
      <span class="arkhanval-resolution-dialog__target-label"><strong>Vous ne ciblez aucun adversaire</strong></span>
    </div>
  `;
}

function combatContextBlock(combatContext) {
  if (!combatContext?.enabled) return "";

  return `
    <section class="arkhanval-resolution-dialog__section arkhanval-resolution-dialog__combat">
      <div class="arkhanval-resolution-dialog__section-body">
        <div class="arkhanval-resolution-dialog__weapon-picker">
          <strong class="arkhanval-resolution-dialog__weapon-heading">Arme utilisée</strong>
          <div class="arkhanval-resolution-dialog__weapon-list">
            ${combatWeaponRows(combatContext)}
          </div>
          ${Array.from(combatContext?.weapons ?? []).some((weapon) => weapon?.compatible === false)
            ? `<small class="arkhanval-resolution-dialog__weapon-warning">
                La teinte rouge sur une arme indique qu'elle ne semble pas adaptée au type de jet que vous effectuez
              </small>`
            : ""}
        </div>
      </div>
    </section>
  `;
}

function dialogContent(
  actor,
  initialSource,
  sources,
  skills,
  combatContext = null,
  defaultFd = 6,
  {
    fdMin = 0,
    fdMax = 20
  } = {}
) {
  const sourceOptions = buildPrimaryRollSourceOptions(sources, initialSource);
  const secondOptions = buildSecondSkillOptions(skills, initialSource?.sourceType === "skill" ? {
    ...initialSource,
    key: initialSource.skillKey
  } : { key: "" });
  const minimumFd = Math.max(0, Math.trunc(Number(fdMin) || 0));
  const maximumFd = Math.max(minimumFd, Math.trunc(Number(fdMax) || 20));
  const requestedFd = Number(defaultFd);
  const normalizedDefaultFd = Math.min(
    maximumFd,
    Math.max(minimumFd, Number.isFinite(requestedFd) ? Math.trunc(requestedFd) : 6)
  );
  const fdOptions = integerSelectOptions(minimumFd, maximumFd, { selected: normalizedDefaultFd });
  const rank = Number(initialSource?.rank) || 0;
  const arkSpendOptions = buildArkSpendOptions(actor);
  const sourceIcon = String(
    initialSource?.icon
    ?? "systems/arkhanval/assets/dices/dice_arkhanval.webp"
  );

  return `
    <div class="arkhanval-resolution-dialog" data-arkhanval-preroll>
      <div class="arkhanval-resolution-dialog__main">
      <section class="arkhanval-resolution-dialog__hero">
        <div class="arkhanval-resolution-dialog__archetype-icon-wrap">
          <img class="arkhanval-resolution-dialog__archetype-icon"
               data-resolution-source-icon
               src="${escapeHtml(sourceIcon)}"
               alt=""
               aria-hidden="true">
        </div>

        <div class="arkhanval-resolution-dialog__hero-main">
          <label class="arkhanval-resolution-dialog__source-picker">
            <span>Compétence / Ark utilisée</span>
            <select name="primaryRollSource">
              ${sourceOptions}
            </select>
          </label>

          <div class="arkhanval-resolution-dialog__difficulty-grid">
            <label>
              <span>${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.FD"))}</span>
              <select name="fd">
                ${fdOptions}
              </select>
            </label>
          </div>
        </div>

        <div class="arkhanval-resolution-dialog__preview-column">
          <strong class="arkhanval-resolution-dialog__preview-title">Récapitulatif du jet</strong>
          <section class="arkhanval-resolution-dialog__preview" data-resolution-preview aria-label="Récapitulatif du jet">
            <div class="arkhanval-resolution-dialog__preview-row">
              <span class="arkhanval-resolution-dialog__preview-label" data-resolution-pool-label>${Math.max(1, rank > 0 ? Math.min(rank, Number(initialSource?.poolLimit) || 5) : 1) === 1 ? "Dé à lancer" : "Dés à lancer"}</span>
              <span class="arkhanval-resolution-dialog__metric arkhanval-resolution-dialog__metric--pool"
                    data-resolution-pool>${rank > 0 ? `${Math.min(rank, Number(initialSource?.poolLimit) || 5)}d10` : "1d8"}</span>
            </div>
            <div class="arkhanval-resolution-dialog__preview-row">
              <span class="arkhanval-resolution-dialog__preview-label">FD final</span>
              <span class="arkhanval-resolution-dialog__metric"
                    data-resolution-fd>${normalizedDefaultFd}</span>
            </div>
            <span class="arkhanval-resolution-dialog__error" data-resolution-error hidden></span>
          </section>
        </div>

        <section
          class="arkhanval-resolution-dialog__automatic arkhanval-resolution-dialog__automatic--hero"
          data-resolution-automatic-details
          hidden
        >
          <div class="arkhanval-resolution-dialog__automatic-header">
            <strong data-resolution-automatic-title>0 effet automatique appliqué</strong>
          </div>
          <ul data-resolution-automatic></ul>
        </section>

      </section>

      ${combatContext?.enabled ? `
        <div class="arkhanval-resolution-dialog__combat-overview-row">
          ${combatTechniqueBlock(actor, combatContext)}
          ${targetOverviewBlock(combatContext)}
        </div>
      ` : ""}
      ${combatContextBlock(combatContext)}

      <div class="arkhanval-resolution-dialog__launch-area">
        <button type="button" class="arkhanval-resolution-dialog__launch" data-arkhanval-roll-launch>
          <i class="fa-solid fa-dice" aria-hidden="true"></i> Lancer le jet
        </button>
      </div>
      </div>
      <button type="button" class="arkhanval-resolution-dialog__modifier-toggle"
              data-arkhanval-modifiers-toggle aria-expanded="false"
              aria-label="Ouvrir les modificateurs du jet">
        <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
        <span>Modificateurs du jet</span>
      </button>
      <aside class="arkhanval-resolution-dialog__modifiers" aria-label="Modificateurs du jet" hidden>
      <section class="arkhanval-resolution-dialog__section">
        <h4 class="arkhanval-resolution-dialog__section-title">Modificateurs du jet</h4>
        <div class="arkhanval-resolution-dialog__section-body">
          <div class="arkhanval-resolution-dialog__grid">
            <label>
              <span>${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.CriticalThreshold"))}</span>
              <select name="criticalFailureThreshold">
                <option value="1">1</option>
                <option value="2">1–2</option>
                <option value="3">1–3</option>
              </select>
              <input name="criticalFailureThresholdManual" type="hidden" value="0">
            </label>
            <label>
              <span>${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.SecondSkill"))}</span>
              <select name="secondarySkill" ${initialSource?.sourceType !== "skill" || rank <= 0 ? "disabled" : ""}>
                <option value="">${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.NoSecondSkill"))}</option>
                ${secondOptions}
              </select>
            </label>
            <label>
              <span>${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.DiceModifier"))}</span>
              <input name="diceModifier" type="number" step="1" value="0">
            </label>
            <label>
              <span>${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.D12Substitutions"))}</span>
              <input name="d12Substitutions" type="number" min="0" step="1" value="0">
            </label>
            <label>
              <span>${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.ResultModifier"))}</span>
              <input name="resultModifier" type="number" step="1" value="0">
            </label>
            <label>
              <span>${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.IgnoreCriticals"))}</span>
              <input name="ignoredCriticalFailures" type="number" min="0" step="1" value="0">
            </label>
          </div>
          <p class="arkhanval-resolution-dialog__critical-notice" data-resolution-critical-notice hidden>
            Les échecs critiques sont neutralisés par le rang du personnage : ces réglages restent modifiables, mais n’affectent pas ce jet.
          </p>
        </div>
      </section>

      ${arkSpendOptions ? `
        <section class="arkhanval-resolution-dialog__section">
          <h4 class="arkhanval-resolution-dialog__section-title">${escapeHtml(game.i18n.localize("ARKHANVAL.Phase04.ArkSpendLegend"))}</h4>
          <div class="arkhanval-resolution-dialog__section-body">
            <div class="arkhanval-resolution-dialog__grid">
              <label>
                <span>${escapeHtml(game.i18n.localize("ARKHANVAL.Phase04.ArkBoost"))}</span>
                <select name="arkBoost">
                  <option value="">${escapeHtml(game.i18n.localize("ARKHANVAL.Phase04.ArkNone"))}</option>
                  ${arkSpendOptions}
                </select>
              </label>
            </div>
          </div>
        </section>
      ` : ""}

      <section class="arkhanval-resolution-dialog__section">
        <h4 class="arkhanval-resolution-dialog__section-title">${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.OptionsLegend"))}</h4>
        <div class="arkhanval-resolution-dialog__section-body">
          <div class="arkhanval-resolution-dialog__grid">
            <label>
              <span>${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.DoubleRoll"))}</span>
              <select name="doubleRoll">
                <option value="none">${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.DoubleNone"))}</option>
                <option value="best">${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.DoubleBest"))}</option>
                <option value="worst">${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.DoubleWorst"))}</option>
              </select>
            </label>
            <label>
              <span>${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.OpenDiceMode"))}</span>
              <select name="chainMode">
                <option value="successes">${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.OpenAsSuccesses"))}</option>
                <option value="cumulative">${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.OpenAsCumulative"))}</option>
              </select>
            </label>
            <label data-resolution-cumulative-row hidden>
              <span>${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.CumulativeTarget"))}</span>
              <input name="cumulativeTarget" type="number" min="11" max="99" step="1" value="11">
            </label>
          </div>
        </div>
      </section>

      </aside>
    </div>
  `;
}

// Kept for spell release only. Physical combat chooses its mode in the same
// window as its pre-roll (combatRollChoiceContent / promptSkillRoll).
export async function promptActionResolutionMode({
  actionLabel = "",
  targets = null
} = {}) {
  const selected = Array.from(targets ?? game.user?.targets ?? []);
  const count = selected.length;
  const targetInfo = count === 0
    ? `<div class="arkhanval-phase04-dialog__notice arkhanval-phase04-dialog__notice--warning">
         <strong>Aucune cible sélectionnée.</strong><br>
         <span>Si cette action concerne un adversaire, pensez à cibler son token avant de poursuivre.</span>
       </div>`
    : `<div class="arkhanval-phase04-dialog__notice">
         <strong>${count} cible${count > 1 ? "s" : ""} sélectionnée${count > 1 ? "s" : ""}.</strong>
       </div>`;
  const label = String(actionLabel ?? "").trim();
  const choice = await DialogV2.wait({
    window: {
      title: label ? `Résolution de l’action — ${label}` : "Résolution de l’action"
    },
    classes: ["arkhanval", "arkhanval-popup-dialog", "arkhanval-popup-dialog--choice"],
    content: `
      <div class="arkhanval-phase04-dialog arkhanval-action-resolution-dialog">
        <p>Choisissez comment cette action doit être résolue.</p>
        ${targetInfo}
        <p><strong>Résolution directe</strong> — Résoudre cette action sans opposition.</p>
        <p><strong>Avec opposition</strong> — Résoudre cette action face à un ou plusieurs adversaires.</p>
      </div>
    `,
    modal: true,
    rejectClose: false,
    buttons: [
      { action: "direct", label: "Résolution directe", icon: "fa-solid fa-dice" },
      { action: "opposed", label: "Avec opposition", icon: "fa-solid fa-crosshairs" }
    ]
  });
  return choice === "direct" || choice === "opposed" ? choice : null;
}

/**
 * Opening step of the combat roll preparation window. Only a real Actor-backed
 * target permits the opposition workflow; targets without an Actor do not
 * silently become manual-QR opponents.
 */
export function combatRollChoiceContent(combatContext = null) {
  const selectedCount = Number(combatContext?.targetCount) || 0;
  const targets = Array.from(combatContext?.targets ?? []);
  const canOppose = selectedCount > 0 && targets.length === selectedCount;
  const targetMarkup = canOppose
    ? targets.map((target) => `
        <span class="arkhanval-roll-choice__target" title="${escapeHtml(target.name)}">
          ${target.tokenImg
            ? `<img src="${escapeHtml(target.tokenImg)}" alt="">`
            : `<i class="fa-solid fa-user" aria-hidden="true"></i>`}
          <span>${escapeHtml(target.name)}</span>
        </span>
      `).join("")
    : `<span class="arkhanval-roll-choice__target-warning">${selectedCount === 0
        ? "Sélectionnez au moins une cible pour lancer une opposition."
        : "Chaque cible doit posséder un personnage pour participer à une opposition."}</span>`;

  return `
    <section class="arkhanval-roll-choice" data-arkhanval-roll-mode-selection>
      <h3>Quel type de jet souhaitez-vous effectuer ?</h3>
      <div class="arkhanval-roll-choice__options">
        <button type="button" class="arkhanval-roll-choice__option" data-arkhanval-roll-mode="direct">
          <i class="fa-solid fa-dice" aria-hidden="true"></i>
          <strong>Jet simple</strong>
          <small>Jet de compétence sans confrontation. Les cibles éventuelles sont ignorées.</small>
        </button>
        <button type="button" class="arkhanval-roll-choice__option" data-arkhanval-roll-mode="opposed"
                ${canOppose ? "" : "disabled"}>
          <i class="fa-solid fa-swords" aria-hidden="true"></i>
          <strong>Jet d’opposition</strong>
          <small>${canOppose ? "Confrontation avec les cibles sélectionnées." : "Une cible valide est nécessaire."}</small>
          <span class="arkhanval-roll-choice__targets">${targetMarkup}</span>
        </button>
      </div>
    </section>
  `;
}

export async function promptSkillRoll({
  actor,
  skill = null,
  rollSource = null,
  combatContext = null,
  combatMode = null,
  ruleContext = null,
  defaultFd = 6,
  fdMin = 0,
  fdMax = 20,
  title = ""
}) {
  const skills = listActorSkills(actor);
  const sources = listActorRollSources(actor, skills);
  const initialSource = initialRollSource(sources, { skill, rollSource });
  if (!initialSource) throw new Error("Aucune compétence ou Ark disponible pour ce jet.");

  const bySourceKey = new Map(sources.map((entry) => [entry.key, entry]));
  const bySkillKey = new Map(skills.map((entry) => [entry.key, entry]));

  const hasModeChoice = typeof combatMode?.getOppositionContext === "function";
  let selectedMode = hasModeChoice ? null : "configured";
  let activeCombatContext = combatContext;
  const initialChoice = hasModeChoice
    ? combatRollChoiceContent(combatMode.getOppositionContext())
    : null;

  const rollContent = (context) => dialogContent(
    actor, initialSource, sources, skills, context, defaultFd, { fdMin, fdMax }
  );

  const result = await DialogV2.input({
    position: {
      width: 804,
      height: "auto"
    },
    window: {
      title: hasModeChoice
        ? `Préparation du jet — ${initialSource.name}`
        : String(title || game.i18n.format("ARKHANVAL.Resolution.RollTitle", {
            skill: initialSource.name
          })),
      resizable: true
    },
    content: hasModeChoice
      ? `<div data-arkhanval-roll-stage>${initialChoice}</div>`
      : rollContent(activeCombatContext),
    modal: true,
    rejectClose: false,
    ok: {
      label: game.i18n.localize("ARKHANVAL.Resolution.Roll"),
      icon: "fa-solid fa-dice"
    },
    render: (_event, dialog) => {
      const attach = (remainingFrames = 3) => {
        const form = resolutionDialogForm(dialog);
        if (!form) {
          if (remainingFrames > 0 && globalThis.requestAnimationFrame) {
            globalThis.requestAnimationFrame(() => attach(remainingFrames - 1));
          }
          return;
        }

        const stage = form.querySelector("[data-arkhanval-roll-stage]");
        const root = dialog?.element ?? form;
        const submitButton = root.querySelector('button[data-action="ok"]')
          ?? form.querySelector('button[type="submit"]');
        const setChoiceState = (choosing) => {
          root.classList?.toggle("arkhanval-roll-preparation--choosing", choosing);
          if (submitButton) submitButton.hidden = choosing;
          if (!hasModeChoice) return;
          // This compact step shares the same DialogV2 as the validated pre-roll.
          // Restore the original 804px width immediately after choosing a mode.
          const viewportWidth = globalThis.innerWidth || 1440;
          const width = Math.min(choosing ? 620 : 804, Math.max(320, viewportWidth - 32));
          const currentWidth = Number(dialog.position?.width);
          const currentLeft = Number(dialog.position?.left);
          const center = Number.isFinite(currentLeft) && Number.isFinite(currentWidth)
            ? currentLeft + currentWidth / 2
            : NaN;
          const left = Number.isFinite(center)
            ? Math.max(16, Math.min(Math.round(center - width / 2), viewportWidth - width - 16))
            : undefined;
          // The mode choice and its taller pre-roll share one window.
          // Anchor it near the top so switching modes cannot push its footer
          // past the bottom of the screen (especially on short displays).
          const currentTop = Number(dialog.position?.top);
          const top = Number.isFinite(currentTop) ? Math.min(Math.max(12, currentTop), 36) : 24;
          dialog.setPosition?.(left === undefined
            ? { width, height: "auto", top }
            : { width, height: "auto", left, top });
        };
        // The visible launch action lives inside the pre-roll, not in the footer.
        if (submitButton && root.querySelector(".arkhanval-resolution-dialog__launch")) {
          submitButton.classList.add("arkhanval-preroll-native-submit");
        }
        setChoiceState(hasModeChoice && !selectedMode);

        const refresh = () => {
          if (hasModeChoice && !selectedMode) return;
          updatePreview(
            dialog, actor, initialSource, bySourceKey, bySkillKey,
            activeCombatContext, ruleContext
          );
        };

        if (form.dataset.arkhanvalResolutionBound !== "true") {
          form.dataset.arkhanvalResolutionBound = "true";
          // An Enter key while on the choice screen must not submit an empty roll.
          form.addEventListener("submit", (event) => {
            if (hasModeChoice && !selectedMode) event.preventDefault();
          });
          const refreshFromEvent = (event) => {
            if (event?.target?.name === "criticalFailureThreshold") {
              const marker = form.elements.criticalFailureThresholdManual;
              if (marker) marker.value = "1";
            }
            refresh();
          };
          form.addEventListener("input", refreshFromEvent);
          form.addEventListener("change", refreshFromEvent);

          form.addEventListener("click", (event) => {
            const toggle = event.target.closest?.("[data-arkhanval-modifiers-toggle]");
            const launch = event.target.closest?.("[data-arkhanval-roll-launch]");
            if (toggle) {
              event.preventDefault();
              const preroll = toggle.closest("[data-arkhanval-preroll]");
              const modifiers = preroll?.querySelector(".arkhanval-resolution-dialog__modifiers");
              if (!preroll || !modifiers) return;
              const expanded = !preroll.classList.contains("arkhanval-resolution-dialog--expanded");
              preroll.classList.toggle("arkhanval-resolution-dialog--expanded", expanded);
              modifiers.hidden = !expanded;
              toggle.setAttribute("aria-expanded", String(expanded));
              toggle.setAttribute("aria-label", expanded
                ? "Fermer les modificateurs du jet" : "Ouvrir les modificateurs du jet");
              // Expand the window, never shrink the main pre-roll column.
              // On narrow screens the CSS stacks the auxiliary panel below it.
              const viewportWidth = globalThis.innerWidth || 1440;
              const compactWidth = Math.min(804, Math.max(320, viewportWidth - 32));
              const width = expanded && viewportWidth >= 1150
                ? Math.min(1110, viewportWidth - 32)
                : compactWidth;
              const currentLeft = Number(dialog.position?.left);
              const left = Number.isFinite(currentLeft)
                ? Math.max(16, Math.min(currentLeft, viewportWidth - width - 16))
                : undefined;
              dialog.setPosition?.(left === undefined ? { width } : { width, left });
              return;
            }
            if (launch) {
              event.preventDefault();
              if (hasModeChoice && !selectedMode) return;
              const action = (dialog?.element ?? form).querySelector('button[data-action="ok"]')
                ?? form.querySelector('button[type="submit"]');
              if (action) action.click();
              else form.requestSubmit?.();
            }
          });

          if (hasModeChoice && stage) {
            stage.addEventListener("click", (event) => {
              const button = event.target.closest?.("[data-arkhanval-roll-mode]");
              if (!button || button.disabled) return;
              event.preventDefault();
              const mode = button.dataset.arkhanvalRollMode;
              if (mode !== "direct" && mode !== "opposed") return;
              const nextContext = mode === "opposed"
                ? combatMode.getOppositionContext()
                : null;
              if (mode === "opposed" && (
                !nextContext?.targetCount ||
                nextContext.targets?.length !== nextContext.targetCount
              )) {
                stage.innerHTML = combatRollChoiceContent(nextContext);
                return;
              }
              selectedMode = mode;
              activeCombatContext = nextContext;
              stage.innerHTML = rollContent(activeCombatContext);
              if (submitButton && root.querySelector(".arkhanval-resolution-dialog__launch")) {
                submitButton.classList.add("arkhanval-preroll-native-submit");
              }
              setChoiceState(false);
              refresh();
            });
          }
        }
        refresh();
      };

      attach();
    }
  });

  // Only the chosen pre-roll is allowed to become a roll request.
  if (!result || (hasModeChoice && !selectedMode)) return null;
  return requestFromForm(
    result,
    initialSource,
    bySourceKey,
    bySkillKey,
    actor,
    activeCombatContext,
    ruleContext
  );
}

export function openVirtualSkillDetail(skill) {
  const content = `
    <div class="arkhanval-skill-detail">
      <dl>
        <dt>${escapeHtml(game.i18n.localize("ARKHANVAL.ItemSheet.Archetype"))}</dt>
        <dd>${escapeHtml(skill.archetypeLabel)}</dd>
        <dt>${escapeHtml(game.i18n.localize("ARKHANVAL.ItemSheet.Rank"))}</dt>
        <dd>${Number(skill.rank) || 0}</dd>
        <dt>${escapeHtml(game.i18n.localize("ARKHANVAL.ItemSheet.XP"))}</dt>
        <dd>${Number(skill.xp) || 0}</dd>
      </dl>
      <p>${escapeHtml(game.i18n.localize("ARKHANVAL.Resolution.VirtualSkillDetail"))}</p>
    </div>
  `;

  const dialog = new DialogV2({
    window: {
      title: skill.name
    },
    content,
    buttons: [
      {
        action: "close",
        label: game.i18n.localize("ARKHANVAL.Resolution.Close"),
        default: true
      }
    ]
  });
  return dialog.render({ force: true });
}
