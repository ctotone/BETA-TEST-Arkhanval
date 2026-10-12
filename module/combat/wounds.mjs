const WOUND_ORDER = Object.freeze(["light", "serious", "critical"]);

export const DAMAGE_WOUND_THRESHOLDS = Object.freeze({
  light: Object.freeze({ min: 10, max: 19 }),
  serious: Object.freeze({ min: 20, max: 29 }),
  critical: Object.freeze({ min: 30, max: 39 }),
  mortal: Object.freeze({ min: 40 })
});

export function woundSeverityFromDamage(total) {
  const points = Math.max(0, Math.trunc(Number(total) || 0));
  if (points < DAMAGE_WOUND_THRESHOLDS.light.min) return null;
  if (points >= DAMAGE_WOUND_THRESHOLDS.mortal.min) return "mortal";
  if (points >= DAMAGE_WOUND_THRESHOLDS.critical.min) return "critical";
  if (points >= DAMAGE_WOUND_THRESHOLDS.serious.min) return "serious";
  return "light";
}

function normalizedTrackState(source = {}) {
  return Object.fromEntries(
    WOUND_ORDER.map((severity) => [
      severity,
      Math.max(0, Math.trunc(Number(source?.[severity]) || 0))
    ])
  );
}

function hasUsableCapacity(capacity, severity) {
  const value = Number(capacity?.[severity]);
  return Number.isFinite(value) && value > 0;
}

export function resolveDamageWound(total, {
  counts = {},
  capacity = {}
} = {}) {
  const points = Math.max(0, Math.trunc(Number(total) || 0));
  const baseSeverity = woundSeverityFromDamage(points);
  const normalizedCounts = normalizedTrackState(counts);
  const normalizedCapacity = normalizedTrackState(capacity);

  if (!baseSeverity) {
    return {
      kind: "none",
      points,
      baseSeverity: null,
      severity: null,
      filled: [],
      counts: normalizedCounts,
      capacity: normalizedCapacity
    };
  }

  if (baseSeverity === "mortal") {
    return {
      kind: "mortal",
      points,
      baseSeverity: "mortal",
      severity: null,
      filled: [],
      counts: normalizedCounts,
      capacity: normalizedCapacity
    };
  }

  let severity = baseSeverity;
  const filled = [];

  while (severity) {
    const index = WOUND_ORDER.indexOf(severity);
    const trackIsFull = hasUsableCapacity(capacity, severity)
      && normalizedCounts[severity] >= Number(capacity[severity]);

    if (!trackIsFull) {
      return {
        kind: "wound",
        points,
        baseSeverity,
        severity,
        filled,
        counts: normalizedCounts,
        capacity: normalizedCapacity
      };
    }

    filled.push(severity);
    if (index >= WOUND_ORDER.length - 1) {
      return {
        kind: "mortal",
        points,
        baseSeverity,
        severity: null,
        filled,
        counts: normalizedCounts,
        capacity: normalizedCapacity
      };
    }

    severity = WOUND_ORDER[index + 1];
  }

  return {
    kind: "wound",
    points,
    baseSeverity,
    severity: baseSeverity,
    filled,
    counts: normalizedCounts,
    capacity: normalizedCapacity
  };
}


export function resolveFixedWound(baseSeverity, {
  counts = {},
  capacity = {}
} = {}) {
  const normalizedSeverity = String(baseSeverity ?? "");
  if (!WOUND_ORDER.includes(normalizedSeverity)) {
    throw new Error(`Niveau de blessure fixe invalide : ${normalizedSeverity || "vide"}.`);
  }

  const normalizedCounts = normalizedTrackState(counts);
  const normalizedCapacity = normalizedTrackState(capacity);
  let severity = normalizedSeverity;
  const filled = [];

  while (severity) {
    const index = WOUND_ORDER.indexOf(severity);
    const trackIsFull = hasUsableCapacity(normalizedCapacity, severity)
      && normalizedCounts[severity] >= Number(normalizedCapacity[severity]);

    if (!trackIsFull) {
      return {
        kind: "wound",
        points: null,
        baseSeverity: normalizedSeverity,
        severity,
        filled,
        counts: normalizedCounts,
        capacity: normalizedCapacity
      };
    }

    filled.push(severity);
    if (index >= WOUND_ORDER.length - 1) {
      return {
        kind: "mortal",
        points: null,
        baseSeverity: normalizedSeverity,
        severity: null,
        filled,
        counts: normalizedCounts,
        capacity: normalizedCapacity
      };
    }

    severity = WOUND_ORDER[index + 1];
  }

  return {
    kind: "wound",
    points: null,
    baseSeverity: normalizedSeverity,
    severity: normalizedSeverity,
    filled,
    counts: normalizedCounts,
    capacity: normalizedCapacity
  };
}

export function woundStateMatches(left, right) {
  const leftCounts = normalizedTrackState(left?.counts);
  const rightCounts = normalizedTrackState(right?.counts);
  const leftCapacity = normalizedTrackState(left?.capacity);
  const rightCapacity = normalizedTrackState(right?.capacity);

  return WOUND_ORDER.every((severity) =>
    leftCounts[severity] === rightCounts[severity]
    && leftCapacity[severity] === rightCapacity[severity]
  );
}
