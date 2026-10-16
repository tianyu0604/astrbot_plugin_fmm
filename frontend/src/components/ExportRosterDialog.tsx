import { useState, useMemo, useEffect } from 'react';
import { Member, CustomField, Gender, Status, ExportConfig, SortRule } from '../types/member';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { Download, Eye, ChevronUp, ChevronDown, X, GripVertical, History, ArrowUpDown, Trash2, FileText } from 'lucide-react';
import { exportRosterToExcel } from '../utils/excelExporter';
import { getExportLists } from '../api/MemberAPI';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
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

interface ExportRosterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function ExportRosterDialog({
  open,
  onOpenChange,
  members,
  customFields,
}: ExportRosterDialogProps) {
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
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [apiHistory, setApiHistory] = useState<Array<{
    id: string;
    title: string;
    createTime: string;
    fieldCount: number;
    ruleCount: number;
  }>>([]);

  // Load export history from API when dialog opens
  const loadExportHistory = async () => {
    setLoadingHistory(true);
    try {
      const response = await getExportLists();
      if (response.code === 200) {
        setApiHistory(response.data || []);
      } else {
        toast.error(response.msg || '获取导出历史失败');
      }
    } catch (error) {
      console.error('Failed to load export history:', error);
      toast.error('获取导出历史失败');
    } finally {
      setLoadingHistory(false);
    }
  };

  // Load export history from localStorage (keep for backward compatibility)
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

  // Load API history when history dialog opens
  useEffect(() => {
    if (showHistoryDialog) {
      loadExportHistory();
    }
  }, [showHistoryDialog]);

  // Initialize field selections when dialog opens or customFields change
  useEffect(() => {
    if (open) {
      const defaultFields = [
        { id: 'photo', name: '照片', selected: false, order: 0 },
        { id: 'name', name: '姓名', selected: true, order: 1 },
        { id: 'gender', name: '性别', selected: false, order: 2 },
        { id: 'status', name: '状态', selected: false, order: 3 },
      ];
      
      const customFieldsList = customFields.map((f, idx) => ({
        id: f.id,
        name: f.name,
        selected: false,
        order: defaultFields.length + idx,
      }));
      
      setFieldSelections([...defaultFields, ...customFieldsList]);
    }
  }, [open, customFields]);

  // Reset state when dialog opens
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setStep('filter');
      setFilters({ gender: [], status: [], customFilters: [] });
      setTitle('成员花名册');
      setSortRules([]);
    }
    onOpenChange(newOpen);
  };

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

  // Toggle filter
  const toggleGenderFilter = (gender: Gender) => {
    setFilters(prev => ({
      ...prev,
      gender: prev.gender.includes(gender)
        ? prev.gender.filter(g => g !== gender)
        : [...prev.gender, gender],
    }));
  };

  const toggleStatusFilter = (status: Status) => {
    setFilters(prev => ({
      ...prev,
      status: prev.status.includes(status)
        ? prev.status.filter(s => s !== status)
        : [...prev.status, status],
    }));
  };

  const toggleCustomFilter = (fieldId: string, value: string) => {
    setFilters(prev => {
      const existingFilter = prev.customFilters.find(f => f.fieldId === fieldId);
      
      if (existingFilter) {
        const newValues = existingFilter.values.includes(value)
          ? existingFilter.values.filter(v => v !== value)
          : [...existingFilter.values, value];
        
        return {
          ...prev,
          customFilters: newValues.length === 0
            ? prev.customFilters.filter(f => f.fieldId !== fieldId)
            : prev.customFilters.map(f =>
                f.fieldId === fieldId ? { ...f, values: newValues } : f
              ),
        };
      } else {
        return {
          ...prev,
          customFilters: [...prev.customFilters, { fieldId, values: [value] }],
        };
      }
    });
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

  const deleteFromHistory = (id: string) => {
    const updatedHistory = exportHistory.filter(h => h.id !== id);
    setExportHistory(updatedHistory);
    localStorage.setItem(EXPORT_HISTORY_KEY, JSON.stringify(updatedHistory));
    setHistoryToDelete(null);
    toast.success('已删除导出记录');
  };

  // Export to Excel
  const handleExport = () => {
    try {
      const result = exportRosterToExcel({
        title,
        members: sortedMembers,
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
      
      toast.success(`成功导出 ${result.count} 条成员记录`);
      handleOpenChange(false);
    } catch (error) {
      toast.error('导出失败，请重试');
      console.error('Export error:', error);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="w-[98vw] max-w-[1600px] max-h-[95vh] flex flex-col p-8">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>导出花名册</DialogTitle>
                <DialogDescription>
                  选择要导出的成员和字段，预览后导出到Excel
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowHistoryDialog(true)}
              >
                <History className="mr-2 h-4 w-4" />
                导出历史
              </Button>
            </div>
          </DialogHeader>

          {/* Steps indicator */}
          <div className="flex items-center gap-4 py-5">
            <div
              className={`flex items-center gap-2 px-4 py-3 rounded-lg flex-1 transition-colors ${
                step === 'filter' ? 'bg-primary text-primary-foreground' : 'bg-muted'
              }`}
            >
              <div className="h-7 w-7 rounded-full bg-background text-foreground flex items-center justify-center shrink-0">
                1
              </div>
              <span className="whitespace-nowrap">筛选成员</span>
            </div>
            <div
              className={`flex items-center gap-2 px-4 py-3 rounded-lg flex-1 transition-colors ${
                step === 'fields' ? 'bg-primary text-primary-foreground' : 'bg-muted'
              }`}
            >
              <div className="h-7 w-7 rounded-full bg-background text-foreground flex items-center justify-center shrink-0">
                2
              </div>
              <span className="whitespace-nowrap">选择字段</span>
            </div>
            <div
              className={`flex items-center gap-2 px-4 py-3 rounded-lg flex-1 transition-colors ${
                step === 'sort' ? 'bg-primary text-primary-foreground' : 'bg-muted'
              }`}
            >
              <div className="h-7 w-7 rounded-full bg-background text-foreground flex items-center justify-center shrink-0">
                3
              </div>
              <span className="whitespace-nowrap">排序设置</span>
            </div>
            <div
              className={`flex items-center gap-2 px-4 py-3 rounded-lg flex-1 transition-colors ${
                step === 'preview' ? 'bg-primary text-primary-foreground' : 'bg-muted'
              }`}
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
            <ScrollArea className="flex-1 pr-6 overflow-y-auto" style={{ maxHeight: 'calc(95vh - 320px)' }}>
              <div className="space-y-6 py-2">
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
                {customFields
                  .filter(f => f.type === 'radio')
                  .map(field => {
                    const uniqueValues = getUniqueValues(field.id);
                    if (uniqueValues.length === 0) return null;
                    
                    const selectedValues =
                      filters.customFilters.find(f => f.fieldId === field.id)?.values || [];
                    
                    return (
                      <div key={field.id}>
                        <Label>按{field.name}筛选</Label>
                        <div className="flex flex-wrap gap-3 mt-2">
                          {uniqueValues.map(value => (
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
                      </div>
                    );
                  })}

                <Separator />

                <div className="flex items-center justify-between p-5 bg-muted rounded-lg">
                  <div>
                    <p className="font-medium">筛选结果</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      共筛选出 {filteredMembers.length} 名成员
                    </p>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}

          {/* Step 2: Select Fields */}
          {step === 'fields' && (
            <ScrollArea className="flex-1 pr-6 overflow-y-auto" style={{ maxHeight: 'calc(95vh - 320px)' }}>
              <div className="space-y-6 py-2">
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
                        className={`flex items-center gap-5 p-5 border rounded-lg transition-all ${
                          field.selected ? 'bg-muted/50 border-primary/20' : 'opacity-50'
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
            <ScrollArea className="flex-1 pr-6 overflow-y-auto" style={{ maxHeight: 'calc(95vh - 320px)' }}>
              <div className="space-y-6 py-2">
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

                        <div className="flex gap-2 ml-auto shrink-0">
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

                <Separator />

                <div className="p-5 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    {sortRules.length === 0 
                      ? '未设置排序，将按默认顺序导出'
                      : `已设置 ${sortRules.length} 个排序规则`
                    }
                  </p>
                </div>
              </div>
            </ScrollArea>
          )}

          {/* Step 4: Preview */}
          {step === 'preview' && (
            <ScrollArea className="flex-1 pr-4 overflow-y-auto" style={{ maxHeight: 'calc(95vh - 320px)' }}>
              <div className="space-y-6 py-2">
                <div className="p-5 bg-muted rounded-lg">
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {sortedMembers.length} 名成员 · {selectedFields.length} 个字段
                    {sortRules.length > 0 && ` · ${sortRules.length} 个排序规则`}
                  </p>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto overflow-y-auto max-h-[400px]">
                    <table className="w-full min-w-max table-auto">
                      <thead className="bg-muted">
                        <tr>
                          {selectedFields.map(field => (
                            <th
                              key={field.id}
                              className="px-6 py-4 text-left font-medium whitespace-nowrap min-w-[120px]"
                            >
                              {field.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedMembers.slice(0, 10).map((member, idx) => (
                          <tr
                            key={member.id}
                            className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'}
                          >
                            {selectedFields.map(field => {
                              let value = '';
                              
                              if (field.id === 'name') value = member.data.name;
                              else if (field.id === 'gender') value = member.data.gender;
                              else if (field.id === 'status') value = member.data.status;
                              else if (field.id === 'photo') value = member.data.photo ? '有照片' : '';
                              else {
                                const fieldValue = member.data[field.id];
                                const customField = customFields.find(f => f.id === field.id);
                                
                                if (customField?.type === 'images' && Array.isArray(fieldValue)) {
                                  value = `${fieldValue.length} 张图片`;
                                } else if (customField?.type === 'date' && fieldValue) {
                                  const date = new Date(fieldValue);
                                  value = date.toLocaleDateString('zh-CN');
                                } else {
                                  value = fieldValue?.toString() || '';
                                }
                              }
                              
                              return (
                                <td
                                  key={field.id}
                                  className="px-6 py-4 text-sm border-t whitespace-nowrap min-w-[120px]"
                                >
                                  {value}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {sortedMembers.length > 10 && (
                  <p className="text-sm text-muted-foreground text-center">
                    仅预览前 10 条记录，导出时将包含全部 {sortedMembers.length} 条记录
                  </p>
                )}

                {sortedMembers.length === 0 && (
                  <div className="p-8 text-center text-muted-foreground">
                    没有符合条件的成员
                  </div>
                )}
              </div>
            </ScrollArea>
          )}

          <DialogFooter className="flex justify-between sm:justify-between pt-4">
            <div>
              {step !== 'filter' && (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => {
                    if (step === 'fields') setStep('filter');
                    if (step === 'sort') setStep('fields');
                    if (step === 'preview') setStep('sort');
                  }}
                >
                  上一步
                </Button>
              )}
            </div>
            
            <div className="flex gap-3">
              <Button variant="outline" size="lg" onClick={() => handleOpenChange(false)}>
                取消
              </Button>
              
              {step === 'filter' && (
                <Button size="lg" onClick={() => setStep('fields')}>
                  下一步
                </Button>
              )}
              
              {step === 'fields' && (
                <Button
                  size="lg"
                  onClick={() => setStep('sort')}
                  disabled={selectedFields.length === 0}
                >
                  下一步
                </Button>
              )}

              {step === 'sort' && (
                <Button size="lg" onClick={() => setStep('preview')}>
                  <Eye className="mr-2 h-4 w-4" />
                  预览
                </Button>
              )}
              
              {step === 'preview' && (
                <Button
                  size="lg"
                  onClick={handleExport}
                  disabled={sortedMembers.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  导出Excel
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export History Dialog */}
      <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
        <DialogContent className="w-[90vw] max-w-[1200px] max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>导出历史</DialogTitle>
            <DialogDescription>
              查看和使用之前的导出配置
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4 max-h-[500px]">
            {loadingHistory ? (
              <div className="p-8 text-center text-muted-foreground">
                <p>加载中...</p>
              </div>
            ) : apiHistory.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>暂无导出历史</p>
              </div>
            ) : (
              <div className="space-y-3">
                {apiHistory.map(item => (
                  <div
                    key={item.id}
                    className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="font-medium">{item.title}</p>
                          <Badge variant="secondary">
                            {item.fieldCount} 字段
                          </Badge>
                          {item.ruleCount > 0 && (
                            <Badge variant="secondary">
                              {item.ruleCount} 排序
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {item.createTime}
                        </p>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            // TODO: 实现从API历史记录加载配置的功能
                            toast.info('从历史记录加载功能待实现');
                          }}
                        >
                          使用
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            // TODO: 实现删除API历史记录的功能
                            toast.info('删除功能待实现');
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHistoryDialog(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={historyToDelete !== null} onOpenChange={() => setHistoryToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除这条导出记录吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => historyToDelete && deleteFromHistory(historyToDelete)}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
