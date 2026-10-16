/** Fenêtre À propos ouverte uniquement à la demande, sans modification du jeu. */
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const SYSTEM_ID = "arkhanval";
const OFFICIAL_REPOSITORY = "https://github.com/ctotone/arkhanval";
const SUPPORT_URL = "https://ko-fi.com/evilbram";
const AUTHOR_URL = "https://www.gameontabletop.com/cf5071/arkhanval.html";
const PUBLISHER_URL = "https://www.gameontabletop.com/pm1561/storyline.html";

export class ArkhanvalAbout extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "arkhanval-about",
    classes: ["arkhanval", "arkhanval-about"],
    tag: "section",
    position: { width: 455, height: "auto" },
    window: { resizable: false, icon: "fa-solid fa-circle-info" }
  };

  static PARTS = {
    main: { template: `systems/${SYSTEM_ID}/templates/apps/about.hbs` }
  };

  get title() {
    return game.i18n.localize("ARKHANVAL.About.Title");
  }

  static open() {
    const existing = [...this.instances()].find((app) => app.rendered);
    if (existing) {
      existing.bringToFront();
      return existing;
    }
    const app = new this();
    void app.render(true);
    return app;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      systemName: game.system?.title ?? "Arkhanval",
      systemVersion: game.system?.version ?? "",
      repositoryUrl: OFFICIAL_REPOSITORY,
      authorUrl: AUTHOR_URL,
      publisherUrl: PUBLISHER_URL,
      coffeeUrl: SUPPORT_URL
    };
  }
}

/** Entrée idempotente dans l'onglet Paramètres de Foundry v14 (MJ et joueurs). */
export function mountArkhanvalAboutInSettings(app, element) {
  if (!(element instanceof HTMLElement)) return;
  if (element.querySelector(".arkhanval-about-settings-entry")) return;

  const target = element.querySelector(".settings-sidebar")
    ?? element.querySelector(".tab")
    ?? element;
  const section = document.createElement("section");
  section.className = "arkhanval-about-settings-entry";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "arkhanval-about-settings-button";
  const labelText = game.i18n.localize("ARKHANVAL.About.SidebarEntry");
  button.setAttribute("aria-label", labelText);
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-circle-info";
  icon.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = labelText;
  button.append(icon, label);
  button.addEventListener("click", () => ArkhanvalAbout.open());
  section.append(button);
  target.append(section);
}
