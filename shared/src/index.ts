/** Wire contracts for /api/v1. Instants are ISO 8601 with timezone; versions are integers. */
export type Role = 'patient' | 'front' | 'doctor' | 'manager' | 'hq';
export type AllergyStatus = 'unknown' | 'none_reported' | 'known';
export interface Assignment { role: Exclude<Role, 'patient'>; clinicId: string | null }
export interface Principal { id: string; username: string; displayName: string; patientId: string | null; staffId: string | null; roles: Role[]; assignments: Assignment[] }
export interface LoginResult { token: string; expiresAt: string; user: Principal }
export interface AuthConfig { demoLoginEnabled: boolean; demoAccounts: {username: string; displayName: string; portal: 'patient' | 'staff'}[]; wechatLoginEnabled: boolean }
export interface Patient { id: string; name: string; birthDate: string; phone: string; email: string | null; billingAddress: string; emergencyName: string; emergencyPhone: string; allergyStatus: AllergyStatus; allergies: string[]; rowVersion: number; isDemo?: boolean }
export type PatientInput = Omit<Patient, 'id' | 'rowVersion' | 'isDemo'>;
export interface Clinic { id: string; name: string; address: string; phone: string; email: string; timezone: 'Asia/Shanghai'; active: boolean; rowVersion: number }
export interface Qualification { id: string; name: string; active: boolean; rowVersion: number }
export interface DentistQualification { qualificationId: string; qualificationName?: string; validFrom: string; validUntil: string | null }
export interface Doctor { id: string; employeeNo: string; name: string; phone: string; specialty: string; active: boolean; rowVersion: number; qualifications: DentistQualification[]; serviceIds: string[]; isDemo?: boolean; bio?: string; focusAreas?: string[]; clinicIds?: string[] }
/** User-supplied, unverified treatment-price reference; never an appointment or treatment quote. */
export interface TreatmentReference { id: string; category: string; name: string; priceMinCents: number; priceMaxCents: number; unit: string; referenceYear: number; sourceLabel: string; description: string; bookingServiceId: string | null }
export interface Service { id: string; name: string; description: string; durationMinutes: number; bufferMinutes: number; priceCents: number; unit: string; active: boolean; clinicIds: string[]; qualificationIds: string[]; rowVersion: number }
export interface Chair { id: string; clinicId: string; name: string; active: boolean; rowVersion: number }
export interface Shift { id: string; clinicId: string; doctorId: string; doctorName: string; startsAt: string; endsAt: string; status: 'published' | 'cancelled'; serviceIds: string[]; rowVersion: number }
export interface BookingSlot { clinicId: string; clinicName: string; serviceId: string; serviceName: string; doctorId: string; doctorName: string; chairId: string; shiftId: string; startsAt: string; endsAt: string; occupiedUntil: string; durationMinutes: number; bufferMinutes: number; priceCents: number }
export interface SlotSelection { clinicId: string; serviceId: string; doctorId: string; chairId: string; shiftId: string; startsAt: string }
export interface BookingPolicy { holdSeconds: number; cancellationNoticeMinutes: number; transferBufferMinutes: number; slotStepMinutes: number; timezone: 'Asia/Shanghai' }
export interface Hold { id: string; expiresAt: string; rowVersion: number; slot: BookingSlot; policy: BookingPolicy }
export type AppointmentStatus = 'confirmed' | 'cancelled' | 'rescheduled';
export interface Appointment { id: string; appointmentNo: string; patientId: string; patientName: string; clinicId: string; clinicName: string; clinicAddress: string; doctorId: string; doctorName: string; serviceId: string; serviceName: string; chairId: string; startsAt: string; endsAt: string; occupiedUntil: string; status: AppointmentStatus; attendance: 'not_recorded'; rowVersion: number; supersedesAppointmentId: string | null; replacementAppointmentId: string | null; cancellationReason: string | null; createdAt: string; policy: BookingPolicy; events?: AppointmentEvent[]; doctorIsDemo?: boolean; patientIsDemo?: boolean }
export interface AppointmentEvent { id: string; kind: string; reason: string | null; occurredAt: string; actorName: string }
export interface ConfirmInput { holdId: string; holdVersion: number; patientId?: string; patientConfirmed: true; rulesAccepted: true }
export interface ChangeInput { intent: 'cancel' | 'reschedule'; expectedVersion: number; reason: string; holdId?: string; holdVersion?: number }
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
export interface ApiSuccess<T> { data: T; requestId: string }
export interface ApiErrorResponse { error: { code: string; message: string; details?: unknown }; requestId: string }
export interface CommandResult { status: 'completed' | 'not_found'; result?: Appointment }
