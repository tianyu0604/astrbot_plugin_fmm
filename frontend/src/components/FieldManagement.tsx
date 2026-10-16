import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { CustomField, FieldType } from '../types/member';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { Pencil, Trash2, Plus, Eye, EyeOff, Save, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { getCustomFields, saveChanges } from '../api/FieldManagementAPI';

interface FieldManagementProps {
  onUpdateFields: (fields: CustomField[]) => void;
  onHasChangesChange?: (hasChanges: boolean, currentFields: CustomField[]) => void;
}

export const FieldManagement = forwardRef<{
  handleSaveAll: () => Promise<void>;
}, FieldManagementProps>((props, ref) => {
  const { onUpdateFields, onHasChangesChange } = props;
  const [fields, setFields] = useState<CustomField[]>([]);
  const [originalFields, setOriginalFields] = useState<CustomField[]>([]); // 存储原始字段数据
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isExitDialogOpen, setIsExitDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; field: CustomField | null }>({ open: false, field: null });
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [loading, setLoading] = useState(true);

  // 定义不可编辑的特殊字段ID
  const specialFieldIds = [
    '7cfce2fa-552f-4759-8f87-56b207637a22', // 劝退原因
    '13dacc46-10c6-40e3-8734-6a43fea7bbfc', // 劝退详情
    '2b370ca9-5e6f-49dd-b663-d54e1eceb123'  // 退休去向
  ];

  // 判断是否为特殊字段
  const isSpecialField = (fieldId: string) => specialFieldIds.includes(fieldId);

  useImperativeHandle(ref, () => ({
    handleSaveAll,
  }));

  useEffect(() => {
    const fetchCustomFields = async () => {
      try {
        setLoading(true);
        const response = await getCustomFields();

        if (response.code === 200) {
          // 按照displayOrder排序
          const sortedFields = response.data.customFields.sort((a, b) => a.displayOrder - b.displayOrder);
          setFields(sortedFields);
          setOriginalFields(sortedFields); // 保存原始数据用于比较
          // 调用父组件的更新函数
          onUpdateFields(sortedFields);
        } else {
          toast.error(response.msg || '获取字段数据失败');
        }
      } catch (error) {
        console.error('获取字段数据失败:', error);
        toast.error('获取字段数据失败');
      } finally {
        setLoading(false);
      }
    };

    fetchCustomFields();
  }, []);

  // New field form
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');

  // Edit field form
  const [editFieldName, setEditFieldName] = useState('');
  const [editFieldOptions, setEditFieldOptions] = useState('');

  const updateHasChanges = (value: boolean | [], updatedFields?: CustomField[]) => {
    const hasChangesValue = Array.isArray(value) ? value.length > 0 : value;
    setHasChanges(hasChangesValue);
    onHasChangesChange?.(hasChangesValue, updatedFields || fields);
  };

  const handleAddField = () => {
    if (newFieldName.length < 2 || newFieldName.length > 10) {
      toast.error('字段名称必须在2~10个字之间');
      return;
    }

    const newField: CustomField = {
      id: Date.now().toString(),
      name: newFieldName,
      type: newFieldType,
      options: newFieldType === 'radio' ? newFieldOptions.split(',').map(o => o.trim()).filter(Boolean) : undefined,
      hidden: false,
      displayOrder: fields.length, // 设置新的显示顺序
      isDeleted: false,
      used: false,
    };

    const updatedFields = [...fields, newField];
    setFields(updatedFields);
    updateHasChanges(true, updatedFields);
    setIsDialogOpen(false);
    setNewFieldName('');
    setNewFieldType('text');
    setNewFieldOptions('');
    toast.success('字段已添加，请点击保存');
  };

  const handleDeleteField = (field: CustomField) => {
    let updatedFields: CustomField[];
    if (field.used) {
      // Hide instead of delete
      updatedFields = fields.map(f => f.id === field.id ? { ...f, hidden: true } : f);
      setFields(updatedFields);
      updateHasChanges(true, updatedFields);
      toast.success('字段已隐藏');
    } else {
      // Delete
      updatedFields = fields.filter(f => f.id !== field.id);
      setFields(updatedFields);
      updateHasChanges(true, updatedFields);
      toast.success('字段已删除');
    }
    setDeleteConfirm({ open: false, field: null });
  };

  const handleToggleHidden = (fieldId: string) => {
    const updatedFields = fields.map(f => f.id === fieldId ? { ...f, hidden: !f.hidden } : f);
    setFields(updatedFields);
    updateHasChanges(true, updatedFields);
    toast.success('字段状态已更新，请点击保存');
  };

  const handleStartEdit = (field: CustomField) => {
    setEditingField(field);
    setEditFieldName(field.name);
    setEditFieldOptions(field.options?.join(', ') || '');
    setIsEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!editingField) return;

    if (editFieldName.length < 2 || editFieldName.length > 10) {
      toast.error('字段名称必须在2~10个字之间');
      return;
    }

    const updatedFields = fields.map(f => {
      if (f.id === editingField.id) {
        return {
          ...f,
          name: editFieldName,
          options: f.type === 'radio' ? editFieldOptions.split(',').map(o => o.trim()).filter(Boolean) : f.options,
        };
      }
      return f;
    });

    setFields(updatedFields);
    updateHasChanges(true, updatedFields);
    setIsEditDialogOpen(false);
    setEditingField(null);
    toast.success('字段已更新，请点击保存');
  };

  const handleSaveAll = async () => {
    // 找出新增的字段（在 fields 中但不在 originalFields 中）
    const newFields = fields.filter(
      field => !originalFields.some(originalField => originalField.id === field.id)
    );

    // 找出修改的字段（在两者中都存在但内容不同）
    const modifiedFields = fields.filter(field => {
      const originalField = originalFields.find(orig => orig.id === field.id);
      if (!originalField) return false;

      // 比较字段的各个属性
      return (
        originalField.name !== field.name ||
        originalField.type !== field.type ||
        JSON.stringify(originalField.options) !== JSON.stringify(field.options) ||
        originalField.hidden !== field.hidden
      );
    });

    // 找出删除的字段（在 originalFields 中但不在 fields 中）
    const deletedFields = originalFields.filter(
      originalField => !fields.some(field => field.id === originalField.id)
    );

    // 找出隐藏/取消隐藏的字段
    const hiddenFields = fields.filter(field => {
      const originalField = originalFields.find(orig => orig.id === field.id);
      return originalField && originalField.hidden !== field.hidden;
    });

    // 定义操作类型
    type Operation =
      | { opType: 'create'; id: string; name: string; type: FieldType; options?: string[] }
      | { opType: 'update'; id: string; name?: string; type?: FieldType; options?: string[]; action?: 'hide' | 'show' }
      | { opType: 'delete'; id: string; action: 'hide' | 'delete' }
      | { opType: 'reorder'; orders: Array<{ id: string; displayOrder: number }> };

    // 构建操作日志
    const operations: Operation[] = [];

    // 添加新增字段操作
    newFields.forEach(field => {
      operations.push({
        opType: 'create',
        id: field.id,
        name: field.name,
        type: field.type,
        options: field.type === 'radio' ? field.options || [] : undefined,
      });
    });

    // 添加修改字段操作
    modifiedFields.forEach(field => {
      const originalField = originalFields.find(orig => orig.id === field.id);
      if (originalField) {
        // 检查哪些属性发生了变化
        let op: Operation = {
          opType: 'update',
          id: field.id,
        };

        let hasChanges = false;

        if (originalField.name !== field.name) {
          op = { ...op, name: field.name };
          hasChanges = true;
        }

        if (originalField.type !== field.type) {
          op = { ...op, type: field.type };
          hasChanges = true;
        }

        if (JSON.stringify(originalField.options) !== JSON.stringify(field.options)) {
          op = { ...op, options: field.type === 'radio' ? field.options || [] : undefined };
          hasChanges = true;
        }

        if (hasChanges) {
          operations.push(op);
        }
      }
    });

    // 添加删除/隐藏操作
    deletedFields.forEach(field => {
      operations.push({
        opType: 'delete',
        id: field.id,
        action: field.used ? 'hide' : 'delete',
      });
    });

    // 添加隐藏/显示操作
    hiddenFields.forEach(field => {
      operations.push({
        opType: 'update',
        id: field.id,
        action: field.hidden ? 'hide' : 'show',
      });
    });

    // 添加排序操作（如果字段顺序发生了变化）
    let orderChanged = false;
    for (let i = 0; i < Math.min(fields.length, originalFields.length); i++) {
      if (fields[i].id !== originalFields[i].id) {
        orderChanged = true;
        break;
      }
    }

    if (orderChanged) {
      const orders = fields.map((field, index) => ({
        id: field.id,
        displayOrder: index + 1,
      }));

      operations.push({
        opType: 'reorder',
        orders: orders,
      });
    }

    // 如果没有操作需要执行，则不发送网络请求
    if (operations.length === 0) {
      // 没有任何更改，更新状态并提示用户
      setOriginalFields([...fields]); // 同步原始字段数据
      updateHasChanges([]); // 传递空数组表示没有更改
      toast.success('没有更改需要保存');
      return; // 退出函数，不执行后续的网络请求
    }

    try {
      // 发送操作数据到API
      const response = await saveChanges({ operations });

      if (response.code === 200) {
        // 保存成功后重新获取数据
        const refreshResponse = await getCustomFields();

        if (refreshResponse.code === 200) {
          const sortedFields = refreshResponse.data.customFields.sort((a, b) => a.displayOrder - b.displayOrder);
          setFields(sortedFields);
          setOriginalFields(sortedFields); // 更新原始数据
          onUpdateFields(sortedFields);
          updateHasChanges([]);
          toast.success('所有更改已保存');
        } else {
          toast.error('保存成功但刷新数据失败: ' + refreshResponse.msg);
        }
      } else {
        toast.error(response.msg || '保存失败');
      }
    } catch (error) {
      console.error('保存更改失败:', error);
      toast.error('保存失败，请重试');
    }
  };

  const handleExit = () => {
    if (hasChanges) {
      setIsExitDialogOpen(true);
    }
  };

  const confirmExit = () => {
    setFields(originalFields);
    updateHasChanges([]);
    setIsExitDialogOpen(false);
    toast.info('更改已放弃');
  };

  const getFieldTypeLabel = (type: FieldType) => {
    const labels = {
      text: '自由文本',
      radio: '单选文本',
      date: '日期',
      number: '数字',
      images: '图片相册',
    };
    return labels[type];
  };

  // 添加拖拽排序功能
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.dataTransfer.setData('text/plain', index.toString());
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
    e.preventDefault();
    const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'));

    if (isNaN(sourceIndex) || sourceIndex === targetIndex) return;

    // 检查源字段和目标位置是否涉及特殊字段
    const sourceField = fields[sourceIndex];
    const targetField = fields[targetIndex];
    
    // 如果源字段或目标位置是特殊字段，则不允许拖拽
    if (isSpecialField(sourceField.id) || isSpecialField(targetField.id)) {
      return;
    }

    const newFields = [...fields];
    const [movedField] = newFields.splice(sourceIndex, 1);
    newFields.splice(targetIndex, 0, movedField);

    setFields(newFields);
    updateHasChanges(true, newFields);
    toast.success('字段顺序已调整');
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg">成员档案字段管理</h2>
          <p className="text-sm text-muted-foreground">配置成员档案的自定义字段</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            新增字段
          </Button>
          {hasChanges && (
            <Button onClick={handleSaveAll} className="gap-2" variant="default">
              <Save className="h-4 w-4" />
              保存更改
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>系统默认字段</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <div className="font-medium">照片</div>
                <div className="text-sm text-muted-foreground">4:3尺寸，大小不超过2M，选填</div>
              </div>
              <div className="text-sm text-muted-foreground">图片</div>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <div className="font-medium">姓名</div>
                <div className="text-sm text-muted-foreground">1~50个字，必填</div>
              </div>
              <div className="text-sm text-muted-foreground">文本</div>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <div className="font-medium">QQ 号</div>
                <div className="text-sm text-muted-foreground">5~12 位数字，必填，不可重复</div>
              </div>
              <div className="text-sm text-muted-foreground">文本</div>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <div className="font-medium">性别</div>
                <div className="text-sm text-muted-foreground">男、女、未知，必填</div>
              </div>
              <div className="text-sm text-muted-foreground">单选</div>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <div className="font-medium">状态</div>
                <div className="text-sm text-muted-foreground">在职、劝退、光荣退休，必填</div>
              </div>
              <div className="text-sm text-muted-foreground">单选</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>自定义字段</CardTitle>
        </CardHeader>
        <CardContent>
          {fields.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无自定义字段，点击"新增字段"添加
            </div>
          ) : (
            <div className="space-y-2">
              {fields.map((field, index) => (
                <div
                  key={field.id}
                  className={`flex items-center gap-2 p-3 border rounded-lg ${field.hidden ? 'opacity-50' : ''} ${isSpecialField(field.id) ? 'bg-muted' : ''}`}
                  draggable={!isSpecialField(field.id)}
                  onDragStart={(e) => !isSpecialField(field.id) && handleDragStart(e, index)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => !isSpecialField(field.id) && handleDrop(e, index)}
                >
                  <GripVertical className={`h-4 w-4 ${isSpecialField(field.id) ? 'text-muted-foreground opacity-50' : 'text-muted-foreground cursor-grab'}`} />
                  <div className="flex-1 cursor-pointer">
                    <div className="font-medium">{field.name} {field.hidden && '(已隐藏)'}</div>
                    <div className="text-sm text-muted-foreground">
                      {getFieldTypeLabel(field.type)}
                      {field.options && ` - 选项: ${field.options.join(', ')}`}
                      {field.used && ' · 已使用'}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleStartEdit(field)}
                      title="编辑"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => !isSpecialField(field.id) && handleToggleHidden(field.id)}
                      title={isSpecialField(field.id) ? "特殊字段不可隐藏" : field.hidden ? "显示" : "隐藏"}
                      disabled={isSpecialField(field.id)}
                      className={isSpecialField(field.id) ? 'opacity-50 cursor-not-allowed' : ''}
                    >
                      {field.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => !isSpecialField(field.id) && setDeleteConfirm({ open: true, field })}
                      title={isSpecialField(field.id) ? "特殊字段不可删除" : "删除"}
                      disabled={isSpecialField(field.id)}
                      className={isSpecialField(field.id) ? 'opacity-50 cursor-not-allowed' : ''}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Field Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增成员档案字段</DialogTitle>
            <DialogDescription>
              配置新的自定义字段用于成员档案
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fieldName">字段名称（2~10个字）</Label>
              <Input
                id="fieldName"
                value={newFieldName}
                onChange={e => setNewFieldName(e.target.value)}
                placeholder="请输入字段名称"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fieldType">字段属性</Label>
              <Select value={newFieldType} onValueChange={(value: FieldType) => setNewFieldType(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">自由文本</SelectItem>
                  <SelectItem value="radio">单选文本</SelectItem>
                  <SelectItem value="date">日期</SelectItem>
                  <SelectItem value="number">数字</SelectItem>
                  <SelectItem value="images">图片相册（最多9张）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newFieldType === 'radio' && (
              <div className="space-y-2">
                <Label htmlFor="fieldOptions">选项（用逗号分隔）</Label>
                <Input
                  id="fieldOptions"
                  value={newFieldOptions}
                  onChange={e => setNewFieldOptions(e.target.value)}
                  placeholder="选项1,选项2,选项3"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>取消</Button>
            <Button onClick={handleAddField}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Field Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑字段</DialogTitle>
            <DialogDescription>
              修改字段名称{editingField?.type === 'radio' && '和选项'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editFieldName">字段名称（2~10个字）</Label>
              <Input
                id="editFieldName"
                value={editFieldName}
                onChange={e => setEditFieldName(e.target.value)}
                placeholder="请输入字段名称"
              />
            </div>
            <div className="space-y-2">
              <Label>字段属性</Label>
              <div className="text-sm text-muted-foreground">
                {editingField && getFieldTypeLabel(editingField.type)}
              </div>
            </div>
            {editingField?.type === 'radio' && (
              <div className="space-y-2">
                <Label htmlFor="editFieldOptions">选项（用逗号分隔）</Label>
                <Input
                  id="editFieldOptions"
                  value={editFieldOptions}
                  onChange={e => setEditFieldOptions(e.target.value)}
                  placeholder="选项1,选项2,选项3"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>取消</Button>
            <Button onClick={handleSaveEdit}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteConfirm.open} onOpenChange={open => setDeleteConfirm({ open, field: null })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteConfirm.field?.used ? '隐藏字段' : '删除字段'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirm.field?.used
                ? `字段"${deleteConfirm.field.name}"已被使用，只能隐藏。隐藏后，该字段在填写成员信息时将不再显示。`
                : `确定要删除字段"${deleteConfirm.field?.name}"吗？此操作不可恢复。`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirm.field && handleDeleteField(deleteConfirm.field)}>
              {deleteConfirm.field?.used ? '隐藏' : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Exit Confirmation */}
      <AlertDialog open={isExitDialogOpen} onOpenChange={setIsExitDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>有未保存的更改</AlertDialogTitle>
            <AlertDialogDescription>
              您有未保存的更改，确定要放弃这些更改吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction onClick={confirmExit}>放弃更改</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

FieldManagement.displayName = 'FieldManagement';






