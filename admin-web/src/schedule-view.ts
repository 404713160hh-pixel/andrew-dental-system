import type { Page } from '@andrew/shared';

/** Calendar arithmetic uses date-only UTC values, independent of browser timezone or DST. */
export function moveCalendarDate(value: string, days: number): string {
  const start = new Date(value + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== value)
    throw new Error('日期无效');
  start.setUTCDate(start.getUTCDate() + days);
  return start.toISOString().slice(0, 10);
}
export function calendarWeek(selected: string, today: string) {
  const anchor = selected || today;
  const weekday = new Date(anchor + 'T00:00:00Z').getUTCDay();
  const monday = moveCalendarDate(anchor, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const date = moveCalendarDate(monday, index);
    return { date, weekday: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][index]!,
      label: date.slice(5).replace('-', '/'), selected: date === selected, today: date === today };
  });
}
export function isDoctorOnly(roles: readonly string[] = []) {
  return roles.includes('doctor') && !roles.some(role => ['hq', 'manager', 'front'].includes(role));
}
export function groupByDoctor<T extends { id: string; doctorId: string; doctorName: string; startsAt: string }>(items: readonly T[]) {
  const groups = new Map<string, { doctorId: string; doctorName: string; items: T[] }>();
  for (const item of items) {
    if (!groups.has(item.doctorId)) groups.set(item.doctorId, { doctorId: item.doctorId, doctorName: item.doctorName, items: [] });
    groups.get(item.doctorId)!.items.push(item);
  }
  return [...groups.values()].sort((a, b) => a.doctorName.localeCompare(b.doctorName, 'zh-CN') || a.doctorId.localeCompare(b.doctorId))
    .map(group => ({ ...group, items: group.items.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)) }));
}

export type PageCollectionReason = 'changed' | 'invalid' | 'limit' | 'superseded';
/** A bounded full-day read, never a capacity calculation or a transaction snapshot. */
export async function collectAppointmentPages<T extends { id: string; rowVersion: number }>(
  fetchPage: (page: number, pageSize: number) => Promise<Page<T>>,
  current: () => boolean = () => true,
  maximumPages = 100,
): Promise<{ items: T[]; total: number; complete: boolean; reason?: PageCollectionReason }> {
  const size = 100;
  const items: T[] = [];
  const ids = new Set<string>();
  let total = 0;
  let first: T[] = [];
  const incomplete = (reason: PageCollectionReason) => ({ items, total, complete: false, reason });
  const fingerprint = (rows: T[]) => JSON.stringify(rows.map(item => [item.id, item.rowVersion]));
  for (let page = 1; page <= maximumPages; page++) {
    if (!current()) return incomplete('superseded');
    const result = await fetchPage(page, size);
    if (!current()) return incomplete('superseded');
    if (!Number.isSafeInteger(result.total) || result.total < 0 || result.page !== page || result.pageSize !== size || !Array.isArray(result.items)) return incomplete('invalid');
    if (page === 1) { total = result.total; first = result.items; }
    if (result.total !== total) return incomplete('changed');
    if (result.items.length !== Math.min(size, Math.max(0, total - (page - 1) * size))) return incomplete('changed');
    for (const item of result.items) {
      if (!item.id || !Number.isSafeInteger(item.rowVersion) || ids.has(item.id)) return incomplete('changed');
      ids.add(item.id); items.push(item);
    }
    if (items.length === total) {
      // Paging can race with mutations. Recheck the leading page and total before
      // calling the displayed collection complete; remaining snapshot limits are explicit.
      if (page > 1) {
        const head = await fetchPage(1, size);
        if (!current()) return incomplete('superseded');
        if (head.total !== total || head.page !== 1 || head.pageSize !== size || !Array.isArray(head.items) || fingerprint(head.items) !== fingerprint(first)) return incomplete('changed');
      }
      return { items, total, complete: true };
    }
  }
  return incomplete('limit');
}
