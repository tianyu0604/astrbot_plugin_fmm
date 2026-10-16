import { useState } from 'react';
import { Task, Estimation, EstimationHistory } from '../types/task';
import { Member } from '../types/member';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
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
import { toast } from 'sonner@2.0.3';
import { Eye, EyeOff, Edit2, Save, X, Lock, Unlock, History as HistoryIcon, TrendingUp } from 'lucide-react';

interface EstimationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task;
  members: Member[];
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  onAddHistory: (record: Omit<EstimationHistory, 'id'>) => void;
  estimationHistory: EstimationHistory[];
}

export function EstimationDialog({
  open,
  onOpenChange,
  task,
  members,
  onUpdateTask,
  onAddHistory,
  estimationHistory,
}: EstimationDialogProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const [addingForUserId, setAddingForUserId] = useState<string | null>(null);
  const [addValue, setAddValue] = useState('');

  // Get member name by ID
  const getMemberName = (memberId: string) => {
    const member = members.find(m => m.id === memberId);
    return member?.data.name || '未知用户';
  };

  // Get evaluators who haven't submitted
  const pendingEvaluators = task.evaluators.filter(
    evalId => !task.estimations.some(e => e.userId === evalId)
  );

  // Calculate average points (excluding hidden)
  const validEstimations = task.estimations.filter(e => !e.hidden);
  const averagePoints = validEstimations.length > 0
    ? Math.round(validEstimations.reduce((sum, e) => sum + e.points, 0) / validEstimations.length * 10) / 10
    : null;

  // Handle toggle visibility
  const handleToggleVisibility = (estimation: Estimation) => {
    if (task.locked) {
      toast.error('任务已锁定，无法修改');
      return;
    }

    const updatedEstimations = task.estimations.map(e =>
      e.id === estimation.id ? { ...e, hidden: !e.hidden } : e
    );

    onUpdateTask(task.id, { estimations: updatedEstimations });

    // Add history record
    onAddHistory({
      taskId: task.id,
      action: estimation.hidden ? 'show' : 'hide',
      targetUserId: estimation.userId,
      operatedBy: '当前管理员',
      operatedAt: new Date().toISOString(),
    });

    toast.success(estimation.hidden ? '已显示该估点' : '已隐藏该估点');
  };

  // Handle edit estimation
  const handleStartEdit = (estimation: Estimation) => {
    if (task.locked) {
      toast.error('任务已锁定，无法修改');
      return;
    }
    setEditingId(estimation.id);
    setEditValue(estimation.points.toString());
  };

  const handleSaveEdit = (estimation: Estimation) => {
    const newPoints = parseFloat(editValue);
    
    if (isNaN(newPoints) || newPoints < 0 || newPoints > 10) {
      toast.error('估点必须在0-10之间');
      return;
    }

    const updatedEstimations = task.estimations.map(e =>
      e.id === estimation.id
        ? {
            ...e,
            points: newPoints,
            modifiedBy: '当前管理员',
            modifiedAt: new Date().toISOString(),
          }
        : e
    );

    onUpdateTask(task.id, { estimations: updatedEstimations });

    // Add history record
    onAddHistory({
      taskId: task.id,
      action: 'modify',
      targetUserId: estimation.userId,
      oldValue: estimation.points,
      newValue: newPoints,
      operatedBy: '当前管理员',
      operatedAt: new Date().toISOString(),
    });

    setEditingId(null);
    setEditValue('');
    toast.success('估点已修改');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  // Handle add estimation for pending user
  const handleStartAdd = (userId: string) => {
    if (task.locked) {
      toast.error('任务已锁定，无法添加');
      return;
    }
    setAddingForUserId(userId);
    setAddValue('');
  };

  const handleSaveAdd = () => {
    if (!addingForUserId) return;

    const newPoints = parseFloat(addValue);
    
    if (isNaN(newPoints) || newPoints < 0 || newPoints > 10) {
      toast.error('估点必须在0-10之间');
      return;
    }

    const newEstimation: Estimation = {
      id: Date.now().toString(),
      userId: addingForUserId,
      userName: getMemberName(addingForUserId),
      points: newPoints,
      submittedAt: new Date().toISOString(),
      hidden: false,
      modifiedBy: '管理员代填',
      modifiedAt: new Date().toISOString(),
    };

    const updatedEstimations = [...task.estimations, newEstimation];
    onUpdateTask(task.id, { estimations: updatedEstimations });

    // Add history record
    onAddHistory({
      taskId: task.id,
      action: 'modify',
      targetUserId: addingForUserId,
      newValue: newPoints,
      operatedBy: '当前管理员',
      operatedAt: new Date().toISOString(),
      reason: '管理员代填',
    });

    setAddingForUserId(null);
    setAddValue('');
    toast.success('估点已添加');
  };

  const handleCancelAdd = () => {
    setAddingForUserId(null);
    setAddValue('');
  };

  // Handle lock/unlock
  const handleToggleLock = () => {
    if (task.locked) {
      // Unlock directly
      onUpdateTask(task.id, { locked: false });
      onAddHistory({
        taskId: task.id,
        action: 'unlock',
        operatedBy: '当前管理员',
        operatedAt: new Date().toISOString(),
      });
      toast.success('任务已解锁');
    } else {
      // Show confirmation for lock
      setShowLockConfirm(true);
    }
  };

  const confirmLock = () => {
    onUpdateTask(task.id, { locked: true });
    onAddHistory({
      taskId: task.id,
      action: 'lock',
      operatedBy: '当前管理员',
      operatedAt: new Date().toISOString(),
    });
    setShowLockConfirm(false);
    toast.success('任务已锁定');
  };

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-CN');
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-3">
                <DialogTitle className="text-xl">{task.name}</DialogTitle>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Badge variant="secondary">{task.type}</Badge>
                    <Badge variant="outline">{task.department}</Badge>
                    {task.locked && (
                      <Badge variant="destructive" className="gap-1">
                        <Lock className="h-3 w-3" />
                        已锁定
                      </Badge>
                    )}
                  </div>
                  {task.description && (
                    <DialogDescription>{task.description}</DialogDescription>
                  )}
                </div>
              </div>
              <Button
                variant={task.locked ? "outline" : "default"}
                size="sm"
                onClick={handleToggleLock}
                className="gap-2"
              >
                {task.locked ? (
                  <>
                    <Unlock className="h-4 w-4" />
                    解锁
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    锁定
                  </>
                )}
              </Button>
            </div>
          </DialogHeader>

          <Tabs defaultValue="estimations" className="flex-1 flex flex-col">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="estimations">估点详情</TabsTrigger>
              <TabsTrigger value="history">修改历史</TabsTrigger>
            </TabsList>

            {/* Estimations Tab */}
            <TabsContent value="estimations" className="flex-1 flex flex-col space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">评价人数</p>
                  <p className="text-2xl font-medium mt-1">
                    {task.estimations.length} / {task.evaluators.length}
                  </p>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">有效估点</p>
                  <p className="text-2xl font-medium mt-1">
                    {validEstimations.length}
                  </p>
                </div>
                <div className="p-4 bg-primary/10 rounded-lg">
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    平均估点
                  </p>
                  <p className="text-3xl font-medium text-primary mt-1">
                    {averagePoints !== null ? averagePoints : '—'}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Estimations Table */}
              <ScrollArea className="flex-1">
                <div className="space-y-6">
                  {/* Submitted Estimations */}
                  {task.estimations.length > 0 && (
                    <div>
                      <Label className="mb-3 block">已提交估点</Label>
                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>评价人</TableHead>
                              <TableHead>估点</TableHead>
                              <TableHead>提交时间</TableHead>
                              <TableHead>状态</TableHead>
                              <TableHead className="text-right">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {task.estimations.map(estimation => (
                              <TableRow key={estimation.id} className={estimation.hidden ? 'opacity-50' : ''}>
                                <TableCell className="font-medium">
                                  <div className="flex flex-col">
                                    <span>{getMemberName(estimation.userId)}</span>
                                    {estimation.modifiedBy === '管理员代填' && (
                                      <span className="text-xs text-muted-foreground mt-0.5">
                                        管理员代填
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {editingId === estimation.id ? (
                                    <div className="flex items-center gap-2">
                                      <Input
                                        type="number"
                                        min="0"
                                        max="10"
                                        step="0.1"
                                        value={editValue}
                                        onChange={e => setEditValue(e.target.value)}
                                        className="w-24"
                                      />
                                      <Button
                                        size="sm"
                                        onClick={() => handleSaveEdit(estimation)}
                                      >
                                        <Save className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={handleCancelEdit}
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <span className="text-lg font-medium">
                                      {estimation.points}
                                      {estimation.modifiedBy && estimation.modifiedBy !== '管理员代填' && (
                                        <span className="text-xs text-muted-foreground ml-2">
                                          (已修改)
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {formatDate(estimation.submittedAt)}
                                </TableCell>
                                <TableCell>
                                  {estimation.hidden ? (
                                    <Badge variant="secondary">已隐藏</Badge>
                                  ) : (
                                    <Badge variant="default">参与计算</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleToggleVisibility(estimation)}
                                      disabled={task.locked}
                                    >
                                      {estimation.hidden ? (
                                        <Eye className="h-4 w-4" />
                                      ) : (
                                        <EyeOff className="h-4 w-4" />
                                      )}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleStartEdit(estimation)}
                                      disabled={task.locked || editingId === estimation.id}
                                    >
                                      <Edit2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* Pending Evaluators */}
                  {pendingEvaluators.length > 0 && (
                    <div>
                      <Label className="mb-3 block">待提交估点（管理员可代填）</Label>
                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>评价人</TableHead>
                              <TableHead>状态</TableHead>
                              <TableHead className="text-right">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pendingEvaluators.map(evalId => (
                              <TableRow key={evalId}>
                                <TableCell className="font-medium">
                                  {getMemberName(evalId)}
                                </TableCell>
                                <TableCell>
                                  {addingForUserId === evalId ? (
                                    <div className="flex items-center gap-2">
                                      <Input
                                        type="number"
                                        min="0"
                                        max="10"
                                        step="0.1"
                                        value={addValue}
                                        onChange={e => setAddValue(e.target.value)}
                                        placeholder="0-10"
                                        className="w-24"
                                        autoFocus
                                      />
                                      <span className="text-xs text-muted-foreground">点</span>
                                    </div>
                                  ) : (
                                    <Badge variant="secondary">待提交</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  {addingForUserId === evalId ? (
                                    <div className="flex justify-end gap-2">
                                      <Button
                                        size="sm"
                                        onClick={handleSaveAdd}
                                      >
                                        <Save className="h-3 w-3 mr-1" />
                                        保存
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={handleCancelAdd}
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleStartAdd(evalId)}
                                      disabled={task.locked}
                                    >
                                      <Edit2 className="h-3 w-3 mr-1" />
                                      代填
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {task.estimations.length === 0 && pendingEvaluators.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <p>暂无评价人</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* History Tab */}
            <TabsContent value="history" className="flex-1">
              <ScrollArea className="h-[500px]">
                {estimationHistory.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <HistoryIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>暂无修改历史</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {estimationHistory.map(record => (
                      <div key={record.id} className="border rounded-lg p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {record.action === 'lock' && (
                              <Badge variant="default">锁定</Badge>
                            )}
                            {record.action === 'unlock' && (
                              <Badge variant="secondary">解锁</Badge>
                            )}
                            {record.action === 'hide' && (
                              <Badge variant="secondary">隐藏</Badge>
                            )}
                            {record.action === 'show' && (
                              <Badge variant="secondary">显示</Badge>
                            )}
                            {record.action === 'modify' && (
                              <Badge variant="default">修改</Badge>
                            )}
                            {record.targetUserId && (
                              <span className="text-sm font-medium">
                                {getMemberName(record.targetUserId)}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(record.operatedAt)}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {record.action === 'modify' && (
                            <p>
                              {record.oldValue !== undefined ? (
                                <>
                                  估点从 <span className="font-medium">{record.oldValue}</span> 修改为{' '}
                                  <span className="font-medium">{record.newValue}</span>
                                </>
                              ) : (
                                <>
                                  管理员代填估点：<span className="font-medium">{record.newValue}</span>
                                </>
                              )}
                            </p>
                          )}
                          <p className="mt-1">操作人：{record.operatedBy}</p>
                          {record.reason && (
                            <p className="text-xs mt-1 text-muted-foreground/80">备注：{record.reason}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Lock Confirmation Dialog */}
      <AlertDialog open={showLockConfirm} onOpenChange={setShowLockConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认锁定任务</AlertDialogTitle>
            <AlertDialogDescription>
              锁定后，所有对估点的修改（包括隐藏、修改估点值）都将被记录到历史中。
              您可以随时解锁任务以继续编辑。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLock}>
              确认锁定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
