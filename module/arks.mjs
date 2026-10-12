import { showEvaluatedRoll } from "./integrations/dice-so-nice.mjs";
import { ARKHANVAL_ARKS } from "./config.mjs";
import { promptSkillRoll } from "./resolution/dialog.mjs";
import { dispatchChatProgressionAction, registerChatProgressionAction, userCanProgressActor } from "./chat-actions.mjs";

const { DialogV2 } = foundry.applications.api;

export const ARKSONGE_TABLE = Object.freeze([
  Object.freeze({ min: 1, max: 3, sourceKey: "arksonge:1-3", name: "Connexion" }),
  Object.freeze({ min: 4, max: 5, sourceKey: "arksonge:4-5", name: "Don de voyance" }),
  Object.freeze({ min: 6, max: 10, sourceKey: "arksonge:6-10", name: "Volonté inébranlable" }),
  Object.freeze({ min: 11, max: 15, sourceKey: "arksonge:11-15", name: "Télépathe" }),
  Object.freeze({ min: 16, max: 20, sourceKey: "arksonge:16-20", name: "Grande nervosité" }),
  Object.freeze({ min: 21, max: 25, sourceKey: "arksonge:21-25", name: "Sommeil voyageur" }),
  Object.freeze({ min: 26, max: 28, sourceKey: "arksonge:26-28", name: "Magie amplifiée" }),
  Object.freeze({ min: 29, max: 30, sourceKey: "arksonge:29-30", name: "Magie discrète" }),
  Object.freeze({ min: 31, max: 32, sourceKey: "arksonge:31-32", name: "Esprit impénétrable" }),
  Object.freeze({ min: 33, max: 34, sourceKey: "arksonge:33-34", name: "Jamais d’erreur" }),
  Object.freeze({ min: 35, max: 36, sourceKey: "arksonge:35-36", name: "Sommeil bénéfique" }),
  Object.freeze({ min: 37, max: 38, sourceKey: "arksonge:37-38", name: "Contact avec un autre monde" }),
  Object.freeze({ min: 39, max: 40, sourceKey: "arksonge:39-40", name: "Perception supérieure" }),
  Object.freeze({ min: 41, max: 42, sourceKey: "arksonge:41-42", name: "Hypersensible" }),
  Object.freeze({ min: 43, max: 44, sourceKey: "arksonge:43-44", name: "Profonde empathie" }),
  Object.freeze({ min: 45, max: 46, sourceKey: "arksonge:45-46", name: "Phobie" }),
  Object.freeze({ min: 47, max: 48, sourceKey: "arksonge:47-48", name: "Tout en contrôle" }),
  Object.freeze({ min: 49, max: 50, sourceKey: "arksonge:49-50", name: "Manie" }),
  Object.freeze({ min: 51, max: 53, sourceKey: "arksonge:51-53", name: "Ralentissement du temps" }),
  Object.freeze({ min: 54, max: 55, sourceKey: "arksonge:54-55", name: "Imprévisible" }),
  Object.freeze({ min: 56, max: 57, sourceKey: "arksonge:56-57", name: "Magie innée" }),
  Object.freeze({ min: 58, max: 60, sourceKey: "arksonge:58-60", name: "Réminiscence" }),
  Object.freeze({ min: 61, max: 65, sourceKey: "arksonge:61-65", name: "6e sens" }),
  Object.freeze({ min: 66, max: 70, sourceKey: "arksonge:66-70", name: "L’un sans l’autre" }),
  Object.freeze({ min: 71, max: 73, sourceKey: "arksonge:71-73", name: "Maîtrise de l’éthérêve" }),
  Object.freeze({ min: 74, max: 75, sourceKey: "arksonge:74-75", name: "Célérité magique" }),
  Object.freeze({ min: 76, max: 77, sourceKey: "arksonge:76-77", name: "Éveil" }),
  Object.freeze({ min: 78, max: 79, sourceKey: "arksonge:78-79", name: "Affinité mystique" }),
  Object.freeze({ min: 80, max: 81, sourceKey: "arksonge:80-81", name: "Les voies secrètes" }),
  Object.freeze({ min: 82, max: 83, sourceKey: "arksonge:82-83", name: "Plus efficace" }),
  Object.freeze({ min: 84, max: 85, sourceKey: "arksonge:84-85", name: "Compréhension supérieure" }),
  Object.freeze({ min: 86, max: 87, sourceKey: "arksonge:86-87", name: "Les ombres de l’esprit" }),
  Object.freeze({ min: 88, max: 89, sourceKey: "arksonge:88-89", name: "Visions" }),
  Object.freeze({ min: 90, max: 90, sourceKey: "arksonge:90-90", name: "Résistance magique" }),
  Object.freeze({ min: 91, max: 91, sourceKey: "arksonge:91-91", name: "Perfectionnement" }),
  Object.freeze({ min: 92, max: 93, sourceKey: "arksonge:92-93", name: "Naturellement doué" }),
  Object.freeze({ min: 94, max: 95, sourceKey: "arksonge:94-95", name: "Amnésie" }),
  Object.freeze({ min: 96, max: 97, sourceKey: "arksonge:96-97", name: "Hypermnésie" }),
  Object.freeze({ min: 98, max: 98, sourceKey: "arksonge:98-98", name: "Doué" }),
  Object.freeze({ min: 99, max: 99, sourceKey: "arksonge:99-99", name: "Maître de l’espace et du temps" }),
  Object.freeze({ min: 100, max: 100, sourceKey: "arksonge:100-100", name: "Voyageur astral" })
]);

