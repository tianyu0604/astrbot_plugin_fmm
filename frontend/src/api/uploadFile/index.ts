// uploadFile/index.ts
// 获取七牛云上传凭证的 API

// 获取七牛云上传凭证
export const getQiniuTokenApi = async () => {
    const url = 'https://www.fmin-courses.com/api/v1/oss/qinniu/getToken';
    
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('获取七牛云上传凭证失败:', error);
        throw error;
    }
};

