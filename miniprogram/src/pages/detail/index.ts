import type { Appointment } from '../../types';
import { api, errorMessage } from '../../utils/api';
import { consumeCompletedOperation, inspectCommand, newCommand, pendingCommand, sendCommand } from '../../utils/booking';
import { appointmentView, dateText } from '../../utils/format';
import { requireLogin, session } from '../../utils/session';
Page({
  data: { ownerId: '', id: '', loading: false, busy: false, error: '', success: false, successTitle: '', successMessage: '', appointment: null as ReturnType<typeof appointmentView> | null, events: [] as { id: string; label: string; reason: string | null; dateLabel: string; actorName: string }[], reason: '', cancelling: false, pending: false, changeAllowed: false },
  onLoad(options: Record<string, string | undefined>) { this.setData({ id: options.id ?? '', success: false, successTitle: '', successMessage: '' }); },
  onShow() {
    const ownerId = session()?.user.id ?? '';
    if (this.data.ownerId !== ownerId) this.setData({ ownerId, appointment: null, events: [], reason: '', cancelling: false, error: '', success: false, successTitle: '', successMessage: '', changeAllowed: false, loading: false, busy: false });
    if (requireLogin()) { this.showCompleted(this.data.id); this.setData({ pending: Boolean(pendingCommand()) }); void this.load(); }
  },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  showCompleted(id: string) {
    const completed = consumeCompletedOperation(id); if (!completed) { this.setData({ id }); return; }
    const messages = {
      confirm: { title: '预约已确认', message: '本次预约已保存，请按确认后的时间到诊。' },
      reschedule: { title: '预约改期成功', message: '新就诊安排已确认，原预约已改期，前后记录均会保留。' },
      cancel: { title: '预约已取消', message: '取消已确认，时段已释放，原预约与取消原因均会保留。' },
    };
    const message = messages[completed.kind];
    this.setData({ id, appointment: appointmentView(completed.appointment), events: [], success: true, successTitle: message.title,
      successMessage: message.message, cancelling: false, changeAllowed: false, error: '' });
  },
  async load() {
    if (!this.data.id) { this.setData({ error: '缺少预约编号，请从“我的预约”重新打开。' }); return; }
    const ownerId = session()?.user.id; if (!ownerId) return;
    const appointmentId = this.data.id;
    this.setData({ loading: true, error: '' });
    try { const item = await api<Appointment>('/appointments/' + encodeURIComponent(appointmentId)); if (session()?.user.id !== ownerId || this.data.ownerId !== ownerId || this.data.id !== appointmentId) return; const names: Record<string, string> = { confirmed: '预约确认', cancelled: '取消预约', rescheduled: '预约改期', created: '建立预约', replacement_confirmed: '改期后预约确认' }; this.setData({
      ...(this.data.success && this.data.appointment?.status !== item.status ? { success: false, successTitle: '', successMessage: '' } : {}),
      appointment: appointmentView(item), changeAllowed: item.status === 'confirmed' && Date.parse(item.startsAt) - Date.now() >= item.policy.cancellationNoticeMinutes * 60000, events: (item.events ?? []).map(event => ({ ...event, label: names[event.kind] ?? '预约记录变更', dateLabel: dateText(event.occurredAt) })) }); }
    catch (error) {
      if (this.data.ownerId !== ownerId || this.data.id !== appointmentId) return;
      if (session()?.user.id === ownerId) this.setData({ error: errorMessage(error),
        ...(!this.data.success || this.data.appointment?.id !== this.data.id ? { appointment: null, events: [] } : {}), changeAllowed: false });
      else if (!session()) this.setData({ error: errorMessage(error), appointment: null, events: [], success: false, successTitle: '', successMessage: '', changeAllowed: false });
    }
    finally { if (this.data.ownerId === ownerId && this.data.id === appointmentId) this.setData({ loading: false }); }
  },
  reasonInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ reason: event.detail.value }); },
  toggleCancel() { this.setData({ cancelling: !this.data.cancelling, reason: '', error: '' }); },
  async cancel() {
    const item = this.data.appointment; if (!item || this.data.loading || this.data.busy || this.data.pending || !this.data.changeAllowed) return;
    if (!this.data.reason.trim()) { this.setData({ error: '请填写取消原因，原预约记录会保留。' }); return; }
    this.setData({ busy: true, error: '', success: false, successTitle: '', successMessage: '' });
    try { const result = await sendCommand(newCommand('/appointments/' + encodeURIComponent(item.id) + '/changes', { intent: 'cancel', expectedVersion: item.rowVersion, reason: this.data.reason.trim() })); this.showCompleted(result.id); await this.load(); }
    catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ busy: false, pending: Boolean(pendingCommand()) }); }
  },
  reschedule() {
    const item = this.data.appointment; if (!item || this.data.loading || this.data.pending || !this.data.changeAllowed) return;
    wx.navigateTo({ url: '/pages/booking/index?appointmentId=' + encodeURIComponent(item.id) + '&version=' + item.rowVersion + '&clinicId=' + encodeURIComponent(item.clinicId) + '&serviceId=' + encodeURIComponent(item.serviceId) + '&doctorId=' + encodeURIComponent(item.doctorId) });
  },
  related(event: WechatMiniprogram.BaseEvent) { wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(String(event.currentTarget.dataset.id)) }); },
  async inspect() {
    if (this.data.busy) return; this.setData({ busy: true, error: '' });
    try { const result = await inspectCommand(); if (result) { this.showCompleted(result.id); await this.load(); } else this.setData({ error: '暂未查到已完成结果。请稍后核对，或使用原操作标识重试。' }); }
    catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ busy: false, pending: Boolean(pendingCommand()) }); }
  },
  async retry() {
    const command = pendingCommand(); if (!command || this.data.busy) return; this.setData({ busy: true, error: '' });
    try { const result = await sendCommand(command); this.showCompleted(result.id); await this.load(); }
    catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ busy: false, pending: Boolean(pendingCommand()) }); }
  },
  appointments() { wx.switchTab({ url: '/pages/appointments/index' }); }
});
