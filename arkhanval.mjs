import { ArkhanvalCharacterData } from "./module/data-models/actor/character.mjs";
import { ARKHANVAL_ITEM_DATA_MODELS } from "./module/data-models/item/items.mjs";
import { ArkhanvalCharacterSheet } from "./module/sheets/character-sheet.mjs";
import { ArkhanvalItemSheet } from "./module/sheets/item-sheet.mjs";
import { applyDefaultItemImage } from "./module/item-assets.mjs";
import { activateExperienceChatMessage } from "./module/progression.mjs";
import { initializeChatProgressionSocket } from "./module/chat-actions.mjs";
import { activateAdaptiveChatTitles } from "./module/chat-title-fit.mjs";
import { initializeCreationState } from "./module/creation-wizard.mjs";
import { activateArkProgressionChatMessage } from "./module/arks.mjs";
import { initializeArkhanvalRichText } from "./module/richtext.mjs";
import { activateCombatChatMessage, initializeCombatSocket } from "./module/combat/chat.mjs";
import { initializeRoundTracking } from "./module/combat/round-tracker.mjs";
import {
  activateSpellResolutionChatMessage,
  initializeSpellResolutionSocket
} from "./module/magic/chat.mjs";
import {
  activateArtCombatChatMessage,
  initializeArtCombatSocket,
  injectArtCombatActorDirectoryButton,
  registerArtCombatSetting
} from "./module/art-of-combat.mjs";

Hooks.once("init", () => {
  console.log("Arkhanval | Initialisation du système");

  registerArtCombatSetting();
  initializeArkhanvalRichText();

  CONFIG.Actor.dataModels.character = ArkhanvalCharacterData;
  Object.assign(CONFIG.Item.dataModels, ARKHANVAL_ITEM_DATA_MODELS);

  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    foundry.documents.Actor,
    game.system.id,
    ArkhanvalCharacterSheet,
    {
      types: ["character"],
      makeDefault: true,
      label: "ARKHANVAL.Sheet.Character"
    }
  );

  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    foundry.documents.Item,
    game.system.id,
    ArkhanvalItemSheet,
    {
      types: Object.keys(ARKHANVAL_ITEM_DATA_MODELS),
      makeDefault: true,
      label: "ARKHANVAL.Sheet.Item"
    }
  );
});

Hooks.once("ready", () => {
  initializeChatProgressionSocket();
  initializeCombatSocket();
  initializeArtCombatSocket();
  initializeSpellResolutionSocket();
  initializeRoundTracking();
});

// Double garde (contrôle UI/handler + hook client) : une mise à jour
// du mode provenant d'un compte non MJ est refusée, même propriétaire.
// Cette protection client ne prétend pas remplacer l'autorité du serveur.
Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
  if (actor?.type !== "character") return;
  const mode = foundry.utils.getProperty(changes, "flags.arkhanval.viewMode")
    ?? changes?.["flags.arkhanval.viewMode"];
  if (mode === undefined) return;
  const user = game.users?.get?.(userId);
  if (!user?.isGM || !["pj", "npc"].includes(mode)) return false;
});

Hooks.on("preCreateActor", (actor, data, options, userId) => {
  if (userId !== game.user.id) return;
  initializeCreationState(actor);
});

Hooks.on("preCreateItem", (item, data, options, userId) => {
  if (userId !== game.user.id) return;
  applyDefaultItemImage(item, data, {
    defaultIcon: foundry.documents.Item.DEFAULT_ICON
  });
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  activateExperienceChatMessage(message, html);
  activateCombatChatMessage(message, html);
  activateSpellResolutionChatMessage(message, html);
  activateArtCombatChatMessage(message, html);
  activateArkProgressionChatMessage(message, html);
  activateAdaptiveChatTitles(html);
});

Hooks.on("renderActorDirectory", (application, element) => {
  injectArtCombatActorDirectoryButton(application, element);
});
