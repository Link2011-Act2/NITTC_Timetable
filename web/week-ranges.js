// A week number is meaningful only after its dates have been confirmed separately.
export function parseWeekRange(subject) {
  if (typeof subject !== 'string') return null;
  const match = subject.match(/^(.*?)\s*([（(]\s*([0-9０-９]*)\s*[〜～~⁓－-]\s*([0-9０-９]*)\s*週\s*[）)])\s*$/u)
    || subject.match(/^(.*?)\s*([（(]\s*([0-9０-９]+)\s*週\s*[〜～~⁓－-]\s*([0-9０-９]*)\s*[）)])\s*$/u);
  if (!match || (!match[3] && !match[4])) return null;
  const number = value => value ? Number(value.normalize('NFKC')) : null;
  const start = number(match[3]), end = number(match[4]);
  if ((start !== null && start < 1) || (end !== null && end < 1) || (start !== null && end !== null && start > end)) return null;
  return {subject:match[1].trim(), activeWeekRange:{start,end}, notation:match[2]};
}

// Explicit date-to-week mappings are the only accepted source of week numbers.
export function weekRangeApplies(range, date, weeks) {
  const number = weeks?.[date];
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return (range.start === null || number >= range.start) && (range.end === null || number <= range.end);
}
