// MemberAPI.ts
import { CustomField, MemberData } from '../types/member';
import { getApiBaseUrl } from './GlobalConfig';

// 定义接口返回的数据类型
export interface MemberInfo {
    createTime: string;
    customFields: Record<string, any>;
    gender: string;
    id: string;
    name: string;
    qq: string;
    photo: string[];
    status: string;
    updateTime: string | null;
}

export interface GetMembersResponse {
    code: number;
    msg: string;
    data: MemberInfo[];
}

// 创建fetch请求的通用函数
async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${getApiBaseUrl()}${endpoint}`;

    const config: RequestInit = {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
        ...options,
    };

    try {
        const response = await fetch(url, config);

        const data = await response.json();
        if (!response.ok || data.code !== 200) {
            if (response.status === 401) window.dispatchEvent(new Event('fmm-session-expired'));
            throw new Error(data.msg || `HTTP error! status: ${response.status}`);
        }
        return data;
    } catch (error) {
        console.error(`API request failed: ${endpoint}`, error);
        throw error;
    }
}

// 获取成员列表
export async function getMembers(): Promise<GetMembersResponse> {
    return apiRequest<GetMembersResponse>('/member/getMembers', {
        method: 'GET',
    });
}

// 定义批量添加成员的请求和响应类型
export interface BatchMembersRequest {
    members: {
        name: string;
        gender: string;
        status: string;
        photo: string[];
        customFields: Record<string, any>;
    }[];
}

export interface BatchMembersResponse {
    code: number;
    msg: string;
    data?: any;
}

// 批量添加成员
export async function batchMembers(requestData: BatchMembersRequest): Promise<BatchMembersResponse> {
    return apiRequest<BatchMembersResponse>('/member/batchMembers', {
        method: 'POST',
        body: JSON.stringify(requestData),
    });
}

// 定义更新成员的请求类型
export interface UpdateMemberRequest {
    id: string;
    updateDate: {
        name: string;
        gender: string;
        status: string;
        photo: string[];
        customFields: Record<string, any>;
    };
    reason: string;
}

export interface UpdateMemberResponse {
    code: number;
    msg: string;
    data?: any;
}

// 更新成员信息
export async function updateMember(requestData: UpdateMemberRequest): Promise<UpdateMemberResponse> {
    return apiRequest<UpdateMemberResponse>('/member/updateMember', {
        method: 'POST',
        body: JSON.stringify(requestData),
    });
}

// 定义查询修改记录的请求类型
export interface GetHistoryRequest {
    id: string;
}

export interface GetHistoryResponse {
    code: number;
    msg: string;
    data: {
        afterDate: Record<string, any>;
        beforeDate: Record<string, any>;
        id: string;
        memberId: string;
        reason: string;
        updateTime: string;
    }[];
}

// 查询修改记录
export async function getHistory(requestData: GetHistoryRequest): Promise<GetHistoryResponse> {
    return apiRequest<GetHistoryResponse>('/member/getHistory', {
        method: 'POST',
        body: JSON.stringify(requestData),
    });
}

// 导出花名册相关接口
export interface GetExportPreviewRequest {
    filter: {
        gender?: string[];
        status?: string[];
        customFields?: Record<string, string[]>;
    };
    selectedFields: string[];
    sortRules: Array<{
        field: string;
        order: 'ASC' | 'DESC';
    }>;
}

export interface GetExportPreviewResponse {
    code: number;
    msg: string;
    data?: {
        members: any[];
        total: number;
    };
}

export async function getExportPreview(requestData: GetExportPreviewRequest): Promise<GetExportPreviewResponse> {
    return apiRequest<GetExportPreviewResponse>('/export_roster/getExportPreview', {
        method: 'POST',
        body: JSON.stringify(requestData),
    });
}

export interface SaveExportHistoryRequest {
    title: string;
    filter: {
        gender?: string[];
        status?: string[];
        customFields?: Record<string, string[]>;
    };
    selectedFields: string[];
    sortRules: Array<{
        field: string;
        order: 'ASC' | 'DESC';
    }>;
}

export interface SaveExportHistoryResponse {
    code: number;
    msg: string;
    data?: any;
}

export async function saveExportHistory(requestData: SaveExportHistoryRequest): Promise<SaveExportHistoryResponse> {
    return apiRequest<SaveExportHistoryResponse>('/export_roster/saveExportHistory', {
        method: 'POST',
        body: JSON.stringify(requestData),
    });
}

export interface GetExportListsResponse {
    code: number;
    msg: string;
    data: Array<{
        id: string;
        title: string;
        createTime: string;
        fieldCount: number;
        ruleCount: number;
    }>;
}

export async function getExportLists(): Promise<GetExportListsResponse> {
    return apiRequest<GetExportListsResponse>('/export_roster/getExportLists', {
        method: 'GET',
    });
}

export interface GetExportHistoryDetailRequest {
    id: string;
}

export interface GetExportHistoryDetailResponse {
    code: number;
    msg: string;
    data?: {
        id: string;
        title: string;
        createTime: string;
        deletedTime: string | null;
        isDeleted: boolean;
        filter: {
            gender: string[];
            status: string[];
            customFields: Record<string, string[]>;
        };
        selectedFields: string[];
        sortRules: Array<{
            field: string;
            order: 'ASC' | 'DESC';
        }>;
        exportPreview?: {
            members: any[];
            total: number;
        };
    };
}

export async function getExportHistoryDetail(requestData: GetExportHistoryDetailRequest): Promise<GetExportHistoryDetailResponse> {
    return apiRequest<GetExportHistoryDetailResponse>('/export_roster/getExportHistoryDetail', {
        method: 'POST',
        body: JSON.stringify(requestData),
    });
}

export interface DeleteExportHistoryRequest {
    id: string;
}

export interface DeleteExportHistoryResponse {
    code: number;
    msg: string;
    data?: any;
}

export async function deleteExportHistory(requestData: DeleteExportHistoryRequest): Promise<DeleteExportHistoryResponse> {
    return apiRequest<DeleteExportHistoryResponse>('/export_roster/deleteExportHistory', {
        method: 'POST',
        body: JSON.stringify(requestData),
    });
}

export interface GetUsedOptionsResponse {
    code: number;
    msg: string;
    data?: Array<{
        id: string;
        name: string;
        options: string[];
    }>;
}

export async function getUsedOptions(): Promise<GetUsedOptionsResponse> {
    return apiRequest<GetUsedOptionsResponse>('/export_roster/getUsedOptions', {
        method: 'GET',
    });
}
