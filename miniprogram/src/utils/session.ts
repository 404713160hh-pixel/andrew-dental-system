import type { LoginResult } from '../types';
const key = 'andrew.session.v1';
let current: LoginResult | null = null;
export function restoreSession(): LoginResult | null {
  const value = wx.getStorageSync(key) as LoginResult | undefined;
  current = value && Date.parse(value.expiresAt) > Date.now() ? value : null;
  if (!current) wx.removeStorageSync(key);
  return current;
}
export function session(): LoginResult | null { return current ?? restoreSession(); }
export function setSession(value: LoginResult): void { current = value; wx.setStorageSync(key, value); }
export function clearSession(): void { current = null; wx.removeStorageSync(key); }
export function requireLogin(): boolean {
  if (session()) return true;
  wx.navigateTo({ url: '/pages/login/index' }); return false;
}
