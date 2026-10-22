import type { AuthConfig, Clinic, Service } from '../../types';
import { api, errorMessage } from '../../utils/api';
import { price } from '../../utils/format';
import { session } from '../../utils/session';
Page({
  data: { loading: false, error: '', clinics: [] as Clinic[], services: [] as (Service & { priceLabel: string })[], signedIn: false, displayName: '', demoEnabled: false },
  onShow() { this.setData({ signedIn: Boolean(session()), displayName: session()?.user.displayName ?? '' }); void this.load(); },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try { const [clinics, services, config] = await Promise.all([api<Clinic[]>('/clinics'), api<Service[]>('/services'), api<AuthConfig>('/auth/config')]); this.setData({ clinics, services: services.map(item => ({ ...item, priceLabel: price(item.priceCents) })), demoEnabled: config.demoLoginEnabled }); }
    catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ loading: false }); }
  },
  book() { wx.navigateTo({ url: '/pages/booking/index' }); },
  clinic(event: WechatMiniprogram.BaseEvent) { wx.navigateTo({ url: '/pages/booking/index?clinicId=' + encodeURIComponent(String(event.currentTarget.dataset.id)) }); },
  service(event: WechatMiniprogram.BaseEvent) { const service = this.data.services.find(item => item.id === String(event.currentTarget.dataset.id)); if (service) wx.navigateTo({ url: '/pages/booking/index?serviceId=' + encodeURIComponent(service.id) + (service.clinicIds[0] ? '&clinicId=' + encodeURIComponent(service.clinicIds[0]) : '') }); },
  appointments() { wx.switchTab({ url: '/pages/appointments/index' }); },
  profile() { wx.switchTab({ url: '/pages/profile/index' }); },
  login() { wx.navigateTo({ url: '/pages/login/index' }); },
  account() { if (session()) this.profile(); else this.login(); }
});
