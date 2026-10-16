import { useCallback, useEffect, useState } from 'react';
import { Bell, Check, ClipboardList, Download, FileSpreadsheet, History, LogOut, RefreshCw, Settings, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, PluginState, Run } from './api/PluginAPI';
import { MemberArchives } from './components/MemberArchives';
import { ExportRoster } from './components/ExportRoster';
import { TaskManagement } from './components/TaskManagement';
import { FieldManagement } from './components/FieldManagement';
import { GroupReminders } from './components/GroupReminders';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './components/ui/dialog';
import { Toaster } from './components/ui/sonner';
import './plugin.css';

const tabs = [
  { id: 'members', label: '成员档案', icon: Users },
  { id: 'fields', label: '字段管理', icon: Settings },
  { id: 'export', label: '花名册导出', icon: FileSpreadsheet },
  { id: 'tasks', label: '任务管理', icon: ClipboardList },
  { id: 'reminders', label: '群提醒', icon: Bell },
  { id: 'logs', label: '发送记录', icon: History },
];
const statuses: Record<Run['status'], string> = { sent: '已发送', failed: '发送失败', unknown: '结果待确认', sending: '发送中', skipped: '已跳过' };
const noop = () => {};

export default function App() {
  const [state, setState] = useState<PluginState | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [tab, setTab] = useState('members');
  const [memberVersion, setMemberVersion] = useState(0);
  const [resolving, setResolving] = useState<{ log: Run; action: 'sent' | 'skipped' } | null>(null);
  const [dirty, setDirty] = useState(false);
  const refresh = useCallback(async () => {
    const data = await api<PluginState>('/state');
    setState(data);
    setAuthenticated(true);
    setError('');
  }, []);
  useEffect(() => {
    refresh().catch(err => {
      if (!(err instanceof ApiError && err.status === 401)) setError(err.message);
    }).finally(() => setLoading(false));
    const expired = () => { setAuthenticated(false); setState(null); };
    window.addEventListener('fmm-session-expired', expired);
    return () => window.removeEventListener('fmm-session-expired', expired);
  }, [refresh]);
  useEffect(() => {
    if (!authenticated) return;
    const id = setInterval(() => refresh().catch(err => setError(err.message)), 15000);
    return () => clearInterval(id);
  }, [authenticated, refresh]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  const work = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); }
    catch (err) { toast.error(err instanceof Error ? err.message : '操作失败'); }
    finally { setBusy(false); }
  };
  const changeTab = (id: string) => {
    if (dirty && !window.confirm('档案字段有未保存的更改，确定放弃？')) return;
    setDirty(false);
    setTab(id);
  };
  if (loading) return <div className="plugin-loading">加载中...</div>;
  if (!authenticated || !state) return <div className="plugin-login">
    <form onSubmit={event => {
      event.preventDefault();
      work(async () => { await api('/login', 'POST', { password }); setPassword(''); await refresh(); });
    }}>
      <Users className="h-8 w-8" />
      <h1>成员档案管理系统</h1>
      <p className="text-sm text-muted-foreground">管理员登录</p>
      <Label htmlFor="admin-password">管理密码</Label>
      <Input id="admin-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
      {error && <p role="alert" className="inline-error">{error}</p>}
      <Button disabled={busy}>{busy ? '登录中' : '登录'}</Button>
    </form><Toaster richColors />
  </div>;
  return <div className="original-app">
    <header className="original-header">
      <div className="original-container header-inner">
        <div className="original-brand"><Users className="h-7 w-7" /><h1>成员档案管理系统</h1></div>
        <div className="header-tools">
          <Button asChild variant="ghost" size="icon" title="备份数据库"><a href="/api/v1/fmm/backup" aria-label="备份数据库"><Download /></a></Button>
          <Button variant="ghost" size="icon" title="刷新" aria-label="刷新" disabled={busy} onClick={() => work(async () => { await refresh(); setMemberVersion(v => v + 1); })}><RefreshCw /></Button>
          <Button variant="ghost" size="icon" title="退出登录" aria-label="退出登录" onClick={() => work(async () => {
            if (dirty && !window.confirm('字段有未保存的更改，确定退出？')) return;
            await api('/logout', 'POST', {}); setDirty(false); setAuthenticated(false); setState(null);
          })}><LogOut /></Button>
        </div>
      </div>
    </header>
    <main className="original-container original-main">
      {error && <div className="fmm-alert" role="alert">{error}</div>}
      <Tabs value={tab} onValueChange={changeTab}>
        <div className="original-tabs-scroll"><TabsList className="original-tabs" aria-label="主导航">
          {tabs.map(item => <TabsTrigger key={item.id} value={item.id}><item.icon />{item.label}
            {item.id === 'logs' && state.logs.some(log => ['unknown', 'failed'].includes(log.status)) && <span className="nav-dot" />}
          </TabsTrigger>)}
        </TabsList></div>
        <TabsContent value="members"><MemberArchives key={memberVersion} members={[]} customFields={state.fields} history={[]}
          onAddMember={noop} onBatchAddMembers={noop} onUpdateMember={noop} onMembersChanged={refresh} /></TabsContent>
        <TabsContent value="fields"><FieldManagement onUpdateFields={fields => setState(current => current ? { ...current, fields } : current)} onHasChangesChange={setDirty} /></TabsContent>
        <TabsContent value="export"><ExportRoster members={state.members} customFields={state.fields} /></TabsContent>
        <TabsContent value="tasks"><TaskManagement members={state.members} /></TabsContent>
        <TabsContent value="reminders"><GroupReminders state={state} refresh={refresh} /></TabsContent>
        <TabsContent value="logs">
          <div className="fmm-section-heading"><div><h2>发送记录</h2><span className="muted">最近 200 条 · 北京时间</span></div></div>
          <div className="table-scroll"><table className="fmm-table log-table"><thead><tr><th>时间 / 排班</th><th>群号 / 提醒人员</th><th>状态</th><th>详情</th></tr></thead><tbody>
            {state.logs.map(log => <tr key={log.id}>
              <td>{new Date(log.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}<small>{log.snapshot.rule.name} {log.kind === 'test' ? '· 测试' : ''}</small></td>
              <td>{log.snapshot.rule.group_id}<small>{log.snapshot.members.map(m => m.data.name).join('、')}</small></td>
              <td><span className={`status ${log.status === 'sent' ? 'success' : ['failed', 'unknown'].includes(log.status) ? 'warning' : 'neutral'}`}>{statuses[log.status]}</span></td>
              <td>{log.error && <p className="log-error">{log.error}</p>}{log.message_id && <small>消息 {log.message_id}</small>}
                {['failed', 'unknown'].includes(log.status) && <div className="action-row">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setResolving({ log, action: 'sent' })}><Check />确认已发送</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setResolving({ log, action: 'skipped' })}>跳过本次</Button>
                </div>}
              </td>
            </tr>)}
          </tbody></table>{!state.logs.length && <div className="fmm-empty"><History /><h3>暂无发送记录</h3></div>}</div>
        </TabsContent>
      </Tabs>
    </main>
    <Dialog open={!!resolving} onOpenChange={open => { if (!open && !busy) setResolving(null); }}><DialogContent><DialogHeader>
      <DialogTitle>处理发送记录</DialogTitle><DialogDescription>{resolving?.action === 'sent' ? '请先核对 QQ 群消息。确认已发送会推进正式排班的轮换位置。' : '本次不再发送，正式排班保留原轮换位置。'}</DialogDescription>
    </DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setResolving(null)}>取消</Button><Button disabled={busy} onClick={() => work(async () => {
      if (!resolving) return;
      await api(`/runs/${resolving.log.id}/resolve`, 'POST', { action: resolving.action });
      setResolving(null); await refresh(); toast.success('操作已完成');
    })}>{busy ? '处理中' : '确认'}</Button></DialogFooter></DialogContent></Dialog>
    <Toaster richColors />
  </div>;
}
