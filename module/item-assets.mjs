/**
 * User-facing Item artwork directories.
 *
 * These folders intentionally use French names: players interact with them
 * directly through the Foundry image picker.
 */
export const ARKHANVAL_ITEM_ASSET_DIRS = Object.freeze({
  weapon: "systems/arkhanval/assets/items/armements/",
  armor: "systems/arkhanval/assets/items/armures/",
  equipment: "systems/arkhanval/assets/items/equipements/",
  book: "systems/arkhanval/assets/items/livres/",
  spell: "systems/arkhanval/assets/items/sortileges/",
  skill: "systems/arkhanval/assets/items/competences/",
  specialty: "systems/arkhanval/assets/items/specialites/",
  state: "systems/arkhanval/assets/items/etats/",
  work: "systems/arkhanval/assets/items/taches/"
});

/**
 * Default artwork assigned only when a newly-created Item does not provide
 * its own image (or still carries Foundry's generic Item icon).
 */

export const ARKHANVAL_ARCHETYPE_ITEM_TYPES = Object.freeze(new Set(["skill", "specialty"]));

export function archetypeItemImage(type, archetypeId) {
  const itemType = String(type ?? "").trim();
  const archetype = String(archetypeId ?? "").trim().toLowerCase();
  if (!ARKHANVAL_ARCHETYPE_ITEM_TYPES.has(itemType) || !archetype) return "";
  const base = ARKHANVAL_ITEM_ASSET_DIRS[itemType];
  return base ? `${base}${archetype}.webp` : "";
}

export function isManagedArchetypeItemImage(type, image) {
  const itemType = String(type ?? "").trim();
  const source = String(image ?? "").trim();
  const base = ARKHANVAL_ITEM_ASSET_DIRS[itemType];
  if (!ARKHANVAL_ARCHETYPE_ITEM_TYPES.has(itemType) || !base || !source.startsWith(base)) return false;
  const file = source.slice(base.length);
  return /^[a-z0-9-]+\.webp$/i.test(file);
}

export const ARKHANVAL_ITEM_DEFAULT_IMAGES = Object.freeze({
  weapon: `${ARKHANVAL_ITEM_ASSET_DIRS.weapon}arme-generale.webp`,
  spell: `${ARKHANVAL_ITEM_ASSET_DIRS.spell}sortilege.webp`,
  armor: `${ARKHANVAL_ITEM_ASSET_DIRS.armor}armor.webp`,
  book: `${ARKHANVAL_ITEM_ASSET_DIRS.book}livre.webp`,
  equipment: `${ARKHANVAL_ITEM_ASSET_DIRS.equipment}equipement.webp`,
  work: `${ARKHANVAL_ITEM_ASSET_DIRS.work}tache.webp`
});


/**
 * Apply Arkhanval default artwork to a pending Item creation.
 * Existing/imported artwork is preserved; Foundry's generic Item icon counts
 * as an unset image for this purpose.
 */
export function applyDefaultItemImage(item, data = {}, { defaultIcon = "icons/svg/item-bag.svg" } = {}) {
  const type = String(data?.type ?? item?.type ?? "").trim();
  const defaultImage = ARKHANVAL_ITEM_DEFAULT_IMAGES[type];
  if (!defaultImage) return false;

  const requestedImage = String(data?.img ?? "").trim();
  const genericImage = String(defaultIcon ?? "icons/svg/item-bag.svg").trim();
  if (requestedImage && requestedImage !== genericImage) return false;
  if (typeof item?.updateSource !== "function") return false;

  item.updateSource({ img: defaultImage });
  return true;
}
