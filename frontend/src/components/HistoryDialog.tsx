import { HistoryRecord, CustomField } from '../types/member';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Clock, User } from 'lucide-react';

interface HistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: HistoryRecord[];
  customFields: CustomField[];
}

export function HistoryDialog({ open, onOpenChange, history, customFields }: HistoryDialogProps) {
  const getFieldName = (fieldId: string) => {
    const fieldMap: { [key: string]: string } = {
      photo: '照片',
      name: '姓名',
      qq: 'QQ 号',
      gender: '性别',
      status: '状态',
    };

    if (fieldMap[fieldId]) return fieldMap[fieldId];

    const customField = customFields.find(f => f.id === fieldId);
    return customField?.name || fieldId;
  };

  const formatValue = (value: any) => {
    if (value === null || value === undefined) return '空';
    if (value === '') return '空';
    if (Array.isArray(value)) return `${value.length}张图片`;
    if (typeof value === 'object') return JSON.stringify(value);

    // Check if value is a date string in ISO format or other date formats
    // Only treat as date if it matches common date patterns
    if (typeof value === 'string') {
      // Check if it's a date format (YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY, DD/MM/YYYY, YYYY年MM月DD日)
      const isDateFormat = /^\d{4}-\d{2}-\d{2}$|^\d{4}\/\d{2}\/\d{2}$|^\d{2}\/\d{2}\/\d{4}$|^\d{2}-\d{2}-\d{4}$|^\d{4}年\d{2}月\d{2}日$/.test(value);

      if (isDateFormat && !isNaN(Date.parse(value))) {
        // Format as YYYY-MM-DD to comply with project specification
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        }
      }
    }

    return value.toString();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>修改历史记录</DialogTitle>
          <DialogDescription>
            查看成员档案的所有修改记录
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[500px] pr-4">
          {history.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无修改记录
            </div>
          ) : (
            <div className="space-y-4">
              {history.map((record, idx) => (
                <div key={record.id}>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <User className="h-4 w-4" />
                          <span className="font-medium">{record.editor}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                          <Clock className="h-3 w-3" />
                          <span>{new Date(record.timestamp).toLocaleString('zh-CN')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-muted p-3 rounded-lg">
                      <div className="text-sm mb-2">
                        <span className="font-medium">修改原因：</span>
                        {record.reason}
                      </div>
                      <div className="space-y-2">
                        {record.changes
                          .filter(change => {
                            // 过滤掉照片字段的空值变化，包括 '空→0张图片' 和 '0张图片→空'
                            if (change.field === 'photo') {
                              const oldValueDisplay = formatValue(change.oldValue);
                              const newValueDisplay = formatValue(change.newValue);
                              // 如果是 '空→0张图片' 或 '0张图片→空'，则过滤掉
                              if ((oldValueDisplay === '空' && newValueDisplay === '0张图片') ||
                                (oldValueDisplay === '0张图片' && newValueDisplay === '空')) {
                                return false;
                              }
                            }
                            return true;
                          })
                          .map((change, changeIdx) => (
                            <div key={changeIdx} className="text-sm">
                              <span className="font-medium">{getFieldName(change.field)}：</span>
                              <span className="text-muted-foreground line-through mr-2">
                                {formatValue(change.oldValue)}
                              </span>
                              <span>→</span>
                              <span className="text-green-600 ml-2">
                                {formatValue(change.newValue)}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                  {idx < history.length - 1 && <Separator className="my-4" />}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
