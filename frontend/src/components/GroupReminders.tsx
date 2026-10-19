import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Bell, CalendarDays, Check, Clock3, Edit3, Plus, RefreshCw, Send, Trash2, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, PluginState, Rule } from '../api/PluginAPI';
import { getSyncGroups, SyncGroup } from '../api/MemberSyncAPI';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

const DAYS = ['一', '二', '三', '四', '五', '六', '日'];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const blankRule = (platform: string): Rule => ({ id: '', name: '', platform_id: platform,
  group_id: '', time: '09:00', weekdays: [0, 1, 2, 3, 4, 5, 6], pool: [], count: 1,
  start_date: today(), message: '今天由 {names} 负责值班，请按时完成。', enabled: false, cursor: 0, revision: 0 });

export function GroupReminders({ state, refresh }: { state: PluginState; refresh: () => Promise<void> }) {
  const [draft, setDraft] = useState<Rule | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ rule: Rule; action: 'test' | 'delete' } | null>(null);
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SyncGroup[]>([]);
  const [groupsNote, setGroupsNote] = useState('');
  const loadGroups = useCallback(async (platformId?: string) => {
    try {
      const res = await getSyncGroups(platformId);
      setGroups(res.groups || []);
      setGroupsNote('');
    } catch (error) {
      setGroups([]);
      setGroupsNote(error instanceof Error ? error.message : '读取群列表失败');
    }
  }, []);
  useEffect(() => { void loadGroups(); }, [loadGroups]);
  useEffect(() => { if (draft) void loadGroups(draft.platform_id || undefined); }, [draft?.id, draft?.platform_id, loadGroups]);
  const groupName = (id: string) => groups.find(g => g.id === id)?.name || '';
  const platformName = (id: string) => state.platforms.find(p => p.id === id)?.name || id;
  const groupHint = (rule: Rule) => {
    if (!rule.group_id) return groups.length ? '下拉里是机器人已加入的群，带群名和人数' : (groupsNote || '填机器人要发消息的那个群号');
    const picked = groups.find(g => g.id === rule.group_id);
    if (groups.length && !picked) return `列表里没有 ${rule.group_id}，可能机器人不在这个群里了`;
    const used = state.rules.filter(r => r.group_id === rule.group_id && r.id !== rule.id).length;
    return [picked?.name || `群 ${rule.group_id}`, picked?.count ? `${picked.count} 人` : '', used ? `该群已有 ${used} 条排班` : '该群暂无排班'].filter(Boolean).join(' · ');
  };
  const active = state.members.filter(m => m.data.status === '在职');
  const names = new Map(state.members.map(m => [m.id, m.data.name]));
  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await work(); await refresh(); toast.success(success); }
    catch (error) { await refresh().catch(() => {}); toast.error(error instanceof Error ? error.message : '操作失败'); }
    finally { setBusy(false); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    await run(async () => {
      await api(`/rules${draft.id ? '/' + draft.id : ''}`, draft.id ? 'PUT' : 'POST', draft);
      setDraft(null);
    }, '排班已保存');
  };
  const move = (index: number, delta: number) => {
    if (!draft || index + delta < 0 || index + delta >= draft.pool.length) return;
    const pool = [...draft.pool];
    [pool[index], pool[index + delta]] = [pool[index + delta], pool[index]];
    setDraft({ ...draft, pool });
  };
  const filtered = state.rules.filter(r => `${r.name} ${r.group_id}`.includes(query));
  return <section>
    <div className="fmm-section-heading"><div><h2>群提醒</h2><span className="muted">{state.rules.length} 条排班 · {state.rules.filter(r => r.enabled).length} 条已启用</span></div>
      <button className="action primary" onClick={() => setDraft(blankRule(state.platforms[0]?.id || ''))}><Plus size={16} />新增排班</button></div>
    <div className="fmm-filter"><input aria-label="搜索排班" placeholder="搜索排班名称或群号" value={query} onChange={e => setQuery(e.target.value)} /><span className="muted"><Clock3 size={14} />北京时间</span></div>
    {filtered.length === 0 ? <div className="fmm-empty"><CalendarDays size={32} /><h3>{query ? '没有匹配的排班' : '暂无排班'}</h3><span className="muted">{active.length ? '尚无排班记录' : '尚无在职成员'}</span></div> :
      <div className="rule-list">{filtered.map(rule => <article className="rule-item" key={rule.id}>
        <div className="rule-main"><div className="rule-icon"><Bell size={20} /></div><div className="rule-title"><h3>{rule.name}</h3><span className="muted" title={`群 ${rule.group_id} · ${rule.platform_id}`}>群 {groupName(rule.group_id) ? `${groupName(rule.group_id)}（${rule.group_id}）` : rule.group_id} · {platformName(rule.platform_id)}</span></div>
          <label className="fmm-toggle" title={rule.enabled ? '暂停排班' : '启用排班'}><input type="checkbox" role="switch" aria-label={`${rule.name}启用状态`} checked={rule.enabled} disabled={busy || rule.blocked} onChange={() => run(() => api(`/rules/${rule.id}`, 'PUT', { ...rule, enabled: !rule.enabled }), rule.enabled ? '排班已暂停' : '排班已启用')} /><span /></label></div>
        <div className="rule-facts"><span><Clock3 size={15} /><strong>{rule.time}</strong></span><span><CalendarDays size={15} />{rule.weekdays.length === 7 ? '每天' : rule.weekdays.map(d => '周' + DAYS[d]).join('、')}</span><span><Users size={15} />每次 {rule.count} 人 / 池内 {rule.pool.length} 人</span></div>
        <div className="rule-next"><span className="muted">下一轮</span><strong>{rule.next_members?.join('、') || '暂无可用人员'}</strong>{rule.blocked && <span className="status warning">待处理发送记录</span>}{!rule.enabled && <span className="status neutral">已暂停</span>}</div>
        {rule.selection_error && <p className="inline-error">{rule.selection_error}</p>}
        <div className="pool-preview">{rule.pool.map((id, i) => <span key={id} className={i === rule.cursor ? 'next-person' : ''}><small>{i + 1}</small>{names.get(id) || '成员已移除'}</span>)}</div>
        {rule.message && <p className="rule-message">{rule.message}</p>}
        <footer><span className="muted">自 {rule.start_date} 起</span><div className="action-row"><button className="action" disabled={busy} onClick={() => setConfirm({ rule, action: 'test' })}><Send size={14} />测试发送</button><button className="icon-action" title="编辑排班" aria-label={`编辑${rule.name}`} disabled={busy || rule.blocked} onClick={() => setDraft({ ...rule })}><Edit3 size={16} /></button><button className="icon-action danger" title="删除排班" aria-label={`删除${rule.name}`} disabled={busy || rule.blocked} onClick={() => setConfirm({ rule, action: 'delete' })}><Trash2 size={16} /></button></div></footer>
      </article>)}</div>}
    <Dialog open={draft !== null} onOpenChange={open => { if (!open && !busy) setDraft(null); }}><DialogContent className="fmm-modal rule-modal"><DialogHeader><DialogTitle>{draft?.id ? '编辑排班' : '新增排班'}</DialogTitle><DialogDescription>排班与人员池</DialogDescription></DialogHeader>
      {draft && <form onSubmit={save} className="rule-form"><div className="form-grid">
        <label>排班名称<input required maxLength={50} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>机器人账号<select required value={draft.platform_id} onChange={e => setDraft({ ...draft, platform_id: e.target.value })}><option value="">选择账号</option>{state.platforms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>目标 QQ 群<div className="group-picker">{groups.length === 0
          ? <input required inputMode="numeric" pattern="[1-9][0-9]{4,11}" maxLength={12} value={draft.group_id} placeholder={groupsNote ? '读不到群列表，手动填群号' : '群号'} onChange={e => setDraft({ ...draft, group_id: e.target.value })} />
          : <select required value={draft.group_id} onChange={e => setDraft({ ...draft, group_id: e.target.value })}><option value="">选择群</option>{draft.group_id && !groupName(draft.group_id) && <option value={draft.group_id}>群 {draft.group_id}（不在列表里）</option>}{groups.map(g => <option key={g.id} value={g.id}>{g.name || '（未命名群）'} · {g.id}{g.count ? ` · ${g.count} 人` : ''}</option>)}</select>}
          <button type="button" className="icon-action" title="重新读取群列表" aria-label="重新读取群列表" onClick={() => loadGroups(draft.platform_id || undefined)}><RefreshCw size={14} /></button>
        </div><span className="muted group-preview">{groupHint(draft)}</span></label>
        <label>提醒时间<input required type="time" value={draft.time} onChange={e => setDraft({ ...draft, time: e.target.value })} /></label>
        <label>开始日期<input required type="date" value={draft.start_date} onChange={e => setDraft({ ...draft, start_date: e.target.value })} /></label>
        <label>每次提醒人数<input required type="number" min={1} max={Math.max(1, draft.pool.length)} value={draft.count} onChange={e => setDraft({ ...draft, count: Number(e.target.value) })} /></label>
      </div><fieldset><legend>执行星期</legend><div className="weekday-options">{DAYS.map((d, i) => <label key={d}><input type="checkbox" checked={draft.weekdays.includes(i)} onChange={() => setDraft({ ...draft, weekdays: draft.weekdays.includes(i) ? draft.weekdays.filter(n => n !== i) : [...draft.weekdays, i] })} /><span>周{d}</span></label>)}</div></fieldset>
        <fieldset><legend>人员池 <span className="muted">{draft.pool.length} 人</span></legend><div className="pool-editor"><div className="pool-choices">{active.length === 0 && <span className="muted">暂无在职成员</span>}{active.map(member => <label key={member.id}><input type="checkbox" checked={draft.pool.includes(member.id)} onChange={() => setDraft({ ...draft, pool: draft.pool.includes(member.id) ? draft.pool.filter(id => id !== member.id) : [...draft.pool, member.id] })} /><span>{member.data.name}<small>{member.data.qq}</small></span></label>)}</div>
          <ol className="pool-order">{draft.pool.map((id, index) => <li key={id}><span className="pool-number">{index + 1}</span><span>{names.get(id) || '未找到成员'}</span><div className="action-row"><button type="button" className="icon-action" title="上移" aria-label={`上移${names.get(id)}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></button><button type="button" className="icon-action" title="下移" aria-label={`下移${names.get(id)}`} disabled={index === draft.pool.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></button><button type="button" className="icon-action" title="移出人员池" aria-label={`移除${names.get(id)}`} onClick={() => setDraft({ ...draft, pool: draft.pool.filter(m => m !== id) })}><X size={14} /></button></div></li>)}</ol></div></fieldset>
        <label>附加文案<textarea maxLength={2000} rows={3} value={draft.message} onChange={e => setDraft({ ...draft, message: e.target.value })} /></label>
        <div className="template-tokens">{['{date}', '{names}', '{schedule}'].map((token, i) => <button type="button" className="action" key={token} title={`插入${['日期', '当班人', '排班名称'][i]}`} onClick={() => setDraft({ ...draft, message: draft.message + token })}><Plus size={12} />{['日期', '当班人', '排班名称'][i]}</button>)}</div>
        <div className="modal-footer"><label className="check-label"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />启用排班</label><button className="action primary" disabled={busy || draft.pool.length === 0 || draft.weekdays.length === 0}><Check size={16} />{busy ? '保存中' : '保存排班'}</button></div>
      </form>}
    </DialogContent></Dialog>
    <Dialog open={!!confirm} onOpenChange={open => { if (!open && !busy) setConfirm(null); }}><DialogContent className="fmm-modal"><DialogHeader><DialogTitle>{confirm?.action === 'test' ? '测试发送' : '删除排班'}</DialogTitle><DialogDescription>{confirm?.action === 'test' ? `即将向 QQ 群 ${confirm.rule.group_id} 发送真实测试消息并 @ 下一轮人员，不推进轮换。` : `确定删除“${confirm?.rule.name}”？发送历史将保留。`}</DialogDescription></DialogHeader><div className="modal-footer"><button className="action" disabled={busy} onClick={() => setConfirm(null)}>取消</button><button className="action primary" disabled={busy} onClick={() => confirm && run(async () => { if (confirm.action === 'test') { const log = await api<{ status: string; error: string }>(`/rules/${confirm.rule.id}/test`, 'POST', {}); if (log.status !== 'sent') throw new Error(log.error); } else await api(`/rules/${confirm.rule.id}`, 'DELETE', {}); setConfirm(null); }, confirm.action === 'test' ? '测试消息已发送' : '排班已删除')}>{busy ? '处理中' : '确认'}</button></div></DialogContent></Dialog>
  </section>;
}
