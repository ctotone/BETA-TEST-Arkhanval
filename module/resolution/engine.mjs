import { showDiceResults } from "../integrations/dice-so-nice.mjs";

const NORMAL_POOL_LIMIT = 5;
const MAX_OPEN_ROLLS_PER_DIE = 100;

function toInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function clampInteger(value, minimum, maximum, fallback = minimum) {
  return Math.min(maximum, Math.max(minimum, toInteger(value, fallback)));
}

function normalizeMode(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeExtraDice(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((faces) => Number(faces))
    .filter((faces) => Number.isInteger(faces) && [6, 8, 10, 12].includes(faces))
    .slice(0, 20);
}

function removeDice(pool, count) {
  const next = [...pool];
  let remaining = Math.abs(count);

  // A generic die penalty removes ordinary d10 first, then substituted d12,
  // and only then d8 created by a coupled-skill gap. The exact resulting pool
  // is retained in the resolution plan and shown before the roll.
  for (const faces of [10, 12, 8]) {
    while (remaining > 0) {
      const index = next.lastIndexOf(faces);
      if (index < 0) break;
      next.splice(index, 1);
      remaining -= 1;
    }
  }

  return next;
}

function applyDiceModifier(pool, modifier) {
  const amount = toInteger(modifier, 0);
  if (amount === 0) return [...pool];
  if (amount > 0) return [...pool, ...Array.from({ length: amount }, () => 10)];
  return removeDice(pool, amount);
}

function applyDiceMultipliers(pool, modifiers = []) {
  let next = [...pool];

  for (const modifier of Array.from(modifiers ?? [])) {
    const multiplier = Number(modifier?.multiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0) continue;

    const rawCount = next.length * multiplier;
    const rounding = normalizeMode(
      modifier?.rounding,
      ["ceil", "floor", "round"],
      "round"
    );
    const count = Math[rounding](rawCount);
    next = next.slice(0, Math.max(0, count));
  }

  return next;
}

function applyD12Substitutions(pool, requested) {
  const next = [...pool];
  const d10Indexes = next
    .map((faces, index) => faces === 10 ? index : -1)
    .filter((index) => index >= 0);

  const substitutions = clampInteger(requested, 0, d10Indexes.length, 0);
  for (const index of d10Indexes.slice(0, substitutions)) next[index] = 12;
  return {
    pool: next,
    substitutions,
    available: d10Indexes.length
  };
}

function basePoolForRanks(primaryRank, secondaryRank = null, poolLimit = NORMAL_POOL_LIMIT) {
  const rank = Math.max(0, toInteger(primaryRank, 0));
  const limit = Math.max(1, toInteger(poolLimit, NORMAL_POOL_LIMIT));

  if (secondaryRank === null || secondaryRank === undefined) {
    if (rank === 0) return { pool: [8], effectiveRank: 0, rankDifference: 0 };
    return {
      pool: Array.from({ length: Math.min(rank, limit) }, () => 10),
      effectiveRank: rank,
      rankDifference: 0
    };
  }

  const second = Math.max(0, toInteger(secondaryRank, 0));
  if (rank === 0 || second === 0) {
    throw new Error("Une action associant deux compétences exige deux rangs supérieurs à 0.");
  }

  const effectiveRank = Math.max(rank, second);
  const count = Math.min(effectiveRank, limit);
  const difference = Math.abs(rank - second);
  const d8Count = Math.min(difference, count);
  const d10Count = count - d8Count;

  return {
    pool: [
      ...Array.from({ length: d10Count }, () => 10),
      ...Array.from({ length: d8Count }, () => 8)
    ],
    effectiveRank,
    rankDifference: difference
  };
}

function buildChainLabel(chain) {
  return chain.rolls
    .map((roll) => `d${roll.faces}:${roll.natural}`)
    .join(" → ");
}

export function describePool(pool) {
  const counts = new Map();
  for (const faces of pool) counts.set(faces, (counts.get(faces) ?? 0) + 1);
  return [12, 10, 8, 6]
    .filter((faces) => counts.has(faces))
    .map((faces) => `${counts.get(faces)}d${faces}`)
    .join(" + ") || "aucun dé";
}

/**
 * Build the complete, immutable pre-roll plan.
 *
 * Only explicit request data are used. Specialty/people rules[] are not
 * interpreted here: callers can translate a validated effect into one
 * of these generic modifiers without giving rules[] a universal semantics.
 */
export function buildResolutionPlan(request = {}) {
  const primaryRank = Math.max(0, toInteger(request.primaryRank, 0));
  const hasSecondary = request.secondaryRank !== null && request.secondaryRank !== undefined;
  const secondaryRank = hasSecondary
    ? Math.max(0, toInteger(request.secondaryRank, 0))
    : null;

  const poolLimit = clampInteger(
    request.poolLimit,
    1,
    20,
    NORMAL_POOL_LIMIT
  );
  const rankBenefitsEnabled = request.rankBenefitsEnabled !== false;
  const base = basePoolForRanks(primaryRank, secondaryRank, poolLimit);
  const diceMultipliers = Array.from(request.diceMultipliers ?? []).map((entry) => ({
    multiplier: Number(entry?.multiplier),
    rounding: normalizeMode(entry?.rounding, ["ceil", "floor", "round"], "round")
  }));
  const multipliedBasePool = applyDiceMultipliers(base.pool, diceMultipliers);
  const extraDice = normalizeExtraDice(request.extraDice);
  const withExtraDice = [...multipliedBasePool, ...extraDice];
  const withDiceModifier = applyDiceModifier(withExtraDice, request.diceModifier);
  if (withDiceModifier.length === 0) {
    throw new Error("Les modificateurs de dés ne peuvent pas réduire le pool à zéro.");
  }

  const substituted = applyD12Substitutions(
    withDiceModifier,
    request.d12Substitutions
  );

  const baseFd = clampInteger(request.fd, 0, 20, 6);
  const fdModifier = toInteger(request.fdModifier, 0);
  const rankFdModifier = rankBenefitsEnabled && base.effectiveRank >= 6 ? -1 : 0;
  const effectiveFd = Math.min(20, Math.max(0, baseFd + fdModifier + rankFdModifier));

  const criticalFailureThreshold = clampInteger(
    request.criticalFailureThreshold,
    1,
    3,
    1
  );

  const ignoredCriticalFailures = Math.max(
    0,
    toInteger(request.ignoredCriticalFailures, 0)
  );

  const chainMode = normalizeMode(
    request.chainMode,
    ["successes", "cumulative"],
    "successes"
  );

  const cumulativeTarget = chainMode === "cumulative"
    ? clampInteger(request.cumulativeTarget, 11, 99, 11)
    : null;

  const legacyDoubleRoll = normalizeMode(
    request.doubleRoll,
    ["none", "best", "worst"],
    "none"
  );
  const requestedRepeatMode = normalizeMode(
    request.repeatKeepMode,
    ["none", "best", "worst"],
    "none"
  );
  const repeatKeepMode = requestedRepeatMode !== "none"
    ? requestedRepeatMode
    : legacyDoubleRoll;
  const repeatCount = repeatKeepMode === "none"
    ? 1
    : clampInteger(request.repeatCount, 2, 5, 2);
  const autoSuccess = request.autoSuccess === true;

  const rollSource = request.rollSource && typeof request.rollSource === "object"
    ? Object.freeze({
        sourceType: String(request.rollSource.sourceType ?? "skill"),
        key: String(request.rollSource.key ?? ""),
        name: String(request.rollSource.name ?? request.skillName ?? ""),
        identifier: String(request.rollSource.identifier ?? request.skillIdentifier ?? ""),
        archetype: String(request.rollSource.archetype ?? ""),
        rank: Math.max(0, toInteger(request.rollSource.rank, primaryRank)),
        xp: Math.max(0, toInteger(request.rollSource.xp, 0)),
        itemId: String(request.rollSource.itemId ?? ""),
        arkId: String(request.rollSource.arkId ?? "")
      })
    : null;

  return Object.freeze({
    skillName: String(request.skillName ?? "").trim(),
    skillIdentifier: String(request.skillIdentifier ?? "").trim(),
    rollSource,
    secondarySkillName: String(request.secondarySkillName ?? "").trim(),
    secondarySkillIdentifier: String(request.secondarySkillIdentifier ?? "").trim(),
    primaryRank,
    secondaryRank,
    effectiveRank: base.effectiveRank,
    rankDifference: base.rankDifference,
    basePool: Object.freeze([...base.pool]),
    multipliedBasePool: Object.freeze([...multipliedBasePool]),
    diceMultipliers: Object.freeze(diceMultipliers.map((entry) => Object.freeze({ ...entry }))),
    pool: Object.freeze([...substituted.pool]),
    poolLabel: describePool(substituted.pool),
    extraDice: Object.freeze([...extraDice]),
    specialtyNotes: Object.freeze(
      Array.from(request.specialtyNotes ?? []).map((entry) => String(entry))
    ),
    diceModifier: toInteger(request.diceModifier, 0),
    d12Substitutions: substituted.substitutions,
    availableD10ForSubstitution: substituted.available,
    fd: baseFd,
    fdModifier,
    rankFdModifier,
    effectiveFd,
    resultModifier: toInteger(request.resultModifier, 0),
    criticalFailureThreshold,
    ignoredCriticalFailures,
    suppressCriticalFailures: rankBenefitsEnabled && base.effectiveRank >= 7,
    rank8OpenNines: rankBenefitsEnabled && base.effectiveRank >= 8,
    rankBenefitsEnabled,
    poolLimit,
    chainMode,
    cumulativeTarget,
    repeatCount,
    repeatKeepMode,
    // Legacy alias retained for existing UI/tests.
    doubleRoll: repeatKeepMode,
    autoSuccess
  });
}

function isOpenResult({ faces, natural, plan }) {
  if (faces === 8) return false;

  if (faces === 12) {
    if (natural >= 10) return true;
    return plan.rank8OpenNines && natural === 9;
  }

  if (faces === 10) {
    if (natural === 10) return true;
    return plan.rank8OpenNines && natural === 9;
  }

  return false;
}

function isExperienceTrigger({ faces, natural }) {
  if (faces === 12) return natural >= 10 && natural <= 12;
  if (faces === 10) return natural === 10;
  return false;
}

function isInitialCriticalFailure({ natural, plan }) {
  if (plan.suppressCriticalFailures) return false;

  // Critical-failure threshold is an interpretation rule applied to the
  // natural result of an initial action die. It must not depend on the die
  // composition that produced that result (d8, d10, d12, etc.).
  return natural >= 1 && natural <= plan.criticalFailureThreshold;
}

async function foundryRoller(faces) {
  const RollClass = globalThis.foundry?.dice?.Roll ?? globalThis.Roll;
  if (!RollClass) throw new Error("API Roll de Foundry indisponible.");

  const roll = await new RollClass(`1d${faces}`).evaluate();
  return Number(roll.total);
}

async function rollChain(initialFaces, plan, roller) {
  const rolls = [];
  let faces = initialFaces;
  let index = 0;

  while (index < MAX_OPEN_ROLLS_PER_DIE) {
    const natural = Number(await roller(faces));
    if (!Number.isInteger(natural) || natural < 1 || natural > faces) {
      throw new Error(`Résultat de dé invalide pour 1d${faces}: ${natural}`);
    }

    const reroll = index > 0;
    const modified = natural + plan.resultModifier;
    const open = isOpenResult({ faces, natural, plan });
    const experienceTrigger = isExperienceTrigger({ faces, natural });
    const criticalFailure = !reroll && isInitialCriticalFailure({
      faces,
      natural,
      plan
    });

    rolls.push({
      index,
      faces,
      natural,
      modified,
      reroll,
      open,
      criticalFailure,
      experienceTrigger
    });

    if (!open) break;

    // Every open reroll is a d10, including an open d12.
    faces = 10;
    index += 1;
  }

  if (rolls.at(-1)?.open) {
    throw new Error("Chaîne de dés ouverts interrompue par la limite de sécurité.");
  }

  return {
    initialFaces,
    rolls,
    label: buildChainLabel({ rolls })
  };
}

function scoreChains(chains, plan) {
  let successes = 0;

  if (plan.chainMode === "successes") {
    for (const chain of chains) {
      for (const roll of chain.rolls) {
        if (roll.modified >= plan.effectiveFd) successes += 1;
      }
    }
  } else {
    for (const chain of chains) {
      const total = chain.rolls.reduce((sum, roll) => sum + roll.modified, 0);
      chain.cumulativeTotal = total;
      chain.cumulativeSuccess = total >= plan.cumulativeTarget;
      if (chain.cumulativeSuccess) successes += 1;
    }
  }

  const rawCriticalFailures = chains.reduce(
    (sum, chain) => sum + chain.rolls.filter((roll) => roll.criticalFailure).length,
    0
  );

  const ignoredCriticalFailures = Math.min(
    rawCriticalFailures,
    plan.ignoredCriticalFailures
  );

  const criticalFailures = plan.suppressCriticalFailures
    ? 0
    : Math.max(0, rawCriticalFailures - ignoredCriticalFailures);

  const qr = successes - criticalFailures;

  const experienceTriggers = [];
  for (const chain of chains) {
    for (const roll of chain.rolls) {
      if (roll.experienceTrigger) {
        experienceTriggers.push({
          faces: roll.faces,
          natural: roll.natural,
          reroll: roll.reroll
        });
      }
    }
  }

  // Project rule: experience eligibility uses
  // the effective FD after all deterministic FD modifiers, including rank 6+.
  const experienceEligible = plan.effectiveFd >= 7 && experienceTriggers.length > 0;

  return {
    successes,
    rawCriticalFailures,
    ignoredCriticalFailures,
    criticalFailures,
    qr,
    experienceEligible,
    experienceTriggers
  };
}

export async function resolveAttempt(plan, { roller = foundryRoller } = {}) {
  const chains = [];
  for (const faces of plan.pool) {
    chains.push(await rollChain(faces, plan, roller));
  }

  const score = scoreChains(chains, plan);

  return {
    chains,
    initialDice: chains.map((chain) => ({
      faces: chain.initialFaces,
      natural: chain.rolls[0]?.natural ?? null
    })),
    rerolls: chains.flatMap((chain, chainIndex) =>
      chain.rolls
        .filter((roll) => roll.reroll)
        .map((roll) => ({
          chainIndex,
          faces: roll.faces,
          natural: roll.natural
        }))
    ),
    ...score
  };
}

function selectAttempt(attempts, mode) {
  if (attempts.length === 1 || mode === "none") {
    return { selectedAttemptIndex: 0, comparisonTie: false };
  }

  const scores = attempts.map((attempt) => Number(attempt?.qr) || 0);
  const target = mode === "best" ? Math.max(...scores) : Math.min(...scores);
  const matching = scores
    .map((score, index) => score === target ? index : -1)
    .filter((index) => index >= 0);

  // Arkhanval defines best/worst through QR but no secondary tie-breaker.
  if (matching.length !== 1) {
    return { selectedAttemptIndex: null, comparisonTie: true };
  }

  return { selectedAttemptIndex: matching[0], comparisonTie: false };
}

export function rescoreResolvedRollWithFdModifier(result, fdModifier = 0) {
  const modifier = toInteger(fdModifier, 0);
  if (!result?.plan || modifier === 0) return result;

  const plan = Object.freeze({
    ...result.plan,
    fdModifier: toInteger(result.plan.fdModifier, 0) + modifier,
    effectiveFd: Math.min(20, Math.max(0, toInteger(result.plan.effectiveFd, 0) + modifier))
  });

  const attempts = Array.from(result.attempts ?? []).map((attempt) => {
    if (attempt?.autoSuccess) return { ...attempt };

    const chains = Array.from(attempt?.chains ?? []).map((chain) => ({
      ...chain,
      rolls: Array.from(chain?.rolls ?? []).map((roll) => ({ ...roll }))
    }));
    const score = scoreChains(chains, plan);

    return {
      ...attempt,
      chains,
      ...score
    };
  });

  const selection = selectAttempt(attempts, plan.repeatKeepMode);
  const selectedAttempt = selection.selectedAttemptIndex === null
    ? null
    : attempts[selection.selectedAttemptIndex];

  return {
    ...result,
    plan,
    attempts,
    ...selection,
    selectedAttempt,
    qr: selectedAttempt?.qr ?? (selection.comparisonTie ? attempts[0]?.qr ?? null : null),
    experienceEligible: selectedAttempt?.experienceEligible ?? null
  };
}

export async function resolveRoll(request, options = {}) {
  const plan = buildResolutionPlan(request);

  if (plan.autoSuccess) {
    const automaticAttempt = {
      autoSuccess: true,
      chains: [],
      initialDice: [],
      rerolls: [],
      successes: 1,
      rawCriticalFailures: 0,
      ignoredCriticalFailures: 0,
      criticalFailures: 0,
      qr: 1,
      experienceEligible: false,
      experienceTriggers: []
    };
    return {
      plan,
      attempts: [automaticAttempt],
      selectedAttemptIndex: 0,
      comparisonTie: false,
      selectedAttempt: automaticAttempt,
      qr: 1,
      experienceEligible: false,
      autoSuccess: true
    };
  }

  const count = plan.repeatCount;
  const attempts = [];

  for (let index = 0; index < count; index += 1) {
    attempts.push(await resolveAttempt(plan, options));
  }

  // Only the real default Foundry roller may be broadcast: injected rollers
  // belong to deterministic tests and must not create imaginary 3D dice.
  if (!options.roller || options.roller === foundryRoller) {
    const dice = attempts.flatMap(attempt => (attempt?.chains ?? []).flatMap(chain =>
      (chain?.rolls ?? []).map(die => ({ faces: die.faces, result: die.natural }))
    ));
    // The QR may not have been published yet (combat/magic anti-spoil):
    // never broadcast raw dice prematurely to other player clients.
    await showDiceResults(dice, { publicRoll: false });
  }

  const selection = selectAttempt(attempts, plan.repeatKeepMode);
  const selectedAttempt = selection.selectedAttemptIndex === null
    ? null
    : attempts[selection.selectedAttemptIndex];

  return {
    plan,
    attempts,
    ...selection,
    selectedAttempt,
    qr: selectedAttempt?.qr ?? (selection.comparisonTie ? attempts[0]?.qr ?? null : null),
    experienceEligible: selectedAttempt?.experienceEligible ?? null
  };
}


/**
 * Reroll up to two selected initial d10 chains from one resolved attempt.
 * If only one initial d10 exists, spending one Ark circle rerolls that single d10.
 *
 * The selected chains are replaced completely, including any open-die chain.
 * The whole attempt is then rescored with the original immutable plan.
 */
export async function rerollSelectedD10(
  result,
  chainIndices,
  { attemptIndex = null, roller = foundryRoller } = {}
) {
  const indices = Array.from(new Set(
    Array.from(chainIndices ?? []).map((value) => toInteger(value, -1))
  ));

  const targetAttemptIndex = attemptIndex === null || attemptIndex === undefined
    ? result.selectedAttemptIndex
    : toInteger(attemptIndex, -1);

  if (!Number.isInteger(targetAttemptIndex) || targetAttemptIndex < 0) {
    throw new Error("Aucune tentative retenue n’est disponible pour la relance.");
  }

  const originalAttempt = result.attempts?.[targetAttemptIndex];
  if (!originalAttempt) throw new Error("Tentative de jet introuvable.");

  const availableD10Count = (originalAttempt.chains ?? [])
    .filter((chain) => chain.initialFaces === 10)
    .length;
  const maximumCount = Math.min(2, availableD10Count);
  if (maximumCount < 1 || indices.length < 1 || indices.length > maximumCount) {
    throw new Error(`La dépense d’un cercle d’Ark permet de relancer 1 ou ${maximumCount}d10.`);
  }

  for (const index of indices) {
    const chain = originalAttempt.chains?.[index];
    if (!chain || chain.initialFaces !== 10) {
      throw new Error("La relance d’Ark ne peut cibler que des d10 initiaux.");
    }
  }

  const chains = [...originalAttempt.chains];
  const newChains = [];
  for (const index of indices) {
    chains[index] = await rollChain(10, result.plan, roller);
    newChains.push(chains[index]);
  }
  if (roller === foundryRoller) {
    // The candidate is not public until the player chooses which result to keep.
    await showDiceResults(newChains.flatMap(chain => (chain.rolls ?? []).map(die => ({
      faces: die.faces, result: die.natural
    }))), { publicRoll: false });
  }

  const rescored = scoreChains(chains, result.plan);
  const replacement = {
    chains,
    initialDice: chains.map((chain) => ({
      faces: chain.initialFaces,
      natural: chain.rolls[0]?.natural ?? null
    })),
    rerolls: chains.flatMap((chain, chainIndex) =>
      chain.rolls
        .filter((roll) => roll.reroll)
        .map((roll) => ({
          chainIndex,
          faces: roll.faces,
          natural: roll.natural
        }))
    ),
    ...rescored
  };

  const attempts = [...result.attempts];
  attempts[targetAttemptIndex] = replacement;
  const selection = selectAttempt(attempts, result.plan.repeatKeepMode);
  const selectedAttempt = selection.selectedAttemptIndex === null
    ? null
    : attempts[selection.selectedAttemptIndex];

  return {
    plan: result.plan,
    attempts,
    ...selection,
    selectedAttempt,
    qr: selectedAttempt?.qr ?? (selection.comparisonTie ? attempts[0]?.qr ?? null : null),
    experienceEligible: selectedAttempt?.experienceEligible ?? null,
    arkReroll: {
      attemptIndex: targetAttemptIndex,
      chainIndices: indices
    }
  };
}

/**
 * Return the progression gained by a progressive-task roll.
 *
 * This system intentionally does not persist or track a task total. The player
 * and GM keep the running total outside the system; Arkhanval only reports the
 * positive contribution of the selected roll.
 */
export function progressionGainFromQr(qr = 0) {
  return Math.max(0, toInteger(qr, 0));
}

export const RESOLUTION_LIMITS = Object.freeze({
  NORMAL_POOL_LIMIT,
  MAX_OPEN_ROLLS_PER_DIE
});
