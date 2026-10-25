import { ref, watch } from 'vue';
import { defineStore } from 'pinia';
import type { Chair, Clinic, Doctor, Qualification, Service } from '@andrew/shared';
import { api, errorText, query } from '../api';
import { useAuth } from './auth';
export const useCatalog = defineStore('catalog', () => {
  const auth = useAuth();
  const clinics = ref<Clinic[]>([]);
  const services = ref<Service[]>([]);
  const doctors = ref<Doctor[]>([]);
  const qualifications = ref<Qualification[]>([]);
  const chairs = ref<Chair[]>([]);
  const loaded = ref(false);
  const loading = ref(false);
  const loadError = ref('');
  const chairsLoading = ref(false);
  const chairsError = ref('');
  const chairsClinicId = ref('');
  let directoryVersion = 0;
  let chairVersion = 0;
  function clearDirectory() {
    clinics.value = [];
    services.value = [];
    doctors.value = [];
    qualifications.value = [];
    loaded.value = false;
  }
  function clearChairs() {
    chairVersion++;
    chairs.value = [];
    chairsClinicId.value = '';
    chairsLoading.value = false;
    chairsError.value = '';
  }
  async function load() {
    const owner = auth.user?.id;
    if (!owner) { reset(); return false; }
    const version = ++directoryVersion;
    const accepts = () => owner === auth.user?.id && version === directoryVersion;
    clearDirectory(); clearChairs();
    loading.value = true; loadError.value = '';
    try {
      const results = await Promise.all([
        api<Clinic[]>('/clinics?includeInactive=true'),
        api<Service[]>('/services?includeInactive=true'),
        api<Doctor[]>('/doctors?includeInactive=true'),
        api<Qualification[]>('/qualifications?includeInactive=true'),
      ]);
      if (!accepts()) return false;
      [clinics.value, services.value, doctors.value, qualifications.value] = results;
      loaded.value = true;
      return true;
    } catch (error) {
      if (!accepts()) return false;
      clearDirectory(); loadError.value = errorText(error);
      throw error;
    } finally { if (accepts()) loading.value = false; }
  }
  async function loadChairs(clinicId: string) {
    const owner = auth.user?.id;
    if (!owner) { reset(); return false; }
    clearChairs();
    if (!clinicId) return false;
    const version = chairVersion;
    const accepts = () => owner === auth.user?.id && version === chairVersion;
    chairsLoading.value = true;
    try {
      const result = await api<Chair[]>(`/chairs${query({ clinicId, includeInactive: true })}`);
      if (!accepts()) return false;
      chairs.value = result;
      chairsClinicId.value = clinicId;
      return true;
    } catch (error) {
      if (!accepts()) return false;
      chairs.value = []; chairsClinicId.value = ''; chairsError.value = errorText(error);
      throw error;
    } finally { if (accepts()) chairsLoading.value = false; }
  }
  function reset() {
    directoryVersion++;
    clearDirectory(); clearChairs(); loading.value = false; loadError.value = '';
  }
  // Synchronous invalidation also protects the interval before the app shell's
  // account watcher runs, and rejects A -> B -> A late responses.
  watch(() => auth.user?.id, reset, { flush: 'sync' });
  return { clinics, services, doctors, qualifications, chairs, loaded, loading, loadError,
    chairsLoading, chairsError, chairsClinicId, load, loadChairs, reset };
});
