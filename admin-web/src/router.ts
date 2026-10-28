import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from './stores/auth';
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      component: () => import('./views/LoginView.vue'),
      meta: { public: true, title: '工作人员登录' },
    },
    { path: '/', redirect: '/appointments' },
    { path: '/change-password', component: () => import('./views/ChangePasswordView.vue'), meta: { title: '修改密码' } },
    { path: '/staff/accounts', component: () => import('./views/StaffAccountsView.vue'), meta: { title: '员工账号', hq: true } },
    {
      path: '/appointments',
      component: () => import('./views/AppointmentsView.vue'),
      meta: { title: '预约总览' },
    },
    {
      path: '/patients',
      component: () => import('./views/PatientsView.vue'),
      meta: { title: '患者档案', book: true },
    },
    {
      path: '/booking',
      component: () => import('./views/BookingView.vue'),
      meta: { title: '患者代约', book: true },
    },
    {
      path: '/shifts',
      component: () => import('./views/ShiftsView.vue'),
      meta: { title: '医生排班' },
    },
    {
      path: '/resources/:kind(clinics|doctors|services|chairs|qualifications)',
      component: () => import('./views/ResourcesView.vue'),
      meta: { title: '基础资源', manage: true },
    },
    { path: '/:pathMatch(.*)*', redirect: '/appointments' },
  ],
});
router.beforeEach(async (to) => {
  const auth = useAuth();
  await auth.restore();
  if (!to.meta.public && !auth.user) return { path: '/login', query: { next: to.fullPath } };
  if (auth.user?.mustChangePassword && to.path !== '/change-password') return '/change-password';
  if (auth.user && to.path === '/login') return '/appointments';
  if (to.meta.hq && !auth.isHq) return '/appointments';
  if ((to.meta.manage && !auth.canManage) || (to.meta.book && !auth.canBook))
    return '/appointments';
});
