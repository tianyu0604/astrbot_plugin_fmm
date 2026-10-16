import { useState, useRef, useEffect } from 'react';
import { Member, MemberData, CustomField, HistoryRecord, Gender, Status } from '../types/member';
import { Dashboard } from './Dashboard';
import { MemberCard } from './MemberCard';
import { MemberDialog } from './MemberDialog';
import { MemberSyncDialog } from './MemberSyncDialog';
import { HistoryDialog } from './HistoryDialog';
import { StatusAnalysisDialog } from './StatusAnalysisDialog';
import { ImagePreviewDialog } from './ImagePreviewDialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { Plus, Search, Upload, History, Edit, Download, Filter, RefreshCw, X as XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { downloadExcelTemplate } from '../utils/excelTemplate';
import { parseExcelFile } from '../utils/excelParser';
import { getMembers, MemberInfo, batchMembers, BatchMembersRequest, updateMember, UpdateMemberRequest, getHistory, GetHistoryRequest } from '../api/MemberAPI';

interface MemberArchivesProps {
  members: Member[];
  customFields: CustomField[];
  history: HistoryRecord[];
  onAddMember: (data: MemberData) => void;
  onBatchAddMembers: (dataList: MemberData[]) => void;
  onUpdateMember: (id: string, data: MemberData, reason: string) => void;
  onMembersChanged?: () => Promise<void>;
}

interface FilterValue {
  fieldId: string;
  value: string | string[];
}

