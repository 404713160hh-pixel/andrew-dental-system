import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { Chair, Clinic, Doctor, Qualification, Service } from '@andrew/shared';
import { api, query } from '../api';
export const useCatalog = defineStore('catalog', () => {
  const clinics = ref<Clinic[]>([]);
  const services = ref<Service[]>([]);
  const doctors = ref<Doctor[]>([]);
  const qualifications = ref<Qualification[]>([]);
  const chairs = ref<Chair[]>([]);
  const loaded = ref(false);
  async function load() {
    const results = await Promise.all([
      api<Clinic[]>('/clinics?includeInactive=true'),
      api<Service[]>('/services?includeInactive=true'),
      api<Doctor[]>('/doctors?includeInactive=true'),
      api<Qualification[]>('/qualifications?includeInactive=true'),
    ]);
    [clinics.value, services.value, doctors.value, qualifications.value] = results;
    loaded.value = true;
  }
  async function loadChairs(clinicId: string) {
    chairs.value = await api<Chair[]>(`/chairs${query({ clinicId, includeInactive: true })}`);
  }
  function reset() {
    clinics.value = [];
    services.value = [];
    doctors.value = [];
    qualifications.value = [];
    chairs.value = [];
    loaded.value = false;
  }
  return { clinics, services, doctors, qualifications, chairs, loaded, load, loadChairs, reset };
});
