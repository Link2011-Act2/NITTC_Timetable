const pattern = /^([0-9]{4})\.([SF])\.(0|[1-9][0-9]{0,127})(\.Beta)?$/;

export function revisionMatches(revision, year, term) {
  const match = typeof revision === 'string' ? pattern.exec(revision) : null;
  return match !== null && match[0] === revision && match[1] === String(year) && match[2] === term;
}
