const STATE_PRESETS = Object.freeze({
  "ebranle": Object.freeze({
    identifier: "arkhanval.state.ebranle",
    name: "Ébranlé",
    description: "Vous en tremblez encore. Jusqu’à la fin du round suivant, vous lancez deux fois les dés pour chacune de vos actions et conservez le moins bon résultat.",
    assistance: "Tant que cet état est présent sur votre fiche, son effet est automatiquement pris en compte dans vos jets. Vous n’avez aucune modification à effectuer manuellement. Cet état expire automatiquement à la fin du round suivant lorsque le Combat Tracker est utilisé.",
    source: "Blessure grave — Effet secondaire 1",
    rules: Object.freeze([
      Object.freeze({ id: "state-ebranle-repeat", key: "roll.repeatKeep", selector: "any", value: "2", mode: "worst" })
    ]),
    tracking: Object.freeze({ mode: "expireRound" })
  }),
  "sous-le-choc": Object.freeze({
    identifier: "arkhanval.state.sous-le-choc",
    name: "Sous le choc",
    description: "La douleur est intense. Vous êtes comme tétanisé, sous le choc : FD +1 tant qu’un jet de résistance n’est pas réussi.",
    assistance: "Tant que cet état est présent sur votre fiche, son effet est automatiquement pris en compte dans vos jets. Vous n’avez aucune modification à effectuer manuellement. Retirez cet état de votre fiche lorsqu’un jet de résistance est réussi.",
    source: "Blessure grave — Effet secondaire 2",
    rules: Object.freeze([
      Object.freeze({ id: "state-sous-le-choc-fd", key: "roll.fd", selector: "any", value: "+1" })
    ])
  }),
  "desoriente": Object.freeze({
    identifier: "arkhanval.state.desoriente",
    name: "Désorienté",
    description: "Complètement déstabilisé, vous êtes désorienté : vos échecs critiques se produisent sur les « 1 » et les « 2 » jusqu’à la fin du round suivant.",
    assistance: "Tant que cet état est présent sur votre fiche, son effet est automatiquement pris en compte dans vos jets. Vous n’avez aucune modification à effectuer manuellement. Cet état expire automatiquement à la fin du round suivant lorsque le Combat Tracker est utilisé.",
    source: "Blessure grave — Effet secondaire 8",
    rules: Object.freeze([
      Object.freeze({ id: "state-desoriente-critical", key: "roll.criticalFailureThreshold", selector: "any", value: "2" })
    ]),
    tracking: Object.freeze({ mode: "expireRound" })
  }),
  "mobilite-reduite": Object.freeze({
    identifier: "arkhanval.state.mobilite-reduite",
    name: "Mobilité réduite",
    description: "La blessure est sérieuse et vous prive de votre liberté de mouvement : FD +1 jusqu’à ce que la blessure rétrograde en blessure légère.",
    assistance: "Tant que cet état est présent sur votre fiche, son effet est automatiquement pris en compte dans vos jets. Vous n’avez aucune modification à effectuer manuellement. Retirez cet état de votre fiche lorsque la blessure rétrograde en blessure légère.",
    source: "Blessure critique — Effet secondaire 1",
    rules: Object.freeze([
      Object.freeze({ id: "state-mobilite-reduite-fd", key: "roll.fd", selector: "any", value: "+1" })
    ])
  }),
  "entaille-profonde": Object.freeze({
    identifier: "arkhanval.state.entaille-profonde",
    name: "Entaille profonde",
    description: "Une large entaille traverse vos chairs jusqu’à l’os : jet de résistance contre la douleur ; en cas d’échec, vous lâchez votre arme ; FD +1 jusqu’à ce que la blessure rétrograde en blessure légère.",
    assistance: "Tant que cet état est présent sur votre fiche, son effet est automatiquement pris en compte dans vos jets. Vous n’avez aucune modification à effectuer manuellement. Retirez cet état de votre fiche lorsque la blessure rétrograde en blessure légère.",
    source: "Blessure critique — Effet secondaire 2",
    rules: Object.freeze([
      Object.freeze({ id: "state-entaille-profonde-fd", key: "roll.fd", selector: "any", value: "+1" })
    ])
  }),
  "fracture-ouverte": Object.freeze({
    identifier: "arkhanval.state.fracture-ouverte",
    name: "Fracture ouverte",
    description: "Une fracture ouverte aggrave durablement vos échecs critiques : ils se produisent sur les « 1 », « 2 » et « 3 » jusqu’à la guérison de la blessure.",
    assistance: "Tant que cet état est présent sur votre fiche, le seuil d’échec critique est automatiquement ajusté. Vous n’avez aucune modification à effectuer manuellement. Retirez cet état de votre fiche lorsque la blessure est guérie.",
    source: "Blessure critique — Effet secondaire 6",
    rules: Object.freeze([
      Object.freeze({ id: "state-fracture-ouverte-critical", key: "roll.criticalFailureThreshold", selector: "any", value: "3" })
    ])
  }),
  "hemorragie": Object.freeze({
    identifier: "arkhanval.state.hemorragie",
    name: "Hémorragie",
    description: "Une artère semble touchée. Hémorragie : 1 blessure légère par round ; vous avez une action de moins à chaque round.",
    assistance: "Suivi manuel — rappel automatique. Tant que cet état est présent sur votre fiche, un rappel apparaît au début de chaque nouveau round lorsque le Combat Tracker est utilisé. Appliquez manuellement les conséquences indiquées pour ce round. Retirez cet état de votre fiche lorsque l’hémorragie prend fin.",
    source: "Blessure critique — Effet secondaire 9",
    rules: Object.freeze([]),
    tracking: Object.freeze({ mode: "roundReminder", reminderKey: "hemorrhage" })
  }),
  "vulnerable": Object.freeze({
    identifier: "arkhanval.state.vulnerable",
    name: "Vulnérable",
    description: "Vous perdez l’équilibre et devenez vulnérable. Vous jetez deux fois les dés pour vous battre et conservez le moins bon résultat jusqu’à la fin du round suivant.",
    assistance: "Tant que cet état est présent sur votre fiche, son effet est automatiquement pris en compte dans vos jets de combat. Vous n’avez aucune modification à effectuer manuellement. Cet état expire automatiquement à la fin du round suivant lorsque le Combat Tracker est utilisé.",
    source: "Maladresse — Effet secondaire 1",
    rules: Object.freeze([
      Object.freeze({ id: "state-vulnerable-repeat", key: "roll.repeatKeep", selector: "combat", value: "2", mode: "worst" })
    ]),
    tracking: Object.freeze({ mode: "expireRound" })
  }),
  "en-difficulte": Object.freeze({
    identifier: "arkhanval.state.en-difficulte",
    name: "En difficulté",
    description: "Une maladresse peut en entraîner une autre. Vous subissez un malus de circonstances : FD +2 jusqu’à la fin du round suivant.",
    assistance: "Tant que cet état est présent sur votre fiche, son effet est automatiquement pris en compte dans vos jets. Vous n’avez aucune modification à effectuer manuellement. Cet état expire automatiquement à la fin du round suivant lorsque le Combat Tracker est utilisé.",
    source: "Maladresse — Effet secondaire 4",
    rules: Object.freeze([
      Object.freeze({ id: "state-en-difficulte-fd", key: "roll.fd", selector: "any", value: "+2" })
    ]),
    tracking: Object.freeze({ mode: "expireRound" })
  }),
  "perturbe": Object.freeze({
    identifier: "arkhanval.state.perturbe",
    name: "Perturbé",
    description: "Vous perdez le fil du combat et vous vous compliquez la tâche. Les résultats de « 1 » et « 2 » sur le d10 sont des échecs critiques jusqu’à la fin du round suivant.",
    assistance: "Tant que cet état est présent sur votre fiche, son effet est automatiquement pris en compte dans vos jets. Vous n’avez aucune modification à effectuer manuellement. Cet état expire automatiquement à la fin du round suivant lorsque le Combat Tracker est utilisé.",
    source: "Maladresse — Effet secondaire 7",
    rules: Object.freeze([
      Object.freeze({ id: "state-perturbe-critical", key: "roll.criticalFailureThreshold", selector: "any", value: "2" })
    ]),
    tracking: Object.freeze({ mode: "expireRound" })
  }),
  "muscle-froisse": Object.freeze({
    identifier: "arkhanval.state.muscle-froisse",
    name: "Muscle froissé",
    description: "Vous vous froissez un muscle. FD +1 tant que vous n’êtes pas soigné. Si vous êtes sur une monture, vous tombez.",
    assistance: "Tant que cet état est présent sur votre fiche, son effet est automatiquement pris en compte dans vos jets. Vous n’avez aucune modification à effectuer manuellement. Retirez cet état de votre fiche lorsque vous êtes soigné.",
    source: "Maladresse — Effet secondaire 9",
    rules: Object.freeze([
      Object.freeze({ id: "state-muscle-froisse-fd", key: "roll.fd", selector: "any", value: "+1" })
    ])
  })
});

