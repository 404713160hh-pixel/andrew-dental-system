import type { Patient } from '../../types';
import { api, errorMessage } from '../../utils/api';
import { getHold, inspectCommand, newCommand, openAppointment, pendingCommand, sendCommand } from '../../utils/booking';
import { allergyLabels, dateText, timeText, price, profileError } from '../../utils/format';
import { requireLogin, session } from '../../utils/session';
let timer: number | undefined;
Page({
  data: { ownerId: '', loading: false, busy: false, error: '', patient: null as Patient | null, context: getHold(), dateLabel: '', endLabel: '', priceLabel: '', allergyLabel: '', remaining: '', expired: true, patientConfirmed: false, rulesAccepted: false, reason: '', pending: false },
  onShow() {
    const ownerId = session()?.user.id ?? '';
    if (this.data.ownerId !== ownerId) this.setData({ ownerId, patient: null, context: null, patientConfirmed: false, rulesAccepted: false, reason: '', error: '', expired: true, loading: false, busy: false });
    if (!requireLogin()) return;
    const context = getHold(); this.setData({ context, pending: Boolean(pendingCommand()) });
    if (context) { this.setData({ dateLabel: dateText(context.hold.slot.startsAt), endLabel: timeText(context.hold.slot.endsAt), priceLabel: price(context.hold.slot.priceCents) }); this.tick(); timer = setInterval(() => this.tick(), 1000); }
    void this.loadPatient();
  },
  onHide() { if (timer !== undefined) clearInterval(timer); timer = undefined; },
  onUnload() { if (timer !== undefined) clearInterval(timer); timer = undefined; },
  tick() {
    const seconds = Math.max(0, Math.ceil((Date.parse(this.data.context?.hold.expiresAt ?? '') - Date.now()) / 1000)) || 0;
    this.setData({ remaining: Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'), expired: seconds === 0 });
  },
  async loadPatient() {
    const ownerId = session()?.user.id; if (!ownerId) return;
    this.setData({ loading: true, error: '' });
    try { const patient = await api<Patient>('/patients/me'); if (session()?.user.id === ownerId && this.data.ownerId === ownerId) this.setData({ patient, allergyLabel: allergyLabels[patient.allergyStatus] }); }
    catch (error) { if (this.data.ownerId === ownerId) this.setData({ error: errorMessage(error), patient: null }); }
    finally { if (this.data.ownerId === ownerId) this.setData({ loading: false }); }
  },
  checks(event: WechatMiniprogram.CustomEvent<{ value: string[] }>) { this.setData({ patientConfirmed: event.detail.value.includes('patient'), rulesAccepted: event.detail.value.includes('rules') }); },
  reasonInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ reason: event.detail.value }); },
  async submit() {
    if (this.data.busy || this.data.pending) return;
    const context = getHold(); if (!context || Date.parse(context.hold.expiresAt) <= Date.now()) { this.setData({ expired: true, error: '短时占位已到期，请返回重新查询时段。' }); return; }
    if (!this.data.patient) { this.setData({ error: '请先读取本人资料。' }); return; }
    const validation = profileError(this.data.patient); if (validation) { this.setData({ error: validation }); return; }
    if (!this.data.patientConfirmed || !this.data.rulesAccepted) { this.setData({ error: '请核对实际就诊人，并阅读预约取消规则后确认。' }); return; }
    if (context.oldAppointmentId && !this.data.reason.trim()) { this.setData({ error: '请填写改期原因，原预约记录将保留。' }); return; }
    this.setData({ busy: true, error: '' });
    try {
      const command = context.oldAppointmentId ? newCommand('/appointments/' + encodeURIComponent(context.oldAppointmentId) + '/changes', { intent: 'reschedule', expectedVersion: context.oldVersion ?? 0, reason: this.data.reason.trim(), holdId: context.hold.id, holdVersion: context.hold.rowVersion }) : newCommand('/appointments/confirm', { holdId: context.hold.id, holdVersion: context.hold.rowVersion, patientConfirmed: true, rulesAccepted: true });
      openAppointment(await sendCommand(command));
    } catch (error) { this.setData({ error: errorMessage(error), pending: Boolean(pendingCommand()) }); }
    finally { this.setData({ busy: false }); }
  },
  async inspect() {
    if (this.data.busy) return; this.setData({ busy: true, error: '' });
    try { const result = await inspectCommand(); if (result) openAppointment(result); else this.setData({ error: '服务端暂未查到已完成结果，原请求仍保留。可稍后核对，或使用原操作标识重试。' }); }
    catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ busy: false, pending: Boolean(pendingCommand()) }); }
  },
  async retry() { const command = pendingCommand(); if (!command || this.data.busy) return; this.setData({ busy: true, error: '' }); try { openAppointment(await sendCommand(command)); } catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ busy: false, pending: Boolean(pendingCommand()) }); } },
  chooseAgain() { wx.navigateBack(); },
  profile() { wx.switchTab({ url: '/pages/profile/index' }); }
});
