import {
  ArkhanvalItemData,
  booleanField,
  integerField,
  stringArrayField,
  textField,
  withBase
} from "./base-item.mjs";

const fields = foundry.data.fields;

const parameterField = () => new fields.SchemaField({
  key: textField(),
  value: textField()
});


export class ArkhanvalPeopleData extends ArkhanvalItemData {
  static defineSchema() {
    return withBase({
      selections: new fields.ArrayField(parameterField())
    });
  }
}

export class ArkhanvalSkillData extends ArkhanvalItemData {
  static defineSchema() {
    return withBase({
      archetype: textField(),
      rank: integerField({ min: 0 }),
      xp: integerField()
    });
  }
}

export class ArkhanvalSpecialtyData extends ArkhanvalItemData {
  static defineSchema() {
    return withBase({
      archetype: textField(),
      repeatable: booleanField(false),
      // Empty means legacy fallback: rules[] => automatic, otherwise narrative.
      handling: textField(),
      acquisition: new fields.SchemaField({
        creationOnly: booleanField(false),
        lateCostMultiplier: new fields.NumberField({
          required: true,
          nullable: false,
          min: 0,
          initial: 1
        })
      }),
      // Legacy single parameter kept for backward compatibility.
      parameter: parameterField(),
      // Canonical storage: ordered, multi-valued and role-aware.
      parameters: new fields.ArrayField(parameterField())
    });
  }
}


export class ArkhanvalStateData extends ArkhanvalItemData {
  static defineSchema() {
    return withBase({
      // Same generic parameter vocabulary as specialties, without specialty-specific behavior fields.
      // Legacy single parameter is retained for compatibility with generic rule helpers.
      parameter: parameterField(),
      parameters: new fields.ArrayField(parameterField()),
      // Generic lifecycle metadata for temporary/reminder states. These values
      // are technical data; user-facing text must never be parsed to recover them.
      tracking: new fields.SchemaField({
        mode: textField(),
        combatId: textField(),
        appliedRound: integerField({ min: 0 }),
        expiresRound: integerField({ min: 0 }),
        reminderKey: textField()
      })
    });
  }
}



export class ArkhanvalTraitData extends ArkhanvalItemData {
  static defineSchema() {
    return withBase({
      origin: new fields.StringField({
        required: true,
        nullable: false,
        blank: true,
        initial: "",
        choices: ["", "arksonge", "arkentropie"]
      }),
      sourceKey: textField(),
      // Traits use the same persistent parameter vocabulary as specialties/states
      // so their rules may target configurable skills, tags or other selectors.
      parameter: parameterField(),
      parameters: new fields.ArrayField(parameterField())
    });
  }
}

export class ArkhanvalWoundData extends ArkhanvalItemData {
  static defineSchema() {
    return withBase({
      severity: new fields.StringField({
        required: true,
        nullable: false,
        blank: false,
        initial: "light",
        choices: ["light", "serious", "critical"]
      }),
      treated: booleanField(false),
      notes: new fields.HTMLField({
        required: true,
        nullable: false,
        blank: true,
        initial: ""
      })
    });
  }
}

export class ArkhanvalWeaponData extends ArkhanvalItemData {
  static defineSchema() {
    return withBase({
      // Common persistent rule-parameter editor (e.g. skill, sourceSkill, tags).
      parameters: new fields.ArrayField(parameterField()),
      // Kept for backward compatibility. Combat selection no longer depends on it.
      equipped: booleanField(false),
      damage: textField(),
      price: textField(),
      fabrication: textField(),
      standardRange: textField(),
      longRange: textField(),
      armorPenetration: integerField({ min: 0 })
    });
  }
}

export class ArkhanvalArmorData extends ArkhanvalItemData {
  static defineSchema() {
    return withBase({
      // Common persistent rule-parameter editor (e.g. skill, sourceSkill, tags).
      parameters: new fields.ArrayField(parameterField()),
      protection: new fields.SchemaField({
        base: integerField(),
        current: integerField()
      }),
      equipped: booleanField(false),
      price: textField(),
      fabrication: textField(),
      restrictions: textField(),
      encumbrance: textField()
    });
  }
}

export class ArkhanvalEquipmentData extends ArkhanvalItemData {
  static defineSchema() {
    return withBase({
      // Common persistent rule-parameter editor (e.g. skill, sourceSkill, tags).
      parameters: new fields.ArrayField(parameterField()),
      quantity: integerField({ min: 0, initial: 1 }),
      equipped: booleanField(false),
      price: textField()
    });
  }
}

export class ArkhanvalSpellData extends ArkhanvalItemData {
  static defineSchema() {
    return withBase({
      // Common persistent rule-parameter editor (e.g. skill, sourceSkill, tags).
      parameters: new fields.ArrayField(parameterField()),
      requirements: stringArrayField(),
      castingSkill: textField(),
      magicPoints: integerField(),
      fd: integerField(),
      range: textField(),
      area: textField(),
      duration: textField(),
      castingCadence: textField(),
      specialization: new fields.HTMLField({
        required: true,
        nullable: false,
        blank: true,
        initial: ""
      }),
      acquisitionStatus: new fields.StringField({
        required: true,
        nullable: false,
        blank: false,
        initial: "mastered",
        choices: ["mastered", "learning"]
      }),
      learningXp: integerField({ min: 0 }),
      learningTarget: integerField({ min: 0 })
    });
  }
}

export class ArkhanvalWorkData extends ArkhanvalItemData {
  static defineSchema() {
    return withBase({
      progress: new fields.SchemaField({
        current: integerField({ min: 0 }),
        target: integerField({ min: 0 })
      }),
      status: new fields.StringField({
        required: true,
        nullable: false,
        blank: false,
        initial: "active",
        choices: ["active", "completed"]
      }),
      skillIdentifier: textField(),
      fd: integerField({ min: 0, initial: 6 })
    });
  }
}

export class ArkhanvalBookData extends ArkhanvalItemData {
  static defineSchema() {
    return withBase({
      author: textField(),
      reading: new fields.SchemaField({
        fd: integerField(),
        required: integerField(),
        progress: integerField(),
        completed: booleanField(false)
      })
    });
  }
}


export const ARKHANVAL_ITEM_DATA_MODELS = Object.freeze({
  weapon: ArkhanvalWeaponData,
  armor: ArkhanvalArmorData,
  book: ArkhanvalBookData,
  skill: ArkhanvalSkillData,
  equipment: ArkhanvalEquipmentData,
  wound: ArkhanvalWoundData,
  people: ArkhanvalPeopleData,
  spell: ArkhanvalSpellData,
  work: ArkhanvalWorkData,
  specialty: ArkhanvalSpecialtyData,
  state: ArkhanvalStateData,
  trait: ArkhanvalTraitData
});
