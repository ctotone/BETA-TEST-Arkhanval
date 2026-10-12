const { TextEditor } = foundry.applications.ux;

/**
 * Enrich stored HTML through Foundry v14's configured text editor.
 * Enrichment is display-only; this helper never rewrites stored data.
 */
export async function enrichArkhanvalHTML(content, document) {
  const implementation = TextEditor.implementation ?? TextEditor;
  return implementation.enrichHTML(String(content ?? ""), {
    relativeTo: document ?? undefined,
    secrets: Boolean(document?.isOwner),
    rollData: document?.getRollData?.() ?? {}
  });
}

function applyJournalTheme(element) {
  if (!(element instanceof HTMLElement)) return;

  // Keep Foundry's native ProseMirror editing surface untouched. The Arkhanval
  // journal identity is a reading-mode theme, not a replacement editor skin.
  if (element.querySelector?.("prose-mirror")) return;

  const pageContents = new Set();
  if (element.matches?.(".journal-page-content")) pageContents.add(element);
  for (const node of element.querySelectorAll?.(".journal-page-content") ?? []) {
    pageContents.add(node);
  }

  // Some standalone page modes expose only the editor content.
  if (!pageContents.size) {
    for (const node of element.querySelectorAll?.(".editor-content") ?? []) {
      pageContents.add(node);
    }
  }

  for (const content of pageContents) {
    content.classList.add("arkhanval-richtext", "arkhanval-journal-theme");
  }
}

/**
 * Theme Journal document applications without modifying Journal data.
 */
export function initializeArkhanvalRichText() {
  Hooks.on("renderApplicationV2", (application, element) => {
    const document = application?.document ?? application?.object;
    const documentName = document?.documentName;
    if (documentName !== "JournalEntry" && documentName !== "JournalEntryPage") return;
    applyJournalTheme(element);
  });
}
