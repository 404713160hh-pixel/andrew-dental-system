import type { Appointment, ChangeInput, CommandResult, ConfirmInput, Hold } from '../types';
import { api, RequestError } from './api';
import { session } from './session';
const pendingKey = 'andrew.booking.pending.v1';
const holdKey = 'andrew.booking.hold.v1';
const ownedKey = (base: string, owner = session()?.user.id ?? '') => base + ':' + owner;
export interface HoldContext { hold: Hold; oldAppointmentId?: string; oldVersion?: number; reason?: string; ownerId: string; doctorIsDemo?: boolean; patientIsDemo?: boolean }
export interface PendingCommand { key: string; path: string; body: ConfirmInput | ChangeInput; ownerId: string; createdAt: string }
export function saveHold(value: Omit<HoldContext, 'ownerId'>): void { wx.setStorageSync(ownedKey(holdKey), { ...value, ownerId: session()?.user.id ?? '' }); }
export function getHold(): HoldContext | null { const value = wx.getStorageSync(ownedKey(holdKey)) as HoldContext | undefined; return value && value.ownerId === session()?.user.id ? value : null; }
export function clearHold(ownerId?: string): void { wx.removeStorageSync(ownedKey(holdKey, ownerId)); }
export function pendingCommand(): PendingCommand | null { const value = wx.getStorageSync(ownedKey(pendingKey)) as PendingCommand | undefined; return value && value.ownerId === session()?.user.id ? value : null; }
export function commandKey(): string { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => { const number = Math.floor(Math.random() * 16); return (char === 'x' ? number : ((number & 3) | 8)).toString(16); }); }
export function newCommand(path: string, body: ConfirmInput | ChangeInput): PendingCommand {
  if (pendingCommand()) throw new RequestError('有一笔提交结果待确认，请先核对或重试原操作。', 'PENDING_COMMAND');
  return { key: commandKey(), path, body, ownerId: session()?.user.id ?? '', createdAt: new Date().toISOString() };
}
export async function sendCommand(value: PendingCommand): Promise<Appointment> {
  if (!session() || value.ownerId !== session()?.user.id) throw new RequestError('请使用原账号登录后核对操作。', 'UNAUTHORIZED');
  // 先保存再发送；关页或进程中断后仍能查同一个 key。
  wx.setStorageSync(ownedKey(pendingKey, value.ownerId), value);
  try {
    const result = await api<Appointment>(value.path, 'POST', value.body, value.key);
    wx.removeStorageSync(ownedKey(pendingKey, value.ownerId)); clearHold(value.ownerId);
    if (session()?.user.id !== value.ownerId) throw new RequestError('账号已切换，请用原账号登录后查看该操作结果。', 'ACCOUNT_CHANGED');
    return result;
  }
  catch (error) { if (error instanceof RequestError && !error.uncertain && error.statusCode !== 401) wx.removeStorageSync(ownedKey(pendingKey, value.ownerId)); throw error; }
}
export async function inspectCommand(): Promise<Appointment | null> {
  const value = pendingCommand(); if (!value) return null;
  const result = await api<CommandResult>('/commands/' + encodeURIComponent(value.key));
  if (result.status === 'completed' && result.result) {
    wx.removeStorageSync(ownedKey(pendingKey, value.ownerId)); clearHold(value.ownerId);
    if (session()?.user.id !== value.ownerId) throw new RequestError('账号已切换，请用原账号登录后查看该操作结果。', 'ACCOUNT_CHANGED');
    return result.result;
  }
  // not_found 不能证明仍在执行的原请求不会提交，保留 key，允许原请求重试。
  return null;
}
export function openAppointment(item: Appointment): void { wx.redirectTo({ url: '/pages/detail/index?id=' + encodeURIComponent(item.id) + '&success=1' }); }
