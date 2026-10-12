/**
 * Arkhanval vanilla persistent states.
 *
 * These are fixed Actor states rather than embedded Items. To keep workflow
 * consumers generic, active states expose virtual rule sources using the same
 * rules[] vocabulary as specialties and other transient effects.
 */

export const VANILLA_STATE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "groggy",
    label: "Groggy",
    labelKey: "ARKHANVAL.States.Groggy",
    rules: Object.freeze([
      Object.freeze({ id: "vanilla-state-groggy-fd", key: "roll.fd", selector: "any", value: "+2" }),
      Object.freeze({ id: "vanilla-state-groggy-defense-only", key: "combat.defenseOnly", selector: "combat", value: "1" })
    ])
  }),
  Object.freeze({
    id: "stunned",
    label: "Étourdi",
    labelKey: "ARKHANVAL.States.Stunned",
    rules: Object.freeze([
      Object.freeze({ id: "vanilla-state-stunned-fd", key: "roll.fd", selector: "any", value: "+2" }),
      Object.freeze({ id: "vanilla-state-stunned-defense-only", key: "combat.defenseOnly", selector: "combat", value: "1" })
    ])
  }),
  Object.freeze({
    id: "greatPain",
    label: "Grande douleur",
    labelKey: "ARKHANVAL.States.GreatPain",
    rules: Object.freeze([
      Object.freeze({ id: "vanilla-state-great-pain-fd", key: "roll.fd", selector: "any", value: "+2" }),
      Object.freeze({ id: "vanilla-state-great-pain-defense-only", key: "combat.defenseOnly", selector: "combat", value: "1" })
    ])
  })
]);

export function activeVanillaStateDefinitions(actor) {
  return VANILLA_STATE_DEFINITIONS.filter(
    (state) => Boolean(actor?.system?.states?.[state.id])
  );
}

export function vanillaStateFdPenalty(actor) {
  return activeVanillaStateDefinitions(actor).reduce((total, state) => {
    const fdRule = state.rules.find((rule) => rule.key === "roll.fd" && rule.selector === "any");
    const value = Number(fdRule?.value);
    return total + (Number.isFinite(value) ? Math.trunc(value) : 0);
  }, 0);
}

export function activeVanillaStateRuleSources(actor) {
  return activeVanillaStateDefinitions(actor).map((state) => ({
    id: `vanilla-state:${state.id}`,
    uuid: `ActorState.${state.id}`,
    type: "state",
    name: state.label,
    system: {
      rules: state.rules
    }
  }));
}
