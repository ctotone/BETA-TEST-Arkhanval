import {
  ARKHANVAL_ARCHETYPE_IDS,
  WOUND_CAPACITY_BY_ARKOEUR
} from "../../config.mjs";

const fields = foundry.data.fields;

function integerField({ min, max, initial = 0 } = {}) {
  return new fields.NumberField({
    required: true,
    nullable: false,
    integer: true,
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    initial
  });
}

function textField() {
  return new fields.StringField({
    required: true,
    nullable: false,
    blank: true,
    initial: ""
  });
}

function htmlField() {
  return new fields.HTMLField({
    required: true,
    nullable: false,
    blank: true,
    initial: ""
  });
}

function arkField() {
  return new fields.SchemaField({
    // Ark values can be driven below zero by rules content, so no lower bound
    // is enforced at the persistence layer.
    rank: integerField({ initial: 0 }),
    circles: integerField({ min: 0, max: 10, initial: 0 })
  });
}

/**
 * Durable character data contract present in the current system.
 *
 * Reusable game content is intentionally not stored here: people, skills,
 * specialties, wounds, gear, spells and books are Embedded Items.
 */
export class ArkhanvalCharacterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const archetypeXp = Object.fromEntries(
      ARKHANVAL_ARCHETYPE_IDS.map((id) => [id, integerField({ min: 0 })])
    );

    return {
      identity: new fields.SchemaField({
        origin: textField(),
        appearance: htmlField()
      }),

      archetypes: new fields.SchemaField({
        primary: new fields.ArrayField(new fields.StringField({
          required: true,
          nullable: false,
          blank: false,
          choices: ARKHANVAL_ARCHETYPE_IDS
        }), {
          max: 2
        }),
        xp: new fields.SchemaField(archetypeXp)
      }),

      arks: new fields.SchemaField({
        arksonge: arkField(),
        arkentropie: arkField(),
        arkoeur: arkField()
      }),

      combat: new fields.SchemaField({
        technique: textField()
      }),

      wealth: new fields.SchemaField({
        electrum: integerField({ min: 0 }),
        deniers: integerField({ min: 0 }),
        sous: integerField({ min: 0 })
      }),

      // Persistent vanilla states.
      // Each active state is exposed as a generic virtual rules[] source.
      // Author clarification: their FD +2 penalties stack (+2 / +4 / +6).
      states: new fields.SchemaField({
        groggy: new fields.BooleanField({ required: true, nullable: false, initial: false }),
        stunned: new fields.BooleanField({ required: true, nullable: false, initial: false }),
        greatPain: new fields.BooleanField({ required: true, nullable: false, initial: false })
      }),

      notes: new fields.SchemaField({
        arks: htmlField(),
        creation: textField(),
        // Carnet riche libre du joueur, indépendant des notes PNJ.
        player: htmlField()
      })
    };
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    const rank = Number(this.arks?.arkoeur?.rank);
    this.woundCapacity = WOUND_CAPACITY_BY_ARKOEUR[rank] ?? null;
  }
}
