import type { ApiErrorResponse, ApiSuccess, Appointment, CommandResult } from '@andrew/shared';
const TOKEN_KEY = 'andrew.staff.token';
const OWNER_KEY = 'andrew.staff.owner';
export const tokenStorage = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (token: string, ownerId?: string) => {
    sessionStorage.setItem(TOKEN_KEY, token);
    if (ownerId) sessionStorage.setItem(OWNER_KEY, ownerId);
  },
  setOwner: (ownerId: string) => sessionStorage.setItem(OWNER_KEY, ownerId),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId = '',
    public details?: unknown,
  ) {
    super(message);
  }
  get uncertain() {
    return this.status === 0 || this.status === 401 || this.status >= 500;
  }
}
export function query(values: Record<string, string | number | boolean | null | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  const result = params.toString();
  return result ? `?${result}` : '';
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20000);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = tokenStorage.get();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    const response = await fetch(`/api/v1${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    let payload: ApiSuccess<T> | ApiErrorResponse;
    try {
      payload = (await response.json()) as ApiSuccess<T> | ApiErrorResponse;
    } catch {
      throw new ApiError(
        response.status || 502,
        'INVALID_RESPONSE',
        '服务暂时不可用，请稍后重试。若刚提交过操作，请先查询操作结果。',
      );
    }
    if (!payload || typeof payload !== 'object')
      throw new ApiError(502, 'INVALID_RESPONSE', '响应不完整，请使用原操作编号核对结果。');
    if (!response.ok || 'error' in payload) {
      const failure = payload as ApiErrorResponse;
      // A request sent by a previous account must not invalidate a newer login.
      if (response.status === 401 && tokenStorage.get() === token) {
        tokenStorage.clear();
        window.dispatchEvent(new Event('andrew:unauthorized'));
      }
      throw new ApiError(
        response.status,
        failure.error?.code || 'REQUEST_FAILED',
        failure.error?.message || '请求失败',
        failure.requestId || '',
        failure.error?.details,
      );
    }
    if (!('data' in payload) || typeof payload.requestId !== 'string')
      throw new ApiError(502, 'INVALID_RESPONSE', '响应不完整，请使用原操作编号核对结果。');
    return (payload as ApiSuccess<T>).data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      0,
      'NETWORK_UNKNOWN',
      '网络连接中断或请求超时，请查询操作结果，避免重复提交。',
    );
  } finally {
    window.clearTimeout(timer);
  }
}
export function errorText(error: unknown): string {
  return error instanceof ApiError
    ? `${error.message}${error.requestId ? `（请求编号 ${error.requestId}）` : ''}`
    : error instanceof Error
      ? error.message
      : '操作失败，请重试。';
}
export interface PendingCommand {
  key: string;
  path: string;
  body: unknown;
  createdAt: string;
}
const PENDING_KEY = 'andrew.staff.pending-command';
const pendingStorageKey = () =>
  `${PENDING_KEY}.${sessionStorage.getItem(OWNER_KEY) || 'unidentified'}`;
export function readPending(): PendingCommand | null {
  try {
    return JSON.parse(
      sessionStorage.getItem(pendingStorageKey()) || 'null',
    ) as PendingCommand | null;
  } catch {
    return null;
  }
}
export function savePending(command: PendingCommand) {
  sessionStorage.setItem(pendingStorageKey(), JSON.stringify(command));
}
export function clearPending() {
  sessionStorage.removeItem(pendingStorageKey());
}
export async function submitCommand(command: PendingCommand): Promise<Appointment> {
  const storageKey = pendingStorageKey();
  savePending(command);
  try {
    const result = await api<Appointment>(command.path, {
      method: 'POST',
      body: command.body,
      idempotencyKey: command.key,
    });
    if (
      !result?.id ||
      !result.appointmentNo ||
      !['confirmed', 'cancelled', 'rescheduled'].includes(result.status)
    )
      throw new ApiError(502, 'INVALID_RESPONSE', '预约响应不完整，请使用原操作编号核对结果。');
    sessionStorage.removeItem(storageKey);
    return result;
  } catch (error) {
    if (!(error instanceof ApiError) || !error.uncertain) sessionStorage.removeItem(storageKey);
    throw error;
  }
}
export async function resolvePending(command: PendingCommand): Promise<Appointment | null> {
  const storageKey = pendingStorageKey();
  const result = await api<CommandResult>(`/commands/${encodeURIComponent(command.key)}`);
  if (result.status === 'completed' && result.result) {
    if (
      !result.result.id ||
      !result.result.appointmentNo ||
      !['confirmed', 'cancelled', 'rescheduled'].includes(result.result.status)
    )
      throw new ApiError(502, 'INVALID_RESPONSE', '预约回执不完整，请保留原操作编号稍后重试。');
    sessionStorage.removeItem(storageKey);
    return result.result;
  }
  if (result.status !== 'not_found')
    throw new ApiError(502, 'INVALID_RESPONSE', '回执响应不完整，请保留原操作编号稍后重试。');
  return null;
}
