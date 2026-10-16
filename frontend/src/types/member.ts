export type FieldType = 'text' | 'radio' | 'date' | 'number' | 'images';

export type Gender = '男' | '女' | '未知';
export type Status = '在职' | '劝退' | '光荣退休';

export interface CustomField {
  id: string;
  name: string;
  type: FieldType;
  typeLabel?: string;
  description?: string;
  options?: string[]; // For radio type
  hidden: boolean;
  displayOrder: number;
  isDeleted: boolean;
  used: boolean;
}

export interface MemberData {
  [key: string]: any;
  photo?: string;
  name: string;
  gender: Gender;
  qq: string;
  status: Status;
  department?: string; // 部门
  position?: string; // 职级
  grade?: string; // 年级
}

export interface Member {
  id: string;
  data: MemberData;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryRecord {
  id: string;
  memberId: string;
  timestamp: string;
  editor: string;
  reason: string;
  changes: {
    field: string;
    oldValue: any;
    newValue: any;
  }[];
}

export interface SortRule {
  fieldId: string;
  fieldName: string;
  direction: 'asc' | 'desc';
}

export interface ExportConfig {
  id: string;
  name: string;
  title: string;
  timestamp: string;
  filters: {
    gender: Gender[];
    status: Status[];
    customFilters: { fieldId: string; values: string[] }[];
  };
  selectedFields: Array<{ id: string; name: string; order: number }>;
  sortRules: SortRule[];
}
