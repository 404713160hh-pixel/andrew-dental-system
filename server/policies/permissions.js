import { permissions as businessPermissions } from '../services/business.js';
export const permissionsByRole={
  customer:['patient.save','appointment.book','appointment.cancel','appointment.reschedule'],
  front:['patient.lookup','patient.save','schedule.save','appointment.book','appointment.cancel','appointment.reschedule','appointment.status','settlement.create'],
  clinical:['visit.save','visit.complete'],
  manager:['patient.lookup','patient.save','clinic.save','dentist.save','qualification.save','schedule.save','treatment.save','appointment.book','appointment.cancel','appointment.reschedule','appointment.status','visit.save','visit.complete','settlement.create','cost.save','cost.review','quarter.compute','quarter.approve','settings.save']
};
for(const [role,commands] of Object.entries(businessPermissions))permissionsByRole[role]=[...new Set([...(permissionsByRole[role]||[]),...commands])];
export function publicUser(user) { return {...user,permissions:permissionsByRole[user.role]||[]}; }
