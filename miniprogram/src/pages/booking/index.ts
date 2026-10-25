import type { BookingQueryPolicy, BookingSlot, Clinic, Doctor, Hold, Patient, Service } from '../../types';
import { api, errorMessage, query, RequestError } from '../../utils/api';
import { dateToday, profileError, slotSelection, slotView, price } from '../../utils/format';
import { doctorView } from '../../utils/catalog';
import { calendarDateText, calendarTimestamp, groupSlotIndices, queryWindowLimits, quickDateChoices, type SlotGroup } from '../../utils/availability';
import { pendingCommand, saveHold } from '../../utils/booking';
import { requireLogin, session } from '../../utils/session';
Page({
  data: {
    loading: false, searching: false, holding: false, queried: false, error: '', catalogFailed: false, requestVersion: 0, clinics: [] as Clinic[],
    services: [] as (Service & { priceLabel: string })[], doctors: [] as ReturnType<typeof doctorView>[], doctorNames: ['不限医生'],
    clinicIndex: 0, serviceIndex: 0, doctorIndex: 0, date: dateToday(), minDate: dateToday(), calendarEndDate: '',
    calendarVisible: false, calendarMin: calendarTimestamp(dateToday()), calendarMax: calendarTimestamp(dateToday()), calendarDate: calendarTimestamp(dateToday()),
    quickDates: quickDateChoices(dateToday()), slotGroups: [] as SlotGroup[],
    steps: [{ text: '选择时段', desc: '门诊 · 医生 · 日期' }, { text: '核对确认', desc: '核对就诊人与规则' }, { text: '预约完成', desc: '获取预约编号' }],
    slots: [] as (ReturnType<typeof slotView> & { doctorIsDemo: boolean })[], policy: null as BookingQueryPolicy | null,
    oldAppointmentId: '', oldVersion: 0, preferredClinicId: '', preferredServiceId: '', preferredDoctorId: '',
    serviceUnavailable: false, doctorUnavailable: false, pending: false,
  },
  onLoad(options: Record<string, string | undefined>) {
    this.setData({ oldAppointmentId: options.appointmentId ?? '', oldVersion: Number(options.version ?? 0),
      preferredClinicId: options.clinicId ?? '', preferredServiceId: options.serviceId ?? '', preferredDoctorId: options.doctorId ?? '' });
    void this.load();
  },
  onShow() {
    this.setData({ pending: Boolean(pendingCommand()) });
    if (this.data.policy && this.data.minDate < dateToday() && !this.data.loading && !this.data.holding) void this.load();
  },
  onUnload() { this.setData({ requestVersion: this.data.requestVersion + 1 }); },
  async load() {
    if (this.data.holding) return;
    const version = this.data.requestVersion + 1;
    this.setData({ requestVersion: version, loading: true, searching: false, error: '', catalogFailed: false, slots: [], slotGroups: [], queried: false });
    try {
      const [clinics, policy] = await Promise.all([api<Clinic[]>('/clinics'), api<BookingQueryPolicy>('/booking-policy')]);
      if (this.data.requestVersion !== version) return;
      const window = queryWindowLimits(policy.queryWindow, dateToday());
      const selectedDate = this.data.date < window.minDate ? window.minDate : this.data.date > window.maxDate ? window.maxDate : this.data.date;
      let clinicIndex = Math.max(0, clinics.findIndex(item => item.id === this.data.preferredClinicId));
      if (this.data.preferredClinicId && !clinics.some(item => item.id === this.data.preferredClinicId)) throw new Error('所选门诊暂无开放安排，请返回重新选择。');
      // A reference links a consultation, which may be offered at another clinic.
      // Never silently replace that requested service with the first local one.
      if (!this.data.preferredClinicId && this.data.preferredServiceId) {
        const services = await api<Service[]>('/services');
        if (this.data.requestVersion !== version) return;
        const requested = services.find(item => item.id === this.data.preferredServiceId);
        if (!requested) throw new Error('关联咨询服务暂未开放，请返回项目资料或联系门诊。');
        const offeredClinic = clinics.findIndex(item => requested.clinicIds.includes(item.id));
        if (offeredClinic < 0) throw new Error('相关咨询服务暂未在开放门诊提供，请稍后查看。');
        clinicIndex = offeredClinic;
      }
      this.setData({ clinics, policy, clinicIndex, date: selectedDate, minDate: window.minDate, calendarEndDate: window.maxDate,
        calendarMin: calendarTimestamp(window.minDate), calendarMax: calendarTimestamp(window.maxDate), calendarDate: calendarTimestamp(selectedDate),
        quickDates: quickDateChoices(window.minDate).filter(day => day.date <= window.maxDate) });
      await this.loadServices(version);
    } catch (error) { if (this.data.requestVersion === version) this.setData({ error: errorMessage(error), catalogFailed: true, services: [], doctors: [], doctorNames: ['不限医生'], doctorIndex: 0, slots: [], slotGroups: [], queried: false }); }
    finally { if (this.data.requestVersion === version) this.setData({ loading: false }); }
  },
  async loadServices(version?: number) {
    version = version ?? this.data.requestVersion;
    if (this.data.requestVersion !== version) return;
    const clinic = this.data.clinics[this.data.clinicIndex];
    // Previous candidates belong to the previous filter, even while the new
    // catalog request is still in flight or ultimately fails.
    this.setData({ services: [], serviceIndex: 0, doctors: [], doctorNames: ['不限医生'], doctorIndex: 0,
      doctorUnavailable: Boolean(this.data.preferredDoctorId), slots: [], slotGroups: [], queried: false });
    if (!clinic) { this.setData({ services: [], doctors: [], doctorNames: ['不限医生'], slots: [], slotGroups: [] }); return; }
    const services = await api<Service[]>('/services' + query({ clinicId: clinic.id }));
    if (this.data.requestVersion !== version) return;
    const matchingIndex = services.findIndex(item => item.id === this.data.preferredServiceId);
    const serviceUnavailable = Boolean(this.data.preferredServiceId && matchingIndex < 0);
    this.setData({ services: services.map(item => ({ ...item, priceLabel: price(item.priceCents) })),
      serviceIndex: Math.max(0, matchingIndex), serviceUnavailable, doctorIndex: 0, slots: [], slotGroups: [], queried: false,
      ...(serviceUnavailable ? { error: '所选咨询服务未在该门诊开放，请主动选择其他服务或门诊。' } : {}),
    });
    await this.loadDoctors(version);
  },
  async loadDoctors(version?: number) {
    version = version ?? this.data.requestVersion;
    if (this.data.requestVersion !== version) return;
    const clinic = this.data.clinics[this.data.clinicIndex], service = this.data.services[this.data.serviceIndex];
    this.setData({ doctors: [], doctorNames: ['不限医生'], doctorIndex: 0,
      doctorUnavailable: Boolean(this.data.preferredDoctorId), slots: [], slotGroups: [], queried: false });
    if (!clinic || !service || this.data.serviceUnavailable) { this.setData({ doctors: [], doctorNames: ['不限医生'], doctorIndex: 0, slots: [], slotGroups: [] }); return; }
    const doctors = await api<Doctor[]>('/doctors' + query({ clinicId: clinic.id, serviceId: service.id }));
    if (this.data.requestVersion !== version) return;
    const matchingIndex = doctors.findIndex(item => item.id === this.data.preferredDoctorId);
    const doctorUnavailable = Boolean(this.data.preferredDoctorId && matchingIndex < 0);
    this.setData({ doctors: doctors.map(doctorView), doctorNames: ['不限医生', ...doctors.map(item => item.name + (item.isDemo ? ' · 虚构医生' : ''))],
      doctorIndex: matchingIndex < 0 ? 0 : matchingIndex + 1, doctorUnavailable, slots: [], slotGroups: [], queried: false,
      ...(doctorUnavailable ? { error: '这位医生暂无与当前门诊和服务匹配的安排，请调整选择。' } : {}),
    });
  },
  async clinicChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.loading || this.data.searching || this.data.holding) return;
    const clinicIndex = Number(event.detail.value), clinic = this.data.clinics[clinicIndex]; if (!clinic) return;
    const version = this.data.requestVersion + 1;
    this.setData({ requestVersion: version, clinicIndex, preferredClinicId: clinic.id, loading: true, error: '', catalogFailed: false });
    try { await this.loadServices(version); } catch (error) { if (this.data.requestVersion === version) this.setData({ error: errorMessage(error), catalogFailed: true }); } finally { if (this.data.requestVersion === version) this.setData({ loading: false }); }
  },
  async serviceChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.loading || this.data.searching || this.data.holding) return;
    const serviceIndex = Number(event.detail.value), service = this.data.services[serviceIndex]; if (!service) return;
    const version = this.data.requestVersion + 1;
    this.setData({ requestVersion: version, serviceIndex, preferredServiceId: service.id, serviceUnavailable: false, loading: true, error: '', catalogFailed: false });
    try { await this.loadDoctors(version); } catch (error) { if (this.data.requestVersion === version) this.setData({ error: errorMessage(error), catalogFailed: true }); } finally { if (this.data.requestVersion === version) this.setData({ loading: false }); }
  },
  doctorChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.loading || this.data.searching || this.data.holding) return;
    const doctorIndex = Number(event.detail.value);
    if (!Number.isInteger(doctorIndex) || doctorIndex < 0 || doctorIndex > this.data.doctors.length) return;
    this.setData({ requestVersion: this.data.requestVersion + 1, doctorIndex, preferredDoctorId: doctorIndex ? this.data.doctors[doctorIndex - 1]?.id || '' : '', doctorUnavailable: false, slots: [], slotGroups: [], queried: false, error: '' });
  },
  selectDate(date: string) {
    if (this.data.loading || this.data.searching || this.data.holding) return;
    if (!this.data.policy || !this.data.calendarEndDate) { this.setData({ error: '预约日期范围暂未读取完成，请原地重试。' }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || calendarDateText(calendarTimestamp(date)) !== date || date < this.data.minDate || date > this.data.calendarEndDate) {
      this.setData({ error: `请选择 ${this.data.minDate} 至 ${this.data.calendarEndDate} 范围内的日期。` }); return;
    }
    this.setData({ requestVersion: this.data.requestVersion + 1, date,
      calendarDate: calendarTimestamp(date > this.data.calendarEndDate ? this.data.calendarEndDate : date), slots: [], slotGroups: [], queried: false, error: '' });
  },
  dateChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.selectDate(event.detail.value); },
  quickDate(event: WechatMiniprogram.BaseEvent) { this.selectDate(String(event.currentTarget.dataset.date ?? '')); },
  openCalendar() {
    if (!this.data.loading && !this.data.searching && !this.data.holding && this.data.policy && this.data.calendarEndDate) this.setData({ calendarVisible: true,
      calendarDate: calendarTimestamp(this.data.date > this.data.calendarEndDate ? this.data.calendarEndDate : this.data.date < this.data.minDate ? this.data.minDate : this.data.date) });
  },
  closeCalendar() { this.setData({ calendarVisible: false }); },
  calendarConfirm(event: { detail: Date | number }) {
    if (this.data.loading || this.data.searching || this.data.holding) return;
    this.selectDate(calendarDateText(event.detail)); this.setData({ calendarVisible: false });
  },
  retryLoad() { if (!this.data.loading && !this.data.searching && !this.data.holding) void this.load(); },
  async search() {
    if (this.data.loading || this.data.searching || this.data.holding) return;
    const clinic = this.data.clinics[this.data.clinicIndex], service = this.data.services[this.data.serviceIndex];
    if (!clinic || !service || this.data.serviceUnavailable) { this.setData({ error: '请选择开放的门诊和咨询服务，关联项目不能自动替换。' }); return; }
    if (this.data.doctorUnavailable) { this.setData({ error: '所选医生暂无匹配安排，请选择其他医生或调整门诊、服务。' }); return; }
    if (this.data.catalogFailed) { this.setData({ error: '门诊与医生资料尚未读取完成，请原地重试。' }); return; }
    if (!this.data.policy || !this.data.calendarEndDate || this.data.date < this.data.minDate || this.data.date > this.data.calendarEndDate) { this.setData({ error: '请重新读取预约日期范围后再查询。' }); return; }
    const doctor = this.data.doctorIndex ? this.data.doctors[this.data.doctorIndex - 1] : undefined;
    const version = this.data.requestVersion + 1;
    this.setData({ requestVersion: version, searching: true, error: '', slots: [], slotGroups: [], queried: false });
    try {
      const slots = await api<BookingSlot[]>('/booking-slots' + query({ clinicId: clinic.id, serviceId: service.id, date: this.data.date, doctorId: doctor?.id }));
      if (this.data.requestVersion !== version) return;
      this.setData({ slots: slots.map((item, index) => ({ ...slotView(item, index), doctorIsDemo: this.data.doctors.find(doctor => doctor.id === item.doctorId)?.isDemo === true })), slotGroups: groupSlotIndices(slots), queried: true });
    } catch (error) { if (this.data.requestVersion === version) this.setData({ error: errorMessage(error), slots: [], slotGroups: [], queried: false }); } finally { if (this.data.requestVersion === version) this.setData({ searching: false }); }
  },
  async choose(event: WechatMiniprogram.BaseEvent) {
    if (this.data.loading || this.data.searching || this.data.holding || !requireLogin()) return;
    if (pendingCommand()) { wx.showModal({ title: '有一笔结果待确认', content: '请到“我的预约”核对原操作，完成后再选择新时段。', showCancel: false }); return; }
    const slot = this.data.slots[Number(event.currentTarget.dataset.index)]; if (!slot) return;
    const ownerId = session()?.user.id; if (!ownerId) return;
    const version = this.data.requestVersion;
    this.setData({ holding: true, error: '' });
    try {
      const patient = await api<Patient>('/patients/me');
      if (session()?.user.id !== ownerId || this.data.requestVersion !== version) return;
      const validation = profileError(patient);
      if (validation) { wx.showModal({ title: '请先完善本人资料', content: validation, success(result) { if (result.confirm) wx.switchTab({ url: '/pages/profile/index' }); } }); return; }
      const hold = await api<Hold>('/booking-holds', 'POST', slotSelection(slot));
      if (session()?.user.id !== ownerId || this.data.requestVersion !== version) return;
      saveHold({ hold, doctorIsDemo: slot.doctorIsDemo, patientIsDemo: Boolean(patient.isDemo),
        ...(this.data.oldAppointmentId ? { oldAppointmentId: this.data.oldAppointmentId, oldVersion: this.data.oldVersion } : {}) });
      wx.navigateTo({ url: '/pages/confirm/index' });
    } catch (error) { if (session()?.user.id === ownerId && this.data.requestVersion === version) this.setData({ error: error instanceof RequestError && error.uncertain ? '占位结果待确认，尚未生成正式预约。请等待短时占位到期后重新查询；改期前原预约仍有效。' : errorMessage(error) }); }
    finally { if (this.data.requestVersion === version) this.setData({ holding: false }); }
  },
  pendingPage() { wx.switchTab({ url: '/pages/appointments/index' }); },
});
