import type { Clinic, PublicDoctor as Doctor } from '../../types';
import { api, errorMessage, query } from '../../utils/api';
import { doctorView } from '../../utils/catalog';

Page({
  requestSequence: 0,
  data: {
    loading: false, error: '', clinics: [] as Clinic[], clinicNames: ['全部门诊'], clinicIndex: 0,
    preferredClinicId: '', doctors: [] as (ReturnType<typeof doctorView> & { clinicLabel: string })[],
  },
  onLoad(options: Record<string, string | undefined>) {
    this.setData({ preferredClinicId: options.clinicId || '' });
    void this.load();
  },
  onUnload() { this.requestSequence++; },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load() {
    const request = ++this.requestSequence;
    this.setData({ loading: true, error: '' });
    try {
      const clinics = await api<Clinic[]>('/clinics');
      if (request !== this.requestSequence) return;
      const preferredIndex = clinics.findIndex(item => item.id === this.data.preferredClinicId);
      const clinicIndex = this.data.preferredClinicId ? preferredIndex + 1 : Math.min(this.data.clinicIndex, clinics.length);
      this.setData({ clinics, clinicNames: ['全部门诊', ...clinics.map(item => item.name)], clinicIndex, preferredClinicId: '' });
      await this.loadDoctors();
    } catch (error) { if (request === this.requestSequence) this.setData({ error: errorMessage(error), loading: false }); }
  },
  async loadDoctors() {
    const request = ++this.requestSequence;
    this.setData({ loading: true, error: '' });
    try {
      const clinic = this.data.clinicIndex ? this.data.clinics[this.data.clinicIndex - 1] : undefined;
      const doctors = await api<Doctor[]>('/doctors' + query({ clinicId: clinic?.id }));
      if (request !== this.requestSequence) return;
      this.setData({ doctors: doctors.map(item => ({
        ...doctorView(item),
        clinicLabel: (item.clinicIds || []).map(id => this.data.clinics.find(clinic => clinic.id === id)?.name).filter(Boolean).join(' · ') || '公开排班待更新',
      })) });
    } catch (error) { if (request === this.requestSequence) this.setData({ error: errorMessage(error), doctors: [] }); }
    finally { if (request === this.requestSequence) this.setData({ loading: false }); }
  },
  clinicChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ clinicIndex: Number(event.detail.value) });
    void this.loadDoctors();
  },
  openDoctor(event: WechatMiniprogram.BaseEvent) {
    const id = String(event.currentTarget.dataset.id);
    const clinic = this.data.clinicIndex ? this.data.clinics[this.data.clinicIndex - 1] : undefined;
    wx.navigateTo({ url: '/pages/doctor-detail/index?id=' + encodeURIComponent(id) + (clinic ? '&clinicId=' + encodeURIComponent(clinic.id) : '') });
  },
});
