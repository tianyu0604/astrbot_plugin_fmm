import * as XLSX from 'xlsx';
import { CustomField, MemberData } from '../types/member';

export interface ParseResult {
  success: boolean;
  data: MemberData[];
  errors: string[];
}

export async function parseExcelFile(
  file: File,
  customFields: CustomField[]
): Promise<ParseResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        // 使用 cellText: true 确保保留单元格的显示文本（w 属性）
        const workbook = XLSX.read(data, { type: 'binary', cellDates: false, cellText: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // 获取工作表范围
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
        
        // 读取表头（第一行）
        const headers: string[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellAddress = XLSX.utils.encode_cell({ r: 0, c });
          const cell = worksheet[cellAddress];
          // 优先使用显示文本 w，如果没有则使用值 v
          const headerValue = cell?.w || cell?.v || '';
          headers.push(String(headerValue).trim());
        }

        if (headers.length === 0 || headers.every(h => !h.trim())) {
          resolve({
            success: false,
            data: [],
            errors: ['Excel文件格式不正确'],
          });
          return;
        }

        // 确定数据起始行（跳过表头和可能的说明行）
        const qqColumn = headers.findIndex(h => ['QQ号*', 'QQ号', 'QQ 号'].includes(h));
        const qqInstruction = qqColumn >= 0 ? worksheet[XLSX.utils.encode_cell({ r: 1, c: qqColumn + range.s.c })]?.v : '';
        const dataStartRow = String(qqInstruction).includes('必填，唯一 QQ 号') ? 2 : 1;

        const parsedData: MemberData[] = [];

        // 遍历数据行
        for (let r = dataStartRow; r <= range.e.r; r++) {
          // 检查行是否有内容
          let hasContent = false;
          for (let c = range.s.c; c <= range.e.c; c++) {
            const cellAddress = XLSX.utils.encode_cell({ r, c });
            const cell = worksheet[cellAddress];
            if (cell && (cell.w || (cell.v !== undefined && cell.v !== null && cell.v !== ''))) {
              const value = cell.w || String(cell.v || '');
              if (value && value.trim() !== '') {
                hasContent = true;
                break;
              }
            }
          }

          if (!hasContent) {
            continue;
          }

          const memberData: any = {};

          headers.forEach((header, colIndex) => {
            const cellAddress = XLSX.utils.encode_cell({ r, c: colIndex + range.s.c });
            const cell = worksheet[cellAddress];
            const field = customFields.find(f => f.name === header || f.name === header.replace('*', ''));
            
            // 优先使用原始显示文本（w 属性），这是 Excel 中实际显示的文本
            let cellValue: any = null;
            if (cell) {
              // 如果有原始文本（w 属性），直接使用（这是最准确的，包含格式化后的日期）
              if (['QQ号*', 'QQ号', 'QQ 号'].includes(header) && cell.v !== undefined) {
                cellValue = String(cell.v);
              } else if (field?.type === 'date' && typeof cell.v === 'number') {
                const date = XLSX.SSF.parse_date_code(cell.v);
                if (date) cellValue = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
              } else if (cell.w !== undefined && cell.w !== null && cell.w !== '') {
                cellValue = cell.w;
              } else if (cell.v !== undefined) {
                cellValue = String(cell.v);
              }
            }
            
            // 如果单元格不存在或值为空，跳过
            if (cellValue === null || cellValue === undefined || cellValue === '') {
              return;
            }

            // 统一转换为字符串，保持原始格式
            const stringValue = String(cellValue).trim();

            // Process default fields
            if (header === '姓名*' || header === '姓名') {
              memberData.name = stringValue;
            } else if (header === 'QQ号*' || header === 'QQ号' || header === 'QQ 号') {
              memberData.qq = stringValue;
            } else if (header === '性别*' || header === '性别') {
              memberData.gender = stringValue;
            } else if (header === '状态*' || header === '状态') {
              memberData.status = stringValue;
            } else if (header === '照片URL' || header === '照片') {
              memberData.photo = stringValue;
            } else {
              // Process custom fields - no validation, preserve original string value
              if (field) {
                if (field.type === 'images' && stringValue) {
                  // Split by comma for images
                  const urls = stringValue.split(',').map(url => url.trim()).filter(url => url);
                  memberData[field.id] = urls.length > 0 ? urls : null;
                } else if (field.type === 'number') {
                  // 对于数字类型，尝试转换为数字，如果失败则保留原始字符串
                  const numValue = parseFloat(stringValue);
                  memberData[field.id] = isNaN(numValue) ? stringValue : numValue;
                } else {
                  // 对于其他类型（包括日期），保留原始字符串值
                  memberData[field.id] = stringValue;
                }
              } else {
                // Unknown field, just add as string
                memberData[header] = stringValue;
              }
            }
          });

          // Add all rows to parsedData, no validation
          parsedData.push(memberData as MemberData);
        }

        resolve({
          success: true,
          data: parsedData,
          errors: [],
        });
      } catch (error) {
        resolve({
          success: false,
          data: [],
          errors: [`文件解析失败: ${error}`],
        });
      }
    };

    reader.onerror = () => {
      resolve({
        success: false,
        data: [],
        errors: ['文件读取失败'],
      });
    };

    reader.readAsBinaryString(file);
  });
}