export const ARKENTROPIE_TABLE = Object.freeze([
  Object.freeze({ min: 1, max: 2, sourceKey: "arkentropie:1-2", name: "Le Grand Éveil" }),
  Object.freeze({ min: 3, max: 4, sourceKey: "arkentropie:3-4", name: "Métamorphose" }),
  Object.freeze({ min: 5, max: 6, sourceKey: "arkentropie:5-6", name: "Mutation" }),
  Object.freeze({ min: 7, max: 8, sourceKey: "arkentropie:7-8", name: "Anatomie réinventée" }),
  Object.freeze({ min: 9, max: 10, sourceKey: "arkentropie:9-10", name: "Distorsion" }),
  Object.freeze({ min: 11, max: 12, sourceKey: "arkentropie:11-12", name: "Nouvelle peau" }),
  Object.freeze({ min: 13, max: 14, sourceKey: "arkentropie:13-14", name: "Illumination" }),
  Object.freeze({ min: 15, max: 16, sourceKey: "arkentropie:15-16", name: "Empathie animale" }),
  Object.freeze({ min: 17, max: 18, sourceKey: "arkentropie:17-18", name: "Transfiguration" }),
  Object.freeze({ min: 19, max: 20, sourceKey: "arkentropie:19-20", name: "Retour aux origines" }),
  Object.freeze({ min: 21, max: 22, sourceKey: "arkentropie:21-22", name: "Semaine sans faim" }),
  Object.freeze({ min: 23, max: 24, sourceKey: "arkentropie:23-24", name: "Sans repos" }),
  Object.freeze({ min: 25, max: 26, sourceKey: "arkentropie:25-26", name: "Maître de la coupe" }),
  Object.freeze({ min: 27, max: 28, sourceKey: "arkentropie:27-28", name: "Fragilité" }),
  Object.freeze({ min: 29, max: 30, sourceKey: "arkentropie:29-30", name: "Nouvelle résonance" }),
  Object.freeze({ min: 31, max: 32, sourceKey: "arkentropie:31-32", name: "Communion animale" }),
  Object.freeze({ min: 33, max: 34, sourceKey: "arkentropie:33-34", name: "Éveil sensoriel" }),
  Object.freeze({ min: 35, max: 36, sourceKey: "arkentropie:35-36", name: "Fureur incontrôlable" }),
  Object.freeze({ min: 37, max: 38, sourceKey: "arkentropie:37-38", name: "Endurci" }),
  Object.freeze({ min: 39, max: 40, sourceKey: "arkentropie:39-40", name: "Altération" }),
  Object.freeze({ min: 41, max: 42, sourceKey: "arkentropie:41-42", name: "Infatigable" }),
  Object.freeze({ min: 43, max: 44, sourceKey: "arkentropie:43-44", name: "Guérison accélérée" }),
  Object.freeze({ min: 45, max: 46, sourceKey: "arkentropie:45-46", name: "Besoin vital" }),
  Object.freeze({ min: 47, max: 48, sourceKey: "arkentropie:47-48", name: "Aura inquiétante" }),
  Object.freeze({ min: 49, max: 50, sourceKey: "arkentropie:49-50", name: "Expertise renforcée" }),
  Object.freeze({ min: 51, max: 51, sourceKey: "arkentropie:51-51", name: "Présence incommodante" }),
  Object.freeze({ min: 52, max: 52, sourceKey: "arkentropie:52-52", name: "Attirant" }),
  Object.freeze({ min: 53, max: 54, sourceKey: "arkentropie:53-54", name: "Déséquilibre" }),
  Object.freeze({ min: 55, max: 56, sourceKey: "arkentropie:55-56", name: "Régénération" }),
  Object.freeze({ min: 57, max: 58, sourceKey: "arkentropie:57-58", name: "Maîtrise du chaos" }),
  Object.freeze({ min: 59, max: 60, sourceKey: "arkentropie:59-60", name: "Avantage inattendu" }),
  Object.freeze({ min: 61, max: 62, sourceKey: "arkentropie:61-62", name: "Réflexes hors norme" }),
  Object.freeze({ min: 63, max: 64, sourceKey: "arkentropie:63-64", name: "Destin hors norme" }),
  Object.freeze({ min: 65, max: 66, sourceKey: "arkentropie:65-66", name: "Affinité métantropique" }),
  Object.freeze({ min: 67, max: 68, sourceKey: "arkentropie:67-68", name: "6e sens" }),
  Object.freeze({ min: 69, max: 70, sourceKey: "arkentropie:69-70", name: "Évolution métabolique" }),
  Object.freeze({ min: 71, max: 72, sourceKey: "arkentropie:71-72", name: "Résistance aux maladies" }),
  Object.freeze({ min: 73, max: 74, sourceKey: "arkentropie:73-74", name: "Expertise magique" }),
  Object.freeze({ min: 75, max: 76, sourceKey: "arkentropie:75-76", name: "Synergie" }),
  Object.freeze({ min: 77, max: 78, sourceKey: "arkentropie:77-78", name: "Étreinte du chaos" }),
  Object.freeze({ min: 79, max: 80, sourceKey: "arkentropie:79-80", name: "Dé « magique »" }),
  Object.freeze({ min: 81, max: 82, sourceKey: "arkentropie:81-82", name: "Aura surnaturelle" }),
  Object.freeze({ min: 83, max: 84, sourceKey: "arkentropie:83-84", name: "Optimisation" }),
  Object.freeze({ min: 85, max: 86, sourceKey: "arkentropie:85-86", name: "Biomimétisme" }),
  Object.freeze({ min: 87, max: 87, sourceKey: "arkentropie:87-87", name: "Résistance ancestrale" }),
  Object.freeze({ min: 88, max: 88, sourceKey: "arkentropie:88-88", name: "Bénédiction" }),
  Object.freeze({ min: 89, max: 89, sourceKey: "arkentropie:89-89", name: "Insensible" }),
  Object.freeze({ min: 90, max: 90, sourceKey: "arkentropie:90-90", name: "Héritage primordial" }),
  Object.freeze({ min: 91, max: 91, sourceKey: "arkentropie:91-91", name: "Savoir martial" }),
  Object.freeze({ min: 92, max: 93, sourceKey: "arkentropie:92-93", name: "Réminiscences" }),
  Object.freeze({ min: 94, max: 94, sourceKey: "arkentropie:94-94", name: "Maîtrise élémentaire" }),
  Object.freeze({ min: 95, max: 95, sourceKey: "arkentropie:95-95", name: "Don du chaos" }),
  Object.freeze({ min: 96, max: 96, sourceKey: "arkentropie:96-96", name: "Nature ancestrale" }),
  Object.freeze({ min: 97, max: 97, sourceKey: "arkentropie:97-97", name: "Transfiguration" }),
  Object.freeze({ min: 98, max: 98, sourceKey: "arkentropie:98-98", name: "Connexion supérieure" }),
  Object.freeze({ min: 99, max: 99, sourceKey: "arkentropie:99-99", name: "Affinité avec le chaos" }),
  Object.freeze({ min: 100, max: 100, sourceKey: "arkentropie:100-100", name: "Éternelle jeunesse" })
]);

