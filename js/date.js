// D1 datetime('now') is UTC without a suffix; ISO timestamps may already include a zone.
export function parseDate(value) {
  if (typeof value !== 'string' || !value.trim()) return new Date(NaN);
  let iso = value.trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(iso)) iso += 'Z';
  return new Date(iso);
}
