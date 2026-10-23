import type { Clinic, Doctor, Service } from '../../types';
import { api, errorMessage, query } from '../../utils/api';
import { doctorView } from '../../utils/catalog';
import { price } from '../../utils/format';

Page({
  requestSequence: 0,
  data: {
    doctorId: '', preferredClinicId: '', loading: false, error: '',
    doctor: null as ReturnType<typeof doctorView> | null, clinics: [] as Clinic[], clinicIndex: 0,
    allServices: [] as Service[], services: [] as (Service & { priceLabel: string })[], serviceIndex: 0,
  },
  onLoad(options: Record<string, string | undefined>) {
    this.setData({ doctorId: options.id || '', preferredClinicId: options.clinicId || '' });
    void this.load();
  },
  onUnload() { this.requestSequence++; },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load() {
    if (!this.data.doctorId) { this.setData({ error: '未找到医生信息，请从医生团队重新选择。' }); return; }
    const request = ++this.requestSequence;
    this.setData({ loading: true, error: '' });
    try {
      const [doctors, clinics, services] = await Promise.all([api<Doctor[]>('/doctors'), api<Clinic[]>('/clinics'), api<Service[]>('/services')]);
      const doctor = doctors.find(item => item.id === this.data.doctorId);
      if (!doctor) throw new Error('该医生暂无公开信息，请返回医生团队重新选择。');
      let clinicIds = doctor.clinicIds;
      if (!Array.isArray(clinicIds)) {
        const assignments = await Promise.all(clinics.map(async clinic => ({ id: clinic.id, doctors: await api<Doctor[]>('/doctors' + query({ clinicId: clinic.id })) })));
        clinicIds = assignments.filter(item => item.doctors.some(candidate => candidate.id === doctor.id)).map(item => item.id);
      }
      if (request !== this.requestSequence) return;
      const openClinics = clinics.filter(clinic => clinicIds?.includes(clinic.id));
      const clinicIndex = Math.max(0, openClinics.findIndex(item => item.id === this.data.preferredClinicId));
      this.setData({ doctor: doctorView(doctor), clinics: openClinics, clinicIndex, allServices: services });
      this.filterServices();
    } catch (error) { if (request === this.requestSequence) this.setData({ error: errorMessage(error), doctor: null, clinics: [], services: [] }); }
    finally { if (request === this.requestSequence) this.setData({ loading: false }); }
  },
  filterServices() {
    const clinic = this.data.clinics[this.data.clinicIndex];
    const doctor = this.data.doctor;
    const services = doctor && clinic ? this.data.allServices.filter(item => doctor.serviceIds.includes(item.id) && item.clinicIds.includes(clinic.id)) : [];
    this.setData({ services: services.map(item => ({ ...item, priceLabel: price(item.priceCents) })), serviceIndex: 0 });
  },
  clinicChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ clinicIndex: Number(event.detail.value) }); this.filterServices(); },
  serviceChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ serviceIndex: Number(event.detail.value) }); },
  book() {
    const doctor = this.data.doctor, clinic = this.data.clinics[this.data.clinicIndex], service = this.data.services[this.data.serviceIndex];
    if (!doctor || !clinic || !service || !doctor.serviceIds.includes(service.id) || !service.clinicIds.includes(clinic.id)) { this.setData({ error: '请选择与该医生和门诊匹配的开放咨询服务。' }); return; }
    wx.navigateTo({ url: '/pages/booking/index' + query({ clinicId: clinic.id, serviceId: service.id, doctorId: doctor.id }) });
  },
});