export function MemberArchives({
  members,
  customFields,
  history,
  onAddMember,
  onBatchAddMembers,
  onUpdateMember,
  onMembersChanged,
}: MemberArchivesProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isExcelDialogOpen, setIsExcelDialogOpen] = useState(false);
  const [isSyncOpen, setIsSyncOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'view' | 'edit'>('view');
  const [apiMembers, setApiMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [dashboardKey, setDashboardKey] = useState(0); // 用于强制刷新 Dashboard 组件
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchMembers();
  }, []);

  // 将API获取的成员数据转换为本地Member类型
  const convertApiMembersToMembers = (apiMembers: MemberInfo[]): Member[] => {
    return apiMembers.map(apiMember => {
      // API返回的photo是数组，但MemberData的photo是单个字符串
      const photo = apiMember.photo && apiMember.photo.length > 0 ? apiMember.photo[0] : undefined;

      // 过滤掉空数组字段，只保留非空值
      const filteredCustomFields: Record<string, any> = {};
      if (apiMember.customFields) {
        Object.entries(apiMember.customFields).forEach(([key, value]) => {
          // 如果值不是空数组，则添加到过滤后的对象中
          if (!Array.isArray(value) || value.length > 0) {
            filteredCustomFields[key] = value;
          }
        });
      }

      return {
        id: apiMember.id,
        data: {
          name: apiMember.name,
          qq: apiMember.qq,
          gender: (apiMember.gender === '男' || apiMember.gender === '女' || apiMember.gender === '未知') ? apiMember.gender as Gender : '未知',
          status: (apiMember.status === '在职' || apiMember.status === '劝退' || apiMember.status === '光荣退休') ? apiMember.status as Status : '在职',
          photo: photo,
          ...filteredCustomFields
        },
        createdAt: apiMember.createTime,
        updatedAt: apiMember.updateTime || new Date().toISOString(),
      };
    });
  };

  // 合并本地成员和API成员
  const allMembers = [...members, ...convertApiMembersToMembers(apiMembers)];

  const [importResult, setImportResult] = useState<{
    isOpen: boolean;
    success: number;
    duplicates: string[];
    errors: string[];
  }>({ isOpen: false, success: 0, duplicates: [], errors: [] });
  const [filters, setFilters] = useState<FilterValue[]>([]);
  const [isStatusAnalysisOpen, setIsStatusAnalysisOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [imagePreview, setImagePreview] = useState<{
    open: boolean;
    images: string[];
    initialIndex: number;
    title?: string;
  }>({ open: false, images: [], initialIndex: 0 });

  const [memberHistoryFromApi, setMemberHistoryFromApi] = useState<any[]>([]); // 从API获取的历史记录

  const filteredMembers = allMembers.filter(member => {
    // Apply search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      let matchesSearch = false;

      // Search in default fields
      if (member.data.name?.toLowerCase().includes(query)) matchesSearch = true;
      if (member.data.gender?.toLowerCase().includes(query)) matchesSearch = true;
      if (member.data.status?.toLowerCase().includes(query)) matchesSearch = true;

      // Search in custom fields
      for (const field of customFields) {
        const value = member.data[field.id];
        if (value && value.toString().toLowerCase().includes(query)) {
          matchesSearch = true;
          break;
        }
      }

      // Also search in API member custom fields
      const customFieldValues = Object.values(member.data).filter(value =>
        typeof value === 'string' || typeof value === 'number'
      );
      for (const value of customFieldValues) {
        if (value.toString().toLowerCase().includes(query)) {
          matchesSearch = true;
          break;
        }
      }

      if (!matchesSearch) return false;
    }

    // Apply filters
    for (const filter of filters) {
      const value = member.data[filter.fieldId];

      if (Array.isArray(filter.value)) {
        // Multi-select filter (not currently used but ready for future)
        if (!filter.value.includes(value?.toString() || '')) {
          return false;
        }
      } else {
        // Single select filter
        if (filter.value === '') continue; // Skip empty filters

        // For date fields, compare dates
        const field = customFields.find(f => f.id === filter.fieldId);
        if (field?.type === 'date') {
          if (!value) return false;
          const filterDate = new Date(filter.value).toDateString();
          const valueDate = new Date(value).toDateString();
          if (filterDate !== valueDate) return false;
        } else {
          // For other fields, exact match
          if (value?.toString() !== filter.value) {
            return false;
          }
        }
      }
    }

    return true;
  });

  const handleCardClick = (member: Member) => {
    setSelectedMember(member);
    setViewMode('view');
    setIsDialogOpen(true);
  };

  const handleEdit = () => {
    setViewMode('edit');
  };

  const handleAddNew = () => {
    setSelectedMember(null);
    setViewMode('edit');
    setIsDialogOpen(true);
  };

  // 辅助函数：格式化日期为 YYYY-MM-DD
  const formatDateForOutput = (dateValue: string): string => {
    if (!dateValue) return '';
    try {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) return dateValue; // 如果不是有效日期，返回原值
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch {
      return dateValue;
    }
  };

  const handleSave = async (data: MemberData, reason?: string) => {
    if (selectedMember && reason) {
      // 更新现有成员
      try {
        // 格式化照片数据 - 如果 data.photo 是字符串，转换为数组；如果是数组，直接使用
        let photoArray: string[] = [];
        if (data.photo) {
          if (Array.isArray(data.photo)) {
            photoArray = data.photo;
          } else {
            photoArray = [data.photo];
          }
        }

        // 分离自定义字段和默认字段
        const customFields: Record<string, any> = {};
        const defaultFields: Record<string, any> = {};

        Object.entries(data).forEach(([key, value]) => {
          if (['name', 'gender', 'status', 'photo'].includes(key)) {
            // 空值标准化处理：undefined、'undefined'、'null'、null 统一转换为空字符串
            if (value === undefined || value === 'undefined' || value === 'null' || value === null) {
              defaultFields[key] = '';
            } else {
              defaultFields[key] = value;
            }
          } else {
            // 如果值是数组（如图片相册），直接使用；否则转换为相应类型
            if (Array.isArray(value)) {
              // 检查数组元素是否为日期并格式化
              customFields[key] = value.map(item => {
                if (typeof item === 'string') {
                  // 检查是否为日期格式 (YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY, DD/MM/YYYY 等)
                  // 避免将纯数字（如12）误认为日期
                  const isDateFormat = /^\d{4}-\d{2}-\d{2}$|^\d{4}\/\d{2}\/\d{2}$|^\d{2}\/\d{2}\/\d{4}$|^\d{2}-\d{2}-\d{4}$/.test(item);
                  if (isDateFormat && !isNaN(Date.parse(item))) {
                    return formatDateForOutput(item);
                  } else {
                    // 如果值是字符串 'null'，转换为实际的 null 值
                    return item === 'null' ? null : item;
                  }
                }
                return item;
              });
            } else if (typeof value === 'number') {
              customFields[key] = value;
            } else if (typeof value === 'string') {
              // 检查是否为日期格式 (YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY, DD/MM/YYYY 等)
              // 避免将纯数字（如12）误认为日期
              const isDateFormat = /^\d{4}-\d{2}-\d{2}$|^\d{4}\/\d{2}\/\d{2}$|^\d{2}\/\d{2}\/\d{4}$|^\d{2}-\d{2}-\d{4}$/.test(value);
              if (isDateFormat && !isNaN(Date.parse(value))) {
                customFields[key] = formatDateForOutput(value);
              } else {
                // 空值标准化处理：undefined、'undefined'、'null'、null 统一转换为空字符串
                if (value === undefined || value === 'undefined' || value === 'null' || value === null) {
                  customFields[key] = '';
                } else {
                  customFields[key] = value;
                }
              }
            } else {
              // 空值标准化处理：undefined、'undefined'、'null'、null 统一转换为空字符串
              if (value === undefined || value === 'undefined' || value === 'null' || value === null) {
                customFields[key] = '';
              } else {
                customFields[key] = String(value);
              }
            }
          }
        });

        const updateRequest: UpdateMemberRequest = {
          id: selectedMember.id,
          updateDate: {
            name: defaultFields.name,
            gender: defaultFields.gender,
            status: defaultFields.status,
            photo: photoArray,
            customFields: customFields
          },
          reason: reason
        };

        console.log('更新成员请求:', JSON.stringify(updateRequest, null, 2));

        const response = await updateMember(updateRequest);
        if (response.code === 200) {
          toast.success('成员档案已更新');
          // 调用本地的 onUpdateMember 回调函数
          onUpdateMember(selectedMember.id, data, reason);
          // 同步成功后，重新获取成员数据以更新仪表板
          await fetchMembers();
        } else {
          throw new Error(response.msg || '更新成员数据失败');
        }
      } catch (error) {
        console.error('更新成员数据失败:', error);
        throw error;
      }
    } else if (!selectedMember) {
      // 新增成员
      // 检查是否与现有成员重名
      const existingQQs = new Set(allMembers.map(m => m.data.qq));
      if (existingQQs.has(data.qq)) throw new Error('该 QQ 号已被使用');

      // 打印格式化的成员数据
      const formattedData = {
        members: [
          {
            // 空值标准化处理：处理可能的空值情况
            name: data.name || '',
            gender: data.gender || '未知',
            status: data.status || '在职',
            photo: data.photo ? [data.photo] : [],
            customFields: {}
          }
        ]
      };

      // 将非默认字段添加到 customFields
      Object.entries(data).forEach(([key, value]) => {
        if (!['name', 'gender', 'status', 'photo'].includes(key)) {
          // 空值标准化处理：undefined、'undefined'、'null'、null 统一转换为空字符串
          if (value === undefined || value === 'undefined' || value === 'null' || value === null) {
            formattedData.members[0].customFields[key] = '';
            return;
          }

          // 如果值是数组（如图片相册），直接使用；否则转换为相应类型
          if (Array.isArray(value)) {
            // 检查数组元素是否为日期并格式化
            formattedData.members[0].customFields[key] = value.map(item => {
              if (typeof item === 'string') {
                // 检查是否为日期格式 (YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY, DD/MM/YYYY 等)
                // 避免将纯数字（如12）误认为日期
                const isDateFormat = /^\d{4}-\d{2}-\d{2}$|^\d{4}\/\d{2}\/\d{2}$|^\d{2}\/\d{2}\/\d{4}$|^\d{2}-\d{2}-\d{4}$/.test(item);
                if (isDateFormat && !isNaN(Date.parse(item))) {
                  return formatDateForOutput(item);
                } else {
                  // 空值标准化处理：undefined、'undefined'、'null'、null 统一转换为空字符串
                  if (item === undefined || item === 'undefined' || item === 'null' || item === null) {
                    return '';
                  }
                  return item;
                }
              }
              return item;
            });
          } else if (typeof value === 'number') {
            formattedData.members[0].customFields[key] = value;
          } else if (typeof value === 'string') {
            // 检查是否为日期格式 (YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY, DD/MM/YYYY 等)
            // 避免将纯数字（如12）误认为日期
            const isDateFormat = /^\d{4}-\d{2}-\d{2}$|^\d{4}\/\d{2}\/\d{2}$|^\d{2}\/\d{2}\/\d{4}$|^\d{2}-\d{2}-\d{4}$/.test(value);
            if (isDateFormat && !isNaN(Date.parse(value))) {
              formattedData.members[0].customFields[key] = formatDateForOutput(value);
            } else {
              // 空值标准化处理：undefined、'undefined'、'null'、null 统一转换为空字符串
              if (value === undefined || value === 'undefined' || value === 'null' || value === null) {
                formattedData.members[0].customFields[key] = '';
              } else {
                formattedData.members[0].customFields[key] = value;
              }
            }
          } else {
            // 空值标准化处理：undefined、'undefined'、'null'、null 统一转换为空字符串
            if (value === undefined || value === 'undefined' || value === 'null' || value === null) {
              formattedData.members[0].customFields[key] = '';
            } else {
              formattedData.members[0].customFields[key] = String(value);
            }
          }
        }
      });

      console.log(JSON.stringify(formattedData, null, 2));

      // 调用网络请求
      try {
        const response = await batchMembers(formattedData);
        if (response.code === 200) {
          toast.success('成员数据已同步到服务器');
          // 同步成功后，重新获取成员数据
          await fetchMembers();
        } else {
          throw new Error(response.msg || '同步成员数据失败');
        }
      } catch (error) {
        console.error('同步成员数据失败:', error);
        throw error;
      }
    }
    setIsDialogOpen(false);
    setSelectedMember(null);
  };

  // 转换API返回的历史记录格式到HistoryDialog期望的格式
  const convertHistoryFormat = (apiHistory: any[], customFields: CustomField[]) => {
    // 创建一个字段ID到字段名的映射
    const fieldIdToName: { [key: string]: string } = {};

    // 映射默认字段
    fieldIdToName['name'] = '姓名';
    fieldIdToName['qq'] = 'QQ 号';
    fieldIdToName['gender'] = '性别';
    fieldIdToName['status'] = '状态';
    fieldIdToName['photo'] = '照片';

    // 映射自定义字段
    customFields.forEach(field => {
      fieldIdToName[field.id] = field.name;
    });

    return apiHistory.map(record => {
      // 将afterDate和beforeDate中的差异转换为changes数组
      const changes: Array<{ field: string; oldValue: any; newValue: any }> = [];

      const afterDate = record.afterDate || {};
      const beforeDate = record.beforeDate || {};

      // 处理嵌套的customFields结构
      const processFields = (obj: any) => {
        const result: any = { ...obj };
        if (obj.customFields && typeof obj.customFields === 'object') {
          // 将customFields中的字段提升到顶层
          Object.assign(result, obj.customFields);
          delete result.customFields;
        }
        return result;
      };

      const processedAfterDate = processFields(afterDate);
      const processedBeforeDate = processFields(beforeDate);

      // 比较所有processedAfterDate中的字段
      Object.keys(processedAfterDate).forEach(key => {
        if (JSON.stringify(processedAfterDate[key]) !== JSON.stringify(processedBeforeDate[key])) {
          const fieldName = fieldIdToName[key] || key; // 如果找不到对应名称，使用原始ID
          changes.push({
            field: fieldName,
            oldValue: processedBeforeDate[key],
            newValue: processedAfterDate[key]
          });
        }
      });

      // 检查processedBeforeDate中有但processedAfterDate中没有的字段
      Object.keys(processedBeforeDate).forEach(key => {
        if (!(key in processedAfterDate)) {
          const fieldName = fieldIdToName[key] || key; // 如果找不到对应名称，使用原始ID
          changes.push({
            field: fieldName,
            oldValue: processedBeforeDate[key],
            newValue: undefined
          });
        }
      });

      // 过滤掉从 0 张照片到空值的变化
      const filteredChanges = changes.filter(change => {
        if (change.field === '照片') {  // '照片' 是经过 fieldIdToName 映射后的字段名
          // 检查是否是从 0 张图片到空值的变化
          const oldValue = change.oldValue;
          const newValue = change.newValue;

          // 如果 oldValue 是空数组或长度为 0 的数组，且 newValue 是 undefined/null，则过滤掉
          const isOldValueEmptyPhotos = Array.isArray(oldValue) && oldValue.length === 0;
          const isNewValueEmpty = newValue == null || (Array.isArray(newValue) && newValue.length === 0);

          if (isOldValueEmptyPhotos && isNewValueEmpty) {
            return false;
          }
        }
        return true;
      });

      return {
        id: record.id,
        memberId: record.memberId,
        editor: '当前用户', // 由于API未提供编辑者信息，使用默认值
        timestamp: record.updateTime, // API返回的时间格式可能需要调整
        reason: record.reason,
        changes: filteredChanges
      };
    });
  };

  const handleShowHistory = async () => {
    if (selectedMember) {
      try {
        // 从API获取历史记录
        const requestData: GetHistoryRequest = { id: selectedMember.id };
        const response = await getHistory(requestData);

        if (response.code === 200) {
          // 转换格式并设置历史记录
          const convertedHistory = convertHistoryFormat(response.data, customFields);
          setMemberHistoryFromApi(convertedHistory);
          console.log('获取历史记录成功:', response.data);
          console.log('转换后历史记录:', convertedHistory);
        } else {
          toast.error(response.msg || '获取历史记录失败');
          setMemberHistoryFromApi([]); // 设置为空数组以避免显示旧数据
        }
      } catch (error) {
        console.error('获取历史记录失败:', error);
        toast.error('获取历史记录失败');
        setMemberHistoryFromApi([]);
      }
    }
    setIsHistoryOpen(true);
  };

  const handleFilterChange = (fieldId: string, value: string) => {
    setFilters(prev => {
      const existing = prev.find(f => f.fieldId === fieldId);
      if (existing) {
        if (value === '') {
          // Remove filter if value is empty
          return prev.filter(f => f.fieldId !== fieldId);
        }
        // Update existing filter
        return prev.map(f => f.fieldId === fieldId ? { ...f, value } : f);
      } else if (value !== '') {
        // Add new filter
        return [...prev, { fieldId, value }];
      }
      return prev;
    });
  };

  const handleClearFilters = () => {
    setFilters([]);
  };

  const getFilterableFields = () => {
    const fields: Array<{ id: string; name: string; type: string; options?: string[] }> = [
      { id: 'gender', name: '性别', type: 'radio', options: ['男', '女', '未知'] },
      { id: 'status', name: '状态', type: 'radio', options: ['在职', '劝退', '光荣退休'] },
    ];

    // Add custom fields that are filterable
    customFields
      .filter(f => !f.hidden && (f.type === 'radio' || f.type === 'date'))
      .forEach(f => {
        fields.push({
          id: f.id,
          name: f.name,
          type: f.type,
          options: f.options,
        });
      });

    return fields;
  };

  const getUniqueValuesForField = (fieldId: string) => {
    const values = new Set<string>();
    members.forEach(member => {
      const value = member.data[fieldId];
      if (value) {
        values.add(value.toString());
      }
    });
    return Array.from(values).sort();
  };

  const activeFilterCount = filters.length;

  // 获取成员数据的函数
  const fetchMembers = async () => {
    try {
      setLoading(true);
      const response = await getMembers();
      if (response.code === 200) {
        setApiMembers(response.data);
        setDashboardKey(prev => prev + 1); // 触发 Dashboard 组件重新渲染
        await onMembersChanged?.();
        console.log('API获取的成员数据:', response.data);
      } else {
        toast.error(response.msg || '获取成员数据失败');
      }
    } catch (error) {
      console.error('获取成员数据失败:', error);
      toast.error('获取成员数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusClick = (status: string) => {
    setSelectedStatus(status);
    setIsStatusAnalysisOpen(true);
  };

  const memberHistory = memberHistoryFromApi;

  const handleDownloadTemplate = () => {
    try {
      downloadExcelTemplate(customFields);
      toast.success('模板下载成功');
    } catch (error) {
      toast.error('模板下载失败');
      console.error(error);
    }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      toast.info('正在解析Excel文件...');

      const result = await parseExcelFile(file, customFields);
      if (!result.success) throw new Error(result.errors.join('；'));

      // 直接使用所有解析的数据，不做任何校验和转换
      const formattedData = {
        members: result.data.map(memberData => {
          const { name, gender, status, photo, ...restFields } = memberData;

          return {
            name,
            gender,
            status,
            photo: photo ? [photo] : [],
            customFields: restFields
          };
        })
      };

      console.log(JSON.stringify(formattedData, null, 2));

      // 调用网络请求
      try {
        const response = await batchMembers(formattedData);
        if (response.code === 200) {
          const { successCount = 0, duplicateCount = [], paraseErrors = [] } = response.data || {};

          // 不再合并同一行的多个错误，每条错误单独占一行显示
          const formattedErrors: string[] = paraseErrors.map(
            (error: { index: number; message: string }) =>
              `第 ${error.index + 3} 行：${error.message}`,
          );

          setImportResult({
            isOpen: true,
            success: successCount,
            duplicates: duplicateCount,
            errors: formattedErrors,
          });
          if (successCount > 0) {
            toast.success(`成功导入 ${successCount} 条成员数据`);
            await fetchMembers();
          } else {
            toast.warning(response.msg || '没有成员被导入');
          }
        } else {
          toast.error(response.msg || '导入成员数据失败');
          setImportResult({
            isOpen: true,
            success: 0,
            duplicates: [],
            errors: [response.msg || '导入成员数据失败'],
          });
        }
      } catch (error) {
        console.error('导入成员数据失败:', error);
        toast.error('导入成员数据失败');
        setImportResult({
          isOpen: true,
          success: 0,
          duplicates: [],
          errors: [`导入失败: ${error instanceof Error ? error.message : '未知错误'}`],
        });
      }

      setIsExcelDialogOpen(false);

      // Reset the input
      e.target.value = '';
    } catch (error) {
      setImportResult({
        isOpen: true,
        success: 0,
        duplicates: [],
        errors: [`Excel导入失败: ${error instanceof Error ? error.message : '未知错误'}`],
      });
      setIsExcelDialogOpen(false);
      e.target.value = '';
      console.error('Excel import error:', error);
    }
  };

  return (
    <div className="space-y-6">
      <Dashboard key={`dashboard-${dashboardKey}`} members={allMembers} onStatusClick={handleStatusClick} />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="flex-1 w-full sm:max-w-md">
            <div className="relative bg-input-background rounded-sm transition-all hover:shadow-lg hover:scale-105">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground " />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索成员档案..."
                className="pl-10"
              />
            </div>
          </div>
          <div className="member-toolbar flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Filter className="h-4 w-4" />
                  筛选器
                  {activeFilterCount > 0 && (
                    <Badge variant="secondary" className="ml-1 px-1.5 py-0 h-5 min-w-5">
                      {activeFilterCount}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">筛选条件</h4>
                    {activeFilterCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleClearFilters}
                        className="h-8 px-2 text-xs"
                      >
                        清除全部
                      </Button>
                    )}
                  </div>

                  <Separator />

                  <div className="space-y-3 max-h-[400px] overflow-y-auto">
                    {getFilterableFields().map(field => {
                      const currentFilter = filters.find(f => f.fieldId === field.id);
                      const currentValue = currentFilter?.value?.toString() || '';

                      return (
                        <div key={field.id} className="space-y-1.5">
                          <label className="text-sm font-medium">{field.name}</label>
                          {field.type === 'radio' && field.options ? (
                            <div className="flex gap-2">
                              <Select
                                value={currentValue || undefined}
                                onValueChange={value => handleFilterChange(field.id, value)}
                              >
                                <SelectTrigger className="h-9">
                                  <SelectValue placeholder="全部" />
                                </SelectTrigger>
                                <SelectContent>
                                  {field.options.map(option => (
                                    <SelectItem key={option} value={option}>
                                      {option}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {currentValue && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9"
                                  onClick={() => handleFilterChange(field.id, '')}
                                >
                                  <XIcon className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          ) : field.type === 'date' ? (
                            <div className="flex gap-2">
                              <Input
                                type="date"
                                value={currentValue}
                                onChange={e => handleFilterChange(field.id, e.target.value)}
                                className="h-9"
                              />
                              {currentValue && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9"
                                  onClick={() => handleFilterChange(field.id, '')}
                                >
                                  <XIcon className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <Button onClick={() => setIsSyncOpen(true)} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              同步群成员
            </Button>
            <Button onClick={() => setIsExcelDialogOpen(true)} variant="outline" className="gap-2">
              <Upload className="h-4 w-4" />
              Excel导入
            </Button>
            <Button onClick={handleAddNew} className="gap-2">
              <Plus className="h-4 w-4" />
              新增成员
            </Button>
          </div>
        </div>

        {/* Active Filters Display */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-muted-foreground">已应用筛选:</span>
            {filters.map(filter => {
              const field = getFilterableFields().find(f => f.id === filter.fieldId);
              if (!field) return null;

              let displayValue = filter.value.toString();
              if (field.type === 'date') {
                // Format date as YYYY-MM-DD to comply with project specification
                const date = new Date(filter.value as string);
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                displayValue = `${year}-${month}-${day}`;
              }

              return (
                <Badge
                  key={filter.fieldId}
                  variant="secondary"
                  className="gap-1 pr-1"
                >
                  {field.name}: {displayValue}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 p-0 hover:bg-transparent"
                    onClick={() => handleFilterChange(filter.fieldId, '')}
                  >
                    <XIcon className="h-3 w-3" />
                  </Button>
                </Badge>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              className="h-7 text-xs"
            >
              清除全部
            </Button>
          </div>
        )}
      </div>

      {filteredMembers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {searchQuery || activeFilterCount > 0 ? '未找到匹配的成员' : '暂无成员档案，点击"新增成员"添加'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMembers.map(member => (
            <MemberCard
              key={member.id}
              member={member}
              customFields={customFields}
              onClick={() => handleCardClick(member)}
              onPhotoClick={(photo, name) => setImagePreview({
                open: true,
                images: [photo],
                initialIndex: 0,
                title: `${name} - 照片`,
              })}
            />
          ))}
        </div>
      )}

      {/* View/Edit Member Dialog */}
      {viewMode === 'view' && selectedMember ? (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>成员档案详情</DialogTitle>
              <DialogDescription>
                查看成员的完整档案信息
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {selectedMember.data.photo && (
                <div className="flex justify-center">
                  <img
                    src={selectedMember.data.photo}
                    alt={selectedMember.data.name}
                    className="w-32 h-32 object-cover rounded cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => setImagePreview({
                      open: true,
                      images: selectedMember.data.photo ? [selectedMember.data.photo] : [],
                      initialIndex: 0,
                      title: `${selectedMember.data.name} - 照片`,
                    })}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">姓名</div>
                  <div className="font-medium">{selectedMember.data.name}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">QQ 号</div>
                  <div className="font-medium">{selectedMember.data.qq}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">性别</div>
                  <div className="font-medium">{selectedMember.data.gender}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">状态</div>
                  <div className="font-medium">{selectedMember.data.status}</div>
                </div>
              </div>

              {customFields.filter(f => !f.hidden).map(field => {
                const value = selectedMember.data[field.id];
                if (!value) return null;

                return (
                  <div key={field.id}>
                    <div className="text-sm text-muted-foreground mb-1">{field.name}</div>
                    <div className="font-medium">
                      {field.type === 'images' && Array.isArray(value) ? (
                        <div className="grid grid-cols-3 gap-2">
                          {value.map((img, idx) => (
                            <img
                              key={idx}
                              src={img}
                              alt=""
                              className="w-full aspect-square object-cover rounded cursor-pointer hover:opacity-80 transition-opacity"
                              onClick={() => setImagePreview({
                                open: true,
                                images: value as string[],
                                initialIndex: idx,
                                title: `${selectedMember.data.name} - ${field.name}`,
                              })}
                            />
                          ))}
                        </div>
                      ) : field.type === 'date' ? (
                        // Format date as YYYY-MM-DD to comply with project specification
                        (() => {
                          const date = new Date(value);
                          const year = date.getFullYear();
                          const month = String(date.getMonth() + 1).padStart(2, '0');
                          const day = String(date.getDate()).padStart(2, '0');
                          return `${year}-${month}-${day}`;
                        })()
                      ) : (
                        value.toString()
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="text-xs text-muted-foreground pt-4 border-t">
                <div>创建时间: {new Date(selectedMember.createdAt).toLocaleString('zh-CN')}</div>
                <div>更新时间: {new Date(selectedMember.updatedAt).toLocaleString('zh-CN')}</div>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleShowHistory} className="gap-2">
                <History className="h-4 w-4" />
                查看历史
              </Button>
              <Button onClick={handleEdit} className="gap-2">
                <Edit className="h-4 w-4" />
                编辑
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : (
        <MemberDialog
          open={isDialogOpen && viewMode === 'edit'}
          onOpenChange={setIsDialogOpen}
          member={selectedMember}
          customFields={customFields}
          onSave={handleSave}
        />
      )}

      {/* History Dialog */}
      <HistoryDialog
        open={isHistoryOpen}
        onOpenChange={setIsHistoryOpen}
        history={memberHistory}
        customFields={customFields}
      />

      {/* Status Analysis Dialog */}
      <StatusAnalysisDialog
        open={isStatusAnalysisOpen}
        onOpenChange={setIsStatusAnalysisOpen}
        status={selectedStatus}
        members={allMembers}
        customFields={customFields}
      />

      {/* Image Preview Dialog */}
      <ImagePreviewDialog
        open={imagePreview.open}
        onOpenChange={(open) => setImagePreview({ ...imagePreview, open })}
        images={imagePreview.images}
        initialIndex={imagePreview.initialIndex}
        title={imagePreview.title}
      />

      {/* 同步 QQ 群成员 */}
      <MemberSyncDialog
        open={isSyncOpen}
        onOpenChange={setIsSyncOpen}
        onSynced={fetchMembers}
      />

      {/* Excel Import Dialog */}
      <Dialog open={isExcelDialogOpen} onOpenChange={setIsExcelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excel导入成员档案</DialogTitle>
            <DialogDescription>
              上传Excel文件批量导入成员档案。非必填字段可以不填写。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <div>
                <div className="font-medium mb-1">下载导入模板</div>
                <p className="text-xs text-muted-foreground">
                  下载包含当前档案字段的Excel模板
                </p>
              </div>
              <Button onClick={handleDownloadTemplate} variant="outline" className="gap-2">
                <Download className="h-4 w-4" />
                下载模板
              </Button>
            </div>

            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                选择Excel文件
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleExcelUpload}
              />
              <p className="text-xs text-muted-foreground mt-2">
                支持 .xlsx 和 .xls 格式
              </p>
            </div>

            <div className="text-sm text-muted-foreground">
              <p className="font-medium mb-2">Excel格式要求：</p>
              <ul className="list-disc list-inside space-y-1">
                <li>第一行为表头（字段名称）</li>
                <li>必填字段：姓名、QQ号、性别、状态</li>
                <li>照片字段可填写图片URL</li>
                <li>自定义字段按照字段名称填写</li>
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Result Dialog */}
      <Dialog open={importResult.isOpen} onOpenChange={(open) => setImportResult({ ...importResult, isOpen: open })}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>Excel导入结果</DialogTitle>
            <DialogDescription>
              查看导入详情
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-6">
            <div className="space-y-4 pb-4">
              {/* Success Summary */}
              <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-green-900">成功导入</div>
                  <div className="text-sm text-green-700">
                    {importResult.success > 0
                      ? `成功导入 ${importResult.success} 条成员档案`
                      : '没有成员被导入'}
                  </div>
                </div>
              </div>

              {/* Duplicates */}
              {importResult.duplicates.length > 0 && (
                <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-medium text-yellow-900">跳过重名记录</div>
                    <div className="text-sm text-yellow-700 mb-2">
                      以下 {importResult.duplicates.length} 条记录因姓名重复被跳过：
                    </div>
                    <div className="text-sm text-yellow-800 space-y-1 max-h-40 overflow-y-auto pr-2">
                      {importResult.duplicates.map((name, idx) => (
                        <div key={idx} className="pl-2">• {name}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Errors */}
              {importResult.errors.length > 0 && (
                <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-medium text-red-900">解析错误</div>
                    <div className="text-sm text-red-700 mb-2">
                      发现 {importResult.errors.length} 个错误：
                    </div>
                    <div className="text-sm text-red-800 space-y-1 max-h-40 overflow-y-auto pr-2">
                      {importResult.errors.map((error, idx) => (
                        <div key={idx} className="pl-2">• {error}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Summary */}
              <div className="text-sm text-muted-foreground p-4 bg-muted rounded-lg">
                <div className="font-medium mb-2">导入汇总：</div>
                <div className="space-y-1">
                  <div>• 成功导入：{importResult.success} 条</div>
                  <div>• 重名跳过：{importResult.duplicates.length} 条</div>
                  <div>• 解析错误：{importResult.errors.length} 个</div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="px-6 pb-6 pt-4">
            <Button onClick={() => setImportResult({ isOpen: false, success: 0, duplicates: [], errors: [] })}>
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
