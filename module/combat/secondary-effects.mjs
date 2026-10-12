const SECONDARY_EFFECTS = Object.freeze({
  serious: Object.freeze({
    1: Object.freeze({
      text: "{target} tremble encore sous l’impact de {source}. Jusqu’à la fin du round suivant, {target} lance deux fois les dés pour chacune de ses actions et conserve le moins bon résultat.",
      followup: "assisted", statePresetId: "ebranle"
    }),
    2: Object.freeze({
      text: "La douleur est intense. {target} est comme tétanisé sous le choc : FD +1 tant qu’un jet de résistance n’est pas réussi.",
      followup: "assisted", statePresetId: "sous-le-choc", requiresResistance: true
    }),
    3: Object.freeze({
      text: "{source} lacère l’armure de {target} : l’armure est détériorée de 2 points. Si {target} ne porte pas d’armure : +1 blessure légère.",
      followup: "immediate",
      extraWoundSeverity: "light",
      extraWoundActionLabel: "Si aucune armure : préparer la Blessure légère supplémentaire",
      followupNote: "La détérioration d’armure reste à gérer manuellement. Si la cible ne portait pas d’armure, le MJ peut préparer la Blessure légère supplémentaire. Elle ne génère jamais de nouvel effet secondaire."
    }),
    4: Object.freeze({
      text: "{source} termine son enchaînement en excellente posture : FD -2 pour son coup suivant.",
      followup: "manual", followupNote: "Le bonus du prochain coup reste à suivre manuellement."
    }),
    5: Object.freeze({
      text: "La surprise fait baisser la garde de {target}. {source} bénéficie d’une attaque d’opportunité.",
      followup: "immediate", followupNote: "Résoudre l’attaque d’opportunité avec le jet d’attaque classique."
    }),
    6: Object.freeze({
      text: "{target} est groggy. Un jet de résistance est nécessaire pour rester lucide. En cas d’échec, {target} reste groggy tant qu’un jet de résistance n’est pas réussi.",
      followup: "assisted", vanillaStateId: "groggy", requiresResistance: true
    }),
    7: Object.freeze({
      text: "{source} se retrouve en excellente posture. Jusqu’à la fin du round en cours et du suivant, {source} lance deux fois les dés pour se battre et conserve le meilleur résultat, tandis que {target} lance deux fois les dés et conserve le pire.",
      followup: "manual", followupNote: "Cet effet concerne deux personnages et reste à suivre manuellement."
    }),
    8: Object.freeze({
      text: "{target} est complètement déstabilisé et désorienté : ses échecs critiques se produisent sur les « 1 » et les « 2 » jusqu’à la fin du round suivant.",
      followup: "assisted", statePresetId: "desoriente"
    }),
    9: Object.freeze({
      text: "{target} perd l’équilibre : un jet de résistance permet d’éviter la chute. Au coup suivant, {target} est sans défense et ne lance aucun dé, tandis que {source} lance deux fois les dés pour se battre et conserve le meilleur résultat.",
      followup: "manual", requiresResistance: true, followupNote: "Après le jet de résistance, les conséquences du prochain coup restent à suivre manuellement."
    }),
    10: Object.freeze({
      text: "{source} trouve une brèche dans l’armure de {target}. L’arme ne rencontre pas de résistance et s’enfonce davantage : +1 blessure à 2d10 de dégâts ; {target} doit réussir un jet de résistance pour éviter l’évanouissement.",
      followup: "immediate", requiresResistance: true, extraDamage: "2d10", followupNote: "La blessure supplémentaire ne génère jamais de nouvel effet secondaire. L’évanouissement reste manuel."
    })
  }),
  critical: Object.freeze({
    1: Object.freeze({
      text: "{source} va trop vite pour {target}. La blessure est sérieuse et prive {target} de sa liberté de mouvement : FD +1 jusqu’à ce que la blessure rétrograde en blessure légère.",
      followup: "assisted", statePresetId: "mobilite-reduite"
    }),
    2: Object.freeze({
      text: "Une large entaille traverse les chairs de {target} jusqu’à l’os : jet de résistance contre la douleur ; en cas d’échec, {target} lâche son arme. FD +1 jusqu’à ce que la blessure rétrograde en blessure légère.",
      followup: "assisted", statePresetId: "entaille-profonde", requiresResistance: true, followupNote: "En cas d’échec au jet de résistance, le lâcher d’arme reste manuel."
    }),
    3: Object.freeze({
      text: "{target} grimace tandis que du sang jaillit de sa bouche : jet de résistance contre la douleur pour pouvoir continuer à se battre ; +1 blessure à 3d10 de dégâts.",
      followup: "manual", followupNote: "Le MJ gère ce résultat : la règle ne cadre pas suffisamment ses conséquences."
    }),
    4: Object.freeze({
      text: "{source} lacère profondément l’armure de {target}, qui perd 2 points de protection. La blessure provoque un saignement abondant : une blessure grave au prochain round.",
      followup: "manual-reminder", roundReminder: "critical4", followupNote: "La perte de protection reste manuelle. Une blessure grave sera rappelée au début du round suivant."
    }),
    5: Object.freeze({
      text: "Le choc propulse {target} au sol. La blessure laissera des séquelles ; {source} bénéficie de 2 attaques d’opportunité.",
      followup: "immediate", followupNote: "Résoudre les deux attaques d’opportunité avec les jets d’attaque classiques."
    }),
    6: Object.freeze({
      text: "Un craquement résonne et la jambe de {target} adopte un angle improbable : jet de résistance contre la douleur pour ne pas rompre le combat. Fracture ouverte : les échecs critiques se produisent sur les « 1 », « 2 » et « 3 » jusqu’à la guérison de la blessure.",
      followup: "assisted", statePresetId: "fracture-ouverte", requiresResistance: true, followupNote: "La conséquence d’une poursuite du combat reste manuelle."
    }),
    7: Object.freeze({
      text: "Le bouclier de {target} est détruit. Si {target} n’avait pas de bouclier : +1 blessure grave. Si {target} avait une arme en main gauche, elle est propulsée à une dizaine de mètres.",
      followup: "immediate",
      extraWoundSeverity: "serious",
      extraWoundActionLabel: "Si aucun bouclier : préparer la Blessure grave supplémentaire",
      followupNote: "L’équipement reste à gérer manuellement. Si la cible n’avait pas de bouclier, le MJ peut préparer la Blessure grave supplémentaire. Elle ne génère jamais de nouvel effet secondaire."
    }),
    8: Object.freeze({
      text: "{source} démolit le casque de {target} : un jet de résistance est requis à chaque round pour éviter l’évanouissement. Si {target} ne portait pas de casque, son visage est fracassé : +1 blessure grave ; jet de résistance pour éviter l’évanouissement.",
      followup: "manual", followupNote: "Le MJ gère ce résultat : aucune interprétation automatique n’est imposée."
    }),
    9: Object.freeze({
      text: "Le sang coule à gros bouillons de la plaie laissée sur {target} par l’arme de {source}. Une artère semble touchée. Hémorragie : 1 blessure légère par round ; {target} dispose d’une action de moins à chaque round.",
      followup: "manual-reminder", statePresetId: "hemorragie", followupNote: "Tant que l’état Hémorragie est présent, un rappel de début de round indique les conséquences à appliquer manuellement."
    }),
    10: Object.freeze({
      text: "L’arme de {source} traverse {target} et touche des organes : {source} cumule d’un coup les 4 points de coup spécial. Il ne reste plus qu’à conclure.",
      followup: "immediate", followupNote: "Les 4 points de coup spécial sont à résoudre selon le suivi de la table."
    })
  })
});

