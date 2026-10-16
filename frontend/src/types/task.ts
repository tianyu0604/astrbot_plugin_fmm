export type TaskType = '推文' | 'APP运营' | string;
export type Department = 'MC' | 'TP' | string;

export interface Estimation {
  id: string;
  userId: string;
  userName: string;
  points: number;
  submittedAt: string;
  hidden: boolean; // 管理员可以隐藏
  modifiedBy?: string; // 管理员修改过
  modifiedAt?: string;
}

export interface EstimationHistory {
  id: string;
  taskId: string;
  action: 'hide' | 'show' | 'modify' | 'lock' | 'unlock';
  targetUserId?: string; // 被操作的估点所属用户
  oldValue?: number;
  newValue?: number;
  operatedBy: string;
  operatedAt: string;
  reason?: string;
}

export interface Task {
  id: string;
  name: string; // 30字以内
  type: TaskType;
  department: Department;
  description: string; // 1000字以内
  evaluators: string[]; // 可评价人的ID数组
  estimations: Estimation[]; // 所有估点
  averagePoints: number | null; // 平均估点（排除隐藏的）
  locked: boolean; // 是否锁定
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskSettings {
  taskTypes: TaskType[];
  departments: Department[];
}
