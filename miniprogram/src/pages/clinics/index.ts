import type { Clinic } from '../../types';
import { api, errorMessage } from '../../utils/api';
import { clinicView } from '../../utils/catalog';

function locationView(clinic: Clinic) {
  return {
    ...clinicView(clinic),
    isDemo: /虚构|课程演示|演示地址/.test(clinic.address + ' ' + (clinic.description || '')),
    address: clinic.address?.trim() || '',
    phone: clinic.phone?.trim() || '',
    openingHours: clinic.openingHours?.trim() || '',
  };
}

Page({
  requestSequence: 0,
  data: { loading: false, error: '', expandedId: '', clinics: [] as ReturnType<typeof locationView>[] },
  onShow() { void this.load(); },
  onUnload() { this.requestSequence++; },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load() {
    const request = ++this.requestSequence;
    this.setData({ loading: true, error: '' });
    try {
      const clinics = await api<Clinic[]>('/clinics');
      if (request === this.requestSequence) this.setData({ clinics: clinics.map(locationView) });
    } catch (error) {
      if (request === this.requestSequence) this.setData({ error: errorMessage(error) });
    } finally {
      if (request === this.requestSequence) this.setData({ loading: false });
    }
  },
  copyAddress(event: WechatMiniprogram.BaseEvent) {
    const clinic = this.data.clinics.find(item => item.id === String(event.currentTarget.dataset.id));
    if (clinic?.address) wx.setClipboardData({ data: clinic.address });
  },
  call(event: WechatMiniprogram.BaseEvent) {
    const clinic = this.data.clinics.find(item => item.id === String(event.currentTarget.dataset.id));
    if (!clinic?.phone || clinic.isDemo) return;
    wx.makePhoneCall({ phoneNumber: clinic.phone });
  },
  toggleDetails(event: WechatMiniprogram.BaseEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (this.data.clinics.some(item => item.id === id)) this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },
  doctors(event: WechatMiniprogram.BaseEvent) {
    const clinic = this.data.clinics.find(item => item.id === String(event.currentTarget.dataset.id));
    if (clinic) wx.navigateTo({ url: '/pages/doctors/index?clinicId=' + encodeURIComponent(clinic.id) });
  },
  book(event: WechatMiniprogram.BaseEvent) {
    const clinic = this.data.clinics.find(item => item.id === String(event.currentTarget.dataset.id));
    if (clinic) wx.navigateTo({ url: '/pages/booking/index?clinicId=' + encodeURIComponent(clinic.id) });
  },
});
