import type { Patient, PatientAvatar, PatientInput, Principal } from '../../types';
import { api, errorMessage, RequestError } from '../../utils/api';
import { allergyLabels, emptyProfile, profileError } from '../../utils/format';
import { clearSession, session } from '../../utils/session';
import { getHold, pendingCommand } from '../../utils/booking';
Page({
  avatarSequence: 0,
  originalProfile: null as PatientInput | null,
  data: { ownerId: '', signedIn: false, loading: false, busy: false, error: '', logoutNotice: '', saved: false, editing: false, versionConflict: false, allergyLabels, displayName: '', patientId: '', profile: emptyProfile(), rowVersion: 0, hasHold: false, isDemo: false,needsConsent:false,privacyContact:'', avatarPath: '', avatarBusy: false, avatarError: '' },
  onShow() {
    const ownerId = session()?.user.id ?? '';
    if (this.data.ownerId !== ownerId) {
      this.resetAvatar();
      this.originalProfile = null;
      this.setData({ ownerId, profile: emptyProfile(), patientId: '', rowVersion: 0, isDemo: false, error: '', loading: false, busy: false, needsConsent: false, editing: false, saved: false });
    }
    const hold = getHold();
    this.setData({ signedIn: Boolean(ownerId), displayName: this.data.rowVersion ? this.data.displayName : session()?.user.displayName ?? '', hasHold: Boolean(hold && Date.parse(hold.hold.expiresAt) > Date.now()), ...(ownerId ? { logoutNotice: '' } : {}) }); if (ownerId && !this.data.editing && !this.data.busy) void this.load();
  },
  async load() {
    const ownerId = session()?.user.id; if (!ownerId) return;
    this.setData({ loading: true, error: '' });
    try { const [principal, patient] = await Promise.all([api<Principal>('/me'), api<Patient>('/patients/me')]); if (session()?.user.id !== ownerId || this.data.ownerId !== ownerId) return; const { id, rowVersion, isDemo = false, ...profile } = patient; if (principal.patientId !== id) throw new Error('就诊人身份与登录账号不一致，请重新登录。'); this.setData({ profile, rowVersion, isDemo, patientId: id, displayName: patient.name, needsConsent: false, editing: false }); void this.loadAvatar(); }
    catch (error) { if (this.data.ownerId === ownerId && (!session() || session()?.user.id === ownerId)) { this.resetAvatar(); this.setData({ error: errorMessage(error),needsConsent:error instanceof RequestError&&error.code==='PRIVACY_CONSENT_REQUIRED', signedIn: Boolean(session()), ...(!session() ? { ownerId: '', displayName: '', profile: emptyProfile(), patientId: '', rowVersion: 0, isDemo: false, hasHold: false, loading: false, busy: false } : {}) }); } }
    finally { if (this.data.ownerId === ownerId) this.setData({ loading: false }); }
  },
  onUnload() { this.resetAvatar(); },
  resetAvatar() {
    this.avatarSequence++;
    this.displayAvatar(null);
    this.setData({ avatarBusy: false, avatarError: '' });
  },
  displayAvatar(avatar: PatientAvatar | null) {
    const oldPath = this.data.avatarPath;
    let avatarPath = '';
    if (avatar) {
      const extension = avatar.mimeType === 'image/png' ? 'png' : 'jpg';
      avatarPath = wx.env.USER_DATA_PATH + '/andrew-avatar-' + Date.now() + '-' + this.avatarSequence + '.' + extension;
      wx.getFileSystemManager().writeFileSync(avatarPath, avatar.base64, 'base64');
    }
    this.setData({ avatarPath });
    if (oldPath && oldPath !== avatarPath) wx.getFileSystemManager().unlink({ filePath: oldPath });
  },
  async loadAvatar() {
    const token = session()?.token;
    if (!token || this.data.avatarBusy) return;
    const sequence = ++this.avatarSequence;
    this.setData({ avatarError: '' });
    try {
      const avatar = await api<PatientAvatar | null>('/patients/me/avatar');
      if (this.avatarSequence === sequence && session()?.token === token) this.displayAvatar(avatar);
    } catch {
      if (this.avatarSequence !== sequence) return;
      this.displayAvatar(null);
      if (session()?.token === token) this.setData({ avatarError: '头像暂时无法读取，可点击重试。' });
      else if (!session()) this.onShow();
    }
  },
  chooseAvatar(event: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    if (event.detail.avatarUrl) void this.updateAvatar(event.detail.avatarUrl);
  },
  removeAvatar() { void this.updateAvatar(null); },
  async updateAvatar(path: string | null) {
    const token = session()?.token;
    if (!token || this.data.avatarBusy || this.data.busy || !this.data.rowVersion || this.data.needsConsent) return;
    const sequence = ++this.avatarSequence;
    this.setData({ avatarBusy: true, avatarError: '' });
    try {
      let base64: string | null = null;
      if (path) {
        const fs = wx.getFileSystemManager();
        base64 = fs.readFileSync(path, 'base64') as string;
        if (base64.length > 122880) {
          const compressed = await wx.compressImage({ src: path, quality: 72, compressedWidth: 320 });
          base64 = fs.readFileSync(compressed.tempFilePath, 'base64') as string;
        }
        if (base64.length > 122880) throw new Error('头像过大，请选一张更小的图片。');
      }
      if (this.avatarSequence !== sequence || session()?.token !== token) return;
      const result = await api<{ mimeType: PatientAvatar['mimeType'] | null }>('/patients/me/avatar', 'PUT', { base64 });
      if (this.avatarSequence !== sequence || session()?.token !== token) return;
      this.displayAvatar(result.mimeType && base64 ? { mimeType: result.mimeType, base64 } : null);
      wx.showToast({ title: path ? '头像已更新' : '头像已移除', icon: 'success' });
    } catch (error) {
      if (this.avatarSequence !== sequence) return;
      if (!session()) this.onShow();
      else if (session()?.token === token) this.setData({ avatarError: errorMessage(error) });
    } finally {
      if (this.avatarSequence === sequence) this.setData({ avatarBusy: false });
    }
  },
  beginEdit() {
    if (!this.data.rowVersion || this.data.busy || this.data.loading || this.data.needsConsent) return;
    const profile = this.data.profile;
    this.originalProfile = { ...profile, allergies: [...profile.allergies] };
    this.setData({ editing: true, saved: false, error: '', versionConflict: false });
  },
  cancelEdit() {
    if (this.data.busy || !this.originalProfile) return;
    this.setData({ profile: this.originalProfile, editing: false, error: '' });
    this.originalProfile = null;
  },
  change(event: WechatMiniprogram.CustomEvent<PatientInput>) {
    if (this.data.editing && !this.data.busy) this.setData({ profile: event.detail });
  },
  async save() {
    if (this.data.busy || this.data.loading || !this.data.editing || !this.data.rowVersion) return;
    const current = session();
    const ownerId = current?.user.id; if (!ownerId || ownerId !== this.data.ownerId) return;
    const validation = profileError(this.data.profile); if (validation) { this.setData({ error: validation }); return; }
    this.setData({ busy: true, error: '', saved: false, versionConflict: false });
    try {
      const patient = await api<Patient>('/patients/me', 'PUT', { ...this.data.profile, expectedVersion: this.data.rowVersion });
      if (session()?.token !== current?.token || this.data.ownerId !== ownerId) return;
      const { id, rowVersion, isDemo = false, ...profile } = patient;
      this.originalProfile = null;
      this.setData({ profile, rowVersion, isDemo, patientId: id, saved: true, editing: false, displayName: patient.name });
      wx.showToast({ title: '资料已保存', icon: 'success' });
    } catch (error) {
      if (this.data.ownerId !== ownerId || (session() && session()?.token !== current?.token)) return;
      if (!session()) {
        this.originalProfile = null;
        this.resetAvatar();
        this.setData({ ownerId: '', signedIn: false, displayName: '', profile: emptyProfile(), patientId: '', rowVersion: 0, isDemo: false, hasHold: false, editing: false, loading: false, busy: false });
      } else this.setData({ error: errorMessage(error), versionConflict: error instanceof RequestError && error.statusCode === 409 });
    } finally {
      if (this.data.ownerId === ownerId && session()?.token === current?.token) this.setData({ busy: false });
    }
  },
  login() { wx.navigateTo({ url: '/pages/login/index' }); },
  async withdrawConsent() {
    if(this.data.busy || this.data.avatarBusy)return;
    const choice=await wx.showModal({title:'撤回隐私同意',content:'撤回后将暂时无法在线查看或管理预约；已有预约请联系门诊处理。历史资料是否删除及保存期限以机构告知和适用规定为准。'});
    if(!choice.confirm)return;
    this.setData({busy:true,error:''});
    try {await api('/privacy/withdraw','POST',{confirm:true});this.resetAvatar();this.originalProfile=null;this.setData({profile:emptyProfile(),patientId:'',rowVersion:0,editing:false,saved:false,needsConsent:true,error:'已撤回同意。重新使用前请阅读并确认最新隐私告知。'});}
    catch(error){this.setData({error:errorMessage(error),...(!session()?{ownerId:'',signedIn:false,displayName:'',profile:emptyProfile(),patientId:'',rowVersion:0,isDemo:false,hasHold:false,loading:false}: {})});}finally{this.setData({busy:false});}
  },
  async logout() {
    if (this.data.busy) return;
    const original = session(); const ownerId = original?.user.id; if (!ownerId || !original) return;
    const response = await wx.showModal({ title: '退出当前账号', content: pendingCommand() ? '存在结果待确认的预约操作。原操作会留在本机，之后请用同一账号登录核对。' : '退出后需要重新登录才能管理预约。' });
    if (!response.confirm) return;
    if (session()?.token !== original.token) return;
    // api captures the current token synchronously, before the local session is cleared.
    const revoke = api<{ loggedOut: boolean }>('/auth/logout', 'POST');
    if (session()?.token === original.token) clearSession();
    this.resetAvatar();
    this.originalProfile = null;
    this.setData({ ownerId: '', signedIn: false, displayName: '', profile: emptyProfile(), patientId: '', rowVersion: 0, isDemo: false, hasHold: false, needsConsent: false, saved: false, editing: false, error: '', logoutNotice: '正在确认服务端退出…', loading: false, busy: false });
    try {
      await revoke;
      if (!session() && !this.data.ownerId) this.setData({ logoutNotice: '' });
    } catch (error) {
      // A late response must not change another account's screen or session.
      if (!session() && !this.data.ownerId) this.setData({ logoutNotice: error instanceof RequestError && error.statusCode === 401 ? '' : '已在本机退出，服务端会话撤销未确认；原会话到期后失效。' });
    }
  },
  appointments() { wx.switchTab({ url: '/pages/appointments/index' }); },
  continueHold() {
    const hold = getHold();
    if (!hold || Date.parse(hold.hold.expiresAt) <= Date.now()) { this.setData({ hasHold: false, error: '短时占位已到期，请重新选择就诊时段。' }); return; }
    wx.navigateTo({ url: '/pages/confirm/index' });
  }
});
