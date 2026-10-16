// checkImageSize.ts
// 检查图片尺寸是否符合要求

/**
 * 检查图片尺寸是否符合要求
 * @param file - 待检查的图片文件
 * @param width - 期望的图片宽度
 * @param height - 期望的图片高度
 * @param absolute - 检查图片比例时是否为绝对像素比 默认false
 * @returns 返回一个 Promise，表示检查结果，true 表示尺寸正常，false 表示尺寸不正常
 */
export const checkPhotoSize = async (param: { 
    file: File; 
    width?: number; 
    height?: number; 
    absolute?: boolean 
}): Promise<boolean> => {
    const { file, width, height, absolute } = param;

    // 返回一个Promise对象
    return new Promise<boolean>((resolve) => {
        if (!width && !height) {
            // 若未指定期望尺寸，则认为尺寸正常
            resolve(true);
            return;
        }

        // 使用 Object URL 代替 base64，更高效
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.src = objectUrl;

        image.onload = () => {
            // 获取图片宽高
            const imgWidth = image.width;
            const imgHeight = image.height;

            // 清理 Object URL
            URL.revokeObjectURL(objectUrl);

            // 判断条件
            const isChecked = absolute
                ? (imgWidth === width && imgHeight === height)
                : (imgWidth / imgHeight === (width as number) / (height as number));

            // 判断是否符合预期尺寸
            if (isChecked) {
                resolve(true);
            } else {
                resolve(false);
            }
        };

        image.onerror = () => {
            // 清理 Object URL
            URL.revokeObjectURL(objectUrl);
            resolve(false);
        };
    });
};

