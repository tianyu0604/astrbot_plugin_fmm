import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Member, MemberData, CustomField, Gender, Status } from '../types/member';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { X, Upload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { uploadImage } from '../utils/qny';

interface MemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: Member | null;
  customFields: CustomField[];
  onSave: (data: MemberData, reason?: string) => Promise<void>;
}

export function MemberDialog({ open, onOpenChange, member, customFields, onSave }: MemberDialogProps) {
  const [formData, setFormData] = useState<MemberData>({
    name: '',
    qq: '',
    gender: '未知' as Gender,
    status: '在职' as Status,
  });
  const [originalFormData, setOriginalFormData] = useState<MemberData>({
    name: '',
    qq: '',
    gender: '未知' as Gender,
    status: '在职' as Status,
  }); // 保存原始数据用于比较
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingImages, setUploadingImages] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEdit = !!member;
  // 类型安全但数字友好的深度比较函数
  const typeSafeDeepEqual = (obj1: any, obj2: any): boolean => {
    // 严格相等检查
    if (obj1 === obj2) return true;

    // 处理 null、undefined 和空字符串的等价性
    const isNullishOrEmpty = (val: any) => val == null || val === '';
    if (isNullishOrEmpty(obj1) && isNullishOrEmpty(obj2)) {
      return true;
    }

    // 如果其中一个为空值，另一个不为空值，则不相等
    if (isNullishOrEmpty(obj1) || isNullishOrEmpty(obj2)) {
      return false;
    }

    // 处理数组类型
    if (Array.isArray(obj1) && Array.isArray(obj2)) {
      if (obj1.length !== obj2.length) return false;
      for (let i = 0; i < obj1.length; i++) {
        if (!typeSafeDeepEqual(obj1[i], obj2[i])) return false;
      }
      return true;
    }

    // 处理基本类型 - 对数字和字符串进行特殊处理
    if (typeof obj1 !== 'object' || typeof obj2 !== 'object') {
      // 数字和字符串的特殊处理：如果一个是数字一个是字符串数字，视为相等
      if ((typeof obj1 === 'number' && typeof obj2 === 'string' && !isNaN(Number(obj2)) && obj1 === Number(obj2)) ||
        (typeof obj2 === 'number' && typeof obj1 === 'string' && !isNaN(Number(obj1)) && obj2 === Number(obj1))) {
        return true;
      }
      // 其他情况保持严格类型检查
      if (typeof obj1 !== typeof obj2) {
        return false;
      }
      return obj1 === obj2;
    }

    // 处理对象
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) {
      return false;
    }

    for (let key of keys1) {
      if (!keys2.includes(key)) {
        return false;
      }
      if (!typeSafeDeepEqual(obj1[key], obj2[key])) {
        return false;
      }
    }

    return true;
  };

  // 使用类型安全的比较方法
  const hasFormChanges = useMemo(() => {
    if (!isEdit) return false;

    // 特殊处理：区分从有值变为空值的情况
    const customEqual = (current: any, original: any): boolean => {
      // 如果原始值存在但当前值为空（undefined, null, 空字符串），则视为已修改（返回false表示不相等）
      if (original != null && original !== '' && (current === undefined || current === null || current === '')) {
        return false;
      }

      // 如果当前值存在但原始值为空，也视为已修改（返回false表示不相等）
      if ((original === undefined || original === null || original === '') && (current != null && current !== '')) {
        return false;
      }

      // 其他情况使用类型安全比较
      return typeSafeDeepEqual(current, original);
    };

    // 检查所有字段
    let hasChanges = false;
    const allKeys = new Set([...Object.keys(formData), ...Object.keys(originalFormData)]);

    for (const key of allKeys) {
      const currentValue = formData[key];
      const originalValue = originalFormData[key];

      if (!customEqual(currentValue, originalValue)) {
        hasChanges = true;
        break;
      }
    }

    return hasChanges;
  }, [formData, originalFormData, isEdit]);

  // 当表单恢复到原始状态时，清空修改原因
  useEffect(() => {
    if (isEdit && !hasFormChanges && reason) {
      setReason('');
    }
  }, [hasFormChanges, isEdit, reason]);

  // Convert ISO date string to YYYY-MM-DD format for date input
  const formatDateForInput = (dateValue: any): string => {
    if (!dateValue) return '';
    try {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) return '';
      // Format as YYYY-MM-DD
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch {
      return '';
    }
  };

  // Convert YYYY-MM-DD format to storage - keep as YYYY-MM-DD format
  const formatDateForStorage = (dateString: string): string => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      // Format as YYYY-MM-DD to comply with project specification
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch {
      return dateString;
    }
  };

  useEffect(() => {
    if (member) {
      // 深拷贝原始数据，避免引用问题
      const memberData = JSON.parse(JSON.stringify(member.data));
      setFormData(memberData);
      setOriginalFormData(memberData);
    } else {
      const defaultData = {
        name: '',
        qq: '',
        gender: '未知' as Gender,
        status: '在职' as Status,
      };
      setFormData(defaultData);
      setOriginalFormData(defaultData);
    }
    setReason('');
  }, [member, open]);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error('照片大小不能超过2M');
      e.target.value = '';
      return;
    }

    // 先显示本地预览
    const objectURL = URL.createObjectURL(file);
    const originalPhoto = formData.photo || '';
    setFormData({ ...formData, photo: objectURL });

    // 上传到七牛云
    setUploadingPhoto(true);
    try {
      const result = await uploadImage({
        file: file,
        featureName: 'member-photo',
        prefix: true,
      });

      if (result.success && result.url) {
        setFormData({ ...formData, photo: result.url });
        toast.success('照片上传成功');
      } else {
        toast.error(result.errorMessage || '照片上传失败');
        setFormData({ ...formData, photo: originalPhoto });
      }
    } catch (error) {
      console.error('上传照片失败:', error);
      toast.error('照片上传失败，请重试');
      setFormData({ ...formData, photo: originalPhoto });
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
      URL.revokeObjectURL(objectURL);
    }
  };

  const handleImagesChange = async (fieldId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const currentImages = (formData[fieldId] as string[]) || [];
    if (currentImages.length + files.length > 9) {
      toast.error('最多只能上传9张图片');
      e.target.value = '';
      return;
    }

    // 先显示本地预览
    const objectURLs = files.map(file => URL.createObjectURL(file));
    const originalImages = currentImages;
    setFormData({
      ...formData,
      [fieldId]: [...currentImages, ...objectURLs],
    });

    // 上传到七牛云
    setUploadingImages(prev => ({ ...prev, [fieldId]: true }));
    try {
      const uploadPromises = files.map(async (file) => {
        const result = await uploadImage({
          file: file,
          featureName: `custom-field-${fieldId}`,
          prefix: true,
        });

        if (result.success && result.url) {
          return result.url;
        } else {
          throw new Error(result.errorMessage || '上传失败');
        }
      });

      const uploadedUrls = await Promise.all(uploadPromises);

      // 替换预览 URL 为网络 URL
      setFormData(prev => {
        const updatedImages = [...originalImages, ...uploadedUrls];
        return {
          ...prev,
          [fieldId]: updatedImages,
        };
      });

      toast.success(`成功上传 ${uploadedUrls.length} 张图片`);
    } catch (error) {
      console.error('上传图片失败:', error);
      toast.error('部分图片上传失败，请重试');
      // 恢复原始图片
      setFormData(prev => ({
        ...prev,
        [fieldId]: originalImages,
      }));
    } finally {
      setUploadingImages(prev => ({ ...prev, [fieldId]: false }));
      e.target.value = '';
      // 清理 Object URL
      objectURLs.forEach(url => URL.revokeObjectURL(url));
    }
  };

  const handleRemoveImage = (fieldId: string, index: number) => {
    const images = [...(formData[fieldId] as string[] || [])];
    images.splice(index, 1);
    setFormData({ ...formData, [fieldId]: images });
  };

  const handleSubmit = async () => {
    if (saving) return;
    // Validate required fields
    if (!formData.name?.trim() || formData.name.trim().length > 50) {
      toast.error('姓名需要 1 到 50 个字');
      return;
    }

    if (!/^[1-9][0-9]{4,11}$/.test(formData.qq?.trim() || '')) {
      toast.error('QQ 号必填，请输入 5 到 12 位数字');
      return;
    }

    // 当状态为“劝退”时，检查劝退详情和劝退原因是否填写
    if (formData.status === '劝退' && customFields.some(f => f.id === '7cfce2fa-552f-4759-8f87-56b207637a22')) {
      const dropoutDetailsFieldId = '13dacc46-10c6-40e3-8734-6a43fea7bbfc'; // 劝退详情字段ID
      const dropoutReasonFieldId = '7cfce2fa-552f-4759-8f87-56b207637a22'; // 劝退原因字段ID

      const dropoutDetailsValue = formData[dropoutDetailsFieldId];
      const dropoutReasonValue = formData[dropoutReasonFieldId];

      // 检查劝退详情和劝退原因是否都未填写
      if ((dropoutDetailsValue === undefined || dropoutDetailsValue === '') &&
        (dropoutReasonValue === undefined || dropoutReasonValue === '')) {
        toast.error('请填写劝退原因和劝退详情');
        return;
      }
      // 检查劝退原因是否未填写
      else if (dropoutReasonValue === undefined || dropoutReasonValue === '') {
        toast.error('请填写劝退原因');
        return;
      }
      // 检查劝退详情是否未填写
      else if (dropoutDetailsValue === undefined || dropoutDetailsValue === '') {
        toast.error('请填写劝退详情');
        return;
      }
    }

    // 在编辑模式下，如果有修改才需要填写修改原因
    if (isEdit && hasFormChanges && !reason) {
      toast.error('修改成员档案时必须填写修改原因');
      return;
    }

    setSaving(true);
    try {
      await onSave({ ...formData, qq: formData.qq.trim() }, isEdit && hasFormChanges ? reason : undefined);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const renderField = (field: CustomField) => {
    const value = formData[field.id];

    // 类型友好的值处理
    const getDisplayValue = (val: any): string => {
      if (val == null) return '';
      if (typeof val === 'string') return val;
      if (typeof val === 'number') return val.toString();
      return String(val);
    };

    const displayValue = getDisplayValue(value);

    switch (field.type) {
      case 'text':
        return (
          <Input
            value={displayValue}
            onChange={e => {
              const newValue = e.target.value;
              // 保持类型友好，空字符串保存为 undefined
              const finalValue = newValue === '' ? undefined : newValue;
              setFormData({ ...formData, [field.id]: finalValue });
            }}
            placeholder={`请输入${field.name}`}
          />
        );

      case 'radio':
        return (
          <Select
            value={displayValue}
            onValueChange={val => {
              // 保持类型友好
              const finalValue = val === '' ? undefined : val;
              setFormData({ ...formData, [field.id]: finalValue });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={`请选择${field.name}`} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map(option => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'date':
        return (
          <Input
            type="date"
            value={formatDateForInput(value)}
            onChange={e => {
              const newValue = formatDateForStorage(e.target.value);
              const finalValue = newValue === '' ? undefined : newValue;
              setFormData({ ...formData, [field.id]: finalValue });
            }}
          />
        );

      case 'number':
        return (
          <Input
            type="number"
            value={displayValue}
            onChange={e => {
              const newValue = e.target.value;
              // 数字类型保持类型友好处理
              const finalValue = newValue === '' ? undefined : newValue;
              setFormData({ ...formData, [field.id]: finalValue });
            }}
            placeholder={`请输入${field.name}`}
          />
        );

      case 'images':
        const images = Array.isArray(value) ? value : [];
        const isUploading = uploadingImages[field.id] || false;
        return (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              {images.map((img, idx) => (
                <div key={idx} className="relative aspect-square">
                  <ImageWithFallback
                    src={img}
                    alt=""
                    className="w-full h-full object-cover rounded"
                  />
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute top-1 right-1 h-6 w-6"
                    onClick={() => handleRemoveImage(field.id, idx)}
                    disabled={isUploading}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {images.length < 9 && (
                <label className={`aspect-square border-2 border-dashed rounded flex items-center justify-center ${isUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary'}`}>
                  {isUploading ? (
                    <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
                  ) : (
                    <Upload className="h-6 w-6 text-muted-foreground" />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={e => handleImagesChange(field.id, e)}
                    disabled={isUploading}
                  />
                </label>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {isUploading ? '正在上传图片...' : '最多上传9张图片'}
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={value => { if (!saving) onOpenChange(value); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑' : '新增'}成员档案</DialogTitle>
          <DialogDescription>
            {isEdit ? '修改成员档案信息' : '填写新成员的档案信息'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Photo */}
          <div className="space-y-2">
            <Label>照片（选填）</Label>
            <div className="flex items-center gap-4">
              <Avatar className="h-20 w-20">
                <AvatarImage src={formData.photo} alt={formData.name} />
                <AvatarFallback>{formData.name?.[0] || '?'}</AvatarFallback>
              </Avatar>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingPhoto}
                >
                  {uploadingPhoto ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      上传中...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      上传照片
                    </>
                  )}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoChange}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  大小不超过2M
                </p>
              </div>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="member-name">姓名 *</Label>
            <Input
              id="member-name"
              maxLength={50}
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="1~50个字"
            />
          </div>

          {/* Gender */}
          <div className="space-y-2">
            <Label htmlFor="member-qq">QQ 号 *</Label>
            <Input id="member-qq" inputMode="numeric" autoComplete="off" maxLength={12}
              required value={formData.qq || ''}
              onChange={e => setFormData({ ...formData, qq: e.target.value })} />
          </div>

          {/* Gender */}
          <div className="space-y-2">
            <Label>性别 *</Label>
            <Select
              value={formData.gender}
              onValueChange={val => setFormData({ ...formData, gender: val as Gender })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="男">男</SelectItem>
                <SelectItem value="女">女</SelectItem>
                <SelectItem value="未知">未知</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label>状态 *</Label>
            <Select
              value={formData.status}
              onValueChange={val => setFormData({ ...formData, status: val as Status })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="在职">在职</SelectItem>
                <SelectItem value="劝退">劝退</SelectItem>
                <SelectItem value="光荣退休">光荣退休</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Custom Fields */}
          {customFields.filter(f => {
            // 如果字段是"劝退详情"或"劝退原因"，只有在状态为"劝退"时才显示
            if ((f.id === "13dacc46-10c6-40e3-8734-6a43fea7bbfc" || f.id === "7cfce2fa-552f-4759-8f87-56b207637a22")
              && formData.status !== "劝退") {
              return false;
            }
            // 如果字段是"退休取向"，只有在状态为"光荣退休"时才显示
            if (f.id === "2b370ca9-5e6f-49dd-b663-d54e1eceb123" && formData.status !== "光荣退休") {
              return false;
            }
            // 其他情况下，只过滤掉隐藏的字段
            return !f.hidden;
          }).map(field => (
            <div key={field.id} className="space-y-2">
              <Label>{field.name}</Label>
              {renderField(field)}
            </div>
          ))}

          {/* Edit Reason - 仅在编辑模式且有修改时显示 */}
          {isEdit && hasFormChanges && (
            <div className="space-y-2">
              <Label>修改原因 *</Label>
              <Textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="请输入修改原因"
                rows={3}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || uploadingPhoto || Object.values(uploadingImages).some(Boolean) || (isEdit && !hasFormChanges)}
          >
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
