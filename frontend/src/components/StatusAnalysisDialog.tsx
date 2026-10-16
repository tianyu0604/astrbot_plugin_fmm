import { useState } from 'react';
import { Member, CustomField } from '../types/member';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';
import { Users, Calendar, TrendingUp, PieChart } from 'lucide-react';
import { BarChart, Bar, PieChart as RePieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ImagePreviewDialog } from './ImagePreviewDialog';

interface StatusAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: string;
  members: Member[];
  customFields: CustomField[];
}

const STATUS_COLORS = {
  '在职': { primary: '#16a34a', light: '#22c55e', bg: '#dcfce7' },
  '劝退': { primary: '#dc2626', light: '#ef4444', bg: '#fee2e2' },
  '光荣退休': { primary: '#2563eb', light: '#3b82f6', bg: '#dbeafe' },
};

const CHART_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

export function StatusAnalysisDialog({
  open,
  onOpenChange,
  status,
  members,
  customFields,
}: StatusAnalysisDialogProps) {
  const statusMembers = members.filter(m => m.data.status === status);
  const statusColor = STATUS_COLORS[status as keyof typeof STATUS_COLORS] || STATUS_COLORS['在职'];
  const [imagePreview, setImagePreview] = useState<{
    open: boolean;
    images: string[];
    initialIndex: number;
    title?: string;
  }>({ open: false, images: [], initialIndex: 0 });

  // Gender distribution
  const genderDistribution = [
    { name: '男', value: statusMembers.filter(m => m.data.gender === '男').length },
    { name: '女', value: statusMembers.filter(m => m.data.gender === '女').length },
    { name: '未知', value: statusMembers.filter(m => m.data.gender === '未知').length },
  ].filter(item => item.value > 0);

  // Join date analysis (if available)
  const joinDateField = customFields.find(f => f.name.includes('加入') && f.type === 'date');
  let joinTrend: { month: string; count: number }[] = [];

  if (joinDateField) {
    const monthCounts: Record<string, number> = {};
    statusMembers.forEach(member => {
      const dateValue = member.data[joinDateField.id];
      if (dateValue) {
        const date = new Date(dateValue);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;
      }
    });

    joinTrend = Object.entries(monthCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6) // Last 6 months
      .map(([month, count]) => ({ month, count }));
  }

  // Custom field analysis - for radio fields
  const radioFields = customFields.filter(f => f.type === 'radio' && !f.hidden);
  const fieldDistributions: Record<string, { name: string; data: { label: string; value: number }[] }> = {};

  radioFields.forEach(field => {
    const distribution: Record<string, number> = {};
    statusMembers.forEach(member => {
      const value = member.data[field.id]?.toString() || '未填写';
      distribution[value] = (distribution[value] || 0) + 1;
    });

    fieldDistributions[field.id] = {
      name: field.name,
      data: Object.entries(distribution).map(([label, value]) => ({ label, value })),
    };
  });

  // Average tenure (if join date and leave date are available)
  const leaveDateField = customFields.find(f => f.name.includes('离开') && f.type === 'date');
  let averageTenure = 0;
  let tenureCalculated = false;

  if (joinDateField && leaveDateField) {
    const tenures: number[] = [];
    statusMembers.forEach(member => {
      const joinDate = member.data[joinDateField.id];
      const leaveDate = member.data[leaveDateField.id];
      if (joinDate && leaveDate) {
        const days = Math.floor((new Date(leaveDate).getTime() - new Date(joinDate).getTime()) / (1000 * 60 * 60 * 24));
        if (days > 0) tenures.push(days);
      }
    });

    if (tenures.length > 0) {
      averageTenure = Math.floor(tenures.reduce((a, b) => a + b, 0) / tenures.length);
      tenureCalculated = true;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span style={{ color: statusColor.primary }}>{status}</span>
            <span>状态分析</span>
          </DialogTitle>
          <DialogDescription>
            深入分析 {status} 状态成员的数据统计和分布
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[calc(90vh-120px)]">
          <div className="space-y-6 pr-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    总人数
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl" style={{ color: statusColor.primary }}>
                    {statusMembers.length}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    占全部成员 {((statusMembers.length / members.length) * 100).toFixed(1)}%
                  </p>
                </CardContent>
              </Card>

              {tenureCalculated && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      平均在职时长
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl" style={{ color: statusColor.primary }}>
                      {averageTenure}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">天</p>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    性别分布
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {genderDistribution.map(item => (
                      <div key={item.name} className="flex justify-between text-sm">
                        <span>{item.name}</span>
                        <Badge variant="secondary">{item.value}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Gender Distribution Chart */}
            {genderDistribution.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PieChart className="h-4 w-4" />
                    性别分布图
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <RePieChart>
                      <Pie
                        data={genderDistribution}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {genderDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </RePieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Join Trend Chart */}
            {joinTrend.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    加入趋势（最近6个月）
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={joinTrend}>
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill={statusColor.primary} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Custom Fields Distribution */}
            {Object.keys(fieldDistributions).length > 0 && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h3 className="font-medium">自定义字段分布</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Object.entries(fieldDistributions).map(([fieldId, field]) => (
                      <Card key={fieldId}>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm">{field.name}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {field.data.map(item => {
                              const percentage = ((item.value / statusMembers.length) * 100).toFixed(1);
                              return (
                                <div key={item.label} className="space-y-1">
                                  <div className="flex justify-between text-sm">
                                    <span>{item.label}</span>
                                    <span className="text-muted-foreground">
                                      {item.value} ({percentage}%)
                                    </span>
                                  </div>
                                  <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                                    <div
                                      className="h-full rounded-full transition-all"
                                      style={{
                                        width: `${percentage}%`,
                                        backgroundColor: statusColor.light,
                                      }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Member List */}
            <Separator />
            <div className="space-y-3">
              <h3 className="font-medium">成员列表</h3>
              <div className="grid grid-cols-1 gap-2">
                {statusMembers.map(member => (
                  <div
                    key={member.id}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    {member.data.photo && (
                      <img
                        src={member.data.photo}
                        alt={member.data.name}
                        className="w-10 h-10 rounded-full object-cover cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setImagePreview({
                          open: true,
                          images: [member.data.photo!],
                          initialIndex: 0,
                          title: `${member.data.name} - 照片`,
                        })}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{member.data.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {member.data.gender}
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      style={{
                        backgroundColor: statusColor.bg,
                        color: statusColor.primary,
                      }}
                    >
                      {status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>

      {/* Image Preview Dialog */}
      <ImagePreviewDialog
        open={imagePreview.open}
        onOpenChange={(open) => setImagePreview({ ...imagePreview, open })}
        images={imagePreview.images}
        initialIndex={imagePreview.initialIndex}
        title={imagePreview.title}
      />
    </Dialog>
  );
}
