import type { AuthConfig, LoginResult, PatientInput } from '../../types';
import { api, errorMessage, RequestError } from '../../utils/api';
import { emptyProfile, profileError } from '../../utils/format';
import { setSession } from '../../utils/session';
Page({
  data: { mode: 'login', username: '', password: '', profile: emptyProfile(), busy: false, loading: false, error: '', config: null as AuthConfig | null },
  onLoad() { void this.load(); },
  async load() { this.setData({ loading: true, error: '' }); try { this.setData({ config: await api<AuthConfig>('/auth/config') }); } catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ loading: false }); } },
  mode(event: WechatMiniprogram.BaseEvent) { if (!this.data.busy) this.setData({ mode: String(event.currentTarget.dataset.mode), error: '' }); },
  input(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ [String(event.currentTarget.dataset.field)]: event.detail.value }); },
  profileChange(event: WechatMiniprogram.CustomEvent<PatientInput>) { this.setData({ profile: event.detail }); },
  async submit() {
    if (this.data.busy) return;
    const username = this.data.username.trim();
    if (!username || !this.data.password) { this.setData({ error: '请填写账号和密码。' }); return; }
    if (this.data.mode === 'register') {
      const error = profileError(this.data.profile); if (error) { this.setData({ error }); return; }
      if (!/^[a-zA-Z0-9._-]{3,80}$/.test(username) || this.data.password.length < 12) { this.setData({ error: '账号需为 3 至 80 位字母、数字、点、下划线或短横线；密码至少 12 位。' }); return; }
    }
    this.setData({ busy: true, error: '' });
    try { const result = this.data.mode === 'register' ? await api<LoginResult>('/auth/register', 'POST', { username, password: this.data.password, profile: this.data.profile }) : await api<LoginResult>('/auth/login', 'POST', { username, password: this.data.password, portal: 'patient' }); this.finish(result); }
    catch (error) { this.setData({ error: error instanceof RequestError && error.uncertain && this.data.mode === 'register' ? '注册结果待确认。请先切换“账号登录”，使用相同账号和密码核对，避免再次建立账号。' : errorMessage(error) }); } finally { this.setData({ busy: false }); }
  },
  async demo(event: WechatMiniprogram.BaseEvent) {
    if (this.data.busy || !this.data.config?.demoLoginEnabled) return;
    this.setData({ busy: true, error: '' });
    try { this.finish(await api<LoginResult>('/auth/demo', 'POST', { username: String(event.currentTarget.dataset.username), portal: 'patient' })); }
    catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ busy: false }); }
  },
  finish(result: LoginResult) {
    setSession(result); wx.showToast({ title: '登录成功', icon: 'success' });
    if (getCurrentPages().length > 1) wx.navigateBack(); else wx.switchTab({ url: '/pages/home/index' });
  }
});