export const ARK_TABLES = Object.freeze({
  arksonge: ARKSONGE_TABLE,
  arkentropie: ARKENTROPIE_TABLE
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function arkProgressionWhisperRecipients(actor) {
  return Array.from(game.users?.values?.() ?? [])
    .filter((user) => Boolean(user?.isGM) || actor?.testUserPermission?.(user, "OWNER"))
    .map((user) => String(user.id ?? ""))
    .filter(Boolean)
    .filter((id, index, values) => values.indexOf(id) === index);
}

/** Shared card header; the actor portrait is captured in the message
 * so it remains available after Chat re-renders or token changes. */
function arkCardHero(actor, ark, title) {
  const actorName = escapeHtml(actor?.name ?? "Personnage");
  const portrait = escapeHtml(String(actor?.img ?? "").trim() || "icons/svg/mystery-man.svg");
  const arkIcon = escapeHtml(`systems/arkhanval/assets/icones/ark/${ark.id}.webp`);
  return `
    <header class="arkhanval-ark-card__hero">
      <div class="arkhanval-ark-card__portrait">
        <img src="${portrait}" alt="${actorName}" loading="lazy">
      </div>
      <div class="arkhanval-ark-card__heading">
        <h3>${escapeHtml(title)}</h3>
        <span class="arkhanval-ark-card__actor">${actorName}</span>
      </div>
      <div class="arkhanval-ark-card__icon">
        <img src="${arkIcon}" alt="${escapeHtml(ark.label)}" loading="lazy">
      </div>
    </header>
  `.trim();
}

function completeArkChatAction(button, label) {
  button.disabled = true;
  button.setAttribute("aria-disabled", "true");
  button.dataset.arkhanvalActionComplete = "";
  button.textContent = label;
}

async function postArkProgressionReminder(actor, ark, rank) {
  if (!ARK_TABLES[ark.id]) return;

  const ChatMessageClass = globalThis.foundry?.documents?.ChatMessage ?? globalThis.ChatMessage;
  if (!ChatMessageClass) return;

  const whisper = arkProgressionWhisperRecipients(actor);
  if (!whisper.length) return;

  const actorId = escapeHtml(actor?.id ?? "");
  const arkId = escapeHtml(ark.id);

  await ChatMessageClass.create({
    speaker: ChatMessageClass.getSpeaker({ actor }),
    whisper,
    flags: { arkhanval: { arkProgressionReminder: { actorId: actor.id, arkId: ark.id, rank, resolved: false, resultMessageId: "" } } },
    content: `
      <article class="arkhanval-ark-progression-reminder arkhanval-chat-card arkhanval-chat-card--notice arkhanval-ark-card"
               data-arkhanval-ark-progression-reminder
               data-actor-id="${actorId}"
               data-ark-id="${arkId}">
        ${arkCardHero(actor, ark, "Progression d’Ark")}
        <section class="arkhanval-ark-card__panel" aria-label="Progression ${escapeHtml(ark.label)}">
          <p class="arkhanval-ark-card__eyebrow">${escapeHtml(ark.label)}</p>
          <strong class="arkhanval-ark-card__rank">Rang ${Math.max(0, Math.trunc(Number(rank) || 0))}</strong>
          <p class="arkhanval-ark-card__detail">Un tirage sur la table d’${escapeHtml(ark.label)} est disponible.</p>
        </section>
        <div class="arkhanval-chat-decision-block arkhanval-ark-card__actions">
          <button type="button" data-arkhanval-ark-table-roll>Effectuer le jet</button>
        </div>
      </article>
    `.trim()
  });
}

export const ARKHANVAL_OFFICIAL_CONTENT_MODULE_ID = "";
export const ARK_TRAIT_FALLBACK_DESCRIPTION = "<p>Consulter les pages 71 à 77 du livre de règles Arkhanval</p>";

function userCanRollArkTable(actor) {
  return Boolean(game.user?.isGM) || Boolean(actor?.testUserPermission?.(game.user, "OWNER"));
}

function officialArkContentModule() {
  const moduleId = String(ARKHANVAL_OFFICIAL_CONTENT_MODULE_ID ?? "").trim();
  if (!moduleId) return null;
  const entry = game.modules?.get?.(moduleId) ?? null;
  return entry?.active ? entry : null;
}

/**
 * Official-content bridge reserved for the future Arkhanval premium package.
 *
 * Deliberately no public provider registry exists here: once the official
 * package id is chosen, this system will consult only that exact package.
 * Expected API: module.api.getArkResultContent({ arkId, sourceKey, min, max, name, actorUuid }).
 */
async function resolveOfficialArkContent(actor, arkId, result) {
  const officialModule = officialArkContentModule();
  const resolver = officialModule?.api?.getArkResultContent;
  if (typeof resolver !== "function") return null;

  try {
    const content = await resolver({
      arkId,
      sourceKey: result.sourceKey,
      min: result.min,
      max: result.max,
      name: result.name,
      actorUuid: String(actor?.uuid ?? "")
    });
    return content && typeof content === "object" ? content : null;
  } catch (error) {
    console.error("Arkhanval | Échec de lecture du contenu Ark officiel.", error);
    return null;
  }
}

function plainObjectArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({ ...entry }));
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

/**
 * Build the Embedded Item source used when a GM validates an Ark-table result.
 * With no official content package the Trait remains fully editable but carries
 * no preconfigured Rule. This is the intended free-system fallback.
 */
export function buildArkTraitData(arkId, result, officialContent = null) {
  if (!result || !["arksonge", "arkentropie"].includes(String(arkId))) return null;

  const trait = officialContent?.trait && typeof officialContent.trait === "object"
    ? officialContent.trait
    : (officialContent && typeof officialContent === "object" ? officialContent : {});
  const description = String(trait.description ?? officialContent?.description ?? "").trim()
    || ARK_TRAIT_FALLBACK_DESCRIPTION;

  return {
    name: String(result.name ?? "Trait d’Ark").trim() || "Trait d’Ark",
    type: "trait",
    img: String(trait.img ?? `systems/arkhanval/assets/icones/ark/${arkId}.webp`).trim(),
    system: {
      identifier: String(trait.identifier ?? "").trim(),
      description,
      tags: stringArray(trait.tags),
      rules: plainObjectArray(trait.rules ?? officialContent?.rules),
      origin: arkId,
      sourceKey: String(result.sourceKey ?? "").trim(),
      parameters: plainObjectArray(trait.parameters ?? officialContent?.parameters)
        .map((entry) => ({
          key: String(entry.key ?? "").trim(),
          value: String(entry.value ?? "").trim()
        }))
        .filter((entry) => entry.key || entry.value)
    }
  };
}

async function enrichArkCardDescription(content, actor) {
  const raw = String(content ?? "").trim();
  if (!raw) return "";

  const TextEditor = globalThis.foundry?.applications?.ux?.TextEditor;
  const implementation = TextEditor?.implementation ?? TextEditor;
  if (typeof implementation?.enrichHTML !== "function") {
    return `<p>${escapeHtml(raw)}</p>`;
  }

  try {
    return await implementation.enrichHTML(raw, {
      relativeTo: actor ?? undefined,
      secrets: Boolean(actor?.isOwner),
      rollData: actor?.getRollData?.() ?? {}
    });
  } catch (error) {
    console.warn("Arkhanval | Impossible d’enrichir la description Ark officielle.", error);
    return `<p>${escapeHtml(raw)}</p>`;
  }
}

function arkTableResultFlag(message) {
  return message?.getFlag?.("arkhanval", "arkTableResult")
    ?? message?.flags?.arkhanval?.arkTableResult
    ?? null;
}

async function createArkTraitFromChat(message) {
  if (!game.user?.isGM) return null;

  const flag = arkTableResultFlag(message);
  if (!flag?.actorId || !flag?.trait || flag.traitId) return null;

  const actor = game.actors?.get?.(String(flag.actorId)) ?? null;
  if (!actor) {
    ui.notifications?.warn?.("Arkhanval | Personnage introuvable pour ce résultat d’Ark.");
    return null;
  }

  const latestFlag = arkTableResultFlag(message);
  if (latestFlag?.traitId) return actor.items?.get?.(latestFlag.traitId) ?? null;

  const [trait] = await actor.createEmbeddedDocuments("Item", [flag.trait], { render: false });
  if (!trait) return null;

  if (typeof message?.setFlag === "function") {
    await message.setFlag("arkhanval", "arkTableResult", {
      ...flag,
      traitId: trait.id
    });
  }

  await actor.sheet?.render?.({ force: false });
  await trait.sheet?.render?.({ force: true });
  return trait;
}

const pendingReminderRolls = new Set();
registerChatProgressionAction("ark-reminder-roll", async ({ message, requester }) => {
  if (pendingReminderRolls.has(message.id)) throw new Error("Ce rappel est déjà en cours de résolution.");
  pendingReminderRolls.add(message.id);
  try {
    const reminder = message.getFlag?.("arkhanval", "arkProgressionReminder");
    // Compatibilité avec les anciens rappels dépourvus de flag.
    const actorId = String(reminder?.actorId
      ?? message.content?.match(/data-actor-id="([a-zA-Z0-9_-]+)"/)?.[1] ?? "");
    const arkId = String(reminder?.arkId
      ?? message.content?.match(/data-ark-id="([a-zA-Z0-9_-]+)"/)?.[1] ?? "");
    const actor = game.actors?.get?.(actorId);
    if (!actor || !ARK_TABLES[arkId] || !userCanProgressActor(requester, actor)) {
      throw new Error("Ce rappel Ark ne peut pas être utilisé pour ce personnage.");
    }
    if (reminder?.resolved) return { alreadyResolved: true, resultMessageId: reminder.resultMessageId };
    // Le résultat public sert aussi de journal de reprise si la mise à jour du rappel échoue.
    const prior = Array.from(game.messages?.values?.() ?? []).find(entry =>
      entry.getFlag?.("arkhanval", "arkTableResult")?.reminderMessageId === message.id);
    const resultMessageId = prior?.id ?? (await rollArkTable(actor, arkId, { reminderMessageId: message.id }))?.messageId;
    if (!resultMessageId) throw new Error("Le tirage Ark n'a pas produit de carte de résultat.");
    await message.update({
      "flags.arkhanval.arkProgressionReminder": {
        actorId, arkId, rank: Number(reminder?.rank) || 0,
        resolved: true, resultMessageId
      }
    });
    return { resultMessageId };
  } finally {
    pendingReminderRolls.delete(message.id);
  }
});

export function activateArkProgressionChatMessage(message, html) {
  for (const button of html?.querySelectorAll?.("[data-arkhanval-ark-table-roll]") ?? []) {
    const reminder = button.closest("[data-arkhanval-ark-progression-reminder]");
    const actorId = reminder?.dataset.actorId;
    const arkId = reminder?.dataset.arkId;
    const actor = actorId ? game.actors?.get(actorId) : null;

    const state = message.getFlag?.("arkhanval", "arkProgressionReminder") ?? null;
    if (state?.resolved) {
      completeArkChatAction(button, "Table tirée");
      continue;
    }
    if (!actor || !ARK_TABLES[arkId] || !userCanRollArkTable(actor)) {
      button.disabled = true;
      continue;
    }

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      if (button.disabled) return;

      button.disabled = true;
      const originalLabel = button.textContent;
      button.textContent = "Tirage en cours…";

      try {
        await dispatchChatProgressionAction(message, "ark-reminder-roll");
        completeArkChatAction(button, "Table tirée");
      } catch (error) {
        console.error("Arkhanval | Échec du tirage manuel de table d’Ark.", error);
        ui.notifications?.error?.("Arkhanval | Impossible de tirer la table d’Ark.");
        button.disabled = Boolean(message.getFlag?.("arkhanval", "arkProgressionReminder")?.resolved);
        button.textContent = button.disabled ? "Table tirée" : originalLabel;
      }
    });
  }

  for (const button of html?.querySelectorAll?.("[data-arkhanval-ark-trait-create]") ?? []) {
    if (!game.user?.isGM) {
      // Retirer aussi l'encart : le HTML d'origine contient des retours à la
      // ligne, ce qui empêche le sélecteur CSS :empty de le masquer.
      const panel = button.closest?.(".arkhanval-ark-card__actions");
      if (panel) panel.remove();
      else button.remove(); // compatibilité éventuelle avec d'anciens messages
      continue;
    }

    const flag = arkTableResultFlag(message);
    if (!flag?.trait || !flag?.actorId) {
      button.disabled = true;
      continue;
    }

    if (flag.traitId) {
      completeArkChatAction(button, "Trait ajouté");
      continue;
    }

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      if (button.disabled) return;

      button.disabled = true;
      const originalLabel = button.textContent;
      button.textContent = "Ajout en cours…";

      try {
        const trait = await createArkTraitFromChat(message);
        if (!trait) throw new Error("Création du Trait impossible.");
        completeArkChatAction(button, "Trait ajouté");
      } catch (error) {
        console.error("Arkhanval | Échec de création du Trait d’Ark.", error);
        ui.notifications?.error?.("Arkhanval | Impossible d’ajouter ce Trait au personnage.");
        button.disabled = false;
        button.textContent = originalLabel;
      }
    });
  }
}

