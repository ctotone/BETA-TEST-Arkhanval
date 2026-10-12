import { progressionGainFromQr } from "./resolution/engine.mjs";

function normalizeNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function canMutateWork(actor, work) {
  return Boolean(
    game.user?.isGM
    || work?.isOwner
    || actor?.isOwner
    || actor?.testUserPermission?.(game.user, "OWNER")
  );
}

export function workChatContext(work) {
  if (!work || work.type !== "work") return null;
  return {
    itemId: String(work.id ?? ""),
    itemUuid: String(work.uuid ?? ""),
    workName: String(work.name ?? "Travail"),
    current: normalizeNonNegativeInteger(work.system.progress?.current),
    target: normalizeNonNegativeInteger(work.system.progress?.target)
  };
}

export async function recordWorkProgress(actor, {
  itemId,
  qr,
  contributionId = null
} = {}) {
  if (!actor) throw new Error("Personnage introuvable.");

  const work = actor.items?.get?.(String(itemId ?? "")) ?? null;
  if (!work || work.type !== "work") {
    throw new Error("Travail introuvable sur ce personnage.");
  }
  if (!canMutateWork(actor, work)) {
    throw new Error("Vous n'avez pas l'autorisation de modifier ce travail.");
  }

  // Le marqueur est écrit dans la même mise à jour que la progression métier.
  // Une carte déjà enregistrée renvoie son résultat sans réadditionner le gain.
  const key = String(contributionId ?? "");
  if (key && !/^[a-zA-Z0-9_-]{1,64}$/.test(key)) throw new Error("Identifiant de contribution invalide.");
  const ledger = work.getFlag?.("arkhanval", "progressionContributions")
    ?? work.flags?.arkhanval?.progressionContributions ?? {};
  if (key && ledger[key]) return { ...ledger[key] };

  const gain = progressionGainFromQr(qr);
  const current = normalizeNonNegativeInteger(work.system.progress?.current);
  const target = normalizeNonNegativeInteger(work.system.progress?.target);
  const uncapped = current + gain;
  const nextCurrent = target > 0 ? Math.min(uncapped, target) : uncapped;
  const completed = target > 0 && nextCurrent >= target;
  const status = completed ? "completed" : String(work.system.status ?? "active");

  const result = { itemId: work.id, workName: work.name, gain, current: nextCurrent, target, status, completed };
  await work.update({
    "system.progress.current": nextCurrent,
    "system.status": status,
    ...(key ? { "flags.arkhanval.progressionContributions": { ...ledger, [key]: result } } : {})
  });

  return result;
}
