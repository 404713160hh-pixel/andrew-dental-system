/** Decimal yuan input is converted without floating-point multiplication. */
export function yuanToCents(value: string): number {
  const text = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error('金额请填写数字，最多保留两位小数。');
  const absolute = BigInt(match[2]!) * 100n + BigInt((match[3] || '').padEnd(2, '0'));
  const cents = match[1] ? -absolute : absolute;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER))
    throw new Error('金额过大，请核对账证。');
  return Number(cents);
}

export function centsToYuan(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error('金额响应无效，请重新加载。');
  const cents = BigInt(value), absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function previousQuarter(now = new Date()): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const year = Number(date.find(item => item.type === 'year')?.value);
  const quarter = Math.floor((Number(date.find(item => item.type === 'month')?.value) - 1) / 3) + 1;
  return quarter === 1 ? `${year - 1}-Q4` : `${year}-Q${quarter - 1}`;
}

export function quarterMonths(quarter: string): string[] {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) return [];
  const first = (Number(match[2]) - 1) * 3 + 1;
  return [first, first + 1, first + 2].map(month => `${match[1]}-${String(month).padStart(2, '0')}`);
}

export const compensationStatuses: Record<string, string> = {
  draft: '草稿', closed: '已关闭', submitted: '待复核', approved: '已批准',
  void: '已作废', voided: '已作废', pending: '待确认', succeeded: '发放成功', failed: '发放失败',
};

export function independentReviewer(actor: { id: string; staffId: string | null } | null,
  preparedBy: string, preparedStaffId: string | null) {
  return !!actor?.staffId && actor.id !== preparedBy && !!preparedStaffId && actor.staffId !== preparedStaffId;
}
