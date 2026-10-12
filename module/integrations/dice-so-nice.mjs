/**
 * Arkhanval / Dice So Nice — optional integration (Foundry v14).
 * Animate already evaluated values only. Never evaluate another Roll or create a
 * ChatMessage: the Arkhanval engine remains the sole authority for results.
 * The "private" mode is local to the initiating browser (no socket broadcast).
 */
// The custom notation uses the DSN v6 `throws[].dice[]` schema. For d100,
// use showForRoll on the actual evaluated Foundry Roll (two percentile dice).
const SUPPORTED_FACES = new Set([4, 6, 8, 10, 12, 20]);

function dice3d() {
  const game = globalThis.game;
  if (!game?.modules?.get?.("dice-so-nice")?.active) return null;
  return game.dice3d ?? null;
}

function recipients(publicRoll) {
  // Keep this explicitly local for private effects/GM staging.
  return publicRoll ? [] : [String(globalThis.game?.user?.id ?? "")].filter(Boolean);
}

/** A best-effort animation: never affect game logic when an addon fails. */
async function safeAnimate(call) {
  try {
    return Boolean(await call());
  } catch (error) {
    console.warn("Arkhanval | Animation Dice So Nice indisponible", error);
    return false;
  }
}

/** Send a real evaluated Foundry Roll to DSN, without rolling it again. */
export async function showEvaluatedRoll(roll, { publicRoll = true } = {}) {
  const api = dice3d();
  if (!roll?.evaluated && !roll?._evaluated) return false;
  if (!api || typeof api.showForRoll !== "function") return false;
  return safeAnimate(() => api.showForRoll(
    roll, globalThis.game.user, Boolean(publicRoll), recipients(publicRoll), false
  ));
}

/** Aggregate pre-evaluated die results into a single DSN animation. */
export async function showDiceResults(dice, { publicRoll = true } = {}) {
  const api = dice3d();
  if (!api || typeof api.show !== "function") return false;
  const entries = Array.from(dice ?? []).filter(die =>
    SUPPORTED_FACES.has(Number(die?.faces)) &&
    Number.isInteger(Number(die?.result)) &&
    Number(die.result) >= 1 && Number(die.result) <= Number(die.faces)
  );
  if (!entries.length) return false;
  // DSN v6 no longer expects the historical {formula, results} shortcut here.
  // Its public `show` API receives fully prepared notation, never a new Roll.
  const data = {
    throws: [{
      dice: entries.map(die => ({
        type: `d${Number(die.faces)}`,
        result: Number(die.result),
        resultLabel: Number(die.result),
        vectors: [],
        options: {}
      }))
    }]
  };
  return safeAnimate(() => api.show(
    data, globalThis.game.user, Boolean(publicRoll), recipients(publicRoll), false
  ));
}

/** Capture all physical dice in already evaluated Roll objects (explosions included). */
export async function showEvaluatedDiceBatch(rolls, { publicRoll = true } = {}) {
  const dice = [];
  for (const roll of rolls ?? []) {
    for (const die of roll?.dice ?? []) {
      const faces = Number(die?.faces);
      for (const value of die?.results ?? []) {
        // An inactive result may still represent a physical die (e.g. open d10).
        if (Number.isInteger(Number(value?.result))) {
          dice.push({ faces, result: Number(value.result) });
        }
      }
    }
  }
  return showDiceResults(dice, { publicRoll });
}
