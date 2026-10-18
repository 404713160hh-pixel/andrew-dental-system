// core/selectors.js — one responsibility within the dental workspace.
import { state, user } from './context.js';

export const nameOf = (list, id) => (state?.[list]||[]).find(x=>x.id===id)?.name || id || '—';

export const get = (list, id) => (state?.[list]||[]).find(x=>x.id===id);

export const visitAppointment = visit => visit ? get('appointments',visit.appointmentId)||{start:visit.appointmentStart,end:visit.appointmentEnd} : undefined;

export const can = action => user?.permissions?.includes(action) || false;

export const customer = () => user?.role === 'customer';

export const scopedClinic = id => user.role==='hq'||user.clinicIds?.includes(id);

export const editableVisit = v => can('visit.save')&&(user.role==='hq'||(user.role==='manager'&&scopedClinic(v.clinicId))||v.dentistId===user.dentistId);

export const options = (list, filter=()=>true) => (state[list]||[]).filter(filter).map(x=>({value:x.id,label:x.name}));

export function profileComplete(p){return !!(p&&p.name&&p.dob&&p.phone&&p.address&&p.emergencyName&&p.emergencyPhone&&['unknown','none','known'].includes(p.allergyStatus)&&(p.allergyStatus!=='unknown'||p.allergyDeclaredAt)&&(p.allergyStatus!=='known'||p.allergies?.length));}
