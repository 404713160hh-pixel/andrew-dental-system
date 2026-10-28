import type { PublicDoctor as Doctor, TreatmentReference } from '../types';
import { dateText } from './format';

/** API money is integer cents; always round its decimal presentation to cents. */
export function priceRange(minCents: number, maxCents: number): string {
  const amount = (cents: number): string => (cents / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  if (!Number.isSafeInteger(minCents) || !Number.isSafeInteger(maxCents) || minCents < 0 || maxCents < minCents) return '待核对';
  return minCents === maxCents ? amount(minCents) : amount(minCents) + '–' + amount(maxCents);
}

export function referenceView(item: TreatmentReference) {
  return { ...item, priceLabel: priceRange(item.priceMinCents, item.priceMaxCents) };
}

export function doctorView(item: Doctor) {
  return {
    ...item,
    isDemo: Boolean(item.isDemo),
    initial: item.name.slice(0, 1),
    bioLabel: item.bio?.trim() || item.specialty,
    focusLabels: item.focusAreas?.length ? item.focusAreas : item.specialty ? [item.specialty] : [],
    clinicIds: item.clinicIds || [],
    qualificationRows: item.qualifications.map(qualification => ({
      id: qualification.qualificationId,
      name: qualification.qualificationName || '专业资格记录',
      validityLabel: item.isDemo
        ? '虚构资格示例，不对应真实执照'
        : (qualification.validUntil ? '有效至 ' + dateText(qualification.validUntil).slice(0, 10) : '未设置失效日期'),
    })),
  };
}
