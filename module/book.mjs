import { progressionGainFromQr } from "./resolution/engine.mjs";

function normalizeNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function canMutateBook(actor, book) {
  return Boolean(
    game.user?.isGM
    || book?.isOwner
    || actor?.isOwner
    || actor?.testUserPermission?.(game.user, "OWNER")
  );
}

export function bookChatContext(book) {
  if (!book || book.type !== "book") return null;
  return {
    itemId: String(book.id ?? ""),
    itemUuid: String(book.uuid ?? ""),
    bookName: String(book.name ?? "Livre"),
    current: normalizeNonNegativeInteger(book.system.reading?.progress),
    target: normalizeNonNegativeInteger(book.system.reading?.required)
  };
}

export async function recordBookProgress(actor, {
  itemId,
  qr,
  contributionId = null
} = {}) {
  if (!actor) throw new Error("Personnage introuvable.");

  const book = actor.items?.get?.(String(itemId ?? "")) ?? null;
  if (!book || book.type !== "book") {
    throw new Error("Livre introuvable sur ce personnage.");
  }
  if (!canMutateBook(actor, book)) {
    throw new Error("Vous n'avez pas l'autorisation de modifier ce livre.");
  }

  // Le marqueur est écrit dans la même mise à jour que la progression métier.
  // Une carte déjà enregistrée renvoie son résultat sans réadditionner le gain.
  const key = String(contributionId ?? "");
  if (key && !/^[a-zA-Z0-9_-]{1,64}$/.test(key)) throw new Error("Identifiant de contribution invalide.");
  const ledger = book.getFlag?.("arkhanval", "progressionContributions")
    ?? book.flags?.arkhanval?.progressionContributions ?? {};
  if (key && ledger[key]) return { ...ledger[key] };

  const gain = progressionGainFromQr(qr);
  const current = normalizeNonNegativeInteger(book.system.reading?.progress);
  const target = normalizeNonNegativeInteger(book.system.reading?.required);
  const uncapped = current + gain;
  const nextProgress = target > 0 ? Math.min(uncapped, target) : uncapped;
  const completed = target > 0 && nextProgress >= target;

  const result = { itemId: book.id, bookName: book.name, gain, progress: nextProgress, target, completed };
  await book.update({
    "system.reading.progress": nextProgress,
    "system.reading.completed": completed,
    ...(key ? { "flags.arkhanval.progressionContributions": { ...ledger, [key]: result } } : {})
  });

  return result;
}
