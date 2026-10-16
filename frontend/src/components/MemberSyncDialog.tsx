import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle, RefreshCw, UserMinus, UserPlus, UserCog, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Separator } from './ui/separator';
import {
  applyMemberSync, getSyncGroups, previewMemberSync,
  DepartedAction, SyncApiError, SyncChange, SyncGroup, SyncPlan, SyncResult,
} from '../api/MemberSyncAPI';

interface MemberSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSynced?: () => void | Promise<void>;
}

function Avatar({ src, name }: { src?: string; name: string }) {
  if (!src) {
    return <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs text-muted-foreground shrink-0">
      {name.slice(0, 1)}
    </div>;
  }
  return <img src={src} alt={name} loading="lazy" className="h-8 w-8 rounded-full object-cover bg-muted shrink-0" />;
}

function SuiteRow({ item, detail }: { item: { qq: string; name: string; cls?: string; avatar?: string }; detail?: string }) {
  return <div className="sync-row flex items-center gap-3 py-2 border-b border-dashed">
    <Avatar src={item.avatar} name={item.name} />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="font-medium truncate">{item.name}</span>
        {item.cls && <Badge variant="secondary" className="shrink-0">{item.cls}</Badge>}
      </div>
      <div className="text-xs text-muted-foreground truncate">{detail || `QQ ${item.qq}`}</div>
    </div>
  </div>;
}

function Section({ icon: Icon, title, count, children, empty }: {
  icon: typeof UserPlus; title: string; count: number; children?: ReactNode; empty?: boolean;
}) {
  return <div className="border rounded-lg overflow-hidden">
    <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
      <div className="flex items-center gap-2 font-medium"><Icon className="h-4 w-4" />{title}</div>
      <span className="text-sm text-muted-foreground">{count} 人</span>
    </div>
    {empty ? <div className="px-3 py-3 text-sm text-muted-foreground">没有</div>
      : <div className="sync-list px-3">{children}</div>}
  </div>;
}

