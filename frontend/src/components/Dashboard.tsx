import { useState, useEffect } from 'react';
import { Member } from '../types/member';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Users, UserCheck, UserX, UserMinus } from 'lucide-react';
import { getMembers, MemberInfo } from '../api/MemberAPI';
import { toast } from 'sonner';

interface DashboardProps {
  members?: Member[];
  onStatusClick?: (status: string) => void;
}

export function Dashboard({ members, onStatusClick }: DashboardProps) {
  const [apiMembers, setApiMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 如果外部传入了成员数据，则使用外部数据；否则从API获取
    if (members !== undefined) {
      setLoading(false);
    } else {
      fetchMembers();
    }
  }, [members]);

  const fetchMembers = async () => {
    try {
      setLoading(true);
      const response = await getMembers();
      if (response.code === 200) {
        setApiMembers(response.data);
      } else {
        toast.error(response.msg || '获取成员数据失败');
      }
    } catch (error) {
      console.error('获取成员数据失败:', error);
      toast.error('获取成员数据失败');
    } finally {
      setLoading(false);
    }
  };

  // 合并本地成员和API成员数据
  const allMembers = [
    ...(members || []).map(m => ({
      ...m.data,
      id: m.id,
      createTime: m.createdAt,
      updateTime: m.updatedAt
    })),
    ...apiMembers
  ];

  const stats = {
    total: allMembers.length,
    active: allMembers.filter(m => m.status === '在职').length,
    dismissed: allMembers.filter(m => m.status === '劝退').length,
    retired: allMembers.filter(m => m.status === '光荣退休').length,
  };

  const genderStats = {
    male: allMembers.filter(m => m.gender === '男').length,
    female: allMembers.filter(m => m.gender === '女').length,
    unknown: allMembers.filter(m => m.gender === '未知').length,
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card className="h-32">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle>总成员数</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col items-center justify-center h-16">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
            </div>
          ) : (
            <>
              <div className="text-2xl font-bold">{stats.total}</div>
              <p className="text-xs text-muted-foreground">
                男 {genderStats.male} / 女 {genderStats.female} / 未知 {genderStats.unknown}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card
        className="h-32 cursor-pointer transition-all hover:shadow-lg hover:scale-105"
        onClick={() => onStatusClick?.('在职')}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle>在职</CardTitle>
          <UserCheck className="h-4 w-4 text-green-600" />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col items-center justify-center h-16">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
            </div>
          ) : (
            <>
              <div className="text-2xl font-bold text-green-600">{stats.active}</div>
              <p className="text-xs text-muted-foreground">
                占比 {stats.total ? ((stats.active / stats.total) * 100).toFixed(1) : 0}%
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card
        className="h-32 cursor-pointer transition-all hover:shadow-lg hover:scale-105"
        onClick={() => onStatusClick?.('劝退')}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle>劝退</CardTitle>
          <UserX className="h-4 w-4 text-red-600" />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col items-center justify-center h-16">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
            </div>
          ) : (
            <>
              <div className="text-2xl font-bold text-red-600">{stats.dismissed}</div>
              <p className="text-xs text-muted-foreground">
                占比 {stats.total ? ((stats.dismissed / stats.total) * 100).toFixed(1) : 0}%
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card
        className="h-32 cursor-pointer transition-all hover:shadow-lg hover:scale-105"
        onClick={() => onStatusClick?.('光荣退休')}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle>光荣退休</CardTitle>
          <UserMinus className="h-4 w-4 text-blue-600" />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col items-center justify-center h-16">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
            </div>
          ) : (
            <>
              <div className="text-2xl font-bold text-blue-600">{stats.retired}</div>
              <p className="text-xs text-muted-foreground">
                占比 {stats.total ? ((stats.retired / stats.total) * 100).toFixed(1) : 0}%
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
