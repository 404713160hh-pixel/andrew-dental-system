import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { Patient } from '@andrew/shared';
export const useBooking = defineStore('booking', () => {
  const patient = ref<Patient | null>(null);
  return { patient };
});