const MALADRESSES = Object.freeze({
  1: Object.freeze({ followup: "assisted", statePresetId: "vulnerable", text: "{target} perd l’équilibre et devient vulnérable. {target} jette deux fois les dés pour se battre et conserve le moins bon résultat jusqu’à la fin du round suivant." }),
  2: Object.freeze({
    followup: "manual",
    text: "L’arme de {target} est endommagée : –1 aux dégâts. Elle risque de se retrouver coincée. Un jet de Compétences athlétiques avec un FD de 1d10 permet de la dégager. Une action est perdue à ce round et au suivant.",
    skillRoll: Object.freeze({
      identifier: "arkhanval.skill.explorateur.competences-athletiques",
      fdFormula: "1d10",
      label: "Compétences athlétiques",
      conditionLabel: "Si l’arme est coincée"
    }),
    followupNote: "L’état de l’arme, le –1 aux dégâts et les actions perdues restent à suivre manuellement."
  }),
  3: Object.freeze({
    followup: "manual",
    text: "L’arme de {target} risque d’être perdue ou devient temporairement inutilisable. Un jet d’Art du combat FD 7 permet de déterminer si elle est envoyée au loin.",
    skillRoll: Object.freeze({
      identifier: "arkhanval.skill.combattant.art-combat",
      fd: 7,
      label: "Art du combat"
    })
  }),
  4: Object.freeze({ followup: "assisted", statePresetId: "en-difficulte", text: "{target} se met en difficulté : FD +2 jusqu’à la fin du round suivant." }),
  5: Object.freeze({ followup: "immediate", text: "La protection est ignorée pour les dégâts concernés.", ignoreProtection: true }),
  6: Object.freeze({ followup: "manual", text: "{target} tombe au sol et l’avantage accordé à son adversaire reste à suivre manuellement." }),
  7: Object.freeze({ followup: "assisted", statePresetId: "perturbe", text: "{target} est perturbé : les « 1 » et « 2 » sur le d10 sont des échecs critiques jusqu’à la fin du round suivant." }),
  8: Object.freeze({ followup: "immediate", text: "Une attaque d’opportunité est déclenchée et se résout avec une attaque classique." }),
  9: Object.freeze({ followup: "assisted", statePresetId: "muscle-froisse", text: "{target} se froisse un muscle : FD +1 tant que {target} n’est pas soigné. Si {target} est sur une monture, la chute reste manuelle." }),
  10: Object.freeze({
    followup: "immediate",
    text: "Le MJ choisit : dégâts sur un allié proche ou jet de résistance Arkœur FD 8 s’il n’y a pas d’allié proche.",
    requiresResistance: true,
    resistanceFd: 8,
    resistanceCondition: "S’il n’y a pas d’allié proche, effectuez le jet de résistance suivant."
  })
});