export function arkTableResult(arkId, roll) {
  const value = Math.trunc(Number(roll));
  const table = ARK_TABLES[arkId];
  if (!table || value < 1 || value > 100) return null;
  return table.find((entry) => value >= entry.min && value <= entry.max) ?? null;
}

async function rollDie(faces) {
  const RollClass = globalThis.foundry?.dice?.Roll ?? globalThis.Roll;
  if (!RollClass) throw new Error("API Roll de Foundry indisponible.");
  const roll = await new RollClass(`1d${faces}`).evaluate();
  await showEvaluatedRoll(roll);
  return Number(roll.total);
}

export async function rollArkTable(actor, arkId, { reminderMessageId = "" } = {}) {
  const ark = ARKHANVAL_ARKS.find((entry) => entry.id === arkId);
  if (!ark || !ARK_TABLES[arkId]) return null;
  if (!userCanRollArkTable(actor)) {
    ui.notifications?.warn?.("Arkhanval | Vous n’avez pas la permission de tirer cette table pour ce personnage.");
    return null;
  }

  const roll = await rollDie(100);
  const result = arkTableResult(arkId, roll);
  if (!result) throw new Error(`Résultat d00 introuvable pour ${ark.label} : ${roll}`);

  const officialContent = await resolveOfficialArkContent(actor, arkId, result);
  const trait = buildArkTraitData(arkId, result, officialContent);
  const description = officialContent
    ? await enrichArkCardDescription(
        officialContent?.chatDescription
          ?? officialContent?.description
          ?? officialContent?.trait?.description
          ?? "",
        actor
      )
    : "";
  const ChatMessageClass = globalThis.foundry?.documents?.ChatMessage ?? globalThis.ChatMessage;

  let publishedMessage = null;
  if (ChatMessageClass) {
    const actorId = String(actor?.id ?? "");
    publishedMessage = await ChatMessageClass.create({
      speaker: ChatMessageClass.getSpeaker({ actor }),
      flags: {
        arkhanval: {
          arkTableResult: {
            actorId,
            arkId,
            roll,
            sourceKey: result.sourceKey,
            name: result.name,
            officialContent: Boolean(officialContent),
            trait,
            traitId: "",
            reminderMessageId: String(reminderMessageId ?? "")
          }
        }
      },
      content: `
        <article class="arkhanval-ark-table-card arkhanval-chat-card arkhanval-chat-card--ark-table arkhanval-ark-card"
                 data-arkhanval-ark-table-result
                 data-source-key="${escapeHtml(result.sourceKey)}">
          ${arkCardHero(actor, ark, "Tirage d’Ark")}
          <section class="arkhanval-ark-card__panel" aria-label="Résultat de ${escapeHtml(ark.label)}">
            <p class="arkhanval-ark-card__eyebrow">${escapeHtml(ark.label)} — d00</p>
            <strong class="arkhanval-ark-card__value">${roll}</strong>
            <p class="arkhanval-ark-table-card__result">${escapeHtml(result.name)}</p>
            ${description ? `<div class="arkhanval-ark-table-card__description">${description}</div>` : ""}
          </section>
          <p class="arkhanval-ark-card__notice">Le résultat n’applique aucune conséquence automatiquement.</p>
          <div class="arkhanval-chat-decision-block arkhanval-ark-card__actions"><button type="button" data-arkhanval-ark-trait-create>MJ — Ajouter au personnage</button></div>
        </article>
      `.trim()
    });
  }

  return { roll, result, officialContent: Boolean(officialContent), trait, messageId: publishedMessage?.id ?? "" };
}

