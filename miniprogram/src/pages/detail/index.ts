import type { Appointment } from '../../types';
import { api, errorMessage } from '../../utils/api';
import { inspectCommand, newCommand, pendingCommand, sendCommand } from '../../utils/booking';
import { appointmentView, dateText } from '../../utils/format';
import { requireLogin, session } from '../../utils/session';
Page({
  data: { ownerId: '', id: '', loading: false, busy: false, error: '', success: false, appointment: null as ReturnType<typeof appointmentView> | null, events: [] as { id: string; label: string; reason: string | null; dateLabel: string; actorName: string }[], reason: '', cancelling: false, pending: false, changeAllowed: false },
  onLoad(options: Record<string, string | undefined>) { this.setData({ id: options.id ?? '', success: options.success === '1' }); },
  onShow() {
    const ownerId = session()?.user.id ?? '';
    if (this.data.ownerId !== ownerId) this.setData({ ownerId, appointment: null, events: [], reason: '', cancelling: false, error: '', changeAllowed: false, loading: false, busy: false });
    if (requireLogin()) { this.setData({ pending: Boolean(pendingCommand()) }); void this.load(); }
  },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load() {
    if (!this.data.id) { this.setData({ error: '缺少预约编号，请从“我的预约”重新打开。' }); return; }
    const ownerId = session()?.user.id; if (!ownerId) return;
    this.setData({ loading: true, error: '' });
    try { const item = await api<Appointment>('/appointments/' + encodeURIComponent(this.data.id)); if (session()?.user.id !== ownerId || this.data.ownerId !== ownerId) return; const names: Record<string, string> = { confirmed: '预约确认', cancelled: '取消预约', rescheduled: '预约改期', created: '建立预约', replacement_confirmed: '改期后预约确认' }; this.setData({ appointment: appointmentView(item), changeAllowed: item.status === 'confirmed' && Date.parse(item.startsAt) - Date.now() >= item.policy.cancellationNoticeMinutes * 60000, events: (item.events ?? []).map(event => ({ ...event, label: names[event.kind] ?? '预约记录变更', dateLabel: dateText(event.occurredAt) })) }); }
    catch (error) { if (this.data.ownerId === ownerId) this.setData({ error: errorMessage(error), appointment: null, events: [], changeAllowed: false }); }
    finally { if (this.data.ownerId === ownerId) this.setData({ loading: false }); }
  },
  reasonInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ reason: event.detail.value }); },
  toggleCancel() { this.setData({ cancelling: !this.data.cancelling, reason: '', error: '' }); },
  async cancel() {
    const item = this.data.appointment; if (!item || this.data.busy || this.data.pending) return;
    if (!this.data.reason.trim()) { this.setData({ error: '请填写取消原因，原预约记录会保留。' }); return; }
    this.setData({ busy: true, error: '' });
    try { const result = await sendCommand(newCommand('/appointments/' + encodeURIComponent(item.id) + '/changes', { intent: 'cancel', expectedVersion: item.rowVersion, reason: this.data.reason.trim() })); this.setData({ appointment: appointmentView(result), success: false, cancelling: false }); wx.showToast({ title: '预约已取消', icon: 'success' }); await this.load(); }
    catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ busy: false, pending: Boolean(pendingCommand()) }); }
  },
  reschedule() {
    const item = this.data.appointment; if (!item || this.data.pending) return;
    wx.navigateTo({ url: '/pages/booking/index?appointmentId=' + encodeURIComponent(item.id) + '&version=' + item.rowVersion + '&clinicId=' + encodeURIComponent(item.clinicId) + '&serviceId=' + encodeURIComponent(item.serviceId) + '&doctorId=' + encodeURIComponent(item.doctorId) });
  },
  related(event: WechatMiniprogram.BaseEvent) { wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(String(event.currentTarget.dataset.id)) }); },
  async inspect() {
    if (this.data.busy) return; this.setData({ busy: true, error: '' });
    try { const result = await inspectCommand(); if (result) { this.setData({ id: result.id, success: result.status === 'confirmed' }); await this.load(); } else this.setData({ error: '暂未查到已完成结果。请稍后核对，或使用原操作标识重试。' }); }
    catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ busy: false, pending: Boolean(pendingCommand()) }); }
  },
  async retry() {
    const command = pendingCommand(); if (!command || this.data.busy) return; this.setData({ busy: true, error: '' });
    try { const result = await sendCommand(command); this.setData({ id: result.id, cancelling: false, success: result.status === 'confirmed' }); await this.load(); }
    catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ busy: false, pending: Boolean(pendingCommand()) }); }
  },
  appointments() { wx.switchTab({ url: '/pages/appointments/index' }); }
});
