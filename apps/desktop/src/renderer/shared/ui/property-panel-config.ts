export type PropertyField<Id extends string> = {
  id: Id;
  label: string;
  maxLength?: number;
};

export type PropertyPanelStyle = {
  fontSize: string;
  smallFontSize: string;
  gap: string;
};

export const propertyPanelDefaults: PropertyPanelStyle = {
  fontSize: '12px',
  smallFontSize: '11px',
  gap: '7px',
};

export function resolvePropertyPanel<Id extends string>(
  fields: readonly PropertyField<Id>[],
  page: { fieldIds: readonly Id[]; style?: Partial<PropertyPanelStyle> },
  subpage: { fieldIds?: readonly Id[]; style?: Partial<PropertyPanelStyle> } = {},
) {
  const byId = new Map<Id, PropertyField<Id>>();
  for (const field of fields) {
    if (byId.has(field.id)) throw new Error(`Duplicate field: ${field.id}`);
    if (
      !field.label ||
      (field.maxLength !== undefined &&
        (!Number.isInteger(field.maxLength) || field.maxLength <= 0))
    )
      throw new Error(`Invalid field: ${field.id}`);
    byId.set(field.id, field);
  }
  const checkIds = (ids: readonly Id[]) => {
    const seen = new Set<Id>();
    for (const id of ids) {
      if (!byId.has(id) || seen.has(id)) throw new Error(`Unknown or duplicate field: ${id}`);
      seen.add(id);
    }
  };
  checkIds(page.fieldIds);
  if (subpage.fieldIds) {
    checkIds(subpage.fieldIds);
    if (subpage.fieldIds.some((id) => !page.fieldIds.includes(id)))
      throw new Error('Subpage field is not present on page');
  }
  for (const style of [page.style, subpage.style]) {
    if (
      style &&
      Object.entries(style).some(
        ([key, value]) =>
          !Object.hasOwn(propertyPanelDefaults, key) || typeof value !== 'string' || !value.trim(),
      )
    )
      throw new Error('Invalid style override');
  }
  return {
    fields: (subpage.fieldIds ?? page.fieldIds).map((id) => byId.get(id)!),
    style: { ...propertyPanelDefaults, ...page.style, ...subpage.style },
  };
}
