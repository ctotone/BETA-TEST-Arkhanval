/**
 * Helpers for persisted specialty parameters.
 *
 * New specialties use system.parameters[]. Legacy system.parameter stays
 * readable as a fallback so existing Items do not need a destructive migration.
 */

function normalizedEntry(entry) {
  const key = String(entry?.key ?? "").trim();
  const value = String(entry?.value ?? "").trim();
  return key && value ? { key, value } : null;
}

export function specialtyParameterEntries(specialty) {
  const modern = Array.from(specialty?.system?.parameters ?? [])
    .map(normalizedEntry)
    .filter(Boolean);

  if (modern.length) return modern;

  const legacy = normalizedEntry(specialty?.system?.parameter);
  return legacy ? [legacy] : [];
}

export function specialtyParameterValues(specialty, key) {
  const wanted = String(key ?? "").trim();
  if (!wanted) return [];
  return specialtyParameterEntries(specialty)
    .filter((entry) => entry.key === wanted)
    .map((entry) => entry.value);
}

export function specialtyParameterValue(specialty, key) {
  return specialtyParameterValues(specialty, key)[0] ?? "";
}
