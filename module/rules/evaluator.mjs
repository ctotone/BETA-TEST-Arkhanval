import {
  ruleEffect
} from "./catalog.mjs";
import {
  resolveArkhanvalVariable
} from "./variables.mjs";
import {
  specialtyParameterValues
} from "./parameters.mjs";
import {
  activeVanillaStateRuleSources
} from "../states.mjs";

const SUPPORTED_DICE = new Set([6, 8, 10, 12]);
const ROUNDING_MODES = new Set(["ceil", "floor", "round"]);
const KEEP_MODES = new Set(["best", "worst"]);
const WOUND_SEVERITIES = new Set(["light", "serious", "critical"]);

function asItems(actor) {
  if (!actor?.items) return [];
  if (Array.isArray(actor.items)) return actor.items;
  if (typeof actor.items.values === "function") return Array.from(actor.items.values());
  if (typeof actor.items[Symbol.iterator] === "function") return Array.from(actor.items);
  return [];
}

function asRuleSources(actor, context = {}) {
  // Owned specialties, states and traits are persistent always-on rule sources. Other Item types
  // are activated explicitly by the workflow (selected weapon, spell being
  // resolved, temporary effect, etc.) so merely owning a spell or weapon never
  // makes all of its rules globally active.
  const sources = [
    ...activeVanillaStateRuleSources(actor),
    ...asItems(actor).filter((item) => item?.type === "specialty" || item?.type === "state" || item?.type === "trait"),
    ...Array.from(context.ruleSources ?? [])
  ].filter(Boolean);

  const seen = new Set();
  return sources.filter((item) => {
    const key = String(item.uuid ?? item.id ?? "");
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parameterSelectorValues(sourceItem, rawTarget) {
  const match = String(rawTarget ?? "").match(/^@parameter\.([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  return specialtyParameterValues(sourceItem, match[1]);
}

function selectorMatches(selector, context = {}, sourceItem = null) {
  const value = String(selector ?? "any").trim() || "any";
  if (value === "any") return true;

  if (value.startsWith("skill:")) {
    const target = value.slice("skill:".length);
    const parameterValues = parameterSelectorValues(sourceItem, target);
    if (parameterValues) {
      return parameterValues.includes(String(context.skillIdentifier ?? ""));
    }
    return target === String(context.skillIdentifier ?? "");
  }

  if (value.startsWith("tag:")) {
    const target = value.slice("tag:".length);
    const ownedTags = new Set(Array.from(context.tags ?? []).map(String));
    const parameterValues = parameterSelectorValues(sourceItem, target);
    if (parameterValues) {
      return parameterValues.some((tag) => ownedTags.has(String(tag)));
    }
    return ownedTags.has(target);
  }

  if (value.startsWith("ark:")) {
    return value === String(context.resourceIdentifier ?? "");
  }

  return new Set(Array.from(context.contexts ?? []).map(String)).has(value);
}

export function resolveRuleScalar(actor, rawValue, context = {}) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return null;

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;

  const variableMatch = raw.match(/^([+-]?)(@[A-Za-z0-9_.-]+)$/);
  if (!variableMatch) return null;

  const [, sign, variable] = variableMatch;
  const resolved = resolveArkhanvalVariable(actor, variable, context);
  if (!Number.isFinite(Number(resolved))) return null;

  const value = Number(resolved);
  return sign === "-" ? -value : value;
}

export function resolveRuleDice(actor, rawValue, context = {}) {
  const raw = String(rawValue ?? "").trim();
  const match = raw.match(/^(.+?)d(6|8|10|12)$/i);
  if (!match) return [];

  const rawCount = String(match[1] ?? "").trim();
  const faces = Number(match[2]);
  if (!SUPPORTED_DICE.has(faces)) return [];

  const literal = Number(rawCount);
  const resolved = Number.isFinite(literal)
    ? literal
    : resolveRuleScalar(actor, rawCount, context);

  if (!Number.isInteger(Number(resolved))) return [];
  const count = Number(resolved);
  if (count < 1 || count > 20) return [];

  return Array.from({ length: count }, () => faces);
}

function formatResolvedDice(dice = []) {
  if (!Array.isArray(dice) || !dice.length) return "";
  const faces = Number(dice[0]);
  if (!dice.every((die) => Number(die) === faces)) {
    return dice.map((die) => `1d${Number(die)}`).join(" + ");
  }
  return `${dice.length}d${faces}`;
}

function sourceLabel(rule) {
  return String(rule.sourceName ?? rule.specialtyName ?? "Effet");
}

const RULE_SOURCE_CATEGORY_LABELS = Object.freeze({
  armor: "Armure",
  book: "Livre",
  equipment: "Équipement",
  people: "Peuple",
  skill: "Compétence",
  specialty: "Spécialité",
  spell: "Sortilège",
  state: "État",
  trait: "Trait",
  weapon: "Arme",
  work: "Travail",
  wound: "Blessure"
});

function sourceCategoryLabel(rule) {
  const sourceType = String(rule?.sourceType ?? rule?.sourceItem?.type ?? "").trim();
  if (sourceType === "trait") {
    const origin = String(rule?.sourceItem?.system?.origin ?? "").trim();
    if (origin === "arksonge") return "Arksonge";
    if (origin === "arkentropie") return "Arkentropie";
  }
  return RULE_SOURCE_CATEGORY_LABELS[sourceType] ?? "";
}

function appliedEntry(rule, value) {
  return {
    sourceId: rule.sourceId,
    sourceName: sourceLabel(rule),
    sourceType: rule.sourceType,
    sourceCategory: sourceCategoryLabel(rule),
    specialtyName: rule.specialtyName,
    key: rule.key,
    label: rule.effect.label,
    value
  };
}

function appliedSourceLabel(entry) {
  const name = String(entry?.sourceName ?? "Effet").trim() || "Effet";
  const category = String(entry?.sourceCategory ?? "").trim();
  return category ? `${name} (${category})` : name;
}

function appliedNote(entry, { label = null, includeValue = true } = {}) {
  const effectLabel = String(label ?? entry?.label ?? "").trim();
  const value = String(entry?.value ?? "").trim();
  const suffix = includeValue && value ? ` : ${value}` : "";
  return `${appliedSourceLabel(entry)} — ${effectLabel}${suffix}`.trim();
}

// Backward-compatible literal parser used by older tests/integrations.
export function parseRuleDice(rawValue) {
  return resolveRuleDice(null, rawValue, {});
}

/**
 * Generic rule collector.
 *
 * Rules can be carried by any Actor Item exposing system.rules[]. Additional
 * transient/non-embedded sources may be passed explicitly through
 * context.ruleSources without making the evaluator depend on scenes/tokens.
 */
export function collectApplicableRules(actor, context = {}) {
  const rules = [];

  for (const sourceItem of asRuleSources(actor, context)) {
    for (const rule of Array.from(sourceItem.system?.rules ?? [])) {
      const effect = ruleEffect(rule.key);
      if (!effect || !selectorMatches(rule.selector, context, sourceItem)) continue;

      const isSpecialty = sourceItem?.type === "specialty";
      rules.push({
        sourceId: sourceItem.id ?? sourceItem.uuid ?? "",
        sourceName: sourceItem.name ?? "Effet",
        sourceType: sourceItem.type ?? "",
        sourceItem,
        // Compatibility aliases retained while existing consumers/UI still
        // refer to specialty-specific names.
        specialtyId: isSpecialty ? sourceItem.id ?? "" : "",
        specialtyName: isSpecialty ? sourceItem.name ?? "Spécialité" : sourceItem.name ?? "Effet",
        specialty: isSpecialty ? sourceItem : null,
        id: rule.id ?? "",
        key: rule.key,
        selector: rule.selector ?? "any",
        rawValue: String(rule.value ?? "").trim(),
        rounding: String(rule.rounding ?? "").trim(),
        mode: String(rule.mode ?? "").trim(),
        effect
      });
    }
  }

  return rules;
}

/**
 * Compatibility helper for code that intentionally wants specialty-only rules
 * (notably current weapon-sheet previews).
 */
export function collectApplicableSpecialtyRules(actor, context = {}) {
  return collectApplicableRules(actor, context)
    .filter((rule) => rule.sourceType === "specialty");
}

/**
 * Static FD modifier exposed by persistent states on the Actor sheet.
 *
 * Only globally applicable roll.fd rules (selector=any) are represented here.
 * Contextual state modifiers still apply in the pre-roll when their selector
 * matches, but cannot be truthfully summarized by a single always-visible value.
 */
export function persistentStateFdModifier(actor) {
  let total = 0;

  for (const rule of collectApplicableRules(actor, {})) {
    if (rule.sourceType !== "state" || rule.key !== "roll.fd") continue;
    if (String(rule.selector ?? "any") !== "any") continue;

    const value = resolveRuleScalar(actor, rule.rawValue, {
      sourceItem: rule.sourceItem,
      specialty: rule.specialty
    });
    if (value === null) continue;
    total += Math.trunc(value);
  }

  return total;
}

/**
 * Translate declarative modifiers understood by the generic skill-roll engine.
 *
 * Rank modifiers are resolved first so all following @skill.rank expressions
 * see the effective rank while the persisted Item rank remains untouched.
 */
export function buildSkillRollRuleModifiers(actor, {
  skillIdentifier = "",
  skillRank = 0,
  tags = [],
  contexts = [],
  ruleSources = []
} = {}) {
  const baseContext = {
    skillIdentifier,
    skillRank,
    tags,
    contexts,
    ruleSources
  };

  const allRules = collectApplicableRules(actor, baseContext);
  const applied = [];
  const warnings = [];
  let rankModifier = 0;

  for (const rule of allRules.filter((entry) => entry.key === "skill.rankFlat")) {
    const ruleContext = {
      ...baseContext,
      sourceItem: rule.sourceItem,
      specialty: rule.specialty
    };
    const value = resolveRuleScalar(actor, rule.rawValue, ruleContext);
    if (value === null) {
      warnings.push(`${sourceLabel(rule)} : valeur invalide pour ${rule.effect.label}`);
      continue;
    }
    rankModifier += Math.trunc(value);
    applied.push(appliedEntry(
      rule,
      value > 0 ? `+${Math.trunc(value)}` : String(Math.trunc(value))
    ));
  }

  const effectiveSkillRank = Math.max(0, Math.trunc(Number(skillRank) || 0) + rankModifier);
  const context = {
    ...baseContext,
    skillRank: effectiveSkillRank
  };

  let fdModifier = 0;
  let d12Substitutions = 0;
  let ignoredCriticalFailures = 0;
  let rerolls = 0;
  let criticalRerolls = 0;
  let autoSuccess = false;
  const extraDice = [];
  const diceMultipliers = [];
  let repeatCount = 1;
  let repeatKeepMode = "none";
  let criticalFailureThreshold = 1;
  const contextualNotes = [];

  for (const rule of allRules) {
    if (!rule.key.startsWith("roll.")) continue;

    let displayValue = rule.rawValue;
    let valid = true;
    const ruleContext = {
      ...context,
      sourceItem: rule.sourceItem,
      specialty: rule.specialty
    };

    switch (rule.key) {
      case "roll.fd": {
        const value = resolveRuleScalar(actor, rule.rawValue, ruleContext);
        if (value === null) valid = false;
        else {
          fdModifier += Math.trunc(value);
          displayValue = value > 0 ? `+${Math.trunc(value)}` : String(Math.trunc(value));
        }
        break;
      }

      case "roll.extraDie": {
        const dice = resolveRuleDice(actor, rule.rawValue, ruleContext);
        if (!dice.length) valid = false;
        else {
          extraDice.push(...dice);
          displayValue = formatResolvedDice(dice);
        }
        break;
      }

      case "roll.diceMultiplier": {
        const value = resolveRuleScalar(actor, rule.rawValue, ruleContext);
        const rounding = rule.rounding;
        if (value === null || value <= 0 || (!Number.isInteger(value) && !ROUNDING_MODES.has(rounding))) {
          valid = false;
        } else {
          diceMultipliers.push({
            multiplier: Number(value),
            rounding: ROUNDING_MODES.has(rounding) ? rounding : "round"
          });
          const roundingLabel = {
            ceil: "arrondi supérieur",
            floor: "arrondi inférieur",
            round: "arrondi standard"
          }[rounding] ?? "";
          displayValue = `×${value}${roundingLabel ? ` (${roundingLabel})` : ""}`;
        }
        break;
      }

      case "roll.dieUpgrade": {
        const value = resolveRuleScalar(actor, rule.rawValue, ruleContext);
        if (value === null || value < 0) valid = false;
        else {
          d12Substitutions += Math.trunc(value);
          displayValue = String(Math.trunc(value));
        }
        break;
      }

      case "roll.repeatKeep": {
        const value = resolveRuleScalar(actor, rule.rawValue, ruleContext);
        const mode = String(rule.mode ?? "");
        if (value === null || value < 2 || value > 5 || !KEEP_MODES.has(mode)) {
          valid = false;
        } else {
          repeatCount = Math.max(repeatCount, Math.trunc(value));
          repeatKeepMode = mode;
          displayValue = `${Math.trunc(value)} jets — garder ${mode === "best" ? "le meilleur" : "le pire"}`;
        }
        break;
      }

      case "roll.criticalFailureThreshold": {
        const value = resolveRuleScalar(actor, rule.rawValue, ruleContext);
        if (value === null || value < 1 || value > 3) {
          valid = false;
        } else {
          criticalFailureThreshold = Math.max(criticalFailureThreshold, Math.trunc(value));
          displayValue = `1–${Math.trunc(value)}`;
        }
        break;
      }

      case "roll.reroll": {
        const value = resolveRuleScalar(actor, rule.rawValue, ruleContext);
        if (value === null || value < 0) valid = false;
        else {
          rerolls += Math.trunc(value);
          displayValue = String(Math.trunc(value));
        }
        break;
      }

      case "roll.rerollCritical": {
        const value = resolveRuleScalar(actor, rule.rawValue, ruleContext);
        if (value === null || value < 0) valid = false;
        else {
          criticalRerolls += Math.trunc(value);
          displayValue = String(Math.trunc(value));
        }
        break;
      }

      case "roll.autoSuccess": {
        const value = resolveRuleScalar(actor, rule.rawValue, ruleContext);
        if (value === null || value <= 0) valid = false;
        else {
          autoSuccess = true;
          displayValue = "Réussite automatique";
        }
        break;
      }

      case "roll.note": {
        if (!rule.rawValue) valid = false;
        else {
          displayValue = rule.rawValue;
          contextualNotes.push(`${sourceLabel(rule)} — ${rule.rawValue}`);
        }
        break;
      }

      case "roll.ignoreCritical": {
        const value = resolveRuleScalar(actor, rule.rawValue, ruleContext);
        if (value === null || value < 0) valid = false;
        else {
          ignoredCriticalFailures += Math.trunc(value);
          displayValue = String(Math.trunc(value));
        }
        break;
      }

      default:
        continue;
    }

    if (!valid) {
      warnings.push(`${sourceLabel(rule)} : valeur invalide pour ${rule.effect.label}`);
      continue;
    }

    applied.push(appliedEntry(rule, displayValue));
  }

  const notes = applied.map((entry) => appliedNote(entry));

  return {
    baseSkillRank: Math.max(0, Math.trunc(Number(skillRank) || 0)),
    rankModifier,
    effectiveSkillRank,
    fdModifier,
    d12Substitutions,
    ignoredCriticalFailures,
    extraDice,
    diceMultipliers,
    repeatCount,
    repeatKeepMode,
    criticalFailureThreshold,
    autoSuccess,
    rerolls,
    criticalRerolls,
    contextualNotes,
    applied,
    notes,
    warnings
  };
}

/**
 * Resolve declarative combat-behavior modifiers.
 *
 * `combat.defenseOnly` is boolean-like: one applicable positive rule is enough
 * to prevent the actor from becoming the source of damage for that combat roll.
 * The calling workflow is responsible for freezing this result at roll time.
 */
export function buildCombatRuleModifiers(actor, {
  skillIdentifier = "",
  skillRank = 0,
  tags = [],
  contexts = [],
  ruleSources = []
} = {}) {
  const context = {
    skillIdentifier,
    skillRank,
    tags,
    contexts,
    ruleSources
  };

  const applied = [];
  const warnings = [];
  let defenseOnly = false;

  for (const rule of collectApplicableRules(actor, context)) {
    if (rule.key !== "combat.defenseOnly") continue;

    const ruleContext = {
      ...context,
      sourceItem: rule.sourceItem,
      specialty: rule.specialty
    };
    const value = resolveRuleScalar(actor, rule.rawValue, ruleContext);
    if (value === null || value < 0) {
      warnings.push(`${sourceLabel(rule)} : valeur invalide pour ${rule.effect.label}`);
      continue;
    }

    if (value > 0) defenseOnly = true;
    applied.push(appliedEntry(
      rule,
      value > 0 ? "Actif" : "Inactif"
    ));
  }

  return {
    defenseOnly,
    applied,
    notes: applied
      .filter((entry) => entry.value === "Actif")
      .map((entry) => appliedNote(entry, { includeValue: false })),
    warnings
  };
}

/**
 * Resolve declarative effects that directly modify damage.
 */
export function buildDamageRuleModifiers(actor, {
  skillIdentifier = "",
  skillRank = 0,
  tags = [],
  contexts = [],
  ruleSources = []
} = {}) {
  const context = {
    skillIdentifier,
    skillRank,
    tags,
    contexts,
    ruleSources
  };

  const applied = [];
  const warnings = [];
  let flatModifier = 0;
  let ignoreProtection = false;
  const extraDice = [];

  for (const rule of collectApplicableRules(actor, context)) {
    if (!rule.key.startsWith("damage.")) continue;

    const ruleContext = {
      ...context,
      sourceItem: rule.sourceItem,
      specialty: rule.specialty
    };
    let displayValue = rule.rawValue;
    let valid = true;

    switch (rule.key) {
      case "damage.flat": {
        const value = resolveRuleScalar(actor, rule.rawValue, ruleContext);
        if (value === null) valid = false;
        else {
          flatModifier += Math.trunc(value);
          displayValue = value > 0 ? `+${Math.trunc(value)}` : String(Math.trunc(value));
        }
        break;
      }

      case "damage.extraDie": {
        const dice = resolveRuleDice(actor, rule.rawValue, ruleContext);
        if (!dice.length) valid = false;
        else {
          extraDice.push(...dice);
          displayValue = formatResolvedDice(dice);
        }
        break;
      }

      case "damage.ignoreProtection": {
        const raw = String(rule.rawValue ?? "").toLowerCase();
        if (raw !== "all") valid = false;
        else {
          ignoreProtection = true;
          displayValue = "Toute la protection";
        }
        break;
      }

      default:
        continue;
    }

    if (!valid) {
      warnings.push(`${sourceLabel(rule)} : valeur invalide pour ${rule.effect.label}`);
      continue;
    }

    applied.push(appliedEntry(rule, displayValue));
  }

  const notes = applied.map((entry) => {
    switch (entry.key) {
      case "damage.flat":
        return appliedNote(entry, { label: "Dégâts" });
      case "damage.extraDie":
        return appliedNote(entry, { label: "Dégâts supplémentaires" });
      case "damage.ignoreProtection":
        return appliedNote(entry, { label: "Protection ignorée", includeValue: false });
      default:
        return appliedNote(entry);
    }
  });

  return {
    flatModifier,
    extraDice,
    ignoreProtection,
    applied,
    notes,
    warnings
  };
}

/**
 * Resolve declarative protection modifiers.
 */
export function buildProtectionRuleModifiers(actor, {
  skillIdentifier = "",
  skillRank = 0,
  tags = [],
  contexts = [],
  ruleSources = []
} = {}) {
  const context = {
    skillIdentifier,
    skillRank,
    tags,
    contexts,
    ruleSources
  };

  const applied = [];
  const warnings = [];
  let flatModifier = 0;

  for (const rule of collectApplicableRules(actor, context)) {
    if (rule.key !== "protection.flat") continue;

    const ruleContext = {
      ...context,
      sourceItem: rule.sourceItem,
      specialty: rule.specialty
    };
    const value = resolveRuleScalar(actor, rule.rawValue, ruleContext);
    if (value === null) {
      warnings.push(`${sourceLabel(rule)} : valeur invalide pour ${rule.effect.label}`);
      continue;
    }

    flatModifier += Math.trunc(value);
    applied.push(appliedEntry(
      rule,
      value > 0 ? `+${Math.trunc(value)}` : String(Math.trunc(value))
    ));
  }

  return {
    flatModifier,
    applied,
    notes: applied.map((entry) => appliedNote(entry)),
    warnings
  };
}

/**
 * Read a derived resource modifier without mutating persisted Actor data.
 */
export function buildResourceRuleModifiers(actor, resourceIdentifier, {
  contexts = [],
  tags = [],
  ruleSources = []
} = {}) {
  const context = {
    resourceIdentifier: String(resourceIdentifier ?? ""),
    contexts,
    tags,
    ruleSources
  };
  const applied = [];
  const warnings = [];
  let flatModifier = 0;

  for (const rule of collectApplicableRules(actor, context)) {
    if (rule.key !== "resource.flat") continue;
    const ruleContext = {
      ...context,
      sourceItem: rule.sourceItem,
      specialty: rule.specialty
    };
    const value = resolveRuleScalar(actor, rule.rawValue, ruleContext);
    if (value === null) {
      warnings.push(`${sourceLabel(rule)} : valeur invalide pour ${rule.effect.label}`);
      continue;
    }
    flatModifier += Number(value);
    applied.push(appliedEntry(
      rule,
      value > 0 ? `+${value}` : String(value)
    ));
  }

  return {
    flatModifier,
    applied,
    notes: applied.map((entry) => appliedNote(entry)),
    warnings
  };
}

/**
 * Interpret wound operations only. The calling workflow remains responsible
 * for supplying the target and for persisting any resulting wound mutation.
 */
export function buildWoundRuleModifiers(actor, {
  contexts = [],
  tags = [],
  ruleSources = []
} = {}) {
  const context = { contexts, tags, ruleSources };
  const applied = [];
  const warnings = [];
  const inflict = [];
  let downgradeLevels = 0;

  for (const rule of collectApplicableRules(actor, context)) {
    if (!rule.key.startsWith("wound.")) continue;

    let displayValue = rule.rawValue;
    let valid = true;

    switch (rule.key) {
      case "wound.inflict": {
        const severity = String(rule.rawValue ?? "").toLowerCase();
        if (!WOUND_SEVERITIES.has(severity)) valid = false;
        else {
          inflict.push(severity);
          displayValue = severity;
        }
        break;
      }

      case "wound.downgrade": {
        const ruleContext = {
          ...context,
          sourceItem: rule.sourceItem,
          specialty: rule.specialty
        };
        const value = resolveRuleScalar(actor, rule.rawValue, ruleContext);
        if (value === null || value < 1) valid = false;
        else {
          downgradeLevels += Math.trunc(value);
          displayValue = String(Math.trunc(value));
        }
        break;
      }

      default:
        continue;
    }

    if (!valid) {
      warnings.push(`${sourceLabel(rule)} : valeur invalide pour ${rule.effect.label}`);
      continue;
    }
    applied.push(appliedEntry(rule, displayValue));
  }

  return {
    inflict,
    downgradeLevels,
    applied,
    notes: applied.map((entry) => appliedNote(entry)),
    warnings
  };
}

/**
 * Pure wound downgrade helper. It does not touch an Actor or an Item.
 */
export function downgradeWoundSeverity(severity, levels = 1) {
  const order = ["light", "serious", "critical"];
  const current = order.indexOf(String(severity ?? ""));
  if (current < 0) return null;
  const next = current - Math.max(0, Math.trunc(Number(levels) || 0));
  return next < 0 ? null : order[next];
}
