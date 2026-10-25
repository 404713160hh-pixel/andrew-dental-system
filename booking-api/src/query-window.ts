const DAY = 86400000;
const CHINA_OFFSET = 8 * 3600000;
export const QUERY_MIN_DAYS = -1;
export const QUERY_MAX_DAYS = 90;

/** Preserve the existing difference between China-midnight and the current instant. */
export function isQueryDateAllowed(date: string, now = Date.now()): boolean {
  const days = (Date.parse(date + 'T00:00:00+08:00') - now) / DAY;
  return days >= QUERY_MIN_DAYS && days <= QUERY_MAX_DAYS;
}
export function queryWindow(now = Date.now()) {
  // China-midnight timestamps lie at k * DAY - CHINA_OFFSET.
  const first = Math.ceil((now + QUERY_MIN_DAYS * DAY + CHINA_OFFSET) / DAY);
  const last = Math.floor((now + QUERY_MAX_DAYS * DAY + CHINA_OFFSET) / DAY);
  return { fromDate: new Date(first * DAY).toISOString().slice(0, 10), toDate: new Date(last * DAY).toISOString().slice(0, 10) };
}
