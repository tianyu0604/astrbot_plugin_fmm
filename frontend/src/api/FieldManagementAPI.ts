// FieldManagementAPI.ts
import { CustomField, FieldType } from '../types/member';
import { getApiBaseUrl } from './GlobalConfig';

// 定义操作类型
export type Operation =
    | { opType: 'create'; id: string; name: string; type: FieldType; options?: string[] }
    | { opType: 'update'; id: string; name?: string; type?: FieldType; options?: string[]; action?: 'hide' | 'show' }
    | { opType: 'delete'; id: string; action: 'hide' | 'delete' }
    | { opType: 'reorder'; orders: Array<{ id: string; displayOrder: number }> };

export interface SaveChangesRequest {
    operations: Operation[];
}

export interface SaveChangesResponse {
    code: number;
    msg: string;
    data?: any;
}

export interface GetCustomFieldsResponse {
    code: number;
    msg: string;
    data: {
        customFields: CustomField[];
    };
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

// 获取自定义字段
export async function getCustomFields(): Promise<GetCustomFieldsResponse> {
    return apiRequest<GetCustomFieldsResponse>('/archive_field/getCustomFields', {
        method: 'GET',
    });
}

// 保存更改
export async function saveChanges(requestData: SaveChangesRequest): Promise<SaveChangesResponse> {
    return apiRequest<SaveChangesResponse>('/archive_field/saveChanges', {
        method: 'POST',
        body: JSON.stringify(requestData),
    });
}

// 导出环境切换相关函数
export { switchEnvironment, getCurrentEnvironment } from './GlobalConfig';

