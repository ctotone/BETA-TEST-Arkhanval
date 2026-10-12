import { findActorSkill } from "../resolution/skills.mjs";
import { specialtyParameterValue } from "./parameters.mjs";

/**
 * Resolve system variables exposed to declarative rules.
 * Returning null means the variable is unavailable in the supplied context.
 */
export function resolveArkhanvalVariable(actor, variable, context = {}) {
  if (!actor) return null;

  const parameterMatch = String(variable ?? "").match(/^@parameter\.([A-Za-z0-9_-]+)(\.rank)?$/);
  if (parameterMatch) {
    const [, key, rankSuffix] = parameterMatch;
    const sourceItem = context.sourceItem ?? context.specialty ?? null;
    if (!sourceItem) return null;

    const value = specialtyParameterValue(sourceItem, key);
    if (!value) return null;
    if (!rankSuffix) return value;

    return Number(findActorSkill(actor, { identifier: value })?.rank) || 0;
  }

  switch (variable) {
    case "@skill.rank": {
      if (Number.isFinite(Number(context.skillRank))) return Number(context.skillRank);
      if (context.skillIdentifier) {
        return Number(findActorSkill(actor, { identifier: context.skillIdentifier })?.rank) || 0;
      }
      return null;
    }

    case "@combatArt.rank":
      return Number(findActorSkill(actor, {
        identifier: "arkhanval.skill.combattant.art-combat"
      })?.rank) || 0;

    case "@arksonge.rank":
      return Number(actor.system.arks?.arksonge?.rank) || 0;
    case "@arkentropie.rank":
      return Number(actor.system.arks?.arkentropie?.rank) || 0;
    case "@arkoeur.rank":
      return Number(actor.system.arks?.arkoeur?.rank) || 0;
    case "@arksonge.circles":
      return Number(actor.system.arks?.arksonge?.circles) || 0;
    case "@arkentropie.circles":
      return Number(actor.system.arks?.arkentropie?.circles) || 0;
    case "@arkoeur.circles":
      return Number(actor.system.arks?.arkoeur?.circles) || 0;
    default:
      return null;
  }
}
