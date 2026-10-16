import { CustomField, Member } from '../types/member';

export interface Rule {
  id: string; name: string; platform_id: string; group_id: string; time: string;
  weekdays: number[]; pool: string[]; count: number; start_date: string;
  message: string; enabled: boolean; cursor: number; revision: number;
  next_members?: string[]; selection_error?: string; blocked?: boolean;
}
export interface Run {
  id: string; rule_id: string; day: string; kind: 'test' | 'scheduled';
  status: 'sending' | 'sent' | 'failed' | 'unknown' | 'skipped';
  error: string; created_at: string; message_id: string | null;
  snapshot: { rule: Rule; members: Member[]; text: string };
}
export interface PluginState {
  members: Member[]; fields: CustomField[]; rules: Rule[]; logs: Run[];
  platforms: { id: string; name: string }[]; server_time: string;
}
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/fmm${path}`, {
    method, credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.code !== 200) {
    if (response.status === 401 && path !== '/login') window.dispatchEvent(new Event('fmm-session-expired'));
    throw new ApiError(data.msg || '请求失败', response.status);
  }
  return data.data as T;
}
