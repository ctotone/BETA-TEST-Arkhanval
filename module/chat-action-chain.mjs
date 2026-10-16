/** Repère de filiation strictement explicite des messages Arkhanval. */
export const ACTION_CHAIN_COLORS = Object.freeze([
  "#3D8FB7", "#B76D43", "#78934B", "#9471AD", "#C09036", "#548C84",
  "#BA687B", "#667FAD", "#A17A52", "#6D9E70", "#AB679D", "#688EAA"
]);

function getSourceId(flags = {}) {
  const ark = flags.arkhanval ?? {};
  return String(
    ark.actionChainParentMessageId
    || ark.arkTableResult?.reminderMessageId
    || ark.experienceGain?.sourceMessageId
    || ark.damage?.resolution?.sourceCombatMessageId
    || ark.damage?.resolution?.sourceDamageMessageId
    || ark.damage?.resolution?.sourceSecondaryMessageId
    || ark.secondaryEffect?.sourceDamageMessageId
    || ark.secondaryEffect?.sourceCombatMessageId
    || ark.secondaryEffectPrivate?.sourceDamageMessageId
    || ark.secondaryEffectPrivate?.sourceCombatMessageId
    || ark.concentration?.sourceDamageMessageId
    || ""
  );
}

/** Une même session d'incantation est une filiation explicite, pas une inférence temporelle.
 * Le speaker Actor doit aussi coïncider pour éviter de confondre deux sessions
 * provenant d'Actors différents (notamment les tokens non liés).
 */
function sessionSource(message, data, ark) {
  const sessionId = String(ark.incantation?.sessionId || ark.spellResolution?.sessionId || "");
  const actorId = String(data?.speaker?.actor || message?._source?.speaker?.actor || "");
  if (!sessionId || !actorId) return null;
  const messages = Array.from(game?.messages?.contents ?? []);
  return messages.reverse().find(candidate => {
    const speaker = candidate?.speaker ?? candidate?._source?.speaker;
    if (String(speaker?.actor ?? "") !== actorId) return false;
    const incantation = candidate?.getFlag?.("arkhanval", "incantation");
    const spellResolution = candidate?.getFlag?.("arkhanval", "spellResolution");
    const existingSession = String(incantation?.sessionId || spellResolution?.sessionId || "");
    return existingSession === sessionId && Boolean(candidate?.getFlag?.("arkhanval", "actionChain")?.id);
  }) ?? null;
}

function newColor() {
  const recent = Array.from(game?.messages?.contents ?? []).slice(-10)
    .map(m => m.getFlag?.("arkhanval", "actionChain")?.color)
    .filter(Boolean);
  const choices = ACTION_CHAIN_COLORS.filter(c => !recent.includes(c));
  const palette = choices.length ? choices : ACTION_CHAIN_COLORS.filter(c => c !== recent.at(-1));
  return palette[Math.floor(Math.random() * palette.length)];
}

/** Pré-création : ne concerne que les messages explicitement flaggés Arkhanval. */
export function prepareArkhanvalActionChain(message, data) {
  const flags = data?.flags ?? message?._source?.flags ?? {};
  const ark = flags?.arkhanval;
  if (!ark || !Object.keys(ark).length || ark.actionChain) return;
  const sourceId = getSourceId(flags);
  const parent = sourceId ? game?.messages?.get?.(sourceId) : sessionSource(message, data, ark);
  const parentId = String(parent?.id ?? (sourceId && parent ? sourceId : ""));
  const inherited = parent?.getFlag?.("arkhanval", "actionChain") ?? null;
  const chain = inherited?.id && ACTION_CHAIN_COLORS.includes(inherited?.color)
    ? { id: inherited.id, color: inherited.color, parentMessageId: parentId }
    : {
        id: foundry?.utils?.randomID?.() ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        color: newColor(),
        parentMessageId: ""
      };
  message.updateSource({ "flags.arkhanval.actionChain": chain });
}

/** Pas de changement des contenus HTML ou des dimensions des cartes. */
export function renderArkhanvalActionChain(message, html) {
  const chain = message?.getFlag?.("arkhanval", "actionChain");
  if (!chain?.id || !ACTION_CHAIN_COLORS.includes(chain.color)) return;
  const root = html?.matches?.(".chat-message") ? html : html?.closest?.(".chat-message")
    ?? html?.querySelector?.(".chat-message");
  if (!root?.style) return;
  root.style.setProperty("--arkhanval-action-chain-color", chain.color);
  root.classList.add("arkhanval-action-chain-message");
}
