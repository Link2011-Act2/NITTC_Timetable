const romanNumerals = new Map([
  ['I', 'I'], ['II', 'II'], ['III', 'III'], ['IV', 'IV'], ['V', 'V'],
  ['VI', 'VI'], ['VII', 'VII'], ['VIII', 'VIII'], ['IX', 'IX'], ['X', 'X'],
]);
const digitNumerals = new Map([
  ['1', 'I'], ['2', 'II'], ['3', 'III'], ['4', 'IV'], ['5', 'V'],
  ['6', 'VI'], ['7', 'VII'], ['8', 'VIII'], ['9', 'IX'], ['10', 'X'],
]);

/** Canonical display spelling for the combined health-and-physical-education subject. */
export function normalizeSubjectName(value) {
  if (typeof value !== 'string') return value;
  value = value.replace(/[\u2160-\u2188]/gu, char => char.normalize('NFKC'));
  const match = value.match(/^(\s*)(?:保健\s*(?:[・･·]\s*)?体育|保体)(.*)$/u);
  if (!match) return value;

  const suffix = match[2].trimStart();
  if (suffix && !/^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVXLCDMivxlcdm0-9０-９]|[（(])/u.test(suffix) && !/^\s/u.test(match[2])) return value;
  const numeral = suffix.match(/^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+|[IVXLCDMivxlcdm]+|[0-9０-９]+)(?=$|[\s（(])/u);
  if (!numeral) return `${match[1]}保体${suffix}`;

  const token = numeral[1];
  const ascii = token.normalize('NFKC').toUpperCase();
  const canonical = romanNumerals.get(ascii) || digitNumerals.get(ascii);
  if (!canonical) return `${match[1]}保体${suffix}`;
  return `${match[1]}保体${canonical}${suffix.slice(token.length)}`;
}

/** Exact comparison key; display strings and stored source text remain untouched. */
export function subjectIdentityKey(value) {
  return String(normalizeSubjectName(value) ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, '')
    .toLocaleLowerCase('ja-JP');
}

export function normalizeSktjfSubjectNames(data) {
  const normalized = structuredClone(data);
  for (const lesson of normalized.lessons || []) {
    lesson.subject = normalizeSubjectName(lesson.subject);
  }
  return normalized;
}