function narrativeName(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function renderNarrativeText(template, { sourceName = "", targetName = "" } = {}) {
  const source = narrativeName(sourceName, "La source des dégâts");
  const target = narrativeName(targetName, "La cible");
  return String(template ?? "")
    .replaceAll("{source}", source)
    .replaceAll("{target}", target);
}

function normalizedEntry(entry, kind, result, context) {
  if (!entry) return null;
  return {
    kind,
    severity: kind === "maladroit" ? "" : kind,
    result: Number(result),
    text: renderNarrativeText(entry.text, context),
    followup: String(entry.followup ?? "manual"),
    followupNote: String(entry.followupNote ?? ""),
    statePresetId: String(entry.statePresetId ?? ""),
    vanillaStateId: String(entry.vanillaStateId ?? ""),
    requiresResistance: Boolean(entry.requiresResistance),
    resistanceFd: Math.max(0, Number(entry.resistanceFd) || 0),
    resistanceCondition: String(entry.resistanceCondition ?? ""),
    skillRoll: entry.skillRoll ? {
      identifier: String(entry.skillRoll.identifier ?? ""),
      fd: Math.max(0, Number(entry.skillRoll.fd) || 0),
      fdFormula: String(entry.skillRoll.fdFormula ?? ""),
      label: String(entry.skillRoll.label ?? ""),
      conditionLabel: String(entry.skillRoll.conditionLabel ?? "")
    } : null,
    extraDamage: String(entry.extraDamage ?? ""),
    extraWoundSeverity: String(entry.extraWoundSeverity ?? ""),
    extraWoundActionLabel: String(entry.extraWoundActionLabel ?? ""),
    roundReminder: String(entry.roundReminder ?? ""),
    ignoreProtection: Boolean(entry.ignoreProtection)
  };
}

export function secondaryEffectFor(severity, result, context = {}) {
  const key = String(severity ?? "");
  const entry = SECONDARY_EFFECTS[key]?.[Number(result)] ?? null;
  return normalizedEntry(entry, key, result, context);
}

export function maladresseEffectFor(result, context = {}) {
  return normalizedEntry(MALADRESSES[Number(result)] ?? null, "maladroit", result, context);
}

export function canUseSecondaryEffectTable(severity) {
  return ["serious", "critical"].includes(String(severity ?? ""));
}

export function effectFollowupLabel(effect) {
  switch (String(effect?.followup ?? "")) {
    case "immediate": return "Résolution immédiate";
    case "assisted": return "État assisté";
    case "manual-reminder": return "Manuel — rappel automatique";
    default: return "Manuel";
  }
}

export function effectIsAssistedState(effect) {
  return Boolean(effect?.statePresetId || effect?.vanillaStateId);
}
