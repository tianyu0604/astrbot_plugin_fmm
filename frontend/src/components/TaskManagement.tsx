import { useState, useEffect, useRef } from 'react';
import { api } from '../api/PluginAPI';
import { Task, TaskSettings, EstimationHistory } from '../types/task';
import { Member } from '../types/member';
import { TaskCard } from './TaskCard';
import { CreateTaskDialog } from './CreateTaskDialog';
import { EstimationDialog } from './EstimationDialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner@2.0.3';

interface TaskManagementProps {
  members: Member[];
}

const STORAGE_KEYS = {
  TASKS: 'fmm_tasks',
  TASK_SETTINGS: 'fmm_task_settings',
  ESTIMATION_HISTORY: 'fmm_estimation_history',
};

const DEFAULT_SETTINGS: TaskSettings = {
  taskTypes: ['推文', 'APP运营'],
  departments: ['MC', 'TP'],
};

export function TaskManagement({ members }: TaskManagementProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<TaskSettings>(DEFAULT_SETTINGS);
  const [estimationHistory, setEstimationHistory] = useState<EstimationHistory[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isEstimationDialogOpen, setIsEstimationDialogOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const saveQueue = useRef(Promise.resolve());

  // Import the original browser data only when SQLite has no saved workspace.
  useEffect(() => {
    let active = true;
    api<{ tasks: Task[]; settings: TaskSettings; history: EstimationHistory[] } | null>('/tasks').then(data => {
      if (!active) return;
      if (data) {
        setTasks(data.tasks); setSettings(data.settings); setEstimationHistory(data.history);
      } else {
        setTasks(JSON.parse(localStorage.getItem(STORAGE_KEYS.TASKS) || '[]'));
        setSettings(JSON.parse(localStorage.getItem(STORAGE_KEYS.TASK_SETTINGS) || JSON.stringify(DEFAULT_SETTINGS)));
        setEstimationHistory(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATION_HISTORY) || '[]'));
      }
      setLoaded(true);
    }).catch(error => { if (active) { setLoadError(true); toast.error(`任务加载失败：${error.message}`); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const data = { tasks, settings, history: estimationHistory };
    saveQueue.current = saveQueue.current.then(async () => {
      await api('/tasks', 'POST', data);
    }).catch(error => toast.error(`任务保存失败：${error.message}`));
  }, [loaded, tasks, settings, estimationHistory]);

  // Save functions
  const saveTasks = (newTasks: Task[]) => {
    setTasks(newTasks);
  };

  const saveSettings = (newSettings: TaskSettings) => {
    setSettings(newSettings);
  };

  const saveHistory = (newHistory: EstimationHistory[]) => {
    setEstimationHistory(newHistory);
  };

  // Calculate average points (excluding hidden estimations)
  const calculateAveragePoints = (task: Task): number | null => {
    const validEstimations = task.estimations.filter(e => !e.hidden);
    if (validEstimations.length === 0) return null;
    
    const sum = validEstimations.reduce((acc, e) => acc + e.points, 0);
    const average = sum / validEstimations.length;
    return Math.round(average * 10) / 10; // 保留1位小数
  };

  // Create task
  const handleCreateTask = (taskData: Omit<Task, 'id' | 'estimations' | 'averagePoints' | 'locked' | 'createdAt' | 'updatedAt'>) => {
    const newTask: Task = {
      ...taskData,
      id: Date.now().toString(),
      estimations: [],
      averagePoints: null,
      locked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveTasks([newTask, ...tasks]);
    toast.success('任务创建成功');
  };

  // Update task
  const handleUpdateTask = (taskId: string, updates: Partial<Task>) => {
    const updatedTasks = tasks.map(task => {
      if (task.id === taskId) {
        const updatedTask = { ...task, ...updates, updatedAt: new Date().toISOString() };
        // Recalculate average points
        updatedTask.averagePoints = calculateAveragePoints(updatedTask);
        
        // Update selectedTask if it's the same task
        if (selectedTask?.id === taskId) {
          setSelectedTask(updatedTask);
        }
        
        return updatedTask;
      }
      return task;
    });
    
    saveTasks(updatedTasks);
  };

  // Add history record
  const addHistoryRecord = (record: Omit<EstimationHistory, 'id'>) => {
    const newRecord: EstimationHistory = {
      ...record,
      id: Date.now().toString(),
    };
    saveHistory([newRecord, ...estimationHistory]);
  };

  // Add new task type or department
  const handleAddTaskType = (type: string) => {
    if (!settings.taskTypes.includes(type)) {
      saveSettings({
        ...settings,
        taskTypes: [...settings.taskTypes, type],
      });
    }
  };

  const handleAddDepartment = (dept: string) => {
    if (!settings.departments.includes(dept)) {
      saveSettings({
        ...settings,
        departments: [...settings.departments, dept],
      });
    }
  };

  // Filter tasks
  const filteredTasks = tasks.filter(task => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      task.name.toLowerCase().includes(query) ||
      task.type.toLowerCase().includes(query) ||
      task.department.toLowerCase().includes(query) ||
      task.description.toLowerCase().includes(query)
    );
  });

  if (!loaded) return <div className="text-muted-foreground py-12">{loadError ? '任务加载失败，请刷新页面重试' : '加载中...'}</div>;

  return (
    <Card className="border-0 shadow-none">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>任务管理</CardTitle>
            <CardDescription>
              创建任务并使用估点制度量化工作量
            </CardDescription>
          </div>
          <Button onClick={() => setIsCreateDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            创建任务
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="搜索任务..."
            className="pl-10"
          />
        </div>

        {/* Task List */}
        {filteredTasks.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
            <p className="font-medium">暂无任务</p>
            <p className="text-sm mt-1">
              {searchQuery ? '没有找到匹配的任务' : '点击"创建任务"按钮开始'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredTasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                members={members}
                onViewEstimations={() => {
                  setSelectedTask(task);
                  setIsEstimationDialogOpen(true);
                }}
                onUpdateTask={handleUpdateTask}
              />
            ))}
          </div>
        )}
      </CardContent>

      {/* Create Task Dialog */}
      <CreateTaskDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        members={members}
        settings={settings}
        onCreateTask={handleCreateTask}
        onAddTaskType={handleAddTaskType}
        onAddDepartment={handleAddDepartment}
      />

      {/* Estimation Dialog */}
      {selectedTask && (
        <EstimationDialog
          open={isEstimationDialogOpen}
          onOpenChange={setIsEstimationDialogOpen}
          task={selectedTask}
          members={members}
          onUpdateTask={handleUpdateTask}
          onAddHistory={addHistoryRecord}
          estimationHistory={estimationHistory.filter(h => h.taskId === selectedTask.id)}
        />
      )}
    </Card>
  );
}
