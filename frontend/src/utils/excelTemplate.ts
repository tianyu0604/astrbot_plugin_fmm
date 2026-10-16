import { CustomField } from '../types/member';
import * as XLSX from 'xlsx';

export function downloadExcelTemplate(customFields: CustomField[]) {
  // Define columns
  const headers = [
    '姓名*',
    'QQ号*',
    '性别*',
    '状态*',
    '照片URL',
  ];

  // Add custom fields (only non-hidden ones)
  customFields
    .filter(field => !field.hidden)
    .forEach(field => {
      headers.push(field.name);
    });

  // Create example row
  const exampleRow = [
    '张三',
    '123456789',
    '男',
    '在职',
    'https://example.com/photo.jpg',
  ];

  // Add example data for custom fields
  customFields
    .filter(field => !field.hidden)
    .forEach(field => {
      switch (field.type) {
        case 'text':
          exampleRow.push('示例文本');
          break;
        case 'radio':
          exampleRow.push(field.options?.[0] || '选项1');
          break;
        case 'date':
          exampleRow.push('2025-01-01');
          break;
        case 'number':
          exampleRow.push('100');
          break;
        case 'images':
          exampleRow.push('https://example.com/img1.jpg,https://example.com/img2.jpg');
          break;
        default:
          exampleRow.push('');
      }
    });

  // Create instructions row
  const instructions = [
    '1~50个字',
    '必填，唯一 QQ 号，按文本填写',
    '男/女/未知',
    '在职/劝退/光荣退休',
    '照片链接地址，4:3尺寸',
  ];

  customFields
    .filter(field => !field.hidden)
    .forEach(field => {
      switch (field.type) {
        case 'text':
          instructions.push('自由文本');
          break;
        case 'radio':
          instructions.push(`选项: ${field.options?.join('/') || ''}`);
          break;
        case 'date':
          instructions.push('日期格式: YYYY-MM-DD');
          break;
        case 'number':
          instructions.push('数字');
          break;
        case 'images':
          instructions.push('多张图片URL用逗号分隔，最多9张');
          break;
        default:
          instructions.push('');
      }
    });

  // Create worksheet data
  const wsData = [
    headers,
    instructions,
    exampleRow,
  ];

  // Create workbook
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Set column widths
  const colWidths = headers.map((_, idx) => {
    if (idx < 4) return { wch: 20 };
    return { wch: 25 };
  });
  ws['!cols'] = colWidths;

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, '成员档案模板');

  // Generate Excel file
  const fileName = `成员档案导入模板_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
