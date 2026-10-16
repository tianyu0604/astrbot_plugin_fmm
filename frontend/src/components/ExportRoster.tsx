import React, { useState, useMemo, useEffect } from 'react';
import { Member, CustomField, Gender, Status, ExportConfig, SortRule } from '../types/member';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { toast } from 'sonner';
import { Download, Eye, ChevronUp, ChevronDown, X, GripVertical, History, ArrowUpDown, Trash2, FileText, Loader2, RotateCcw } from 'lucide-react';
import { exportRosterToExcel } from '../utils/excelExporter';
import { getExportPreview, saveExportHistory, getExportLists, getExportHistoryDetail, deleteExportHistory, getUsedOptions } from '../api/MemberAPI';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

interface ExportRosterProps {
  members: Member[];
  customFields: CustomField[];
}

interface FieldSelection {
  id: string;
  name: string;
  selected: boolean;
  order: number;
}

interface MemberFilter {
  gender: Gender[];
  status: Status[];
  customFilters: { fieldId: string; values: string[] }[];
}

const EXPORT_HISTORY_KEY = 'fmm_export_history';

export function ExportRoster({
  members,
  customFields,
}: ExportRosterProps) {
  const [step, setStep] = useState<'filter' | 'fields' | 'sort' | 'preview'>('filter');
  const [title, setTitle] = useState('成员花名册');

  // Filter state
  const [filters, setFilters] = useState<MemberFilter>({
    gender: [],
    status: [],
    customFilters: [],
  });

  // Field selection state
  const [fieldSelections, setFieldSelections] = useState<FieldSelection[]>([]);

  // Sort rules state
  const [sortRules, setSortRules] = useState<SortRule[]>([]);

  // Export history state
  const [exportHistory, setExportHistory] = useState<ExportConfig[]>([]);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [historyToDelete, setHistoryToDelete] = useState<string | null>(null);

  // API export history state
  const [apiExportHistory, setApiExportHistory] = useState<Array<{
    id: string;
    title: string;
    createTime: string;
    fieldCount: number;
    ruleCount: number;
  }>>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Preview data from API
  const [previewData, setPreviewData] = useState<{
    members: any[];
    total: number;
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Filter step total count from API
  const [filterStepTotal, setFilterStepTotal] = useState<number | null>(null);
  const [loadingFilterStep, setLoadingFilterStep] = useState(false);

  // Custom fields from API
  const [apiCustomFields, setApiCustomFields] = useState<CustomField[]>([]);
  const [loadingCustomFields, setLoadingCustomFields] = useState(false);

  // Load export history from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem(EXPORT_HISTORY_KEY);
    if (savedHistory) {
      try {
        setExportHistory(JSON.parse(savedHistory));
      } catch (error) {
        console.error('Failed to load export history:', error);
      }
    }
  }, []);

  // Initialize field selections when customFields change
  useEffect(() => {
    const defaultFields = [
      { id: 'photo', name: '照片', selected: false, order: 0 },
      { id: 'name', name: '姓名', selected: true, order: 1 },
      { id: 'qq', name: 'QQ 号', selected: true, order: 2 },
      { id: 'gender', name: '性别', selected: false, order: 3 },
      { id: 'status', name: '状态', selected: false, order: 4 },
    ];

    const customFieldsList = customFields.map((f, idx) => ({
      id: f.id,
      name: f.name,
      selected: false,
      order: defaultFields.length + idx,
    }));

    setFieldSelections([...defaultFields, ...customFieldsList]);
  }, [customFields]);

  // 当进入筛选步骤时，调用接口获取自定义字段
  useEffect(() => {
    if (step === 'filter') {
      setLoadingCustomFields(true);
      getUsedOptions()
        .then(response => {
          if (response.code === 200 && response.data) {
            // 新接口返回的 data 直接是数组
            const fields = Array.isArray(response.data) ? response.data : [];
            // 转换为 CustomField 格式以便兼容现有代码
            const convertedFields: CustomField[] = fields.map((field: any) => ({
              id: field.id,
              name: field.name,
              type: 'radio' as const,
              options: field.options || [],
              hidden: false,
              displayOrder: 0,
              isDeleted: false,
              used: true,
            }));
            setApiCustomFields(convertedFields);
          } else {
            console.error('获取自定义字段失败:', response.msg);
            // 如果获取失败，使用传入的 customFields prop
            setApiCustomFields(customFields);
          }
        })
        .catch(error => {
          console.error('获取自定义字段失败:', error);
          // 如果获取失败，使用传入的 customFields prop
          setApiCustomFields(customFields);
        })
        .finally(() => {
          setLoadingCustomFields(false);
        });
    }
  }, [step, customFields]);

  // 当在筛选步骤且筛选条件变化时，调用接口获取总数
  useEffect(() => {
    if (step === 'filter') {
      // 构建请求体，只包含筛选条件
      const customFieldsObj: Record<string, string[]> = {};
      filters.customFilters.forEach(cf => {
        customFieldsObj[cf.fieldId] = cf.values;
      });

      const requestData = {
        filter: {
          gender: filters.gender,
          status: filters.status,
          customFields: customFieldsObj,
        },
        selectedFields: [], // 第一步不需要字段选择
        sortRules: [], // 第一步不需要排序规则
      };

      setLoadingFilterStep(true);
      getExportPreview(requestData)
        .then(response => {
          if (response.code === 200 && response.data) {
            setFilterStepTotal(response.data.total);
          } else {
            console.error('获取筛选总数失败:', response.msg);
            setFilterStepTotal(null);
          }
        })
        .catch(error => {
          console.error('获取筛选总数失败:', error);
          setFilterStepTotal(null);
        })
        .finally(() => {
          setLoadingFilterStep(false);
        });
    } else {
      // 离开筛选步骤时清空总数
      setFilterStepTotal(null);
    }
  }, [step, filters]);

  // 当到达预览步骤时，调用接口获取预览数据并保存历史
  useEffect(() => {
    if (step === 'preview') {
      // 构建请求体
      const selectedFieldsArray = fieldSelections
        .filter(f => f.selected)
        .sort((a, b) => a.order - b.order)
        .map(f => f.id);

      // 将 customFilters 数组转换为 customFields 对象
      const customFieldsObj: Record<string, string[]> = {};
      filters.customFilters.forEach(cf => {
        customFieldsObj[cf.fieldId] = cf.values;
      });

      const requestData = {
        filter: {
          gender: filters.gender,
          status: filters.status,
          customFields: customFieldsObj,
        },
        selectedFields: selectedFieldsArray,
        sortRules: sortRules.map(rule => ({
          field: rule.fieldId,
          order: rule.direction.toUpperCase() as 'ASC' | 'DESC',
        })),
      };


      setLoadingPreview(true);
      setPreviewData(null); // 清空之前的预览数据

      // 调用 getExportPreview 接口
      getExportPreview(requestData)
        .then(response => {
          if (response.code === 200 && response.data) {
            setPreviewData(response.data);
          } else {
            console.error('获取预览数据失败:', response.msg);
            setPreviewData(null);
            toast.error(response.msg || '获取预览数据失败');
          }
        })
        .catch(error => {
          console.error('获取预览数据失败:', error);
          setPreviewData(null);
          toast.error('获取预览数据失败，请重试');
        })
        .finally(() => {
          setLoadingPreview(false);
        });

    } else {
      // 离开预览步骤时清空预览数据
      setPreviewData(null);
      setLoadingPreview(false);
    }
  }, [step, filters, fieldSelections, sortRules, title]);

  // Get filtered members
  const filteredMembers = useMemo(() => {
    return members.filter(member => {
      // Gender filter
      if (filters.gender.length > 0 && !filters.gender.includes(member.data.gender)) {
        return false;
      }

      // Status filter
      if (filters.status.length > 0 && !filters.status.includes(member.data.status)) {
        return false;
      }

      // Custom field filters
      for (const customFilter of filters.customFilters) {
        if (customFilter.values.length > 0) {
          const memberValue = member.data[customFilter.fieldId];
          if (!memberValue || !customFilter.values.includes(memberValue.toString())) {
            return false;
          }
        }
      }

      return true;
    });
  }, [members, filters]);

  // Get sorted members
  const sortedMembers = useMemo(() => {
    if (sortRules.length === 0) {
      return filteredMembers;
    }

    return [...filteredMembers].sort((a, b) => {
      for (const rule of sortRules) {
        let aValue: any;
        let bValue: any;

        // Get values based on field type
        if (rule.fieldId === 'name') {
          aValue = a.data.name;
          bValue = b.data.name;
        } else if (rule.fieldId === 'gender') {
          aValue = a.data.gender;
          bValue = b.data.gender;
        } else if (rule.fieldId === 'status') {
          aValue = a.data.status;
          bValue = b.data.status;
        } else {
          aValue = a.data[rule.fieldId];
          bValue = b.data[rule.fieldId];
        }

        // Handle null/undefined values
        if (aValue == null && bValue == null) continue;
        if (aValue == null) return 1;
        if (bValue == null) return -1;

        // Find custom field type
        const customField = customFields.find(f => f.id === rule.fieldId);

        // Compare based on field type
        let comparison = 0;
        if (customField?.type === 'number') {
          comparison = Number(aValue) - Number(bValue);
        } else if (customField?.type === 'date') {
          comparison = new Date(aValue).getTime() - new Date(bValue).getTime();
        } else {
          // Text comparison
          comparison = String(aValue).localeCompare(String(bValue), 'zh-CN');
        }

        if (comparison !== 0) {
          return rule.direction === 'asc' ? comparison : -comparison;
        }
      }
      return 0;
    });
  }, [filteredMembers, sortRules, customFields]);

  // Get selected fields in order
  const selectedFields = useMemo(() => {
    return fieldSelections
      .filter(f => f.selected)
      .sort((a, b) => a.order - b.order);
  }, [fieldSelections]);

  // 打印当前所有已选择的筛选条件
  const printSelectedFilters = (currentFilters: MemberFilter) => {
    const selectedFilters: Record<string, string[]> = {};

    // 性别筛选（没有id，直接使用名称）
    if (currentFilters.gender.length > 0) {
      selectedFilters['性别'] = currentFilters.gender;
    }

    // 状态筛选（没有id，直接使用名称）
    if (currentFilters.status.length > 0) {
      selectedFilters['状态'] = currentFilters.status;
    }

    // 自定义字段筛选（有id时，格式为"字段名称（字段id）"）
    currentFilters.customFilters.forEach(customFilter => {
      const field = apiCustomFields.find(f => f.id === customFilter.fieldId);
      let fieldKey: string;
      if (field) {
        // 如果有字段信息且有id，格式为"字段名称（字段id）"
        fieldKey = `${field.name}（${field.id}）`;
      } else {
        // 如果找不到字段信息，只使用id
        fieldKey = customFilter.fieldId;
      }
      if (customFilter.values.length > 0) {
        selectedFilters[fieldKey] = customFilter.values;
      }
    });


    Object.entries(selectedFilters).forEach(([name, values]) => {
    });
  };

  // Toggle filter
  const toggleGenderFilter = (gender: Gender) => {
    setFilters(prev => {
      const newFilters = {
        ...prev,
        gender: prev.gender.includes(gender)
          ? prev.gender.filter(g => g !== gender)
          : [...prev.gender, gender],
      };
      // 打印当前所有已选择的筛选条件
      printSelectedFilters(newFilters);
      return newFilters;
    });
  };

  const toggleStatusFilter = (status: Status) => {
    setFilters(prev => {
      const newFilters = {
        ...prev,
        status: prev.status.includes(status)
          ? prev.status.filter(s => s !== status)
          : [...prev.status, status],
      };
      // 打印当前所有已选择的筛选条件
      printSelectedFilters(newFilters);
      return newFilters;
    });
  };

  const toggleCustomFilter = (fieldId: string, value: string) => {
    setFilters(prev => {
      const existingFilter = prev.customFilters.find(f => f.fieldId === fieldId);

      let newFilters: MemberFilter;
      if (existingFilter) {
        const newValues = existingFilter.values.includes(value)
          ? existingFilter.values.filter(v => v !== value)
          : [...existingFilter.values, value];

        newFilters = {
          ...prev,
          customFilters: newValues.length === 0
            ? prev.customFilters.filter(f => f.fieldId !== fieldId)
            : prev.customFilters.map(f =>
              f.fieldId === fieldId ? { ...f, values: newValues } : f
            ),
        };
      } else {
        newFilters = {
          ...prev,
          customFilters: [...prev.customFilters, { fieldId, values: [value] }],
        };
      }
      // 打印当前所有已选择的筛选条件
      printSelectedFilters(newFilters);
      return newFilters;
    });
  };

  // 重置所有筛选条件
  const resetFilters = () => {
    const emptyFilters: MemberFilter = {
      gender: [],
      status: [],
      customFilters: [],
    };
    setFilters(emptyFilters);
    // 打印重置后的筛选条件（应该为空）
    printSelectedFilters(emptyFilters);
    toast.success('已重置所有筛选条件');
  };

  // Get unique values for a custom field
  const getUniqueValues = (fieldId: string): string[] => {
    const values = new Set<string>();
    members.forEach(member => {
      const value = member.data[fieldId];
      if (value) {
        if (Array.isArray(value)) {
          value.forEach(v => values.add(v.toString()));
        } else {
          values.add(value.toString());
        }
      }
    });
    return Array.from(values).sort();
  };

  // Field selection
  const toggleFieldSelection = (fieldId: string) => {
    setFieldSelections(prev =>
      prev.map(f => (f.id === fieldId ? { ...f, selected: !f.selected } : f))
    );
  };

  const moveFieldUp = (fieldId: string) => {
    const index = fieldSelections.findIndex(f => f.id === fieldId);
    if (index <= 0) return;

    setFieldSelections(prev => {
      const newSelections = [...prev];
      const temp = newSelections[index].order;
      newSelections[index].order = newSelections[index - 1].order;
      newSelections[index - 1].order = temp;
      return newSelections;
    });
  };

  const moveFieldDown = (fieldId: string) => {
    const index = fieldSelections.findIndex(f => f.id === fieldId);
    if (index >= fieldSelections.length - 1) return;

    setFieldSelections(prev => {
      const newSelections = [...prev];
      const temp = newSelections[index].order;
      newSelections[index].order = newSelections[index + 1].order;
      newSelections[index + 1].order = temp;
      return newSelections;
    });
  };

  // Sort rules
  const addSortRule = () => {
    if (selectedFields.length === 0) return;

    // Find first field not already in sort rules
    const availableField = selectedFields.find(
      f => !sortRules.some(r => r.fieldId === f.id)
    );

    if (availableField) {
      setSortRules(prev => [...prev, {
        fieldId: availableField.id,
        fieldName: availableField.name,
        direction: 'asc',
      }]);
    }
  };

  const updateSortRule = (index: number, updates: Partial<SortRule>) => {
    setSortRules(prev => prev.map((rule, i) =>
      i === index ? { ...rule, ...updates } : rule
    ));
  };

  const removeSortRule = (index: number) => {
    setSortRules(prev => prev.filter((_, i) => i !== index));
  };

  const moveSortRuleUp = (index: number) => {
    if (index <= 0) return;
    setSortRules(prev => {
      const newRules = [...prev];
      [newRules[index], newRules[index - 1]] = [newRules[index - 1], newRules[index]];
      return newRules;
    });
  };

  const moveSortRuleDown = (index: number) => {
    if (index >= sortRules.length - 1) return;
    setSortRules(prev => {
      const newRules = [...prev];
      [newRules[index], newRules[index + 1]] = [newRules[index + 1], newRules[index]];
      return newRules;
    });
  };

  // Export history
  const saveToHistory = (config: Omit<ExportConfig, 'id' | 'timestamp'>) => {
    const newConfig: ExportConfig = {
      ...config,
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
    };

    const updatedHistory = [newConfig, ...exportHistory].slice(0, 20); // Keep last 20
    setExportHistory(updatedHistory);
    localStorage.setItem(EXPORT_HISTORY_KEY, JSON.stringify(updatedHistory));
  };

  const loadFromHistory = (config: ExportConfig) => {
    setTitle(config.title);
    setFilters(config.filters);
    setSortRules(config.sortRules);

    // Update field selections to match saved config
    setFieldSelections(prev => {
      return prev.map(field => {
        const savedField = config.selectedFields.find(f => f.id === field.id);
        if (savedField) {
          return {
            ...field,
            selected: true,
            order: savedField.order,
          };
        }
        return { ...field, selected: false };
      });
    });

    setShowHistoryDialog(false);
    toast.success('已加载导出配置');
  };

  // 从 API 加载导出历史详情
  const loadFromApiHistory = async (historyId: string) => {
    try {
      const response = await getExportHistoryDetail({ id: historyId });
      if (response.code === 200 && response.data) {
        const data = response.data;

        // 设置标题
        setTitle(data.title);

        // 转换 filter 格式：从 { gender: [], status: [], customFields: {} } 转换为 { gender: [], status: [], customFilters: [] }
        const customFilters = Object.entries(data.filter.customFields || {}).map(([fieldId, values]) => ({
          fieldId,
          values: values || [],
        }));

        setFilters({
          gender: (data.filter.gender || []) as Gender[],
          status: (data.filter.status || []) as Status[],
          customFilters: customFilters,
        });

        // 转换 sortRules：从 { field, order }[] 转换为 { fieldId, fieldName, direction }[]
        const convertedSortRules = data.sortRules.map(rule => {
          // 查找字段名称
          let fieldName = rule.field;
          if (rule.field === 'name') fieldName = '姓名';
          else if (rule.field === 'gender') fieldName = '性别';
          else if (rule.field === 'status') fieldName = '状态';
          else if (rule.field === 'photo') fieldName = '照片';
          else {
            // 查找自定义字段名称
            const customField = customFields.find(f => f.id === rule.field);
            if (customField) fieldName = customField.name;
          }

          return {
            fieldId: rule.field,
            fieldName: fieldName,
            direction: rule.order.toLowerCase() as 'asc' | 'desc',
          };
        });
        setSortRules(convertedSortRules);

        // 更新字段选择：从 string[] 转换为 FieldSelection[]
        setFieldSelections(prev => {
          const selectedFieldIds = data.selectedFields || [];
          // 创建一个映射，记录每个字段在 selectedFields 中的顺序
          const orderMap = new Map<string, number>();
          selectedFieldIds.forEach((fieldId, index) => {
            orderMap.set(fieldId, index);
          });

          return prev.map(field => {
            const order = orderMap.get(field.id);
            if (order !== undefined) {
              return {
                ...field,
                selected: true,
                order: order, // 使用在 selectedFields 数组中的索引作为顺序
              };
            }
            return { ...field, selected: false };
          });
        });

        // 如果有预览数据，设置预览数据
        if (data.exportPreview) {
          setPreviewData(data.exportPreview);
        }

        // 关闭对话框并跳转到预览步骤
        setShowHistoryDialog(false);
        setStep('preview');

        toast.success('已加载导出配置');
      } else {
        toast.error(response.msg || '加载导出配置失败');
      }
    } catch (error) {
      console.error('加载导出配置失败:', error);
      toast.error('加载导出配置失败，请重试');
    }
  };

  const deleteFromHistory = async (id: string) => {
    try {
      const response = await deleteExportHistory({ id });
      if (response.code === 200) {
        // 从 API 历史列表中移除
        setApiExportHistory(prev => prev.filter(item => item.id !== id));
        // 也从本地历史中移除（如果存在）
        const updatedHistory = exportHistory.filter(h => h.id !== id);
        setExportHistory(updatedHistory);
        localStorage.setItem(EXPORT_HISTORY_KEY, JSON.stringify(updatedHistory));
        setHistoryToDelete(null);
        toast.success('已删除导出记录');
      } else {
        toast.error(response.msg || '删除导出记录失败');
      }
    } catch (error) {
      console.error('删除导出记录失败:', error);
      toast.error('删除导出记录失败，请重试');
    }
  };

  // Export to Excel
  const handleExport = () => {
    try {
      // 优先使用预览数据，如果没有则使用本地筛选的数据
      const membersToExport = previewData && previewData.members.length > 0
        ? previewData.members.map(apiMember => {
          // 将 API 返回的成员数据转换为 Member 格式
          const memberData: any = {
            name: apiMember.name || '',
            qq: apiMember.qq || '',
            gender: apiMember.gender || '未知',
            status: apiMember.status || '在职',
            photo: Array.isArray(apiMember.photo) ? apiMember.photo[0] : apiMember.photo || undefined,
            ...apiMember.customFields,
          };

          // 将所有其他字段（包括自定义字段）添加到 memberData
          Object.keys(apiMember).forEach(key => {
            if (!['id', 'name', 'gender', 'status', 'photo'].includes(key)) {
              memberData[key] = apiMember[key];
            }
          });

          return {
            id: apiMember.id,
            data: memberData,
            createdAt: '',
            updatedAt: '',
          } as Member;
        })
        : sortedMembers;

      const result = exportRosterToExcel({
        title,
        members: membersToExport,
        fields: selectedFields,
        customFields,
      });

      // Save to history
      saveToHistory({
        name: title,
        title,
        filters,
        selectedFields: selectedFields.map(f => ({ id: f.id, name: f.name, order: f.order })),
        sortRules,
      });

      // 调用 saveExportHistory 接口
      const saveHistoryData = {
        title: title,
        filter: {
          gender: filters.gender,
          status: filters.status,
          customFields: filters.customFilters.reduce((acc, curr) => {
            acc[curr.fieldId] = curr.values;
            return acc;
          }, {} as Record<string, string[]>),
        },
        selectedFields: selectedFields.map(f => f.id),
        sortRules: sortRules.map(rule => ({
          field: rule.fieldId,
          order: rule.direction.toUpperCase() as 'ASC' | 'DESC',
        })),
      };

      saveExportHistory(saveHistoryData)
        .then(response => {
          if (response.code === 200) {
          } else {
            console.error('保存导出历史失败:', response.msg);
            // 不显示错误提示，因为保存历史失败不影响导出
          }
        })
        .catch(error => {
          console.error('保存导出历史失败:', error);
          // 不显示错误提示，因为保存历史失败不影响导出
        });

      toast.success(`成功导出 ${result.count} 条成员记录`);
    } catch (error) {
      toast.error('导出失败，请重试');
      console.error('Export error:', error);
    }
  };

  // Get field value for preview table
  const getFieldValue = (member: Member, fieldId: string): string => {
    if (fieldId === 'name') return member.data.name || '';
    if (fieldId === 'gender') return member.data.gender || '';
    if (fieldId === 'status') return member.data.status || '';
    if (fieldId === 'photo') return member.data.photo ? '[图片]' : '';

    const value = member.data[fieldId];
    if (!value) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  };

  // 从 API 返回的成员对象中获取字段值
  const getApiFieldValue = (apiMember: any, fieldId: string): string => {
    if (fieldId === 'name') return apiMember.name || '';
    if (fieldId === 'gender') return apiMember.gender || '';
    if (fieldId === 'status') return apiMember.status || '';
    if (fieldId === 'photo') {
      if (apiMember.photo) {
        if (Array.isArray(apiMember.photo)) {
          return apiMember.photo.length > 0 ? '[图片]' : '';
        }
        return '[图片]';
      }
      return '';
    }

    // 自定义字段
    const value = apiMember[fieldId] ?? apiMember.customFields?.[fieldId];
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  };

  return (
    <Card className="border-0 shadow-none">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>导出花名册</CardTitle>
            <CardDescription>
              选择要导出的成员和字段，预览后导出到Excel
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              setShowHistoryDialog(true);
              // 调用接口获取导出历史
              setLoadingHistory(true);
              try {
                const response = await getExportLists();
                if (response.code === 200) {
                  setApiExportHistory(response.data || []);
                } else {
                  toast.error(response.msg || '获取导出历史失败');
                }
              } catch (error) {
                console.error('获取导出历史失败:', error);
                toast.error('获取导出历史失败');
              } finally {
                setLoadingHistory(false);
              }
            }}
          >
            <History className="mr-2 h-4 w-4" />
            导出历史
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Steps indicator */}
        <div className="export-steps flex items-center gap-4">
          <div
            className={`flex items-center gap-2 px-4 py-3 rounded-lg flex-1 transition-colors cursor-pointer ${step === 'filter' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
              }`}
            onClick={() => setStep('filter')}
          >
            <div className="h-7 w-7 rounded-full bg-background text-foreground flex items-center justify-center shrink-0">
              1
            </div>
            <span className="whitespace-nowrap">筛选成员</span>
          </div>
          <div
            className={`flex items-center gap-2 px-4 py-3 rounded-lg flex-1 transition-colors cursor-pointer ${step === 'fields' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
              }`}
            onClick={() => setStep('fields')}
          >
            <div className="h-7 w-7 rounded-full bg-background text-foreground flex items-center justify-center shrink-0">
              2
            </div>
            <span className="whitespace-nowrap">选择字段</span>
          </div>
          <div
            className={`flex items-center gap-2 px-4 py-3 rounded-lg flex-1 transition-colors cursor-pointer ${step === 'sort' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
              }`}
            onClick={() => setStep('sort')}
          >
            <div className="h-7 w-7 rounded-full bg-background text-foreground flex items-center justify-center shrink-0">
              3
            </div>
            <span className="whitespace-nowrap">排序设置</span>
          </div>
          <div
            className={`flex items-center gap-2 px-4 py-3 rounded-lg flex-1 transition-colors cursor-pointer ${step === 'preview' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
              }`}
            onClick={() => setStep('preview')}
          >
            <div className="h-7 w-7 rounded-full bg-background text-foreground flex items-center justify-center shrink-0">
              4
            </div>
            <span className="whitespace-nowrap">预览导出</span>
          </div>
        </div>

        <Separator />

        {/* Step 1: Filter Members */}
        {step === 'filter' && (
          <ScrollArea className="h-[calc(100vh-400px)]">
            <div className="space-y-6 pr-6">
              <div>
                <Label className="text-sm">Excel 标题</Label>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="输入花名册标题"
                  className="mt-2 h-11"
                />
              </div>

              <Separator />

              <div>
                <Label>按性别筛选</Label>
                <div className="flex gap-3 mt-2">
                  {(['男', '女', '未知'] as Gender[]).map(gender => (
                    <Badge
                      key={gender}
                      variant={filters.gender.includes(gender) ? 'default' : 'outline'}
                      className="cursor-pointer px-4 py-2 text-sm"
                      onClick={() => toggleGenderFilter(gender)}
                    >
                      {gender}
                      {filters.gender.includes(gender) && (
                        <X className="ml-2 h-3 w-3" />
                      )}
                    </Badge>
                  ))}
                </div>
                {filters.gender.length === 0 && (
                  <p className="text-sm text-muted-foreground mt-1">
                    未选择则导出所有性别
                  </p>
                )}
                {filters.gender.length > 0 && (
                  <p className="text-sm text-muted-foreground mt-1">
                    已选择 {filters.gender.length} 个性别
                  </p>
                )}
              </div>

              <div>
                <Label>按状态筛选</Label>
                <div className="flex gap-3 mt-2">
                  {(['在职', '劝退', '光荣退休'] as Status[]).map(status => (
                    <Badge
                      key={status}
                      variant={filters.status.includes(status) ? 'default' : 'outline'}
                      className="cursor-pointer px-4 py-2 text-sm"
                      onClick={() => toggleStatusFilter(status)}
                    >
                      {status}
                      {filters.status.includes(status) && (
                        <X className="ml-2 h-3 w-3" />
                      )}
                    </Badge>
                  ))}
                </div>
                {filters.status.length === 0 && (
                  <p className="text-sm text-muted-foreground mt-1">
                    未选择则导出所有状态
                  </p>
                )}
                {filters.status.length > 0 && (
                  <p className="text-sm text-muted-foreground mt-1">
                    已选择 {filters.status.length} 个状态
                  </p>
                )}
              </div>

              {/* Custom field filters */}
              {loadingCustomFields ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">加载自定义字段...</span>
                </div>
              ) : (
                apiCustomFields
                  .filter(f => f.options && f.options.length > 0)
                  .map(field => {
                    // 使用字段的 options 数组
                    const availableOptions = field.options || [];

                    if (availableOptions.length === 0) return null;

                    const selectedValues =
                      filters.customFilters.find(f => f.fieldId === field.id)?.values || [];

                    return (
                      <div key={field.id}>
                        <Label>按{field.name}筛选</Label>
                        <div className="flex flex-wrap gap-3 mt-2">
                          {availableOptions.map(value => (
                            <Badge
                              key={value}
                              variant={selectedValues.includes(value) ? 'default' : 'outline'}
                              className="cursor-pointer px-4 py-2 text-sm"
                              onClick={() => toggleCustomFilter(field.id, value)}
                            >
                              {value}
                              {selectedValues.includes(value) && (
                                <X className="ml-2 h-3 w-3" />
                              )}
                            </Badge>
                          ))}
                        </div>
                        {selectedValues.length === 0 && (
                          <p className="text-sm text-muted-foreground mt-1">
                            未选择则导出所有{field.name}
                          </p>
                        )}
                        {selectedValues.length > 0 && (
                          <p className="text-sm text-muted-foreground mt-1">
                            已选择 {selectedValues.length} 个{field.name}
                          </p>
                        )}
                      </div>
                    );
                  })
              )}

              <Separator />

              <div className="flex items-center justify-between p-5 bg-muted rounded-lg">
                <div>
                  <p className="font-medium">筛选结果</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {loadingFilterStep ? (
                      '正在加载...'
                    ) : filterStepTotal !== null ? (
                      `共筛选出 ${filterStepTotal} 名成员`
                    ) : (
                      `共筛选出 ${filteredMembers.length} 名成员`
                    )}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetFilters}
                  className="flex items-center gap-2"
                >
                  <RotateCcw className="h-4 w-4" />
                  重置
                </Button>
              </div>
            </div>
          </ScrollArea>
        )}

        {/* Step 2: Select Fields */}
        {step === 'fields' && (
          <ScrollArea className="h-[calc(100vh-400px)]">
            <div className="space-y-6 pr-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <Label>选择要导出的字段并排序</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    使用上下箭头调整字段顺序，选择多个字段可在下一步设置多个排序规则
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    已选择：{fieldSelections.filter(f => f.selected).length} / {fieldSelections.length} 个字段
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFieldSelections(prev => prev.map(f => ({ ...f, selected: true })));
                    }}
                  >
                    全选
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFieldSelections(prev => prev.map(f => ({ ...f, selected: false })));
                    }}
                  >
                    全不选
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {fieldSelections
                  .sort((a, b) => a.order - b.order)
                  .map((field, index) => (
                    <div
                      key={field.id}
                      className={`flex items-center gap-5 p-5 border rounded-lg transition-all ${field.selected ? 'bg-muted/50 border-primary/20' : 'opacity-50'
                        }`}
                    >
                      <GripVertical className="h-5 w-5 text-muted-foreground shrink-0" />

                      <Checkbox
                        checked={field.selected}
                        onCheckedChange={() => toggleFieldSelection(field.id)}
                        className="shrink-0"
                      />

                      <span className="flex-1 min-w-0">{field.name}</span>

                      <div className="flex gap-2 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveFieldUp(field.id)}
                          disabled={index === 0}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveFieldDown(field.id)}
                          disabled={index === fieldSelections.length - 1}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>

              <Separator />

              <div className="flex items-center justify-between p-5 bg-muted rounded-lg">
                <div>
                  <p className="font-medium">已选择字段</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    共 {selectedFields.length} 个字段
                  </p>
                </div>
              </div>
            </div>
          </ScrollArea>
        )}

        {/* Step 3: Sort Settings */}
        {step === 'sort' && (
          <ScrollArea className="h-[calc(100vh-400px)]">
            <div className="space-y-6 pr-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <Label>排序规则</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    设置多字段组合排序，优先级从上到下
                  </p>
                  {selectedFields.length > 0 && (
                    <p className="text-sm text-muted-foreground mt-1">
                      可用字段：{selectedFields.length - sortRules.length} / {selectedFields.length}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addSortRule}
                    disabled={selectedFields.length === 0 || sortRules.length >= selectedFields.length}
                  >
                    <ArrowUpDown className="mr-2 h-4 w-4" />
                    添加排序
                  </Button>
                  {sortRules.length >= selectedFields.length && selectedFields.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      所有字段已使用
                    </p>
                  )}
                  {selectedFields.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      请先选择字段
                    </p>
                  )}
                </div>
              </div>

              {sortRules.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground border-2 border-dashed rounded-lg">
                  <ArrowUpDown className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">暂无排序规则</p>
                  <p className="text-sm mt-1">点击"添加排序"按钮设置排序规则</p>
                  {selectedFields.length > 0 && (
                    <p className="text-sm mt-2">
                      当前已选择 {selectedFields.length} 个字段，可添加最多 {selectedFields.length} 个排序规则
                    </p>
                  )}
                  {selectedFields.length === 0 && (
                    <p className="text-sm mt-2 text-orange-500">
                      请先在"选择字段"步骤中选择要导出的字段
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {sortRules.map((rule, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-5 p-5 border rounded-lg bg-muted/50"
                    >
                      <div className="flex items-center gap-3 shrink-0">
                        <Badge variant="secondary" className="px-3 py-1.5">{index + 1}</Badge>
                        <GripVertical className="h-5 w-5 text-muted-foreground" />
                      </div>

                      <Select
                        value={rule.fieldId}
                        onValueChange={(value) => {
                          const field = selectedFields.find(f => f.id === value);
                          if (field) {
                            updateSortRule(index, {
                              fieldId: value,
                              fieldName: field.name
                            });
                          }
                        }}
                      >
                        <SelectTrigger className="flex-1 min-w-[220px] h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedFields.map(field => (
                            <SelectItem
                              key={field.id}
                              value={field.id}
                              disabled={sortRules.some((r, i) => r.fieldId === field.id && i !== index)}
                            >
                              {field.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={rule.direction}
                        onValueChange={(value: 'asc' | 'desc') =>
                          updateSortRule(index, { direction: value })
                        }
                      >
                        <SelectTrigger className="w-[160px] h-11 shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="asc">升序 ↑</SelectItem>
                          <SelectItem value="desc">降序 ↓</SelectItem>
                        </SelectContent>
                      </Select>

                      <div className="flex gap-2 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveSortRuleUp(index)}
                          disabled={index === 0}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveSortRuleDown(index)}
                          disabled={index === sortRules.length - 1}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeSortRule(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {/* Step 4: Preview and Export */}
        {step === 'preview' && (
          <ScrollArea className="h-[calc(100vh-400px)]">
            <div className="space-y-6 pr-6">
              <div className="flex items-center justify-between p-5 bg-muted rounded-lg">
                <div>
                  <p className="font-medium">预览数据</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {loadingPreview ? (
                      '正在加载预览数据...'
                    ) : previewData ? (
                      `共 ${previewData.total} 条记录，${selectedFields.length} 个字段`
                    ) : (
                      `共 ${sortedMembers.length} 条记录，${selectedFields.length} 个字段`
                    )}
                  </p>
                </div>
                <Button
                  onClick={handleExport}
                  disabled={loadingPreview || !previewData || previewData.members.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  导出到 Excel
                </Button>
              </div>

              {loadingPreview ? (
                <div className="p-12 text-center text-muted-foreground border-2 border-dashed rounded-lg">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">正在加载预览数据...</p>
                </div>
              ) : selectedFields.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground border-2 border-dashed rounded-lg">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">未选择字段</p>
                  <p className="text-sm mt-1">请返回"选择字段"步骤选择要导出的字段</p>
                </div>
              ) : previewData && previewData.members.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground border-2 border-dashed rounded-lg">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">没有符合条件的成员</p>
                  <p className="text-sm mt-1">请返回"筛选成员"步骤调整筛选条件</p>
                </div>
              ) : previewData && previewData.members.length > 0 ? (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {selectedFields.map(field => (
                          <TableHead key={field.id} className="whitespace-nowrap">
                            {field.name}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.members.slice(0, 50).map((apiMember, index) => (
                        <TableRow key={apiMember.id || index}>
                          {selectedFields.map(field => (
                            <TableCell key={field.id} className="whitespace-nowrap">
                              {getApiFieldValue(apiMember, field.id)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {previewData.members.length > 50 && (
                    <div className="p-4 text-center text-sm text-muted-foreground border-t">
                      显示前 50 条记录，共 {previewData.total} 条
                    </div>
                  )}
                </div>
              ) : sortedMembers.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground border-2 border-dashed rounded-lg">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">没有符合条件的成员</p>
                  <p className="text-sm mt-1">请返回"筛选成员"步骤调整筛选条件</p>
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {selectedFields.map(field => (
                          <TableHead key={field.id} className="whitespace-nowrap">
                            {field.name}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedMembers.slice(0, 50).map(member => (
                        <TableRow key={member.id}>
                          {selectedFields.map(field => (
                            <TableCell key={field.id} className="whitespace-nowrap">
                              {getFieldValue(member, field.id)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {sortedMembers.length > 50 && (
                    <div className="p-4 text-center text-sm text-muted-foreground border-t">
                      显示前 50 条记录，共 {sortedMembers.length} 条
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {/* Navigation buttons */}
        <div className="flex justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => {
              if (step === 'fields') setStep('filter');
              else if (step === 'sort') setStep('fields');
              else if (step === 'preview') setStep('sort');
            }}
            disabled={step === 'filter'}
          >
            上一步
          </Button>
          <Button
            onClick={() => {
              if (step === 'filter') setStep('fields');
              else if (step === 'fields') setStep('sort');
              else if (step === 'sort') setStep('preview');
            }}
            disabled={step === 'preview'}
          >
            下一步
          </Button>
        </div>
      </CardContent>

      {/* Export History Dialog */}
      <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>导出历史</DialogTitle>
            <DialogDescription>
              选择之前的导出配置快速应用
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-6">
            {loadingHistory ? (
              <div className="flex items-center justify-center p-12 text-center text-muted-foreground">
                <div>
                  <Loader2 className="h-12 w-12 mx-auto mb-3 opacity-50 animate-spin" />
                  <p>正在加载导出历史...</p>
                </div>
              </div>
            ) : apiExportHistory.length === 0 ? (
              <div className="flex items-center justify-center p-12 text-center text-muted-foreground">
                <div>
                  <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>暂无导出历史</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 pb-4">
                {apiExportHistory.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{item.title}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {item.createTime}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {item.fieldCount} 个字段，{item.ruleCount} 个排序规则
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => loadFromApiHistory(item.id)}
                      >
                        加载
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setHistoryToDelete(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="px-6 pb-6 pt-4">
            <Button variant="outline" onClick={() => setShowHistoryDialog(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!historyToDelete} onOpenChange={(open) => !open && setHistoryToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除这条导出历史记录吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => historyToDelete && deleteFromHistory(historyToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}




