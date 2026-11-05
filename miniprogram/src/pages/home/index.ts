import type { AuthConfig, PublicDoctor as Doctor, Service } from '../../types';
import { api, errorMessage } from '../../utils/api';
import { doctorView } from '../../utils/catalog';
import { price } from '../../utils/format';
import { session } from '../../utils/session';
Page({
  requestSequence: 0,
  data: {
    loading: false, error: '', services: [] as (Service & { priceLabel: string })[],
    doctorsPreview: [] as ReturnType<typeof doctorView>[],
    signedIn: false, demoEnabled: false,
  },
  onShow() { this.setData({ signedIn: Boolean(session()) }); void this.load(); },
  onUnload() { this.requestSequence++; },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load() {
    const request = ++this.requestSequence;
    this.setData({ loading: true, error: '' });
    try {
      const [services, config, doctors] = await Promise.all([
        api<Service[]>('/services'), api<AuthConfig>('/auth/config'), api<Doctor[]>('/doctors'),
      ]);
      if (request !== this.requestSequence) return;
      this.setData({ services: services.slice(0, 3).map(item => ({ ...item, priceLabel: price(item.priceCents) })),
        doctorsPreview: doctors.slice(0, 3).map(doctorView),
        demoEnabled: config.demoLoginEnabled });
    } catch (error) { if (request === this.requestSequence) this.setData({ error: errorMessage(error) }); }
    finally { if (request === this.requestSequence) this.setData({ loading: false }); }
  },
  book() { wx.navigateTo({ url: '/pages/booking/index' }); },
  startBooking() { if (session()) this.book(); else this.login(); },
  clinics() { wx.switchTab({ url: '/pages/clinics/index' }); },
  service(event: WechatMiniprogram.BaseEvent) {
    const service = this.data.services.find(item => item.id === String(event.currentTarget.dataset.id));
    if (service) wx.navigateTo({ url: '/pages/booking/index?serviceId=' + encodeURIComponent(service.id) + (service.clinicIds[0] ? '&clinicId=' + encodeURIComponent(service.clinicIds[0]) : '') });
  },
  doctors() { wx.navigateTo({ url: '/pages/doctors/index' }); },
  doctorDetail(event: WechatMiniprogram.BaseEvent) { wx.navigateTo({ url: '/pages/doctor-detail/index?id=' + encodeURIComponent(String(event.currentTarget.dataset.id)) }); },
  prices() { wx.navigateTo({ url: '/pages/prices/index' }); },
  appointments() { wx.switchTab({ url: '/pages/appointments/index' }); },
  profile() { wx.switchTab({ url: '/pages/profile/index' }); },
  login() { wx.navigateTo({ url: '/pages/login/index' }); },
  account() { if (session()) this.profile(); else this.login(); },
});
