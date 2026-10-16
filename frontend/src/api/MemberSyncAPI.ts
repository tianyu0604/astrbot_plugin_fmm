// MemberSyncAPI.ts
// QQ 群成员同步：预览差异（只读）→ 确认后落库
import { getApiBaseUrl } from './GlobalConfig';

export interface SyncGroup {
    id: string;
    name: string;
    count?: number;
}

export interface SyncGroupsResponse {
    groups: SyncGroup[];
    default: string;
    class_field: string;
    class_field_name: string;
}

export interface SyncChange {
    field: string;
    old: string;
    new: string;
}

export interface SyncNewMember {
    qq: string;
    name: string;
    cls: string;
    sex: string;
    nickname: string;
    avatar: string;
}

export interface SyncChangedMember {
    id: string;
    qq: string;
    name: string;
    cls: string;
    avatar: string;
    changes: SyncChange[];
}

export interface SyncDepartedMember {
    id: string;
    qq: string;
    name: string;
    cls: string;
    status: string;
    photo: string;
}

export interface SyncPlan {
    group_id: string;
    group_name: string;
    group_member_count: number;
    profile_count: number;
    class_field: string;
    class_field_name: string;
    added: SyncNewMember[];
    changed: SyncChangedMember[];
    departed: SyncDepartedMember[];
    retired_absent_count: number;
    unchanged: number;
    skipped: { qq: string; reason: string }[];
    suspicious: boolean;
    fingerprint: string;
    server_time: string;
}

export interface SyncDone {
    added: { qq: string; name: string }[];
    changed: { qq: string; name: string }[];
    departed: { qq: string; name: string; action: string }[];
    photos: number;
    failed: { qq: string; why: string }[];
}

export interface SyncResult {
    done: SyncDone;
    added: number;
    changed: number;
    departed: number;
    photos: number;
    failed: { qq: string; why: string }[];
    left: { added: number; changed: number; departed: number; unchanged: number; retired_absent: number };
}

export type DepartedAction = 'retire' | 'delete' | 'keep';

export interface ApplySyncRequest {
    group_id: string;
    platform_id?: string;
    fingerprint: string;
    departed: DepartedAction;
    refresh_photos: boolean;
    force?: boolean;
}

/** 409 时带上服务器刚算出来的新差异，页面据此让人重新确认。 */
export class SyncApiError extends Error {
    constructor(message: string, public status: number, public plan?: SyncPlan) {
        super(message);
    }
}

async function request<T>(endpoint: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const response = await fetch(`${getApiBaseUrl()}${endpoint}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data: { code: number; msg: string; data?: unknown } | null = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }
    if (response.status === 401) window.dispatchEvent(new Event('fmm-session-expired'));
    if (!response.ok || !data || data.code !== 200) {
        throw new SyncApiError(
            data?.msg || `请求失败（HTTP ${response.status}）`,
            response.status,
            response.status === 409 ? (data?.data as SyncPlan) : undefined,
        );
    }
    return data.data as T;
}

export function getSyncGroups(): Promise<SyncGroupsResponse> {
    return request<SyncGroupsResponse>('/sync/groups', 'GET');
}

export function previewMemberSync(groupId: string): Promise<SyncPlan> {
    return request<SyncPlan>('/sync/preview', 'POST', { group_id: groupId });
}

export function applyMemberSync(payload: ApplySyncRequest): Promise<SyncResult> {
    return request<SyncResult>('/sync/apply', 'POST', payload);
}
