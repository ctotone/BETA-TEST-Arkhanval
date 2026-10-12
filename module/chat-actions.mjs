// Autorité commune pour les actions de progression issues du Chat.
// Les requêtes contiennent un type connu et des IDs, jamais des modifications de Documents arbitraires.
const CHANNEL = "system.arkhanval";
const TYPE_REQUEST = "progression-action-request";
const TYPE_REPLY = "progression-action-reply";
const handlers = new Map();
const pending = new Map();
let requestSequence = 0;

function authorityFor(message) {
  const gm = Array.from(game.users?.values?.() ?? [])
    .filter(user => user?.active && user?.isGM)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
  if (gm) return gm.id;
  const author = message?.author ?? message?.user ?? null;
  return author?.active ? author.id : null;
}

export function registerChatProgressionAction(type, handler) {
  if (handlers.has(type)) throw new Error(`Action de progression déjà enregistrée : ${type}`);
  handlers.set(type, handler);
}

async function executeAction({ type, messageId, userId, data }) {
  const message = game.messages?.get?.(String(messageId ?? "")) ?? null;
  const requester = game.users?.get?.(String(userId ?? "")) ?? null;
  const handler = handlers.get(String(type ?? ""));
  if (!message || !requester?.active || !handler) throw new Error("Action ou utilisateur de progression indisponible.");
  if (authorityFor(message) !== game.user?.id) throw new Error("Autorité de progression indisponible.");
  return handler({ message, requester, data: data ?? {} });
}

export async function dispatchChatProgressionAction(message, type, data = {}) {
  if (!message?.id) throw new Error("Message Chat introuvable.");
  const authority = authorityFor(message);
  if (!authority) throw new Error("Aucun MJ actif ni auteur disponible pour traiter cette action.");
  const payload = { type, messageId: message.id, userId: game.user.id, data };
  if (authority === game.user.id) return executeAction(payload);
  if (!game.socket?.emit) throw new Error("Connexion au traitement Chat indisponible.");
  const requestId = `${game.user.id}-${Date.now()}-${++requestSequence}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("L’autorité n’a pas répondu. Vérifiez l’état de la carte avant de réessayer."));
    }, 15000);
    pending.set(requestId, { resolve, reject, timeout });
    try { game.socket.emit(CHANNEL, { kind: TYPE_REQUEST, requestId, ...payload }); }
    catch (error) { clearTimeout(timeout); pending.delete(requestId); reject(error); }
  });
}

export function initializeChatProgressionSocket() {
  game.socket?.on?.(CHANNEL, async (payload) => {
    if (!payload || typeof payload !== "object") return;
    if (payload.kind === TYPE_REPLY) {
      if (String(payload.userId) !== game.user?.id) return;
      const entry = pending.get(String(payload.requestId));
      if (!entry) return;
      clearTimeout(entry.timeout);
      pending.delete(String(payload.requestId));
      if (payload.ok) entry.resolve(payload.result);
      else entry.reject(new Error(String(payload.error ?? "Échec de l’action de progression.")));
      return;
    }
    if (payload.kind !== TYPE_REQUEST || !handlers.has(String(payload.type))) return;
    const message = game.messages?.get?.(String(payload.messageId ?? ""));
    if (!message || authorityFor(message) !== game.user?.id) return;
    let result;
    let error;
    try { result = await executeAction(payload); }
    catch (caught) { error = caught; console.error("Arkhanval | Action Chat de progression refusée", caught); }
    game.socket?.emit?.(CHANNEL, {
      kind: TYPE_REPLY,
      requestId: payload.requestId,
      userId: payload.userId,
      ok: !error,
      result: result ?? null,
      error: error?.message ?? null
    });
  });
}

export function userCanProgressActor(user, actor) {
  return Boolean(user?.isGM || (user && actor?.testUserPermission?.(user, "OWNER")));
}
