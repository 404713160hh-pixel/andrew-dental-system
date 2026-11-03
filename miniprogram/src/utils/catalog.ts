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
  // The sprite contains fictional portraits only; never attach them to ordinary records.
  const portraitPositions: Record<string, [number, number]> = {
    '李若宁（虚构医生）': [0, 0], '陈知远（虚构医生）': [1, 0],
    '苏予安（虚构医生）': [2, 0], '顾清和（虚构医生）': [3, 0],
    '许知夏（虚构医生）': [0, 1], '周沐辰（虚构医生）': [1, 1],
    '唐书禾（虚构医生）': [2, 1], '林亦岚（虚构医生）': [3, 1],
  };
  const portrait = item.isDemo ? portraitPositions[item.name] : undefined;
  return {
    ...item,
    isDemo: Boolean(item.isDemo),
    hasPortrait: Boolean(portrait), portraitCol: portrait?.[0] ?? 0, portraitRow: portrait?.[1] ?? 0,
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

/** Images depict fictional demo clinics; unmatched clinics get no invented photo. */
export function clinicView<T extends { name: string }>(item: T) {
  const images: Record<string, string> = {
    '安德鲁牙科·越秀门诊': '/assets/clinic-yuexiu.jpg',
    '安德鲁牙科·天河门诊': '/assets/clinic-tianhe.jpg',
  };
  return { ...item, demoImage: images[item.name] || '' };
}
