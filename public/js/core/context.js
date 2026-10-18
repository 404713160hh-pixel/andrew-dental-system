// core/context.js — one responsibility within the dental workspace.

export const root = document.querySelector('#root');

export const dialog = document.querySelector('#dialog');

export const toastBox = document.querySelector('#toast');

export const ui = {offset:0, limit:25,resourceTab:'clinics', appointmentStatus:'all', appointmentDate:'', patientSearch:'', bookingClinic:'', bookingDentist:'', bookingDate:'', bookingDateInitialized:false, bookingLimit:24, quarter:'', appointmentClinic:'', appointmentDentist:''};

export let state = null;
export function setState(value) { state = value; }
export let user = null;
export function setUser(value) { user = value; }
export let csrfToken = null;
export function setCsrfToken(value) { csrfToken = value; }
export let currentPage = 'home';
export function setCurrentPage(value) { currentPage = value; }
export let authMode = 'login';
export function setAuthMode(value) { authMode = value; }
export let busy = false;
export function setBusy(value) { busy = value; }
export let toastTimer = null;
export function setToastTimer(value) { toastTimer = value; }
export let demoEnabled = false;
export function setDemoEnabled(value) { demoEnabled = value; }
export let pendingWriteConfirmation = false;
export function setPendingWriteConfirmation(value) { pendingWriteConfirmation = value; }
export let pendingAuthConfirmation = false;
export function setPendingAuthConfirmation(value) { pendingAuthConfirmation = value; }
export let authSubmitting = false;
export function setAuthSubmitting(value) { authSubmitting = value; }
export let pendingRequests = 0;
export function setPendingRequests(value) { pendingRequests = value; }
export let initializing = false;
export function setInitializing(value) { initializing = value; }
