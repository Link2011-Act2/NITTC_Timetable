export const knownAttributes = [['DD', 'DD'], ['INTERNATIONAL', '留学生']];
export function attributeTokens(value) {
  return String(value || '').split(/[,，\s]+/u).filter(Boolean);
}
export function toggleAttribute(value, id, checked) {
  const items = attributeTokens(value).filter(item => item !== id);
  if (checked) items.push(id);
  return [...new Set(items)].join(', ');
}
export function setCustomAttributes(value, custom) {
  const known = new Set(knownAttributes.map(([id]) => id));
  return [...new Set([...attributeTokens(value).filter(id => known.has(id)), ...attributeTokens(custom)])].join(', ');
}
