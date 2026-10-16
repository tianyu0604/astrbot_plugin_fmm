// GlobalConfig.ts
// 全局环境配置

// 定义全局变量类型
declare global {
    var API_ENV: 'test' | 'production';
    var API_BASE_URL: string;
}

// 环境配置
const ENV_CONFIG = {
    test: '/api/v1/fmm',
    production: '/api/v1/fmm',
};

// 初始化全局环境变量（如果未设置）
if (typeof global !== 'undefined' && !global.API_ENV) {
    global.API_ENV = 'test';
    global.API_BASE_URL = ENV_CONFIG[global.API_ENV];
} else if (typeof window !== 'undefined' && !window.API_ENV) {
    window.API_ENV = 'test';
    window.API_BASE_URL = ENV_CONFIG[window.API_ENV];
}

// 环境切换函数
export function switchEnvironment(env: 'test' | 'production') {
    if (typeof window !== 'undefined') {
        window.API_ENV = env;
        window.API_BASE_URL = ENV_CONFIG[env];
    } else if (typeof global !== 'undefined') {
        global.API_ENV = env;
        global.API_BASE_URL = ENV_CONFIG[env];
    }
}

// 获取当前环境
export function getCurrentEnvironment(): 'test' | 'production' {
    if (typeof window !== 'undefined') {
        return window.API_ENV;
    } else if (typeof global !== 'undefined') {
        return global.API_ENV;
    }
    return 'test'; // 默认返回测试环境
}

// 获取API基础URL
export function getApiBaseUrl(): string {
    if (typeof window !== 'undefined') {
        return window.API_BASE_URL;
    } else if (typeof global !== 'undefined') {
        return global.API_BASE_URL;
    }
    return ENV_CONFIG.test; // 默认返回测试环境URL
}

// 导出环境配置
export { ENV_CONFIG };

// 确保类型定义在模块中可用
export { };