export async function advanceArk(actor, arkId, { confirm = true } = {}) {
  const ark = ARKHANVAL_ARKS.find((entry) => entry.id === arkId);
  if (!ark) return false;

  const currentRank = Number(actor.system.arks?.[arkId]?.rank) || 0;
  const circles = Number(actor.system.arks?.[arkId]?.circles) || 0;

  if (circles < 10) {
    ui.notifications?.info?.(`Arkhanval | ${ark.label} : 10 cercles sont requis pour progresser.`);
    return false;
  }

  if (confirm) {
    const result = await DialogV2.input({
      window: { title: `Progression — ${ark.label}` },
      content: `
        <div class="arkhanval-phase04-dialog">
          <p><strong>${escapeHtml(ark.label)}</strong> : rang ${currentRank} → <strong>${currentRank + 1}</strong></p>
          <p>Les 10 cercles seront effacés.</p>
          <p><small>Utiliser cette action seulement au moment prévu par les règles (repos ou méditation).</small></p>
          <input type="hidden" name="confirm" value="1">
        </div>
      `,
      modal: true,
      rejectClose: false,
      ok: {
        label: "Faire progresser",
        icon: "fa-solid fa-arrow-up"
      }
    });

    if (!result) return false;
  }

  await actor.update({
    [`system.arks.${arkId}.rank`]: currentRank + 1,
    [`system.arks.${arkId}.circles`]: 0
  });

  if (ARK_TABLES[arkId]) {
    await postArkProgressionReminder(actor, ark, currentRank + 1);
  }

  ui.notifications?.info?.(`Arkhanval | ${ark.label} passe au rang ${currentRank + 1}.`);
  return true;
}

export async function promptArkRollRequest(actor, arkId, {
  defaultFd = 6,
  fdMin = 1,
  fdMax = 12,
  title = "",
  allowArkSelection = false
} = {}) {
  const initialArk = ARKHANVAL_ARKS.find((entry) => entry.id === arkId);
  if (!initialArk) return null;

  // Every pre-roll uses the same source selector. An Ark request is
  // therefore only the proposed/default source; the table may resolve the
  // workflow with another Ark or a skill without leaving the workflow.
  void allowArkSelection;
  return promptSkillRoll({
    actor,
    rollSource: {
      sourceType: "ark",
      arkId: initialArk.id
    },
    defaultFd,
    fdMin,
    fdMax,
    title: String(title || `Jet d’Ark — ${initialArk.label}`)
  });
}
