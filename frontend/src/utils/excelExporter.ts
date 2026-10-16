import * as XLSX from 'xlsx';
import { Member, CustomField } from '../types/member';

interface ExportOptions {
  title: string;
  members: Member[];
  fields: Array<{ id: string; name: string }>;
  customFields: CustomField[];
}

export function exportRosterToExcel(options: ExportOptions) {
  const { title, members, fields, customFields } = options;
  
  // Prepare headers
  const headers = fields.map(f => f.name);
  
  // Prepare data rows
  const rows = members.map(member => {
    return fields.map(field => {
      if (field.id === 'name') return member.data.name;
      if (field.id === 'gender') return member.data.gender;
      if (field.id === 'status') return member.data.status;
      if (field.id === 'photo') return member.data.photo || '';
      
      const value = member.data[field.id];
      
      // Handle different field types
      const customField = customFields.find(f => f.id === field.id);
      if (customField?.type === 'images' && Array.isArray(value)) {
        return value.join(', ');
      }
      if (customField?.type === 'date' && value) {
        const date = new Date(value);
        return date.toLocaleDateString('zh-CN');
      }
      
      return value?.toString() || '';
    });
  });
  
  // Create workbook
  const wsData = [headers, ...rows];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  
  // Set column widths
  const colWidths = headers.map(() => ({ wch: 15 }));
  ws['!cols'] = colWidths;
  
  // Style the header row (if possible with XLSX)
  // Note: Basic XLSX doesn't support styling, but we can set it up for future enhancement
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, title.substring(0, 31)); // Excel sheet name max 31 chars
  
  // Generate file
  const fileName = `${title}_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.xlsx`;
  XLSX.writeFile(wb, fileName);
  
  return { fileName, count: members.length };
}
