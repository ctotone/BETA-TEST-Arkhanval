const fields = foundry.data.fields;

export function textField({ blank = true, initial = "" } = {}) {
  return new fields.StringField({
    required: true,
    nullable: false,
    blank,
    initial
  });
}

export function integerField({ min = 0, max, initial = 0 } = {}) {
  return new fields.NumberField({
    required: true,
    nullable: false,
    integer: true,
    min,
    ...(max === undefined ? {} : { max }),
    initial
  });
}

export function booleanField(initial = false) {
  return new fields.BooleanField({
    required: true,
    nullable: false,
    initial
  });
}

export function stringArrayField() {
  return new fields.ArrayField(new fields.StringField({
    required: true,
    nullable: false,
    blank: false
  }));
}

export function ruleCollectionField() {
  return new fields.ArrayField(new fields.SchemaField({
    id: textField({ blank: false }),
    key: textField({ blank: false }),
    selector: textField(),
    value: textField(),
    // Optional metadata used only by rule families that need it.
    rounding: textField(),
    mode: textField()
  }));
}

export class ArkhanvalItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: textField(),
      description: new fields.HTMLField({
        required: true,
        nullable: false,
        blank: true,
        initial: ""
      }),
      tags: stringArrayField(),
      // Declarative rules are available to every Item type. Consumers decide
      // which rule families they understand for their own workflow.
      rules: ruleCollectionField()
    };
  }
}

export function withBase(schema) {
  return {
    ...ArkhanvalItemData.defineSchema(),
    ...schema
  };
}
