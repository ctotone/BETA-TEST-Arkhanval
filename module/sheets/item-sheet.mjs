import {
  ARKHANVAL_ARCHETYPES,
  buildSkillIdentifier
} from "../config.mjs";
import {
  isNativeSkillItem,
  listActorSkills
} from "../resolution/skills.mjs";
import {
  ARKHANVAL_RULE_EFFECTS,
  ARKHANVAL_SYSTEM_VARIABLES,
  buildCustomTagSelector,
  combatSkillIdentifiersForWeaponTags,
  buildRuleSelectorOptions,
  customTagLabel,
  knownTag,
  normalizeCustomTag,
  ruleEffect,
  selectorCustomTagLabel,
  selectorUsesCustomTag,
  tagOptionsForItemType
} from "../rules/catalog.mjs";
import {
  collectApplicableSpecialtyRules
} from "../rules/evaluator.mjs";
import {
  specialtyParameterEntries
} from "../rules/parameters.mjs";
import { summarizeDeclaredRules } from "../rules/rule-summary.mjs";
import { enrichArkhanvalHTML } from "../richtext.mjs";
import {
  ARKHANVAL_ITEM_ASSET_DIRS,
  ARKHANVAL_ITEM_DEFAULT_IMAGES,
  archetypeItemImage,
  isManagedArchetypeItemImage
} from "../item-assets.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { FilePicker } = foundry.applications.apps;

const ARKHANVAL_RULE_EFFECT_GROUPS = Object.freeze([
  Object.freeze({
    label: "Jet",
    ids: [
      "roll.fd",
      "roll.extraDie",
      "roll.diceMultiplier",
      "roll.dieUpgrade",
      "roll.repeatKeep",
      "roll.reroll",
      "roll.rerollCritical",
      "roll.autoSuccess",
      "roll.ignoreCritical",
      "roll.note"
    ]
  }),
  Object.freeze({ label: "Compétence", ids: ["skill.rankFlat"] }),
  Object.freeze({
    label: "Dégâts et protection",
    ids: ["damage.flat", "damage.extraDie", "damage.ignoreProtection", "protection.flat"]
  }),
  Object.freeze({ label: "Résistance et tâches", ids: ["resistance.fd", "task.requiredSuccesses"] }),
  Object.freeze({
    label: "Progression XP",
    ids: [
      "progression.skillCostMultiplier",
      "progression.skillUsePrimaryCost",
      "progression.specialtyCostMultiplier",
      "progression.specialtyCostFlat"
    ]
  }),
  Object.freeze({ label: "Combat et ressources", ids: ["combat.usesPerRound", "combat.defenseOnly", "resource.flat"] }),
  Object.freeze({ label: "Blessures", ids: ["wound.inflict", "wound.downgrade"] })
]);

function groupedRuleEffectOptions(selectedKey) {
  const effects = new Map(ARKHANVAL_RULE_EFFECTS.map((effect) => [effect.id, effect]));
  const used = new Set();
  const groups = ARKHANVAL_RULE_EFFECT_GROUPS.map((group) => ({
    label: group.label,
    options: group.ids
      .map((id) => effects.get(id))
      .filter(Boolean)
      .map((effect) => {
        used.add(effect.id);
        return {
          value: effect.id,
          label: effect.label,
          selected: effect.id === selectedKey
        };
      })
  })).filter((group) => group.options.length);

  const remaining = ARKHANVAL_RULE_EFFECTS
    .filter((effect) => !used.has(effect.id))
    .map((effect) => ({
      value: effect.id,
      label: effect.label,
      selected: effect.id === selectedKey
    }));

  if (remaining.length) groups.push({ label: "Autres", options: remaining });
  return groups;
}

function linesFromArray(values) {
  return Array.from(values ?? []).join("\n");
}

function arrayFromLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function arrayFromTagField(value) {
  return String(value ?? "")
    .split(/[\r\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeLegacyArmorTags(tags = []) {
  const values = Array.from(tags ?? []).map(String);
  if (!values.includes("weapon.shield")) return uniqueStrings(values);

  return uniqueStrings([
    ...values.filter((tag) => tag !== "weapon.shield"),
    "armor.shield"
  ]);
}

function ruleValuePlaceholder(key) {
  return ruleEffect(key)?.example ?? "";
}

function newRuleId() {
  return foundry.utils.randomID(16);
}

function specialtyParameterRows(item) {
  const modern = Array.from(item?.system?.parameters ?? []);
  const source = modern.length ? modern : specialtyParameterEntries(item);
  return source.map((entry, index) => ({
    index,
    key: String(entry?.key ?? ""),
    value: String(entry?.value ?? "")
  }));
}



function workSkillOptions(item) {
  const selected = String(item?.system?.skillIdentifier ?? "").trim();
  const actor = item?.parent?.documentName === "Actor" ? item.parent : null;
  const entries = actor
    ? listActorSkills(actor).map((skill) => ({
        identifier: String(skill.identifier ?? ""),
        label: `${skill.archetypeLabel} — ${skill.name}`
      }))
    : ARKHANVAL_ARCHETYPES.flatMap((archetype) => archetype.skills.map((skill) => ({
        identifier: skill.identifier,
        label: `${game.i18n.localize(archetype.labelKey)} — ${game.i18n.localize(skill.labelKey)}`
      })));

  const seen = new Set();
  const options = entries.filter((entry) => {
    if (!entry.identifier || seen.has(entry.identifier)) return false;
    seen.add(entry.identifier);
    return true;
  });
  const selectedKnown = options.some((entry) => entry.identifier === selected);

  return [
    { identifier: "", label: "— Choisir —", selected: !selected },
    ...(selected && !selectedKnown
      ? [{ identifier: selected, label: selected, selected: true }]
      : []),
    ...options.map((entry) => ({
      ...entry,
      selected: entry.identifier === selected
    }))
  ];
}

function weaponAutomaticEffects(item) {
  const actor = item?.parent?.documentName === "Actor" ? item.parent : null;
  if (!actor) return [];

  const tags = Array.from(item.system?.tags ?? []).map(String);
  if (!tags.length) return [];

  const matched = new Map();

  // Direct tag rules: family, usage, damage type, custom tags, etc.
  for (const rule of collectApplicableSpecialtyRules(actor, { tags })) {
    if (!String(rule.selector ?? "").startsWith("tag:")) continue;
    matched.set(`${rule.specialtyId}:${rule.id}`, rule);
  }

  // Skill selectors are extrapolated from the weapon's declared combat usages.
  // Example: a weapon tagged combat.one-handed is affected by rules targeting
  // the canonical "Armes à 1 main" skill.
  for (const skillIdentifier of combatSkillIdentifiersForWeaponTags(tags)) {
    for (const rule of collectApplicableSpecialtyRules(actor, { skillIdentifier })) {
      if (!String(rule.selector ?? "").startsWith("skill:")) continue;
      matched.set(`${rule.specialtyId}:${rule.id}`, rule);
    }
  }

  return Array.from(matched.values()).map((rule) => ({
    specialtyName: String(rule.specialtyName ?? "Spécialité"),
    label: String(rule.effect?.label ?? rule.key ?? "Effet"),
    value: String(rule.rawValue ?? "").trim() || "—"
  }));
}

/**
 * Generic Arkhanval Item sheet for the durable item contracts.
 *
 * This sheet exposes the already-existing tags/rules contracts through a small
 * declarative editor. No rule is applied here: resolution engines consume the
 * supported rule keys explicitly when their functional phase implements them.
 */
export class ArkhanvalItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  _deletingOwnedItem = false;
  _tagPanelOpen = false;
  _persistentRulesPanelOpen = false;
  _equipmentRulesSidebarOpen = false;
  _equipmentRulesClosedWidth = null;

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["arkhanval", "arkhanval-item-sheet"],
    position: {
      width: 720,
      height: "auto"
    },
    form: {
      handler: this.#handleSubmit,
      closeOnSubmit: false,
      submitOnChange: true
    },
    window: {
      resizable: true
    }
  };

  static PARTS = {
    body: {
      template: "systems/arkhanval/templates/item/item-sheet.hbs"
    }
  };

  static async #handleSubmit(event, form, formData, submitOptions = {}) {
    const submitData = this._prepareSubmitData(
      event,
      form,
      formData,
      submitOptions.updateData
    );

    if (this.item.type === "skill") {
      const name = submitData.name ?? this.item.name;
      const archetype = submitData["system.archetype"] ?? this.item.system.archetype;
      submitData["system.identifier"] = buildSkillIdentifier(archetype, name);
    }

    if (["skill", "specialty"].includes(this.item.type)) {
      const archetype = submitData["system.archetype"] ?? this.item.system.archetype;
      const linkedImage = archetypeItemImage(this.item.type, archetype);
      const archetypeChanged = event?.target?.name === "system.archetype";
      const currentImage = String(this.item.img ?? "").trim();
      const genericImage = String(foundry.documents.Item.DEFAULT_ICON ?? "icons/svg/item-bag.svg").trim();
      const managedImage = isManagedArchetypeItemImage(this.item.type, currentImage);
      if (linkedImage && (archetypeChanged || managedImage || !currentImage || currentImage === genericImage)) {
        submitData.img = linkedImage;
      }
    }

    const isRichTextChange = event?.type === "change"
      && event?.target?.localName === "prose-mirror";
    const operationOptions = isRichTextChange ? { render: false } : {};

    await this._processSubmitData(event, form, submitData, operationOptions);

    // Rich Text display uses pre-enriched HTML from _prepareContext. Force one
    // controlled refresh after the ProseMirror save so the rendered content
    // reflects the value that was just persisted, without reopening the sheet.
    if (isRichTextChange) await this.render({ force: false });
  }

  async _preClose(options) {
    if (!this._deletingOwnedItem && this.isEditable && this.form) await this.submit();
    return super._preClose(options);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const root = this.element;
    if (!root) return;

    const equipmentRulesToggle = root.querySelector("[data-equipment-rules-toggle]");
    if (equipmentRulesToggle) equipmentRulesToggle.addEventListener("click", (event) => {
      event.preventDefault();
      this._equipmentRulesSidebarOpen = !this._equipmentRulesSidebarOpen;
      const body = root.querySelector(".ark-item-layout--rules-sidebar");
      body?.classList.toggle("ark-item-layout--rules-open", this._equipmentRulesSidebarOpen);
      equipmentRulesToggle.setAttribute("aria-expanded", String(this._equipmentRulesSidebarOpen));
      const glyph = equipmentRulesToggle.querySelector("i");
      glyph?.classList.toggle("fa-chevron-left", !this._equipmentRulesSidebarOpen);
      glyph?.classList.toggle("fa-chevron-right", this._equipmentRulesSidebarOpen);

      // <details> must be open for its editor to render even when the summary
      // is hidden inside the right-hand grid column.
      const panel = root.querySelector("[data-persistent-rules-panel]");
      if (panel) panel.open = this._equipmentRulesSidebarOpen;
      this._persistentRulesPanelOpen = this._equipmentRulesSidebarOpen;

      // Only the right sidebar increases the window width; the 650px main
      // column and the 40px vertical control stay exactly the same size.
      const extraWidth = 310;
      if (this._equipmentRulesSidebarOpen) {
        this._equipmentRulesClosedWidth = Number(this.position.width) || 720;
        this.setPosition({ width: this._equipmentRulesClosedWidth + extraWidth });
      } else {
        this.setPosition({ width: this._equipmentRulesClosedWidth || 720 });
        this._equipmentRulesClosedWidth = null;
      }
    });

    if (!this.isEditable) return;

    if (this.item.type === "armor") {
      const currentTags = Array.from(this.item.system.tags ?? []).map(String);
      const normalizedTags = normalizeLegacyArmorTags(currentTags);
      const changed = normalizedTags.length !== currentTags.length
        || normalizedTags.some((tag, index) => tag !== currentTags[index]);
      if (changed) {
        await this.item.update({ "system.tags": normalizedTags });
        return;
      }
    }

    for (const input of root.querySelectorAll("[data-array-field]")) {
      input.addEventListener("change", (event) => this._onArrayFieldChange(event));
    }

    for (const input of root.querySelectorAll("[data-system-tag]")) {
      input.addEventListener("change", (event) => this._onSystemTagChange(event));
    }

    const weaponImage = root.querySelector("[data-weapon-image-picker]");
    if (weaponImage) weaponImage.addEventListener("click", (event) => this._onWeaponImagePick(event));

    const itemImage = root.querySelector("[data-item-image-picker]");
    if (itemImage) itemImage.addEventListener("click", (event) => this._onItemImagePick(event));

    const tagPanel = root.querySelector("[data-tag-panel]");
    if (tagPanel) {
      tagPanel.addEventListener("toggle", () => {
        this._tagPanelOpen = tagPanel.open;
      });
    }

    const persistentRulesPanel = root.querySelector("[data-persistent-rules-panel]");
    if (persistentRulesPanel) {
      persistentRulesPanel.addEventListener("toggle", () => {
        this._persistentRulesPanelOpen = persistentRulesPanel.open;
      });
    }

    for (const input of root.querySelectorAll("[data-weapon-family]")) {
      input.addEventListener("change", (event) => this._onWeaponFamilyChange(event));
    }

    const customTags = root.querySelector("[data-custom-tags]");
    if (customTags) customTags.addEventListener("change", (event) => this._onCustomTagsChange(event));

    const addParameter = root.querySelector("[data-specialty-parameter-add]");
    if (addParameter) addParameter.addEventListener("click", (event) => this._onSpecialtyParameterAdd(event));

    for (const control of root.querySelectorAll("[data-specialty-parameter-key], [data-specialty-parameter-value]")) {
      control.addEventListener("change", (event) => this._onSpecialtyParameterChange(event));
    }

    for (const button of root.querySelectorAll("[data-specialty-parameter-remove]")) {
      button.addEventListener("click", (event) => this._onSpecialtyParameterRemove(event));
    }

    const addRule = root.querySelector("[data-rule-add]");
    if (addRule) addRule.addEventListener("click", (event) => this._onRuleAdd(event));

    for (const control of root.querySelectorAll("[data-rule-key], [data-rule-selector], [data-rule-value], [data-rule-rounding], [data-rule-mode], [data-rule-custom-tag], [data-rule-parameter-key]")) {
      control.addEventListener("change", (event) => this._onRuleChange(event));
    }

    for (const button of root.querySelectorAll("[data-rule-remove]")) {
      button.addEventListener("click", (event) => this._onRuleRemove(event));
    }

    const saveButton = root.querySelector("[data-save-item]");
    if (saveButton) saveButton.addEventListener("click", async (event) => {
      event.preventDefault();
      // Auto-save is already handled by submitOnChange; close uses the same
      // _preClose submission path as the native window close button.
      await this.close();
    });

    // Trait display shows only the result band, but retains the canonical
    // `arksonge:1-3` / `arkentropie:1-3` source key for the table engine.
    const traitRange = root.querySelector("[data-trait-range]");
    if (traitRange) {
      const syncTraitSource = () => {
        const origin = String(root.querySelector('[name="system.origin"]')?.value ?? this.item.system.origin ?? "").trim();
        const range = String(traitRange.value ?? "").trim();
        const field = root.querySelector('[name="system.sourceKey"]');
        if (field) field.value = range ? (origin ? `${origin}:${range}` : range) : "";
      };
      traitRange.addEventListener("change", syncTraitSource);
      root.querySelector('[name="system.origin"]')?.addEventListener("change", syncTraitSource);
    }

    const workCompleted = root.querySelector("[data-work-completed]");
    if (workCompleted) workCompleted.addEventListener("change", async (event) => {
      await this.item.update({ "system.status": event.currentTarget.checked ? "completed" : "active" });
    });

    const deleteButton = root.querySelector("[data-delete-owned-item]");
    if (deleteButton) {
      deleteButton.addEventListener("click", (event) => this._onDeleteOwnedItem(event));
    }
  }

  async _onWeaponImagePick(event) {
    event.preventDefault();
    event.stopPropagation();

    const defaultDirectory = ARKHANVAL_ITEM_ASSET_DIRS.weapon;
    const FilePickerClass = FilePicker.implementation ?? FilePicker;
    const picker = new FilePickerClass({
      type: "image",
      current: defaultDirectory,
      document: this.item,
      callback: async (path) => {
        const selected = String(path ?? "").trim();
        if (!selected) return;
        await this.item.update({ img: selected });
      }
    });

    await picker.render({ force: true });
  }

  async _onItemImagePick(event) {
    event.preventDefault();
    event.stopPropagation();

    const defaultDirectory = ARKHANVAL_ITEM_ASSET_DIRS[this.item.type]
      ?? "systems/arkhanval/assets/items/";
    const FilePickerClass = FilePicker.implementation ?? FilePicker;
    const picker = new FilePickerClass({
      type: "image",
      current: defaultDirectory,
      document: this.item,
      callback: async (path) => {
        const selected = String(path ?? "").trim();
        if (!selected) return;
        await this.item.update({ img: selected });
      }
    });

    await picker.render({ force: true });
  }

  async _onArrayFieldChange(event) {
    const input = event.currentTarget;
    const field = input.dataset.arrayField;
    if (!field) return;

    await this.item.update({
      [`system.${field}`]: arrayFromLines(input.value)
    });
  }

  async _onSystemTagChange(event) {
    this._tagPanelOpen = true;
    const input = event.currentTarget;
    const tag = input.dataset.systemTag;
    if (!tag) return;

    const sourceTags = this.item.type === "armor"
      ? normalizeLegacyArmorTags(this.item.system.tags ?? [])
      : Array.from(this.item.system.tags ?? []);
    const tags = new Set(sourceTags);
    if (input.checked) tags.add(tag);
    else tags.delete(tag);

    await this.item.update({ "system.tags": Array.from(tags) });
  }

  async _onWeaponFamilyChange(event) {
    event.preventDefault();
    this._tagPanelOpen = true;

    const root = event.currentTarget.closest(".arkhanval-item-tags") ?? this.element;
    const selectedFamilies = uniqueStrings(
      Array.from(root?.querySelectorAll("[data-weapon-family]") ?? [])
        .map((control) => String(control.value ?? "").trim())
        .filter(Boolean)
    );

    const current = Array.from(this.item.system.tags ?? []);
    const nonFamily = current.filter((tag) => !String(tag).startsWith("weapon.family."));

    await this.item.update({
      "system.tags": [...selectedFamilies, ...nonFamily]
    });
  }

  async _onCustomTagsChange(event) {
    this._tagPanelOpen = true;
    const current = this.item.type === "armor"
      ? normalizeLegacyArmorTags(this.item.system.tags ?? [])
      : Array.from(this.item.system.tags ?? []);
    const standard = current.filter((tag) => knownTag(tag));
    const custom = arrayFromTagField(event.currentTarget.value)
      .map((tag) => normalizeCustomTag(tag))
      .filter(Boolean);

    await this.item.update({
      "system.tags": uniqueStrings([...standard, ...custom])
    });
  }

  async _onSpecialtyParameterAdd(event) {
    event.preventDefault();
    const modern = Array.from(this.item.system.parameters ?? []);
    const parameters = (modern.length ? modern : specialtyParameterEntries(this.item))
      .map((entry) => ({ ...entry }));
    parameters.push({ key: "", value: "" });
    await this.item.update({ "system.parameters": parameters });
  }

  _specialtyParametersFromForm(root = this.element) {
    return Array.from(root?.querySelectorAll("[data-specialty-parameter-row]") ?? [])
      .map((row) => ({
        key: String(row.querySelector("[data-specialty-parameter-key]")?.value ?? "").trim(),
        value: String(row.querySelector("[data-specialty-parameter-value]")?.value ?? "").trim()
      }))
      .filter((entry) => entry.key || entry.value);
  }

  async _onSpecialtyParameterChange(event) {
    const root = event.currentTarget.closest(".arkhanval-item-specialty-parameters") ?? this.element;
    await this.item.update({
      "system.parameters": this._specialtyParametersFromForm(root)
    });
  }

  async _onSpecialtyParameterRemove(event) {
    event.preventDefault();
    const index = Number(event.currentTarget.dataset.specialtyParameterRemove);
    if (!Number.isInteger(index) || index < 0) return;

    const modern = Array.from(this.item.system.parameters ?? []);
    const parameters = (modern.length ? modern : specialtyParameterEntries(this.item))
      .map((entry) => ({ ...entry }));
    parameters.splice(index, 1);
    await this.item.update({ "system.parameters": parameters });
  }

  async _onRuleAdd(event) {
    event.preventDefault();
    const rules = Array.from(this.item.system.rules ?? []).map((rule) => ({ ...rule }));
    rules.push({
      id: newRuleId(),
      key: ARKHANVAL_RULE_EFFECTS[0].id,
      selector: "any",
      value: "0",
      rounding: "",
      mode: ""
    });
    await this.item.update({ "system.rules": rules });
  }

  async _onRuleRemove(event) {
    event.preventDefault();
    const ruleId = event.currentTarget.dataset.ruleRemove;
    if (!ruleId) return;

    const rules = Array.from(this.item.system.rules ?? [])
      .filter((rule) => rule.id !== ruleId)
      .map((rule) => ({ ...rule }));
    await this.item.update({ "system.rules": rules });
  }

  async _onRuleChange(event) {
    const row = event.currentTarget.closest("[data-rule-id]");
    const ruleId = row?.dataset.ruleId;
    if (!row || !ruleId) return;

    const key = row.querySelector("[data-rule-key]")?.value ?? "";
    const selectorControl = row.querySelector("[data-rule-selector]");
    const selectorChoice = selectorControl?.value ?? "any";
    const customTagControl = row.querySelector("[data-rule-custom-tag]");
    const parameterKeyControl = row.querySelector("[data-rule-parameter-key]");
    const value = row.querySelector("[data-rule-value]")?.value ?? "";
    const rounding = row.querySelector("[data-rule-rounding]")?.value ?? "";
    const mode = row.querySelector("[data-rule-mode]")?.value ?? "";

    let selector = selectorChoice;
    if (selectorChoice === "__customTag__") {
      selector = buildCustomTagSelector(customTagControl?.value ?? "") || "tag:custom.";
    } else if (selectorChoice === "__parameterSkill__" || selectorChoice === "__parameterTag__") {
      const parameterKey = String(parameterKeyControl?.value ?? "").trim();
      const prefix = selectorChoice === "__parameterSkill__" ? "skill:" : "tag:";
      selector = `${prefix}@parameter.${parameterKey}`;
    }

    const rules = Array.from(this.item.system.rules ?? []).map((rule) => ({ ...rule }));
    const index = rules.findIndex((rule) => rule.id === ruleId);
    if (index < 0) return;

    rules[index] = {
      ...rules[index],
      key,
      selector,
      value: String(value).trim(),
      rounding: String(rounding).trim(),
      mode: String(mode).trim()
    };

    await this.item.update({ "system.rules": rules });
  }

  async _onDeleteOwnedItem(event) {
    event.preventDefault();
    if (!this.isEditable) return;

    const actor = this.item.parent;
    if (actor?.documentName !== "Actor") return;

    const confirmed = await DialogV2.confirm({
      window: {
        title: game.i18n.localize("ARKHANVAL.ItemSheet.DeleteTitle")
      },
      content: `<p>${game.i18n.localize(
        this.item.type === "state"
          ? "ARKHANVAL.ItemSheet.DeleteStateConfirm"
          : "ARKHANVAL.ItemSheet.DeleteConfirm"
      )}</p>`,
      rejectClose: false,
      modal: true,
      yes: {
        label: game.i18n.localize("ARKHANVAL.ItemSheet.DeleteYes"),
        icon: "fa-solid fa-trash"
      },
      no: {
        label: game.i18n.localize("ARKHANVAL.ItemSheet.DeleteNo")
      }
    });

    if (!confirmed) return;

    this._deletingOwnedItem = true;
    await actor.deleteEmbeddedDocuments("Item", [this.item.id]);
    await this.close();
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const type = this.item.type;

    context.item = this.item;
    context.system = this.item.system;
    context.editable = this.isEditable;
    context.readOnly = !this.isEditable;
    context.systemFields = this.item.system.schema.fields;
    context.enriched = {
      description: await enrichArkhanvalHTML(this.item.system.description, this.item),
      specialization: type === "spell"
        ? await enrichArkhanvalHTML(this.item.system.specialization, this.item)
        : "",
      notes: type === "wound"
        ? await enrichArkhanvalHTML(this.item.system.notes, this.item)
        : ""
    };
    context.typeLabel = game.i18n.localize(`TYPES.Item.${type}`);
    context.typeFlags = Object.fromEntries(
      ["people", "skill", "specialty", "state", "trait", "wound", "weapon", "armor", "equipment", "spell", "book", "work"]
        .map((itemType) => [itemType, itemType === type])
    );
    context.showStandardItemCore = ["equipment", "book", "work"].includes(type);
    context.showSimpleActions = ["equipment", "book", "work", "skill", "wound", "people", "state"].includes(type);
    context.sidebarRuleItem = ["equipment", "weapon", "armor", "trait", "spell", "specialty"].includes(type);
    context.advancedItemSidebar = ["weapon", "armor", "trait", "spell", "specialty"].includes(type);
    context.equipmentRulesSidebarOpen = context.sidebarRuleItem && this._equipmentRulesSidebarOpen;
    context.traitRange = String(this.item.system.sourceKey ?? "").split(":").slice(1).join(":")
      || String(this.item.system.sourceKey ?? "");
    context.workCompleted = type === "work" && this.item.system.status === "completed";
    context.canEditIdentifier = this.isEditable && game.user.isGM;
    context.declaredRules = summarizeDeclaredRules(this.item.system.rules, {
      selectorOptions: buildRuleSelectorOptions(),
      parameters: specialtyParameterRows(this.item)
    });
    context.itemImageTitle = `Changer l’icône — ${context.typeLabel}`;
    context.archetypeLinkedImage = ["skill", "specialty"].includes(type)
      ? (archetypeItemImage(type, this.item.system.archetype) || this.item.img)
      : this.item.img;

    context.archetypeOptions = [
      {
        id: "",
        label: game.i18n.localize("ARKHANVAL.ItemSheet.None"),
        selected: !this.item.system.archetype
      },
      ...ARKHANVAL_ARCHETYPES.map((archetype) => ({
        id: archetype.id,
        label: game.i18n.localize(archetype.labelKey),
        selected: this.item.system.archetype === archetype.id
      }))
    ];

    if (type === "specialty") {
      const explicitHandling = String(this.item.system.handling ?? "").trim();
      const resolvedHandling = explicitHandling
        || (Array.from(this.item.system.rules ?? []).length ? "automatic" : "narrative");
      context.handlingOptions = [
        ["automatic", "Automatisée"],
        ["assisted", "Assistée"],
        ["narrative", "Narrative / MJ"],
        ["suspended", "Suspendue"]
      ].map(([id, label]) => ({
        id,
        label,
        selected: id === resolvedHandling
      }));
      context.resolvedHandling = resolvedHandling;
    }

    context.traitOriginOptions = type === "trait"
      ? [
          { id: "", label: game.i18n.localize("ARKHANVAL.ItemSheet.TraitOriginNone"), selected: !String(this.item.system.origin ?? "") },
          { id: "arksonge", label: game.i18n.localize("ARKHANVAL.ItemSheet.TraitOriginArksonge"), selected: String(this.item.system.origin ?? "") === "arksonge" },
          { id: "arkentropie", label: game.i18n.localize("ARKHANVAL.ItemSheet.TraitOriginArkentropie"), selected: String(this.item.system.origin ?? "") === "arkentropie" }
        ]
      : [];

    context.severityOptions = [
      {
        id: "light",
        label: game.i18n.localize("ARKHANVAL.ItemSheet.SeverityLight"),
        selected: this.item.system.severity === "light"
      },
      {
        id: "serious",
        label: game.i18n.localize("ARKHANVAL.ItemSheet.SeveritySerious"),
        selected: this.item.system.severity === "serious"
      },
      {
        id: "critical",
        label: game.i18n.localize("ARKHANVAL.ItemSheet.SeverityCritical"),
        selected: this.item.system.severity === "critical"
      }
    ];

    context.requirementsText = linesFromArray(this.item.system.requirements);
    context.workSkillOptions = type === "work" ? workSkillOptions(this.item) : [];
    context.workStatusOptions = type === "work"
      ? [
          { id: "active", label: "En cours", selected: String(this.item.system.status ?? "active") !== "completed" },
          { id: "completed", label: "Terminé", selected: String(this.item.system.status ?? "active") === "completed" }
        ]
      : [];
    if (type === "spell") {
      const selectedCastingSkill = String(this.item.system.castingSkill ?? "").trim();
      const spellImage = String(this.item.img ?? "").trim();
      context.spellImage = (!spellImage || spellImage === "icons/svg/item-bag.svg")
        ? ARKHANVAL_ITEM_DEFAULT_IMAGES.spell
        : spellImage;

      const canonicalSkills = ARKHANVAL_ARCHETYPES.flatMap((archetype) => archetype.skills.map((entry) => ({
        identifier: entry.identifier,
        label: `${game.i18n.localize(archetype.labelKey)} — ${game.i18n.localize(entry.labelKey)}`,
        selected: entry.identifier === selectedCastingSkill
      })));
      const selectedIsKnown = canonicalSkills.some((entry) => entry.identifier === selectedCastingSkill);
      context.castingSkillOptions = [
        { identifier: "", label: "— Choisir —", selected: !selectedCastingSkill },
        ...(selectedCastingSkill && !selectedIsKnown
          ? [{ identifier: selectedCastingSkill, label: selectedCastingSkill, selected: true }]
          : []),
        ...canonicalSkills
      ];
      context.acquisitionStatusOptions = [
        { id: "mastered", label: "Sortilège connu", selected: String(this.item.system.acquisitionStatus ?? "mastered") !== "learning" },
        { id: "learning", label: "Sortilège en apprentissage", selected: String(this.item.system.acquisitionStatus ?? "mastered") === "learning" }
      ];
    } else {
      context.castingSkillOptions = [];
      context.acquisitionStatusOptions = [];
    }

    context.weaponAutomaticEffects = type === "weapon"
      ? weaponAutomaticEffects(this.item)
      : [];
    context.hasWeaponAutomaticEffects = context.weaponAutomaticEffects.length > 0;

    const tagOptions = tagOptionsForItemType(type);
    const currentTags = type === "armor"
      ? normalizeLegacyArmorTags(this.item.system.tags ?? [])
      : Array.from(this.item.system.tags ?? []);
    context.showWeaponRangeFields = type === "weapon" && (
      currentTags.includes("combat.ranged") || currentTags.includes("combat.thrown")
    );
    const weaponFamilyOptions = type === "weapon"
      ? tagOptions
          .filter((tag) => tag.id.startsWith("weapon.family."))
          .sort((left, right) => left.label.localeCompare(right.label, "fr", { sensitivity: "base" }))
      : [];
    const weaponFamilyIds = new Set(weaponFamilyOptions.map((tag) => tag.id));

    context.showTagEditor = tagOptions.length > 0 && !["armor", "spell"].includes(type);
    context.tagPanelOpen = this._tagPanelOpen;
    context.tagPanelTitle = type === "weapon"
      ? "Type d’arme"
      : type === "armor"
        ? "Type d’armure"
        : type === "spell"
          ? "Type de sort"
          : "Classification";

    const taggedOptions = tagOptions
      .filter((tag) => !weaponFamilyIds.has(tag.id))
      .map((tag) => ({
        ...tag,
        checked: currentTags.includes(tag.id)
      }));

    context.armorTypeOptions = [];

    if (type === "weapon") {
      const weaponTypeIds = new Set([
        "combat.one-handed",
        "combat.two-handed",
        "combat.thrown",
        "combat.ranged",
        "weapon.defensive",
        "weapon.shield"
      ]);
      context.weaponTypeOptions = taggedOptions
        .filter((tag) => weaponTypeIds.has(tag.id))
        .map((tag) => ({
          ...tag,
          label: tag.label.replace(/^Combat\s*:\s*/i, "")
        }));
      context.weaponDamageOptions = taggedOptions
        .filter((tag) => tag.id.startsWith("damage."))
        .map((tag) => ({
          ...tag,
          label: tag.label.replace(/^Dégâts\s*:\s*/i, "")
        }));
      context.tagOptions = [];
    } else if (type === "armor") {
      context.weaponTypeOptions = [];
      context.weaponDamageOptions = [];
      context.armorTypeOptions = taggedOptions
        .filter((tag) => tag.id.startsWith("armor."));
      context.tagOptions = [];
    } else {
      context.weaponTypeOptions = [];
      context.weaponDamageOptions = [];
      context.tagOptions = type === "spell"
        ? taggedOptions.map((tag) => ({ ...tag, magicLabel: tag.label.replace(/^Magie\s*:\s*/i, "") }))
        : taggedOptions;
    }

    if (type === "weapon") {
      const selectedFamilies = currentTags.filter((tag) => weaponFamilyIds.has(tag));
      const familyRows = [...selectedFamilies, ""].slice(0, weaponFamilyOptions.length);
      if (!familyRows.length) familyRows.push("");

      context.weaponFamilyRows = familyRows.map((selected, index) => ({
        index,
        options: [
          {
            value: "",
            label: index === 0 ? "— Aucune famille —" : "— Ajouter une famille —",
            selected: !selected
          },
          ...weaponFamilyOptions.map((tag) => ({
            value: tag.id,
            label: tag.label.replace(/^Famille\s*:\s*/i, ""),
            selected: tag.id === selected
          }))
        ]
      }));
    } else {
      context.weaponFamilyRows = [];
    }

    context.customTagsText = currentTags
      .filter((tag) => !knownTag(tag))
      .map((tag) => customTagLabel(tag))
      .join(", ");

    const contextualRuleItems = new Set(["weapon", "armor", "equipment", "spell"]);
    context.directRuleItem = ["people", "state"].includes(type);
    context.showPersistentRuleItem = context.directRuleItem || type === "trait" || type === "specialty" || contextualRuleItems.has(type);
    context.showPersistentRuleDescription = context.directRuleItem;
    context.showRuleParameters = context.showPersistentRuleItem && type !== "people";
    context.showPersistentRuleTechnical = ["people", "state", "trait", "equipment", "weapon", "armor", "spell", "specialty"].includes(type);
    context.persistentRulesPanelOpen = context.directRuleItem || context.sidebarRuleItem || this._persistentRulesPanelOpen;
    context.persistentRulesTitle = type === "trait"
      ? "Effets mécaniques du Trait"
      : type === "people"
        ? "Effets mécaniques du peuple"
      : type === "state"
        ? "Règles de l’état"
        : type === "specialty"
          ? "Règles de la spécialité"
        : type === "weapon"
          ? "Effets mécaniques de l’arme"
          : type === "armor"
            ? "Effets mécaniques de l’armure"
            : type === "equipment"
              ? "Effets mécaniques de l’équipement"
              : "Effets mécaniques du sortilège";
    context.persistentRulesEmptyText = type === "trait"
      ? "Aucune règle déclarative. Le Trait reste descriptif et géré manuellement."
      : type === "people"
        ? "Aucune règle déclarative. Le peuple reste descriptif et géré manuellement."
      : type === "state"
        ? "Aucune règle déclarative. L’état reste descriptif et géré manuellement."
        : type === "specialty"
          ? "Aucune règle déclarative. La spécialité reste descriptive et gérée manuellement."
          : "Aucune règle déclarative. Cet Item reste descriptif et géré manuellement.";

    if (type === "specialty" || context.showPersistentRuleItem) {
      // States share the generic persistent-parameter vocabulary used by
      // specialties so complex selectors can reference @parameter.<key>.
      context.parameterRows = specialtyParameterRows(this.item);
      const selectorOptions = buildRuleSelectorOptions();
      context.ruleRows = Array.from(this.item.system.rules ?? []).map((rule) => {
        const rawSelector = String(rule.selector ?? "any");
        const parameterSelectorMatch = rawSelector.match(/^(skill|tag):@parameter\.([A-Za-z0-9_-]*)$/);
        const customSelector = !parameterSelectorMatch && selectorUsesCustomTag(rawSelector);
        const selectedSelector = parameterSelectorMatch
          ? (parameterSelectorMatch[1] === "skill" ? "__parameterSkill__" : "__parameterTag__")
          : customSelector
            ? "__customTag__"
            : (rawSelector || "any");
        return {
          id: rule.id,
          key: rule.key,
          selector: rule.selector,
          value: rule.value,
          rounding: String(rule.rounding ?? ""),
          mode: String(rule.mode ?? ""),
          showRounding: rule.key === "roll.diceMultiplier",
          showKeepMode: rule.key === "roll.repeatKeep",
          roundingOptions: [
            { value: "", label: "— Choisir —", selected: !rule.rounding },
            { value: "ceil", label: "Supérieur", selected: rule.rounding === "ceil" },
            { value: "floor", label: "Inférieur", selected: rule.rounding === "floor" },
            { value: "round", label: "Standard", selected: rule.rounding === "round" }
          ],
          keepModeOptions: [
            { value: "", label: "— Choisir —", selected: !rule.mode },
            { value: "best", label: "Meilleur", selected: rule.mode === "best" },
            { value: "worst", label: "Pire", selected: rule.mode === "worst" }
          ],
          customSelector,
          parameterSelector: Boolean(parameterSelectorMatch),
          parameterKey: parameterSelectorMatch?.[2] ?? "",
          customTag: selectorCustomTagLabel(rule.selector),
          valuePlaceholder: ruleValuePlaceholder(rule.key),
          keyGroups: groupedRuleEffectOptions(rule.key),
          selectorOptions: [
            ...selectorOptions
              .filter((entry) => context.showRuleParameters || !["__parameterSkill__", "__parameterTag__"].includes(entry.value))
              .map((entry) => ({
                ...entry,
                selected: entry.value === selectedSelector
              })),
            {
              value: "__customTag__",
              label: "Tag personnalisé…",
              group: "Personnalisé",
              selected: customSelector
            }
          ]
        };
      });
      context.ruleVariables = ARKHANVAL_SYSTEM_VARIABLES;
    }

    const parent = this.item.parent;
    context.isOwned = parent?.documentName === "Actor";
    context.ownerName = context.isOwned ? parent.name : "";
    context.canDeleteOwned = context.isOwned && this.item.type !== "wound" && !(
      this.item.type === "skill" && isNativeSkillItem(this.item)
    );

    return context;
  }
}
