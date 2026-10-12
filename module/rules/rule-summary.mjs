import { ruleEffect, knownTag, customTagLabel } from "./catalog.mjs";

const ADDITIVE_EFFECTS = new Set([
  "roll.fd", "skill.rankFlat", "damage.flat", "protection.flat", "resistance.fd",
  "task.requiredSuccesses", "progression.specialtyCostFlat", "resource.flat"
]);

function displayedValue(rule) {
  const value = String(rule?.value ?? "").trim();
  if (ADDITIVE_EFFECTS.has(rule?.key) && /^\d+(?:[.,]\d+)?$/.test(value) && Number(value.replace(",", ".")) > 0) {
    return `+${value}`;
  }
  return value;
}

function resolveSelector(selector, options, parameters) {
  const raw = String(selector ?? "any").trim() || "any";
  if (raw === "any") return "";
  const params = new Map(Array.from(parameters ?? []).map((entry) => [String(entry.key ?? "").trim(), String(entry.value ?? "").trim()]));
  const parameterMatch = raw.match(/^(skill|tag):@parameter\.([A-Za-z0-9_-]+)$/);
  if (parameterMatch) {
    const [, kind, key] = parameterMatch;
    const resolved = params.get(key);
    if (!resolved) return `${kind === "skill" ? "Compétence" : "Tag"} — paramètre « ${key} » (non renseigné)`;
    const target = `${kind}:${resolved}`;
    const option = options.find((entry) => entry.value === target);
    return option?.label ?? `${kind === "skill" ? "Compétence" : "Tag"} — ${resolved}`;
  }
  const option = options.find((entry) => entry.value === raw);
  if (option) return option.label;
  if (raw.startsWith("tag:")) {
    const tag = raw.slice(4);
    return `Tag — ${knownTag(tag)?.label ?? customTagLabel(tag)}`;
  }
  if (raw.startsWith("skill:")) return `Compétence — ${raw.slice(6)}`;
  return `Sélecteur — ${raw}`;
}

export function summarizeDeclaredRules(rules, { selectorOptions = [], parameters = [] } = {}) {
  const options = Array.from(selectorOptions ?? []);
  const sourceParams = Array.from(parameters ?? []);
  return Array.from(rules ?? []).map((rule) => {
    const label = ruleEffect(rule.key)?.label ?? String(rule.key ?? "Règle");
    const value = displayedValue(rule);
    const target = resolveSelector(rule.selector, options, sourceParams);
    const details = [];
    if (rule.rounding) details.push(`Arrondi : ${({ceil:"supérieur",floor:"inférieur",round:"standard"})[rule.rounding] ?? rule.rounding}`);
    if (rule.mode) details.push(`Résultat conservé : ${({best:"meilleur",worst:"pire"})[rule.mode] ?? rule.mode}`);
    // Show only parameters referenced by this rule: don't attach unrelated item parameters to every effect.
    const references = `${rule.selector ?? ""} ${rule.value ?? ""}`;
    for (const entry of sourceParams) {
      const key = String(entry.key ?? "").trim();
      if (!key || !references.includes(`@parameter.${key}`)) continue;
      if (String(rule.selector ?? "").includes(`@parameter.${key}`)) continue; // Already resolved in target.
      details.push(`Paramètre ${key} : ${String(entry.value ?? "").trim() || "non renseigné"}`);
    }
    return { label, value, target, details: details.join(" · ") };
  });
}
