/** réduction uniquement si un mot du titre déborde.
 *
 * CSS text-wrap balance permet aux intitulés comportant plusieurs mots de
 * revenir à la ligne normalement ; seul le mot le plus long peut forcer une
 * réduction. Aucune modification des messages ou flags n'est nécessaire.
 */
const TITLE_SELECTOR = ".arkhanval-resolution-card__hero-main > h3, .arkhanval-spell-resolution__name";
const MIN_FONT_REM = 0.875;
const OBSERVED = new Set();
const WIDTHS = new WeakMap();

/** Calcule dans le navigateur, en fonction de la largeur effective du titre. */
export function fitChatTitle(title) {
  if (!title || !title.clientWidth) return;
  const available = title.clientWidth;
  title.style.removeProperty("font-size");
  title.style.removeProperty("overflow-wrap");

  const original = Number.parseFloat(getComputedStyle(title).fontSize);
  if (!Number.isFinite(original) || original <= 0) return;
  const rootFont = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const minimum = Math.min(original, rootFont * MIN_FONT_REM);
  if (title.scrollWidth <= available + 1) return;

  title.style.fontSize = `${minimum}px`;
  if (title.scrollWidth > available + 1) {
    // Un mot réellement trop long reste lisible, sans être tronqué.
    title.style.overflowWrap = "anywhere";
    return;
  }

  let low = minimum;
  let high = original;
  for (let i = 0; i < 9; i += 1) {
    const mid = (low + high) / 2;
    title.style.fontSize = `${mid}px`;
    if (title.scrollWidth <= available + 1) low = mid;
    else high = mid;
  }
  title.style.fontSize = `${Math.floor(low * 10) / 10}px`;
}

const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
  for (const entry of entries) {
    const container = entry.target;
    const width = entry.contentRect.width;
    if (Math.abs(width - (WIDTHS.get(container) ?? -1)) < 0.5) continue;
    WIDTHS.set(container, width);
    for (const title of container.querySelectorAll(TITLE_SELECTOR)) fitChatTitle(title);
  }
});

/** Réutilise le hook renderChatMessageHTML existant, sans toucher au moteur. */
export function activateAdaptiveChatTitles(html) {
  if (!html?.querySelectorAll) return;
  if (resizeObserver) {
    for (const container of OBSERVED) {
      if (!container.isConnected) {
        resizeObserver.unobserve(container);
        OBSERVED.delete(container);
      }
    }
  }

  for (const title of html.querySelectorAll(TITLE_SELECTOR)) {
    fitChatTitle(title);
    const container = title.parentElement;
    if (!container || !resizeObserver || OBSERVED.has(container)) continue;
    OBSERVED.add(container);
    WIDTHS.set(container, container.clientWidth);
    resizeObserver.observe(container);
  }
}
