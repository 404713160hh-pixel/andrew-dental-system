import type { ApiSuccess, ApiErrorResponse } from '../types';
import { apiBaseUrl } from '../config';
import { clearSession, session } from './session';
export class RequestError extends Error {
  constructor(message: string, public code: string, public uncertain = false, public requestId = '', public statusCode = 0) { super(message); }
}
type Method = 'GET' | 'POST' | 'PUT';
export function api<T>(path: string, method: Method = 'GET', body?: unknown, idempotencyKey?: string): Promise<T> {
  const token = session()?.token;
  return new Promise<T>((resolve, reject) => {
    wx.request({ url: apiBaseUrl + path, method, timeout: 15000,
      data: body as WechatMiniprogram.IAnyObject | undefined,
      header: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      success(response) {
        const payload = response.data && typeof response.data === 'object' ? response.data as ApiSuccess<T> & Partial<ApiErrorResponse> : undefined;
        if (response.statusCode >= 200 && response.statusCode < 300 && payload && 'data' in payload) resolve(payload.data);
        else {
          // A delayed response from a previous account must not sign out the
          // account that has since logged in on this device.
          if (response.statusCode === 401 && token && session()?.token === token && !['/auth/login', '/auth/demo', '/auth/register'].includes(path)) clearSession();
          reject(new RequestError(payload?.error?.message ?? '服务响应不完整，请核对结果', payload?.error?.code ?? 'INVALID_RESPONSE', method !== 'GET' && (response.statusCode >= 500 || response.statusCode < 400), payload?.requestId, response.statusCode));
        }
      },
      fail() { reject(new RequestError(method === 'GET' ? '无法连接服务，请检查网络后重试。' : '连接中断，提交结果待确认。请先核对，避免重复提交。', 'NETWORK_ERROR', method !== 'GET')); }
    });
  });
}
export function query(values: Record<string, string | number | undefined>): string {
  const parts = Object.entries(values).filter(([, value]) => value !== undefined && value !== '').map(([name, value]) => encodeURIComponent(name) + '=' + encodeURIComponent(String(value)));
  return parts.length ? '?' + parts.join('&') : '';
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '操作未完成，请稍后重试。'; }
