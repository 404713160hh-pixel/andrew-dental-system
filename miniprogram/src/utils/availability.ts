import type { BookingSlot } from '../types';

export function queryWindowLimits(value: unknown, today: string): { minDate: string; maxDate: string } {
  const window = value as { fromDate?: unknown; toDate?: unknown } | null;
  const valid = (date: unknown): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date + 'T00:00:00Z')) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
  if (!window || !valid(window.fromDate) || !valid(window.toDate) || window.fromDate > window.toDate || window.toDate < today)
    throw new Error('预约日期范围暂未读取完成，请原地重试。');
  return { minDate: window.fromDate > today ? window.fromDate : today, maxDate: window.toDate };
}

export function dayAfter(date: string, days: number): string {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// Vant's calendar works with local calendar days. Construct its timestamps from
// date parts, then send the selected YYYY-MM-DD to our China-time booking API.
export function calendarTimestamp(date: string): number {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

export function calendarDateText(value: Date | number): string {
  const date = new Date(value instanceof Date ? value.getTime() : value);
  if (!Number.isFinite(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function quickDateChoices(today: string) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = dayAfter(today, index);
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(date + 'T00:00:00Z').getUTCDay()] ?? '';
    return { date, label: index === 0 ? '今天' : index === 1 ? '明天' : weekday, number: date.slice(8), month: Number(date.slice(5, 7)) + '月' };
  });
}

export interface SlotGroup { key: string; title: string; indices: number[] }
export function groupSlotIndices(slots: BookingSlot[]): SlotGroup[] {
  const groups: SlotGroup[] = [
    { key: 'morning', title: '上午', indices: [] },
    { key: 'afternoon', title: '下午', indices: [] },
    { key: 'evening', title: '晚间', indices: [] },
  ];
  slots.forEach((slot, index) => {
    const hour = new Date(Date.parse(slot.startsAt) + 8 * 3600000).getUTCHours();
    if (!Number.isFinite(hour)) throw new Error('号源时间暂时无法读取，请重新查询。');
    groups[hour < 12 ? 0 : hour < 18 ? 1 : 2]!.indices.push(index);
  });
  return groups.filter(group => group.indices.length > 0);
}
