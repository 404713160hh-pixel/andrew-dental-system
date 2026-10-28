import type { Patient, PatientInput, Principal } from '../../types';
import { api, errorMessage, RequestError } from '../../utils/api';
import { emptyProfile, profileError } from '../../utils/format';
import { clearSession, session } from '../../utils/session';
import { getHold, pendingCommand } from '../../utils/booking';
Page({
  data: { ownerId: '', signedIn: false, loading: false, busy: false, error: '', saved: false, displayName: '', patientId: '', profile: emptyProfile(), rowVersion: 0, hasHold: false, isDemo: false,needsConsent:false,privacyContact:'' },
  onShow() {
    const ownerId = session()?.user.id ?? '';
    if (this.data.ownerId !== ownerId) this.setData({ ownerId, profile: emptyProfile(), patientId: '', rowVersion: 0, isDemo: false, error: '', loading: false, busy: false });
    const hold = getHold();
    this.setData({ signedIn: Boolean(ownerId), displayName: session()?.user.displayName ?? '', saved: false, hasHold: Boolean(hold && Date.parse(hold.hold.expiresAt) > Date.now()) }); if (ownerId) void this.load();
  },
  async load() {
    const ownerId = session()?.user.id; if (!ownerId) return;
    this.setData({ loading: true, error: '' });
    try { const [principal, patient] = await Promise.all([api<Principal>('/me'), api<Patient>('/patients/me')]); if (session()?.user.id !== ownerId || this.data.ownerId !== ownerId) return; const { id, rowVersion, isDemo = false, ...profile } = patient; if (principal.patientId !== id) throw new Error('就诊人身份与登录账号不一致，请重新登录。'); this.setData({ profile, rowVersion, isDemo, patientId: id, displayName: patient.name }); }
    catch (error) { if (this.data.ownerId === ownerId && (!session() || session()?.user.id === ownerId)) this.setData({ error: errorMessage(error),needsConsent:error instanceof RequestError&&error.code==='PRIVACY_CONSENT_REQUIRED', signedIn: Boolean(session()), ...(!session() ? { profile: emptyProfile(), patientId: '', rowVersion: 0, isDemo: false } : {}) }); }
    finally { if (this.data.ownerId === ownerId) this.setData({ loading: false }); }
  },
  change(event: WechatMiniprogram.CustomEvent<PatientInput>) { this.setData({ profile: event.detail, saved: false }); },
  async save() {
    if (this.data.busy || !this.data.rowVersion) return;
    const ownerId = session()?.user.id; if (!ownerId || ownerId !== this.data.ownerId) return;
    const validation = profileError(this.data.profile); if (validation) { this.setData({ error: validation }); return; }
    this.setData({ busy: true, error: '', saved: false });
    try { const patient = await api<Patient>('/patients/me', 'PUT', { ...this.data.profile, expectedVersion: this.data.rowVersion }); if (session()?.user.id !== ownerId || this.data.ownerId !== ownerId) return; const { id, rowVersion, isDemo = false, ...profile } = patient; this.setData({ profile, rowVersion, isDemo, patientId: id, saved: true, displayName: patient.name }); }
    catch (error) { if (this.data.ownerId === ownerId) this.setData({ error: errorMessage(error) + ' 如提示版本已变更，请先重新读取后核对。' }); }
    finally { if (this.data.ownerId === ownerId) this.setData({ busy: false }); }
  },
  login() { wx.navigateTo({ url: '/pages/login/index' }); },
  async withdrawConsent() {
    if(this.data.busy)return;
    const choice=await wx.showModal({title:'撤回隐私同意',content:'撤回后将暂时无法在线查看或管理预约；已有预约请联系门诊处理。历史资料是否删除及保存期限以机构告知和适用规定为准。'});
    if(!choice.confirm)return;
    this.setData({busy:true,error:''});
    try {await api('/privacy/withdraw','POST',{confirm:true});this.setData({profile:emptyProfile(),patientId:'',rowVersion:0,needsConsent:true,error:'已撤回同意。重新使用前请阅读并确认最新隐私告知。'});}
    catch(error){this.setData({error:errorMessage(error)});}finally{this.setData({busy:false});}
  },
  async logout() {
    if (this.data.busy) return;
    const ownerId = session()?.user.id; if (!ownerId) return;
    const response = await wx.showModal({ title: '退出当前账号', content: pendingCommand() ? '存在结果待确认的预约操作。原操作会留在本机，之后请用同一账号登录核对。' : '退出后需要重新登录才能管理预约。' });
    if (!response.confirm) return;
    this.setData({ busy: true, error: '' });
    try { await api<{ loggedOut: boolean }>('/auth/logout', 'POST'); if (session()?.user.id !== ownerId) return; clearSession(); this.setData({ ownerId: '', signedIn: false, profile: emptyProfile(), patientId: '', rowVersion: 0, isDemo: false }); }
    catch (error) { this.setData({ error: errorMessage(error), signedIn: Boolean(session()) }); } finally { this.setData({ busy: false }); }
  },
  appointments() { wx.switchTab({ url: '/pages/appointments/index' }); },
  continueHold() {
    const hold = getHold();
    if (!hold || Date.parse(hold.hold.expiresAt) <= Date.now()) { this.setData({ hasHold: false, error: '短时占位已到期，请重新选择就诊时段。' }); return; }
    wx.navigateTo({ url: '/pages/confirm/index' });
  }
});
