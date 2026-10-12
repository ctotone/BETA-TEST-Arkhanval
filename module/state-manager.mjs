import { VANILLA_STATE_DEFINITIONS } from "./states.mjs";

const { DialogV2 } = foundry.applications.api;
const STATE_MANAGER_DIALOGS = new Map();

const VANILLA_STATE_ICONS = Object.freeze({
  groggy: "systems/arkhanval/assets/items/etats/etat-groggy.webp",
  stunned: "systems/arkhanval/assets/items/etats/etat-etourdi.webp",
  greatPain: "systems/arkhanval/assets/items/etats/etat-grande-douleur.webp"
});

function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function plainTextFromHtml(value) {
  const html = String(value ?? "").trim();
  if (!html) return "";
  if (globalThis.document?.createElement) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    return String(wrapper.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(value, max = 240) {
  const text = String(value ?? "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function actorCanUpdate(actor) {
  return Boolean(actor?.canUserModify?.(game.user, "update"));
}

function documentCanDelete(document) {
  return Boolean(document?.canUserModify?.(game.user, "delete"));
}

function vanillaStateDescription(state) {
  const rules = Array.from(state?.rules ?? []);
  if (!rules.length) return "État natif Arkhanval actif.";
  return `État natif Arkhanval actif · ${rules.length} règle${rules.length > 1 ? "s" : ""} automatique${rules.length > 1 ? "s" : ""}.`;
}

function activeVanillaRows(actor) {
  return VANILLA_STATE_DEFINITIONS
    .filter((state) => Boolean(actor?.system?.states?.[state.id]))
    .map((state) => ({
      kind: "vanilla",
      id: state.id,
      name: game.i18n.localize(state.labelKey),
      icon: VANILLA_STATE_ICONS[state.id] ?? "systems/arkhanval/assets/items/etats/etat-debuff.webp",
      category: "État natif",
      detail: vanillaStateDescription(state),
      canDelete: actorCanUpdate(actor)
    }));
}

function stateItemRows(actor) {
  return Array.from(actor?.items ?? [])
    .filter((item) => item?.type === "state")
    .map((item) => {
      const description = truncate(plainTextFromHtml(item.system?.description), 260);
      const identifier = String(item.system?.identifier ?? "").trim();
      return {
        kind: "item",
        id: String(item.id ?? ""),
        name: String(item.name ?? "État"),
        icon: String(item.img ?? "") || "systems/arkhanval/assets/items/etats/etat-debuff.webp",
        category: "État Arkhanval",
        detail: description || (identifier ? `Identifiant : ${identifier}` : "État persistant porté par le personnage."),
        canDelete: documentCanDelete(item)
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "fr", { sensitivity: "base" }));
}

function statusLabel(statusId) {
  const config = CONFIG.statusEffects?.[statusId] ?? null;
  const raw = config?.name ?? config?.label ?? statusId;
  return game.i18n?.has?.(raw) ? game.i18n.localize(raw) : String(raw ?? statusId);
}

function effectStatusText(effect) {
  const statuses = Array.from(effect?.statuses ?? []).map(statusLabel).filter(Boolean);
  return statuses.length ? `Statut : ${statuses.join(", ")}` : "";
}

function effectSourceText(effect) {
  const parent = effect?.parent ?? null;
  if (parent?.documentName === "Item" && parent?.name) return `Source : ${parent.name}`;
  const origin = String(effect?.origin ?? "").trim();
  if (!origin) return "";
  const sourceName = String(effect?.sourceName ?? "").trim();
  return sourceName ? `Source : ${sourceName}` : `Origine : ${origin}`;
}

function activeEffectDocuments(actor) {
  const effects = [];
  const seen = new Set();
  const add = (effect) => {
    if (!effect || effect.active === false || effect.disabled || effect.isSuppressed) return;
    if (effect.parent?.documentName === "Item" && effect.modifiesActor === false) return;
    const key = String(effect.uuid ?? `${effect.parent?.uuid ?? ""}.${effect.id ?? ""}`);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    effects.push(effect);
  };

  for (const effect of Array.from(actor?.effects ?? [])) add(effect);
  for (const item of Array.from(actor?.items ?? [])) {
    for (const effect of Array.from(item?.effects ?? [])) add(effect);
  }
  return effects;
}

function activeEffectRows(actor) {
  return activeEffectDocuments(actor)
    .map((effect) => {
      const statusText = effectStatusText(effect);
      const sourceText = effectSourceText(effect);
      const parentItem = effect.parent?.documentName === "Item" ? effect.parent : null;
      return {
        kind: "effect",
        id: String(effect.id ?? ""),
        parentType: parentItem ? "Item" : "Actor",
        parentId: parentItem ? String(parentItem.id ?? "") : "",
        name: String(effect.name ?? "Effet Foundry"),
        icon: String(effect.img ?? "") || "icons/svg/aura.svg",
        category: "Effet Foundry",
        detail: [statusText, sourceText].filter(Boolean).join(" · ") || "Active Effect actuellement actif sur ce personnage.",
        canDelete: documentCanDelete(effect)
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "fr", { sensitivity: "base" }));
}

export function actorStateManagerRows(actor) {
  return {
    vanilla: activeVanillaRows(actor),
    items: stateItemRows(actor),
    effects: activeEffectRows(actor)
  };
}

function renderRow(row) {
  const deleteButton = row.canDelete
    ? `<button type="button" class="arkhanval-state-manager__delete" data-state-manager-delete data-kind="${escapeHtml(row.kind)}" data-id="${escapeHtml(row.id)}"${row.parentType ? ` data-parent-type="${escapeHtml(row.parentType)}"` : ""}${row.parentId ? ` data-parent-id="${escapeHtml(row.parentId)}"` : ""} title="Supprimer ${escapeHtml(row.name)}" aria-label="Supprimer ${escapeHtml(row.name)}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>`
    : `<span class="arkhanval-state-manager__locked" title="Vous n’avez pas la permission de supprimer cet état" aria-label="Suppression non autorisée"><i class="fa-solid fa-lock" aria-hidden="true"></i></span>`;

  return `<article class="arkhanval-state-manager__row">
    <img class="arkhanval-state-manager__icon" src="${escapeHtml(row.icon)}" alt="">
    <div class="arkhanval-state-manager__content">
      <div class="arkhanval-state-manager__identity">
        <strong>${escapeHtml(row.name)}</strong>
        <span>${escapeHtml(row.category)}</span>
      </div>
      <p>${escapeHtml(row.detail)}</p>
    </div>
    ${deleteButton}
  </article>`;
}

function renderSection(title, rows, emptyText) {
  return `<section class="arkhanval-state-manager__section">
    <h3>${escapeHtml(title)} <span>${rows.length}</span></h3>
    ${rows.length
      ? `<div class="arkhanval-state-manager__rows">${rows.map(renderRow).join("")}</div>`
      : `<p class="arkhanval-state-manager__empty">${escapeHtml(emptyText)}</p>`}
  </section>`;
}

function stateManagerContent(actor) {
  const groups = actorStateManagerRows(actor);
  const total = groups.vanilla.length + groups.items.length + groups.effects.length;
  return `<div class="arkhanval-state-manager" data-state-manager-content>
    <header class="arkhanval-state-manager__header">
      <div>
        <h2>États appliqués</h2>
        <p>${escapeHtml(actor.name)}</p>
      </div>
      <strong class="arkhanval-state-manager__count">${total}</strong>
    </header>
    ${total ? "" : `<p class="arkhanval-state-manager__empty arkhanval-state-manager__empty--global">Aucun état ou effet actif détecté sur ce personnage.</p>`}
    ${renderSection("États natifs", groups.vanilla, "Aucun état natif actif.")}
    ${renderSection("États Arkhanval", groups.items, "Aucun Item État actif.")}
    ${renderSection("Effets Foundry", groups.effects, "Aucun Active Effect actif.")}
  </div>`;
}

async function confirmStateDeletion(name) {
  const safeName = escapeHtml(name);
  const choice = await DialogV2.wait({
    window: { title: "Arkhanval | Confirmation" },
    classes: ["arkhanval", "arkhanval-confirm-dialog"],
    content: `<section class="arkhanval-confirm-panel arkhanval-confirm-panel--danger">
      <h3><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Confirmer la suppression</h3>
      <div class="arkhanval-confirm-panel__body">
        <strong>Supprimer « ${safeName} » ?</strong>
        <small>Cet état ou effet sera retiré du personnage.</small>
      </div>
    </section>`,
    modal: true,
    rejectClose: false,
    buttons: [
      { action: "cancel", label: "Annuler", default: true },
      { action: "delete", label: "Supprimer", icon: "fa-solid fa-trash", class: "arkhanval-confirm-danger" }
    ]
  });
  return choice === "delete";
}

function resolveEffect(actor, button) {
  const id = String(button.dataset.id ?? "");
  if (button.dataset.parentType === "Item") {
    return actor.items?.get?.(String(button.dataset.parentId ?? ""))?.effects?.get?.(id) ?? null;
  }
  return actor.effects?.get?.(id) ?? null;
}

async function deleteManagedState(actor, button) {
  const kind = String(button.dataset.kind ?? "");
  const id = String(button.dataset.id ?? "");

  if (kind === "vanilla") {
    const definition = VANILLA_STATE_DEFINITIONS.find((state) => state.id === id);
    if (!definition || !actorCanUpdate(actor)) return false;
    if (!await confirmStateDeletion(game.i18n.localize(definition.labelKey))) return false;
    await actor.update({ [`system.states.${id}`]: false });
    return true;
  }

  if (kind === "item") {
    const item = actor.items?.get?.(id) ?? null;
    if (!item || item.type !== "state" || !documentCanDelete(item)) return false;
    if (!await confirmStateDeletion(item.name)) return false;
    await actor.deleteEmbeddedDocuments("Item", [id]);
    return true;
  }

  if (kind === "effect") {
    const effect = resolveEffect(actor, button);
    if (!effect || !documentCanDelete(effect)) return false;
    if (!await confirmStateDeletion(effect.name ?? "Effet Foundry")) return false;
    const parent = effect.parent;
    if (!parent?.deleteEmbeddedDocuments) return false;
    await parent.deleteEmbeddedDocuments("ActiveEffect", [String(effect.id)]);
    return true;
  }

  return false;
}

async function refreshStateManagerDialog(dialog, actor, onChange) {
  const content = dialog.element?.querySelector?.("[data-state-manager-content]");
  if (!content) return;
  const fresh = document.createElement("div");
  fresh.innerHTML = stateManagerContent(actor);
  content.replaceWith(fresh.firstElementChild);
  bindStateManagerDialog(dialog, actor, onChange);
}

function bindStateManagerDialog(dialog, actor, onChange) {
  const root = dialog.element?.querySelector?.("[data-state-manager-content]");
  if (!root) return;

  for (const button of root.querySelectorAll("[data-state-manager-delete]")) {
    button.addEventListener("click", async (event) => {
      const control = event.currentTarget;
      control.disabled = true;
      try {
        const changed = await deleteManagedState(actor, control);
        if (!changed) return;
        await onChange?.();
        await refreshStateManagerDialog(dialog, actor, onChange);
      } catch (error) {
        console.error("Arkhanval | Suppression d’un état", error);
        ui.notifications?.error?.(`Arkhanval | ${error?.message ?? String(error)}`);
      } finally {
        if (control.isConnected) control.disabled = false;
      }
    });
  }
}

export async function openStateManagerWindow(actor, { onChange } = {}) {
  if (!game.user?.isGM) return null;

  const key = String(actor?.uuid ?? actor?.id ?? "");
  const existing = STATE_MANAGER_DIALOGS.get(key);
  if (existing?.rendered) {
    await refreshStateManagerDialog(existing, actor, onChange);
    existing.bringToFront();
    return existing;
  }

  const dialog = new DialogV2({
    position: { width: 560, height: 640 },
    classes: ["arkhanval-state-manager-dialog"],
    window: { title: `États — ${actor.name}`, resizable: true },
    content: stateManagerContent(actor),
    modal: false,
    buttons: [{ action: "close", label: "Fermer", icon: "fa-solid fa-xmark", default: true }]
  });

  STATE_MANAGER_DIALOGS.set(key, dialog);
  dialog.addEventListener("close", () => {
    if (STATE_MANAGER_DIALOGS.get(key) === dialog) STATE_MANAGER_DIALOGS.delete(key);
  }, { once: true });

  await dialog.render(true);
  bindStateManagerDialog(dialog, actor, onChange);
  return dialog;
}
