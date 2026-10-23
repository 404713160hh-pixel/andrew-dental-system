import type { BookingPolicy, BookingSlot, Clinic, Doctor, Hold, Patient, Service } from '../../types';
import { api, errorMessage, query, RequestError } from '../../utils/api';
import { dateToday, profileError, slotSelection, slotView, price } from '../../utils/format';
import { pendingCommand, saveHold } from '../../utils/booking';
import { requireLogin } from '../../utils/session';
Page({
  data: {
    loading: false, searching: false, holding: false, queried: false, error: '', clinics: [] as Clinic[], services: [] as (Service & { priceLabel: string })[], doctors: [] as Doctor[], doctorNames: ['不限医生'],
    clinicIndex: 0, serviceIndex: 0, doctorIndex: 0, date: dateToday(), minDate: dateToday(), slots: [] as ReturnType<typeof slotView>[], policy: null as BookingPolicy | null,
    oldAppointmentId: '', oldVersion: 0, preferredClinicId: '', preferredServiceId: '', pending: false
  },
  onLoad(options: Record<string, string | undefined>) {
    this.setData({ oldAppointmentId: options.appointmentId ?? '', oldVersion: Number(options.version ?? 0), preferredClinicId: options.clinicId ?? '', preferredServiceId: options.serviceId ?? '' });
    void this.load();
  },
  onShow() { this.setData({ pending: Boolean(pendingCommand()) }); },
  async load() {
    this.setData({ loading: true, error: '' });
    try { const [clinics, policy] = await Promise.all([api<Clinic[]>('/clinics'), api<BookingPolicy>('/booking-policy')]); const clinicIndex = Math.max(0, clinics.findIndex(item => item.id === this.data.preferredClinicId)); this.setData({ clinics, policy, clinicIndex }); await this.loadServices(); }
    catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ loading: false }); }
  },
  async loadServices() {
    const clinic = this.data.clinics[this.data.clinicIndex]; if (!clinic) { this.setData({ services: [], doctors: [], doctorNames: ['不限医生'], slots: [] }); return; }
    const services = await api<Service[]>('/services' + query({ clinicId: clinic.id }));
    const serviceIndex = Math.max(0, services.findIndex(item => item.id === this.data.preferredServiceId));
    this.setData({ services: services.map(item => ({ ...item, priceLabel: price(item.priceCents) })), serviceIndex, doctorIndex: 0, slots: [], queried: false });
    await this.loadDoctors();
  },
  async loadDoctors() {
    const clinic = this.data.clinics[this.data.clinicIndex], service = this.data.services[this.data.serviceIndex];
    if (!clinic || !service) { this.setData({ doctors: [], doctorNames: ['不限医生'] }); return; }
    const doctors = await api<Doctor[]>('/doctors' + query({ clinicId: clinic.id, serviceId: service.id }));
    this.setData({ doctors, doctorNames: ['不限医生', ...doctors.map(item => item.name)], doctorIndex: 0, slots: [], queried: false });
  },
  async clinicChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.loading || this.data.searching || this.data.holding) return;
    this.setData({ clinicIndex: Number(event.detail.value), loading: true, error: '' });
    try { await this.loadServices(); } catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ loading: false }); }
  },
  async serviceChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.loading || this.data.searching || this.data.holding) return;
    this.setData({ serviceIndex: Number(event.detail.value), loading: true, error: '' });
    try { await this.loadDoctors(); } catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ loading: false }); }
  },
  doctorChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ doctorIndex: Number(event.detail.value), slots: [], queried: false }); },
  dateChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ date: event.detail.value, slots: [], queried: false }); },
  async search() {
    if (this.data.loading || this.data.searching || this.data.holding) return;
    const clinic = this.data.clinics[this.data.clinicIndex], service = this.data.services[this.data.serviceIndex];
    if (!clinic || !service) { this.setData({ error: '请选择开放的门诊和服务项目。' }); return; }
    const doctor = this.data.doctorIndex ? this.data.doctors[this.data.doctorIndex - 1] : undefined;
    this.setData({ searching: true, error: '', slots: [], queried: false });
    try { const slots = await api<BookingSlot[]>('/booking-slots' + query({ clinicId: clinic.id, serviceId: service.id, date: this.data.date, doctorId: doctor?.id })); this.setData({ slots: slots.map(slotView), queried: true }); }
    catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ searching: false }); }
  },
  async choose(event: WechatMiniprogram.BaseEvent) {
    if (this.data.holding || !requireLogin()) return;
    if (pendingCommand()) { wx.showModal({ title: '有一笔结果待确认', content: '请到“我的预约”核对原操作，完成后再选择新时段。', showCancel: false }); return; }
    const slot = this.data.slots[Number(event.currentTarget.dataset.index)]; if (!slot) return;
    this.setData({ holding: true, error: '' });
    try {
      const patient = await api<Patient>('/patients/me'); const validation = profileError(patient);
      if (validation) { wx.showModal({ title: '请先完善本人资料', content: validation, success(result) { if (result.confirm) wx.switchTab({ url: '/pages/profile/index' }); } }); return; }
      const hold = await api<Hold>('/booking-holds', 'POST', slotSelection(slot));
      saveHold({ hold, ...(this.data.oldAppointmentId ? { oldAppointmentId: this.data.oldAppointmentId, oldVersion: this.data.oldVersion } : {}) });
      wx.navigateTo({ url: '/pages/confirm/index' });
    } catch (error) { this.setData({ error: error instanceof RequestError && error.uncertain ? '占位结果待确认，尚未生成正式预约。请等待短时占位到期后重新查询；改期前原预约仍有效。' : errorMessage(error) }); }
    finally { this.setData({ holding: false }); }
  },
  pendingPage() { wx.switchTab({ url: '/pages/appointments/index' }); }
});
