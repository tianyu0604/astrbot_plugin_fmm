import { Task } from '../types/task';
import { Member } from '../types/member';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Lock, Unlock, Users, TrendingUp } from 'lucide-react';

interface TaskCardProps {
  task: Task;
  members: Member[];
  onViewEstimations: () => void;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
}

export function TaskCard({ task, members, onViewEstimations, onUpdateTask }: TaskCardProps) {
  const validEstimations = task.estimations.filter(e => !e.hidden);
  const totalEvaluators = task.evaluators.length;
  const submittedCount = task.estimations.length;

  const handleToggleLock = () => {
    onUpdateTask(task.id, { locked: !task.locked });
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg line-clamp-2">{task.name}</CardTitle>
            <CardDescription className="mt-1">
              创建于 {new Date(task.createdAt).toLocaleDateString('zh-CN')}
            </CardDescription>
          </div>
          {task.locked && (
            <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Badges */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{task.type}</Badge>
          <Badge variant="outline">{task.department}</Badge>
        </div>

        {/* Description */}
        <p className="text-sm text-muted-foreground line-clamp-2">
          {task.description || '暂无详情'}
        </p>

        {/* Stats */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3" />
              评价人数
            </span>
            <span className="font-medium">
              {submittedCount} / {totalEvaluators}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              平均估点
            </span>
            <span className="font-medium">
              {task.averagePoints !== null ? (
                <span className="text-lg text-primary">{task.averagePoints}</span>
              ) : (
                <span className="text-muted-foreground">暂无</span>
              )}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={onViewEstimations}
          >
            查看详情
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleLock}
          >
            {task.locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
