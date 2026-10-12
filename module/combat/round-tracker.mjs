const ROUND_FLAG_SCOPE = "arkhanval";
const ROUND_REMINDERS_FLAG = "roundReminders";
const processingCombats = new Set();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function activeRoundAuthorityId() {
  const activeGms = Array.from(game.users ?? [])
    .filter((user) => user?.active && user?.isGM)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return String(activeGms[0]?.id ?? "");
}

function isRoundAuthority() {
  const authorityId = activeRoundAuthorityId();
  return Boolean(authorityId && String(game.user?.id ?? "") === authorityId);
}

function combatActors(combat) {
  const seen = new Set();
  const rows = [];
  for (const combatant of Array.from(combat?.combatants ?? [])) {
    const actor = combatant?.actor ?? null;
    if (!actor) continue;
    const key = String(actor.uuid ?? actor.id ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(actor);
  }
  return rows;
}

function roundTrackedActors(combat) {
  const combatId = String(combat?.id ?? "");
  const rows = combatActors(combat);
  const seen = new Set(rows.map((actor) => String(actor?.uuid ?? actor?.id ?? "")).filter(Boolean));
  if (!combatId) return rows;

  for (const actor of Array.from(game.actors ?? [])) {
    const key = String(actor?.uuid ?? actor?.id ?? "");
    if (!key || seen.has(key)) continue;
    const followsThisCombat = ownedStates(actor).some((item) => String(tracking(item)?.combatId ?? "") === combatId);
    if (!followsThisCombat) continue;
    seen.add(key);
    rows.push(actor);
  }

  return rows;
}

function ownedStates(actor) {
  return Array.from(actor?.items ?? []).filter((item) => item?.type === "state");
}

function tracking(item) {
  return item?.system?.tracking ?? {};
}

function actorMatchesReminder(actor, reminder) {
  if (!actor || !reminder) return false;
  const wantedUuid = String(reminder?.targetActorUuid ?? "");
  const wantedId = String(reminder?.targetActorId ?? "");
  return Boolean(
    (wantedUuid && String(actor.uuid ?? "") === wantedUuid)
    || (wantedId && String(actor.id ?? "") === wantedId)
  );
}

function delayedReminderIsStillValid(combat, reminder) {
  if (!combat || !reminder) return false;

  const sourceMessageId = String(reminder?.sourceMessageId ?? "");
  if (sourceMessageId && !game.messages?.get?.(sourceMessageId)) return false;

  const sourcePublicMessageId = String(reminder?.sourcePublicMessageId ?? "");
  if (sourcePublicMessageId && !game.messages?.get?.(sourcePublicMessageId)) return false;

  const hasTargetRef = Boolean(reminder?.targetActorUuid || reminder?.targetActorId);
  if (hasTargetRef) {
    const targetExists = roundTrackedActors(combat).some((actor) => actorMatchesReminder(actor, reminder))
      || Boolean(reminder?.targetActorId && game.actors?.get?.(String(reminder.targetActorId)));
    if (!targetExists) return false;
  }

  return true;
}

function buildRoundCard(round, { expired = [], reminders = [], delayed = [] } = {}) {
  const expiredHtml = expired.length
    ? `
      <section class="arkhanval-notice-card__panel">
        <h4>États arrivés à expiration</h4>
        <ul>${expired.map((entry) => `<li><strong>${escapeHtml(entry.actorName)}</strong> — ${escapeHtml(entry.stateName)}</li>`).join("")}</ul>
      </section>
    `
    : "";
  const reminderHtml = reminders.length
    ? `
      <section class="arkhanval-notice-card__panel">
        <h4>Effets à suivre</h4>
        <ul>${reminders.map((entry) => `
          <li>
            <strong>${escapeHtml(entry.actorName)}</strong> — ${escapeHtml(entry.stateName)}
            ${entry.key === "hemorrhage"
              ? `<br><small>→ appliquer 1 Blessure légère<br>→ une action de moins ce round</small>`
              : ""}
          </li>
        `).join("")}</ul>
      </section>
    `
    : "";
  const delayedHtml = delayed.length
    ? `
      <section class="arkhanval-notice-card__panel">
        <h4>Effets différés à résoudre</h4>
        <ul>${delayed.map((entry) => `
          <li><strong>${escapeHtml(entry.targetName || "Cible")}</strong> — ${escapeHtml(entry.label || "Effet différé")}
            ${entry.note ? `<br><small>${escapeHtml(entry.note)}</small>` : ""}
          </li>
        `).join("")}</ul>
      </section>
    `
    : "";

  return `
    <article class="arkhanval-round-followup-card arkhanval-chat-card arkhanval-chat-card--notice arkhanval-notice-card arkhanval-notice-card--round">
      <header class="arkhanval-notice-card__hero arkhanval-notice-card__hero--round">
        <div class="arkhanval-notice-card__heading"><h3 class="arkhanval-notice-card__title">Début du round</h3></div>
        <span class="arkhanval-notice-card__round" aria-label="Round ${Math.max(0, Number(round) || 0)}">${Math.max(0, Number(round) || 0)}</span>
      </header>
      ${expiredHtml}
      ${reminderHtml}
      ${delayedHtml}
    </article>
  `;
}

export async function scheduleRoundReminder(combat, reminder) {
  if (!combat?.id || !reminder) return false;
  const current = Array.from(combat.getFlag?.(ROUND_FLAG_SCOPE, ROUND_REMINDERS_FLAG) ?? [])
    .map((entry) => ({ ...entry }));
  const key = String(reminder.id ?? "");
  if (key && current.some((entry) => String(entry?.id ?? "") === key)) return false;
  current.push({ ...reminder });
  await combat.setFlag(ROUND_FLAG_SCOPE, ROUND_REMINDERS_FLAG, current);
  return true;
}

async function processRoundChange(combat, prior, current) {
  if (!isRoundAuthority()) return;
  const oldRound = Number(prior?.round) || 0;
  const newRound = Number(current?.round) || 0;
  if (newRound <= oldRound || newRound <= 0) return;

  const combatId = String(combat?.id ?? "");
  if (!combatId || processingCombats.has(combatId)) return;
  processingCombats.add(combatId);

  try {
    const expired = [];
    const reminders = [];

    for (const actor of roundTrackedActors(combat)) {
      const deleteIds = [];
      for (const item of ownedStates(actor)) {
        let meta = tracking(item);
        const mode = String(meta?.mode ?? "");

        // Art du combat can create its silent Foundry Combat only when the first
        // round is advanced. A temporary State applied before that moment already
        // knows its tracking mode, but has no combatId/round metadata yet. Adopt
        // such a State the first time its Actor participates in this Combat rather
        // than ignoring it forever.
        if (mode && !String(meta?.combatId ?? "")) {
          const appliedRound = Math.max(1, oldRound || newRound);
          const adopted = {
            ...meta,
            combatId,
            appliedRound,
            expiresRound: mode === "expireRound" ? appliedRound + 2 : 0
          };
          await item.update({ "system.tracking": adopted });
          meta = adopted;
        }

        if (String(meta?.combatId ?? "") !== combatId) continue;

        const expiresRound = Number(meta?.expiresRound) || 0;
        const appliedRound = Number(meta?.appliedRound) || 0;

        if (mode === "expireRound" && expiresRound > 0 && newRound >= expiresRound) {
          deleteIds.push(String(item.id));
          expired.push({
            actorName: String(actor.name ?? "Personnage"),
            stateName: String(item.name ?? "État")
          });
          continue;
        }

        if (mode === "roundReminder" && appliedRound > 0 && newRound > appliedRound) {
          reminders.push({
            actorName: String(actor.name ?? "Personnage"),
            stateName: String(item.name ?? "État"),
            key: String(meta?.reminderKey ?? "")
          });
        }
      }

      if (deleteIds.length) {
        await actor.deleteEmbeddedDocuments("Item", deleteIds);
      }
    }

    const scheduled = Array.from(combat.getFlag?.(ROUND_FLAG_SCOPE, ROUND_REMINDERS_FLAG) ?? [])
      .map((entry) => ({ ...entry }));
    const due = scheduled.filter((entry) => (Number(entry?.dueRound) || 0) === newRound);
    const stale = scheduled.filter((entry) => (Number(entry?.dueRound) || 0) < newRound);
    const future = scheduled.filter((entry) => (Number(entry?.dueRound) || 0) > newRound);

    // Delayed effects are one-shot reminders for one exact round. Consume both
    // entries due now and any stale leftovers before rendering, so an old flag
    // can never repeat forever on later rounds. State-based reminders (for
    // example Hémorragie) are rebuilt independently from the Items that are
    // actually still owned by Actors.
    if (due.length || stale.length) {
      await combat.setFlag(ROUND_FLAG_SCOPE, ROUND_REMINDERS_FLAG, future);
    }

    const delayed = due.filter((entry) => delayedReminderIsStillValid(combat, entry));

    if (!expired.length && !reminders.length && !delayed.length) return;

    const ChatMessageClass = globalThis.ChatMessage ?? globalThis.foundry?.documents?.ChatMessage;
    if (!ChatMessageClass) return;
    await ChatMessageClass.create({
      speaker: { alias: "Arkhanval — Suivi de round" },
      content: buildRoundCard(newRound, { expired, reminders, delayed }),
      flags: {
        arkhanval: {
          roundFollowup: {
            combatId,
            round: newRound
          }
        }
      }
    });
  } catch (error) {
    console.error("Arkhanval | Échec du suivi de début de round", error);
    ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
  } finally {
    processingCombats.delete(combatId);
  }
}

export async function cleanupCombatRoundTracking(combat) {
  if (!combat?.id || !game.user?.isGM) return { statesDeleted: 0, remindersCleared: 0 };

  const combatId = String(combat.id);
  let statesDeleted = 0;

  for (const actor of roundTrackedActors(combat)) {
    const deleteIds = ownedStates(actor)
      .filter((item) => String(tracking(item)?.combatId ?? "") === combatId)
      .map((item) => String(item.id ?? ""))
      .filter(Boolean);

    if (!deleteIds.length) continue;
    await actor.deleteEmbeddedDocuments("Item", deleteIds);
    statesDeleted += deleteIds.length;
  }

  const reminders = Array.from(combat.getFlag?.(ROUND_FLAG_SCOPE, ROUND_REMINDERS_FLAG) ?? []);
  if (reminders.length) {
    await combat.unsetFlag?.(ROUND_FLAG_SCOPE, ROUND_REMINDERS_FLAG);
  }

  return { statesDeleted, remindersCleared: reminders.length };
}

export function initializeRoundTracking() {
  Hooks.on("combatTurnChange", (combat, prior, current) => {
    void processRoundChange(combat, prior, current);
  });
}
