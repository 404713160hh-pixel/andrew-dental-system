import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { PatientCandidate } from '@andrew/shared';
export const useBooking = defineStore('booking', () => {
  const patient = ref<PatientCandidate | null>(null);
  return { patient };
});
