export function today() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function calendarDate(value: string) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}
export function time(value: string, withDate = false) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    ...(withDate ? { month: '2-digit', day: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
export function money(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}
export function instant(value: string) {
  return `${value}+08:00`;
}
export const statusLabels: Record<string, string> = {
  confirmed: '已确认',
  cancelled: '已取消',
  rescheduled: '已改期',
  published: '已发布',
};
export function statusType(status: string): 'success' | 'info' | 'warning' {
  return status === 'confirmed' || status === 'published'
    ? 'success'
    : status === 'rescheduled'
      ? 'warning'
      : 'info';
}