export function MemberSyncDialog({ open, onOpenChange, onSynced }: MemberSyncDialogProps) {
  const [groups, setGroups] = useState<SyncGroup[]>([]);
  const [selected, setSelected] = useState('');
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [departedAction, setDepartedAction] = useState<DepartedAction>('retire');
  const [refreshPhotos, setRefreshPhotos] = useState(false);
  const [force, setForce] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (groupId?: string) => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const list = await getSyncGroups();
      const target = groupId || (list.default && list.groups.some(g => g.id === list.default) ? list.default : list.groups[0]?.id);
      setGroups(list.groups);
      if (!target) {
        setPlan(null);
        setError('这个机器人账号还没有加入任何 QQ 群。');
        return;
      }
      setSelected(target);
      setPlan(await previewMemberSync(target));
    } catch (err) {
      setPlan(null);
      setError(err instanceof Error ? err.message : '读取群成员失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setNote('');
    setForce(false);
    setDepartedAction('retire');
    setRefreshPhotos(false);
    load();
  }, [open, load]);

  const changeGroup = async (groupId: string) => {
    setSelected(groupId);
    setNote('');
    setForce(false);
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setPlan(await previewMemberSync(groupId));
    } catch (err) {
      setPlan(null);
      setError(err instanceof Error ? err.message : '读取群成员失败');
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const outcome = await applyMemberSync({
        group_id: plan.group_id,
        fingerprint: plan.fingerprint,
        departed: departedAction,
        refresh_photos: refreshPhotos,
        force,
      });
      setResult(outcome);
      setNote('');
      await onSynced?.();
      toast.success(`同步完成：新增 ${outcome.added} · 修改 ${outcome.changed} · 退群处理 ${outcome.departed}`);
    } catch (err) {
      if (err instanceof SyncApiError && err.plan) {
        setPlan(err.plan);
        setForce(false);
        setNote(err.message);
      } else {
        setError(err instanceof Error ? err.message : '同步失败');
      }
    } finally {
      setBusy(false);
    }
  };

  const total = plan ? plan.added.length + plan.changed.length + plan.departed.length : 0;
  const nothingToDo = total === 0;
  const blockedByForce = !!plan?.suspicious && !force;

  const close = (next: boolean) => { if (!busy) onOpenChange(next); };

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent className="sync-dialog">
      <DialogHeader className="sync-header">
        <DialogTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5" />同步群成员</DialogTitle>
        <DialogDescription>
          读取 QQ 群成员与现有档案比对，确认之后才写入。预览不改动任何数据。
        </DialogDescription>
      </DialogHeader>

      <div className="sync-body">
        <div className="space-y-3 pb-2">
          <div className="flex flex-wrap items-center gap-3">
            <Label htmlFor="sync-group" className="shrink-0">同步哪个群</Label>
            <Select value={selected || undefined} onValueChange={changeGroup} disabled={loading || busy || !groups.length}>
              <SelectTrigger id="sync-group" className="min-w-0 flex-1 overflow-hidden"><SelectValue placeholder="选择 QQ 群" /></SelectTrigger>
              <SelectContent>
                {groups.map(group => <SelectItem key={group.id} value={group.id}>
                  {group.name}（{group.id}）
                </SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" className="gap-2 shrink-0" disabled={loading || busy} onClick={() => load(selected)}>
              <RefreshCw className="h-4 w-4" />重新读取
            </Button>
          </div>

          {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>读不到群成员</AlertTitle>
            <AlertDescription>{error}</AlertDescription></Alert>}
          {note && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>群成员刚刚有变化</AlertTitle>
            <AlertDescription>{note}下面是重新算出来的差异。</AlertDescription></Alert>}

          {loading && <div className="py-8 text-center text-sm text-muted-foreground">正在对比群成员和现有档案...</div>}

          {!loading && result && <>
            <Alert className="border-green-200 bg-green-50 text-green-900">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertTitle>同步完成</AlertTitle>
              <AlertDescription className="text-green-800">
                新增 {result.added} · 修改 {result.changed} · 退群处理 {result.departed} · 下载头像 {result.photos} 张。
                同步后再对比：新增 {result.left.added} · 修改 {result.left.changed} · 退群 {result.left.departed}
                · 无变化 {result.left.unchanged}{result.left.retired_absent > 0 && ` · 已标记退休 ${result.left.retired_absent}`}。
              </AlertDescription>
            </Alert>
            {!!result.failed.length && <Alert variant="destructive"><AlertCircle className="h-4 w-4" />
              <AlertTitle>{result.failed.length} 项没成功</AlertTitle>
              <AlertDescription>{result.failed.slice(0, 8).map(item => `${item.qq}（${item.why}）`).join('；')}</AlertDescription>
            </Alert>}
            {!!result.done.added.length && <Section icon={UserPlus} title="已新增" count={result.done.added.length}>
              {result.done.added.map(item => <SuiteRow key={item.qq} item={item} />)}
            </Section>}
            {!!result.done.changed.length && <Section icon={UserCog} title="已修改" count={result.done.changed.length}>
              {result.done.changed.map(item => <SuiteRow key={item.qq} item={item} />)}
            </Section>}
            {!!result.done.departed.length && <Section icon={UserMinus} title="已处理的退群" count={result.done.departed.length}>
              {result.done.departed.map(item => <SuiteRow key={item.qq} item={item} detail={item.action} />)}
            </Section>}
          </>}

          {!loading && !result && plan && <>
            <div className="text-sm text-muted-foreground">
              群：{plan.group_name || '（未命名）'}（{plan.group_id}）· 群成员 {plan.group_member_count} 人
              · 现有档案 {plan.profile_count} 人
            </div>

            {plan.suspicious && <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>退群人数异常多</AlertTitle>
              <AlertDescription>
                这次要退群的人数占了现有档案的一半以上，先确认群号有没有选错。确认无误请勾选下面的确认项。
              </AlertDescription>
            </Alert>}
            {!plan.class_field && <Alert><AlertCircle className="h-4 w-4" />
              <AlertTitle>找不到班级字段</AlertTitle>
              <AlertDescription>没有名为「专业班级」的自定义字段，群名片里的班级这次不会写入。</AlertDescription>
            </Alert>}

            {nothingToDo
              ? <Alert className="border-green-200 bg-green-50 text-green-900"><CheckCircle className="h-4 w-4 text-green-600" />
                <AlertTitle>档案和群成员已经一致</AlertTitle>
                <AlertDescription className="text-green-800">
                  无变化 {plan.unchanged} 人{plan.retired_absent_count > 0 && `，另有 ${plan.retired_absent_count} 人已退群并标记过`}，没有需要同步的内容。
                </AlertDescription>
              </Alert>
              : <>
                {!!plan.added.length && <Section icon={UserPlus} title="新增（群里有、档案里没有）" count={plan.added.length}>
                  {plan.added.map(item => <SuiteRow key={item.qq} item={item}
                    detail={item.nickname && item.nickname !== item.name ? `QQ 昵称 ${item.nickname}` : `QQ ${item.qq}`} />)}
                </Section>}

                {!!plan.changed.length && <Section icon={UserCog} title="修改（资料对不上）" count={plan.changed.length}>
                  {plan.changed.map(item => <SuiteRow key={item.qq} item={item}
                    detail={item.changes.map((change: SyncChange) => `${change.field}：${change.old || '空'} → ${change.new}`).join('　')} />)}
                </Section>}

                {!!plan.departed.length && <>
                  <Section icon={UserMinus} title="退群（档案里有、群里已经不在）" count={plan.departed.length}>
                    {plan.departed.map(item => <SuiteRow key={item.qq} item={item}
                      detail={item.status ? `当前状态 ${item.status}` : `QQ ${item.qq}`} />)}
                  </Section>
                  <div className="space-y-2">
                    <Label>这些人的档案怎么处理</Label>
                    <RadioGroup value={departedAction} onValueChange={value => setDepartedAction(value as DepartedAction)} disabled={busy}>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="retire" id="sync-retire" />
                        <Label htmlFor="sync-retire" className="sync-label">标记为「光荣退休」，保留档案（推荐）</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="delete" id="sync-delete" />
                        <Label htmlFor="sync-delete" className="sync-label">直接删除档案（不可撤销）</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="keep" id="sync-keep" />
                        <Label htmlFor="sync-keep" className="sync-label">这次不处理</Label>
                      </div>
                    </RadioGroup>
                  </div>
                </>}

                <Separator />
                <div className="flex items-center gap-2">
                  <Checkbox id="sync-photos" checked={refreshPhotos} disabled={busy}
                    onCheckedChange={checked => setRefreshPhotos(checked === true)} />
                  <Label htmlFor="sync-photos" className="sync-label text-sm">
                    重新下载所有人的头像（默认只处理新增和资料变动的人）
                  </Label>
                </div>
              </>}

            {!!(plan.unchanged || plan.skipped.length || plan.retired_absent_count) && <div className="text-xs text-muted-foreground space-y-1">
              <div>无变化 {plan.unchanged} 人
                {plan.retired_absent_count > 0 && `，已退群并标记过 ${plan.retired_absent_count} 人（不再重复处理）`}
                {!!plan.skipped.length && `，跳过 ${plan.skipped.length} 人`}</div>
              {plan.skipped.map(item => <div key={item.qq}>跳过 {item.qq}：{item.reason}</div>)}
            </div>}

            {plan.suspicious && <div className="flex items-center gap-2">
              <Checkbox id="sync-force" checked={force} disabled={busy}
                onCheckedChange={checked => setForce(checked === true)} />
              <Label htmlFor="sync-force" className="sync-label text-sm">我确认群号没选错，就按上面这个差异同步</Label>
            </div>}
          </>}
        </div>
      </div>

      <DialogFooter className="sync-footer">
        <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{result ? '关闭' : '取消'}</Button>
        {!result && <Button disabled={busy || loading || !plan || nothingToDo || blockedByForce} onClick={submit}>
          {busy ? '同步中...' : nothingToDo ? '无需同步' : '确认同步'}
        </Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
