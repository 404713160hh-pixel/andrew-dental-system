import type { Appointment, PatientInput, SlotSelection, BookingSlot } from '../types';
export function dateToday(): string { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
export function dateText(instant: string): string { return new Date(Date.parse(instant) + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' '); }
export function timeText(instant: string): string { return dateText(instant).slice(11); }
export function price(cents: number): string { return (cents / 100).toFixed(2); }
export const statusLabels = { confirmed: '预约已确认', cancelled: '已取消', rescheduled: '已改期' };
export const allergyLabels = { unknown: '过敏情况待核实', none_reported: '本人声明无已知过敏', known: '存在已知过敏' };
export function appointmentView(item: Appointment) { return { ...item, dateLabel: dateText(item.startsAt), endLabel: timeText(item.endsAt), statusLabel: statusLabels[item.status] }; }
export function slotView(item: BookingSlot, index: number) { return { ...item, key: String(index), startLabel: timeText(item.startsAt), endLabel: timeText(item.endsAt), priceLabel: price(item.priceCents) }; }
export function slotSelection(item: BookingSlot): SlotSelection { return { clinicId: item.clinicId, serviceId: item.serviceId, doctorId: item.doctorId, chairId: item.chairId, shiftId: item.shiftId, startsAt: item.startsAt }; }
export function emptyProfile(): PatientInput { return { name: '', birthDate: '', phone: '', email: null, billingAddress: '', emergencyName: '', emergencyPhone: '', allergyStatus: 'unknown', allergies: [] }; }
export function profileError(profile: PatientInput): string {
  if (![profile.name, profile.birthDate, profile.phone, profile.billingAddress, profile.emergencyName, profile.emergencyPhone].every(value => value.trim())) return '请完整填写姓名、出生日期、联系方式、地址和紧急联系人。';
  if (profile.allergyStatus === 'known' && !profile.allergies.length) return '存在已知过敏时，请逐行填写至少一个过敏项。';
  return '';
}
