import type { AuthConfig, Clinic, Doctor, Service, TreatmentReference } from '../../types';
import { api, errorMessage } from '../../utils/api';
import { doctorView } from '../../utils/catalog';
import { price } from '../../utils/format';
import { session } from '../../utils/session';
Page({
  requestSequence: 0,
  data: {
    loading: false, error: '', clinics: [] as Clinic[], services: [] as (Service & { priceLabel: string })[],
    doctorsPreview: [] as ReturnType<typeof doctorView>[], doctorCount: 0, referenceCount: 0, referenceYearLabel: '',
    signedIn: false, displayName: '', demoEnabled: false,
  },
  onShow() { this.setData({ signedIn: Boolean(session()), displayName: session()?.user.displayName ?? '' }); void this.load(); },
  onUnload() { this.requestSequence++; },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load() {
    const request = ++this.requestSequence;
    this.setData({ loading: true, error: '' });
    try {
      const [clinics, services, config, doctors, references] = await Promise.all([
        api<Clinic[]>('/clinics'), api<Service[]>('/services'), api<AuthConfig>('/auth/config'),
        api<Doctor[]>('/doctors'), api<TreatmentReference[]>('/treatment-references'),
      ]);
      if (request !== this.requestSequence) return;
      this.setData({ clinics, services: services.map(item => ({ ...item, priceLabel: price(item.priceCents) })),
        doctorsPreview: doctors.slice(0, 3).map(doctorView), doctorCount: doctors.length, referenceCount: references.length,
        referenceYearLabel: [...new Set(references.map(item => item.referenceYear))].join(' / '), demoEnabled: config.demoLoginEnabled });
    } catch (error) { if (request === this.requestSequence) this.setData({ error: errorMessage(error) }); }
    finally { if (request === this.requestSequence) this.setData({ loading: false }); }
  },
  book() { wx.navigateTo({ url: '/pages/booking/index' }); },
  clinic(event: WechatMiniprogram.BaseEvent) { wx.navigateTo({ url: '/pages/booking/index?clinicId=' + encodeURIComponent(String(event.currentTarget.dataset.id)) }); },
  clinicDoctors(event: WechatMiniprogram.BaseEvent) { wx.navigateTo({ url: '/pages/doctors/index?clinicId=' + encodeURIComponent(String(event.currentTarget.dataset.id)) }); },
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
