// ExportRosterAPI.ts
import { getApiBaseUrl } from './GlobalConfig';

// 定义获取已使用选项的响应类型
export interface GetUsedOptionsResponse {
    code: number;
    msg: string;
    data?: any;
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

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`API request failed: ${endpoint}`, error);
        throw error;
    }
}

// 获取已使用的选项
export async function getUsedOptions(): Promise<GetUsedOptionsResponse> {
    return apiRequest<GetUsedOptionsResponse>('/export_roster/getUsedOptions', {
        method: 'GET',
    });
}



