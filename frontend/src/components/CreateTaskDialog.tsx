import  { useState, useMemo } from 'react';
import { Task, TaskSettings } from '../types/task';
import { Member } from '../types/member';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Checkbox } from './ui/checkbox';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { toast } from 'sonner';
import { Plus, X, Search } from 'lucide-react';

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: Member[];
  settings: TaskSettings;
  onCreateTask: (task: Omit<Task, 'id' | 'estimations' | 'averagePoints' | 'locked' | 'createdAt' | 'updatedAt'>) => void;
  onAddTaskType: (type: string) => void;
  onAddDepartment: (dept: string) => void;
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  members,
  settings,
  onCreateTask,
  onAddTaskType,
  onAddDepartment,
}: CreateTaskDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [department, setDepartment] = useState('');
  const [description, setDescription] = useState('');
  const [selectedEvaluators, setSelectedEvaluators] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [newType, setNewType] = useState('');
  const [newDepartment, setNewDepartment] = useState('');
  const [showAddType, setShowAddType] = useState(false);
  const [showAddDept, setShowAddDept] = useState(false);

  // Group members
  const membersByDepartment = useMemo(() => {
    const groups: Record<string, Member[]> = {};
    members.forEach(member => {
      const dept = member.data.department || '未分配';
      if (!groups[dept]) groups[dept] = [];
      groups[dept].push(member);
    });
    return groups;
  }, [members]);

  const membersByPosition = useMemo(() => {
    const groups: Record<string, Member[]> = {};
    members.forEach(member => {
      const pos = member.data.position || '未设置';
      if (!groups[pos]) groups[pos] = [];
      groups[pos].push(member);
    });
    return groups;
  }, [members]);

  const membersByGrade = useMemo(() => {
    const groups: Record<string, Member[]> = {};
    members.forEach(member => {
      const grade = member.data.grade || '未设置';
      if (!groups[grade]) groups[grade] = [];
      groups[grade].push(member);
    });
    return groups;
  }, [members]);

  // Filtered members for search
  const filteredMembers = useMemo(() => {
    if (!searchQuery) return members;
    const query = searchQuery.toLowerCase();
    return members.filter(m => m.data.name.toLowerCase().includes(query));
  }, [members, searchQuery]);

  const handleReset = () => {
    setName('');
    setType('');
    setDepartment('');
    setDescription('');
    setSelectedEvaluators([]);
    setSearchQuery('');
    setNewType('');
    setNewDepartment('');
    setShowAddType(false);
    setShowAddDept(false);
  };

  const handleSubmit = () => {
    // Validation
    if (!name.trim()) {
      toast.error('请输入任务名称');
      return;
    }
    if (name.length > 30) {
      toast.error('任务名称不能超过30个字');
      return;
    }
    if (!type) {
      toast.error('请选择任务类型');
      return;
    }
    if (!department) {
      toast.error('请选择部门');
      return;
    }
    if (description.length > 1000) {
      toast.error('任务详情不能超过1000个字');
      return;
    }
    if (selectedEvaluators.length === 0) {
      toast.error('请至少选择一位评价人');
      return;
    }

    onCreateTask({
      name: name.trim(),
      type,
      department,
      description: description.trim(),
      evaluators: selectedEvaluators,
      createdBy: '当前用户', // 实际应用中应该是登录用户
    });

    handleReset();
    onOpenChange(false);
  };

  const toggleEvaluator = (memberId: string) => {
    setSelectedEvaluators(prev =>
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    );
  };

  const toggleGroup = (memberIds: string[]) => {
    const allSelected = memberIds.every(id => selectedEvaluators.includes(id));
    if (allSelected) {
      setSelectedEvaluators(prev => prev.filter(id => !memberIds.includes(id)));
    } else {
      setSelectedEvaluators(prev => [...new Set([...prev, ...memberIds])]);
    }
  };

  const handleAddNewType = () => {
    if (newType.trim() && !settings.taskTypes.includes(newType.trim())) {
      onAddTaskType(newType.trim());
      setType(newType.trim());
      setNewType('');
      setShowAddType(false);
      toast.success('任务类型已添加');
    }
  };

  const handleAddNewDept = () => {
    if (newDepartment.trim() && !settings.departments.includes(newDepartment.trim())) {
      onAddDepartment(newDepartment.trim());
      setDepartment(newDepartment.trim());
      setNewDepartment('');
      setShowAddDept(false);
      toast.success('部门已添加');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      if (!newOpen) handleReset();
      onOpenChange(newOpen);
    }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>创建任务</DialogTitle>
          <DialogDescription>
            填写任务信息并选择可评价人
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6 py-2">
            {/* Task Name */}
            <div className="space-y-2">
              <Label htmlFor="name">
                任务名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="输入任务名称（30字以内）"
                maxLength={30}
              />
              <p className="text-xs text-muted-foreground text-right">
                {name.length} / 30
              </p>
            </div>

            {/* Task Type */}
            <div className="space-y-2">
              <Label htmlFor="type">
                任务类型 <span className="text-destructive">*</span>
              </Label>
              {!showAddType ? (
                <div className="flex gap-2">
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger id="type">
                      <SelectValue placeholder="选择任务类型" />
                    </SelectTrigger>
                    <SelectContent>
                      {settings.taskTypes.map(t => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowAddType(true)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={newType}
                    onChange={e => setNewType(e.target.value)}
                    placeholder="新增任务类型"
                    onKeyDown={e => e.key === 'Enter' && handleAddNewType()}
                  />
                  <Button onClick={handleAddNewType}>添加</Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setShowAddType(false);
                      setNewType('');
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            {/* Department */}
            <div className="space-y-2">
              <Label htmlFor="department">
                部门 <span className="text-destructive">*</span>
              </Label>
              {!showAddDept ? (
                <div className="flex gap-2">
                  <Select value={department} onValueChange={setDepartment}>
                    <SelectTrigger id="department">
                      <SelectValue placeholder="选择部门" />
                    </SelectTrigger>
                    <SelectContent>
                      {settings.departments.map(d => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowAddDept(true)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={newDepartment}
                    onChange={e => setNewDepartment(e.target.value)}
                    placeholder="新增部门"
                    onKeyDown={e => e.key === 'Enter' && handleAddNewDept()}
                  />
                  <Button onClick={handleAddNewDept}>添加</Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setShowAddDept(false);
                      setNewDepartment('');
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">任务详情</Label>
              <Textarea
                id="description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="输入任务详情（1000字以内）"
                rows={4}
                maxLength={1000}
              />
              <p className="text-xs text-muted-foreground text-right">
                {description.length} / 1000
              </p>
            </div>

            <Separator />

            {/* Evaluators Selection */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>
                  任务可评价人 <span className="text-destructive">*</span>
                </Label>
                <Badge variant="secondary">
                  已选择 {selectedEvaluators.length} 人
                </Badge>
              </div>

              <Tabs defaultValue="all" className="w-full">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="all">全部</TabsTrigger>
                  <TabsTrigger value="department">部门</TabsTrigger>
                  <TabsTrigger value="position">职级</TabsTrigger>
                  <TabsTrigger value="grade">年级</TabsTrigger>
                  <TabsTrigger value="search">搜索</TabsTrigger>
                </TabsList>

                {/* All Members */}
                <TabsContent value="all" className="space-y-2">
                  <div className="flex gap-2 mb-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedEvaluators(members.map(m => m.id))}
                    >
                      全选
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedEvaluators([])}
                    >
                      清空
                    </Button>
                  </div>
                  <ScrollArea className="h-[300px] border rounded-lg p-4">
                    <div className="space-y-2">
                      {members.map(member => (
                        <div key={member.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={`all-${member.id}`}
                            checked={selectedEvaluators.includes(member.id)}
                            onCheckedChange={() => toggleEvaluator(member.id)}
                          />
                          <label
                            htmlFor={`all-${member.id}`}
                            className="text-sm flex-1 cursor-pointer"
                          >
                            {member.data.name}
                            {member.data.department && (
                              <span className="text-muted-foreground ml-2">
                                ({member.data.department})
                              </span>
                            )}
                          </label>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* By Department */}
                <TabsContent value="department" className="space-y-3">
                  <ScrollArea className="h-[300px] border rounded-lg p-4">
                    {Object.entries(membersByDepartment).map(([dept, deptMembers]) => (
                      <div key={dept} className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <Label className="cursor-pointer" onClick={() => toggleGroup(deptMembers.map(m => m.id))}>
                            {dept} ({deptMembers.length})
                          </Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleGroup(deptMembers.map(m => m.id))}
                          >
                            {deptMembers.every(m => selectedEvaluators.includes(m.id)) ? '取消全选' : '全选'}
                          </Button>
                        </div>
                        <div className="space-y-2 pl-4">
                          {deptMembers.map(member => (
                            <div key={member.id} className="flex items-center space-x-2">
                              <Checkbox
                                id={`dept-${member.id}`}
                                checked={selectedEvaluators.includes(member.id)}
                                onCheckedChange={() => toggleEvaluator(member.id)}
                              />
                              <label
                                htmlFor={`dept-${member.id}`}
                                className="text-sm flex-1 cursor-pointer"
                              >
                                {member.data.name}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </ScrollArea>
                </TabsContent>

                {/* By Position */}
                <TabsContent value="position" className="space-y-3">
                  <ScrollArea className="h-[300px] border rounded-lg p-4">
                    {Object.entries(membersByPosition).map(([pos, posMembers]) => (
                      <div key={pos} className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <Label className="cursor-pointer" onClick={() => toggleGroup(posMembers.map(m => m.id))}>
                            {pos} ({posMembers.length})
                          </Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleGroup(posMembers.map(m => m.id))}
                          >
                            {posMembers.every(m => selectedEvaluators.includes(m.id)) ? '取消全选' : '全选'}
                          </Button>
                        </div>
                        <div className="space-y-2 pl-4">
                          {posMembers.map(member => (
                            <div key={member.id} className="flex items-center space-x-2">
                              <Checkbox
                                id={`pos-${member.id}`}
                                checked={selectedEvaluators.includes(member.id)}
                                onCheckedChange={() => toggleEvaluator(member.id)}
                              />
                              <label
                                htmlFor={`pos-${member.id}`}
                                className="text-sm flex-1 cursor-pointer"
                              >
                                {member.data.name}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </ScrollArea>
                </TabsContent>

                {/* By Grade */}
                <TabsContent value="grade" className="space-y-3">
                  <ScrollArea className="h-[300px] border rounded-lg p-4">
                    {Object.entries(membersByGrade).map(([grade, gradeMembers]) => (
                      <div key={grade} className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <Label className="cursor-pointer" onClick={() => toggleGroup(gradeMembers.map(m => m.id))}>
                            {grade} ({gradeMembers.length})
                          </Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleGroup(gradeMembers.map(m => m.id))}
                          >
                            {gradeMembers.every(m => selectedEvaluators.includes(m.id)) ? '取消全选' : '全选'}
                          </Button>
                        </div>
                        <div className="space-y-2 pl-4">
                          {gradeMembers.map(member => (
                            <div key={member.id} className="flex items-center space-x-2">
                              <Checkbox
                                id={`grade-${member.id}`}
                                checked={selectedEvaluators.includes(member.id)}
                                onCheckedChange={() => toggleEvaluator(member.id)}
                              />
                              <label
                                htmlFor={`grade-${member.id}`}
                                className="text-sm flex-1 cursor-pointer"
                              >
                                {member.data.name}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </ScrollArea>
                </TabsContent>

                {/* Search */}
                <TabsContent value="search" className="space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="搜索成员..."
                      className="pl-10"
                    />
                  </div>
                  <ScrollArea className="h-[250px] border rounded-lg p-4">
                    <div className="space-y-2">
                      {filteredMembers.map(member => (
                        <div key={member.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={`search-${member.id}`}
                            checked={selectedEvaluators.includes(member.id)}
                            onCheckedChange={() => toggleEvaluator(member.id)}
                          />
                          <label
                            htmlFor={`search-${member.id}`}
                            className="text-sm flex-1 cursor-pointer"
                          >
                            {member.data.name}
                            {member.data.department && (
                              <span className="text-muted-foreground ml-2">
                                ({member.data.department})
                              </span>
                            )}
                          </label>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit}>创建任务</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
