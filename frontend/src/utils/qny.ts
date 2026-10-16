import { api } from '../api/PluginAPI';

// Keep the form helper contract, but store images in the plugin data directory.
export async function uploadImage(param: { file: File; featureName: string; prefix?: boolean }) {
  try {
    const { file } = param;
    if (file.size > 2 * 1024 * 1024) throw new Error('图片大小不能超过 2MB');
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });
    const response = await api<{ url: string }>('/upload', 'POST', { data });
    return { success: true, url: response.url };
  } catch (error) {
    return { success: false, errorMessage: error instanceof Error ? error.message : '图片上传失败' };
  }
}