function cloneRules(rules) {
  return Array.from(rules ?? []).map((rule) => ({ ...rule }));
}

function trackingData(preset, {
  combat = globalThis.game?.combat ?? null
} = {}) {
  const config = preset?.tracking ?? null;
  if (!config) {
    return {
      mode: "",
      combatId: "",
      appliedRound: 0,
      expiresRound: 0,
      reminderKey: ""
    };
  }

  const started = Boolean(combat?.started);
  const appliedRound = started ? Math.max(0, Number(combat?.round) || 0) : 0;
  return {
    mode: String(config.mode ?? ""),
    combatId: started ? String(combat?.id ?? "") : "",
    appliedRound,
    expiresRound: config.mode === "expireRound" && appliedRound > 0 ? appliedRound + 2 : 0,
    reminderKey: String(config.reminderKey ?? "")
  };
}

function htmlDescription(preset, tracking) {
  const obtained = tracking.appliedRound > 0
    ? `<p><strong>Obtenu au round : ${tracking.appliedRound}</strong></p>`
    : "";
  return [
    `<p>${preset.description}</p>`,
    `<p><strong>${preset.identifier === "arkhanval.state.hemorragie" ? "Suivi manuel — rappel automatique" : "État assisté"}</strong><br>${preset.assistance}</p>`,
    `<p><strong>Source : ${preset.source}</strong></p>`,
    obtained
  ].join("");
}

export function statePreset(id) {
  return STATE_PRESETS[String(id ?? "")] ?? null;
}

export function statePresetIds() {
  return Object.keys(STATE_PRESETS);
}

export function stateItemData(id, options = {}) {
  const preset = statePreset(id);
  if (!preset) return null;
  const tracking = trackingData(preset, options);
  return {
    name: preset.name,
    type: "state",
    img: "systems/arkhanval/assets/items/etats/etat-debuff.webp",
    system: {
      identifier: preset.identifier,
      description: htmlDescription(preset, tracking),
      tags: [],
      rules: cloneRules(preset.rules),
      parameter: { key: "", value: "" },
      parameters: [],
      tracking
    }
  };
}

export function statePresetSummary(id) {
  const preset = statePreset(id);
  if (!preset) return null;
  return {
    id: String(id),
    identifier: preset.identifier,
    name: preset.name,
    assistance: preset.assistance,
    source: preset.source,
    tracking: preset.tracking ? { ...preset.tracking } : null
  };
}
