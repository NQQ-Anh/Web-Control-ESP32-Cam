import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from './stores/auth'
const LoginView = () => import('./views/LoginView.vue')
const AdminLayout = () => import('./layouts/AdminLayout.vue')
const DashboardView = () => import('./views/DashboardView.vue')
const ResourceView = () => import('./views/ResourceView.vue')
const DetailView = () => import('./views/DetailView.vue')
const ProfileView = () => import('./views/ProfileView.vue')
const InviteView = () => import('./views/InviteView.vue')
const RegisterView = () => import('./views/RegisterView.vue')
const SystemStatusView = () => import('./views/SystemStatusView.vue')

const routes = [
  { path: '/login', name: 'login', component: LoginView, meta: { guestOnly: true } },
  { path: '/register', name: 'register', component: RegisterView, meta: { guestOnly: true } },
  { path: '/invite', name: 'invite', component: InviteView },
  {
    path: '/', component: AdminLayout, meta: { requiresAuth: true }, children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', name: 'dashboard', component: DashboardView, meta: { title: 'Tổng quan' } },
      { path: 'users', name: 'users', component: ResourceView, meta: { title: 'Người được cấp quyền', resource: 'users' } },
      { path: 'users/:id', name: 'user-detail', component: DetailView, meta: { title: 'Chi tiết người dùng', resource: 'users' } },
      { path: 'enrollments', name: 'enrollments', component: ResourceView, meta: { title: 'Đăng ký khuôn mặt', resource: 'enrollments' } },
      { path: 'devices', name: 'devices', component: ResourceView, meta: { title: 'Thiết bị', resource: 'devices' } },
      { path: 'devices/:id', name: 'device-detail', component: DetailView, meta: { title: 'Chi tiết thiết bị', resource: 'devices' } },
      { path: 'permissions', name: 'permissions', component: ResourceView, meta: { title: 'Phân quyền truy cập', resource: 'permissions' } },
      { path: 'events', name: 'events', component: ResourceView, meta: { title: 'Lịch sử truy cập', resource: 'events' } },
      { path: 'events/:id', name: 'event-detail', component: DetailView, meta: { title: 'Chi tiết sự kiện', resource: 'events' } },
      { path: 'settings', name: 'settings', component: SystemStatusView, meta: { title: 'Cài đặt hệ thống' } },
      { path: 'admins', name: 'admins', component: ResourceView, meta: { title: 'Quản trị viên', resource: 'admins', roles: ['admin'] } },
      { path: 'profile', name: 'profile', component: ProfileView, meta: { title: 'Tài khoản cá nhân' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  const signedIn = await auth.restore()
  if (to.meta.requiresAuth && !signedIn) return { name: 'login', query: { redirect: to.fullPath } }
  if (to.meta.guestOnly && signedIn) return { name: 'dashboard' }
  if (to.meta.roles && !to.meta.roles.includes(auth.user?.role)) return { name: 'dashboard' }
  return true
})

export default router
