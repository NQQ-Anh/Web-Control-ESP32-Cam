<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import api, { apiMessage } from '../api/client'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import {
  Activity, Bell, ChevronDown, Cpu, History, KeyRound, LayoutDashboard,
  LogOut, Menu, ScanFace, Settings, ShieldCheck, UserRound, UsersRound, Wifi, WifiOff, X,
} from '@lucide/vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const confirm = useConfirm()
const toast = useToast()
const sidebarOpen = ref(false)
const accountOpen = ref(false)
const backendOnline = ref(false)
const pingTimer = ref()

const navigation = computed(() => {
  const links = [
    { label: 'Tổng quan', to: '/dashboard', icon: LayoutDashboard },
    { label: 'Người được cấp quyền', to: '/users', icon: UsersRound },
    { label: 'Đăng ký khuôn mặt', to: '/enrollments', icon: ScanFace },
    { label: 'Thiết bị', to: '/devices', icon: Cpu },
    { label: 'Phân quyền truy cập', to: '/permissions', icon: KeyRound },
    { label: 'Lịch sử truy cập', to: '/events', icon: History },
    { label: 'Cài đặt hệ thống', to: '/settings', icon: Settings },
  ]
  if (auth.user?.role === 'admin') links.push({ label: 'Quản trị viên', to: '/admins', icon: ShieldCheck })
  return links
})

const title = computed(() => route.meta.title || 'Face Access Control')
const initials = computed(() => (auth.user?.full_name || auth.user?.email || 'AD').split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase())

const ping = async () => {
  try { await api.get('/health'); backendOnline.value = true } catch { backendOnline.value = false }
}

const closeSidebar = () => { sidebarOpen.value = false }
const logout = () => confirm.require({
  header: 'Đăng xuất',
  message: 'Bạn có muốn kết thúc phiên làm việc hiện tại không?',
  icon: 'pi pi-sign-out',
  acceptLabel: 'Đăng xuất',
  rejectLabel: 'Ở lại',
  acceptClass: 'p-button-danger',
  accept: async () => {
    try { await auth.logout() } catch (error) { toast.add({ severity: 'warn', summary: 'Phiên đã đóng', detail: apiMessage(error), life: 3500 }) }
    router.push('/login')
  },
})

const onExpired = () => {
  auth.clearSession()
  router.replace({ name: 'login', query: { expired: '1' } })
}

watch(() => route.fullPath, closeSidebar)
onMounted(() => {
  ping()
  pingTimer.value = window.setInterval(ping, 30_000)
  window.addEventListener('auth:expired', onExpired)
})
onBeforeUnmount(() => {
  window.clearInterval(pingTimer.value)
  window.removeEventListener('auth:expired', onExpired)
})
</script>

<template>
  <div class="app-shell">
    <div
      v-if="sidebarOpen"
      class="mobile-scrim"
      @click="closeSidebar"
    />
    <aside
      class="sidebar"
      :class="{ 'sidebar-open': sidebarOpen }"
    >
      <div class="brand-lockup">
        <div class="brand-mark">
          <ScanFace
            :size="23"
            :stroke-width="2.2"
          />
        </div>
        <div><strong>FaceAccess</strong><span>CONTROL CENTER</span></div>
        <button
          class="icon-button sidebar-close"
          aria-label="Đóng menu"
          @click="closeSidebar"
        >
          <X :size="19" />
        </button>
      </div>

      <div class="workspace-label">
        KHÔNG GIAN LÀM VIỆC
      </div>
      <div class="workspace-switcher">
        <div class="workspace-dot">
          <Activity :size="17" />
        </div>
        <div><strong>Hệ thống kiểm soát</strong><span>Thiết bị IoT · Việt Nam</span></div>
        <ChevronDown
          :size="15"
          class="muted-icon"
        />
      </div>

      <nav
        class="main-nav"
        aria-label="Điều hướng chính"
      >
        <span class="nav-caption">QUẢN LÝ</span>
        <RouterLink
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          class="nav-link"
          :class="{ 'nav-link-active': route.path.startsWith(item.to) }"
        >
          <component
            :is="item.icon"
            :size="18"
            :stroke-width="1.9"
          />
          <span>{{ item.label }}</span>
        </RouterLink>
        <span class="nav-caption nav-caption-lower">TÀI KHOẢN</span>
        <RouterLink
          to="/profile"
          class="nav-link"
          :class="{ 'nav-link-active': route.path === '/profile' }"
        >
          <UserRound
            :size="18"
            :stroke-width="1.9"
          /><span>Tài khoản cá nhân</span>
        </RouterLink>
      </nav>

      <div class="sidebar-bottom">
        <div class="help-card">
          <div class="help-icon">
            <ShieldCheck :size="18" />
          </div>
          <strong>Bảo mật là ưu tiên</strong>
          <p>Khuôn mặt được xử lý trực tiếp trên thiết bị.</p>
        </div>
        <button
          class="nav-link logout-link"
          @click="logout"
        >
          <LogOut :size="18" /><span>Đăng xuất</span>
        </button>
        <div class="sidebar-version">
          Face Access Control <span>v1.0</span>
        </div>
      </div>
    </aside>

    <section class="main-shell">
      <header class="topbar">
        <div class="topbar-left">
          <button
            class="icon-button mobile-menu"
            aria-label="Mở menu"
            @click="sidebarOpen = true"
          >
            <Menu :size="21" />
          </button>
          <div class="breadcrumb">
            <span>FaceAccess</span><span class="breadcrumb-slash">/</span><strong>{{ title }}</strong>
          </div>
        </div>
        <div class="topbar-actions">
          <div
            class="connection-pill"
            :class="backendOnline ? 'connection-online' : 'connection-offline'"
          >
            <Wifi
              v-if="backendOnline"
              :size="15"
            /><WifiOff
              v-else
              :size="15"
            />
            <span>{{ backendOnline ? 'Hệ thống hoạt động' : 'Mất kết nối API' }}</span>
          </div>
          <button
            class="icon-button notification-button"
            aria-label="Thông báo"
            title="Thông báo chưa có sự kiện mới"
          >
            <Bell :size="19" /><i />
          </button>
          <div class="account-wrap">
            <button
              class="account-button"
              @click="accountOpen = !accountOpen"
            >
              <span class="avatar">{{ initials }}</span>
              <span class="account-label"><strong>{{ auth.user?.full_name || 'Quản trị viên' }}</strong><small>{{ auth.user?.role }}</small></span>
              <ChevronDown
                :size="15"
                class="muted-icon"
              />
            </button>
            <div
              v-if="accountOpen"
              class="account-menu"
            >
              <RouterLink
                to="/profile"
                @click="accountOpen = false"
              ><UserRound :size="16" />Tài khoản cá nhân</RouterLink>
              <button @click="accountOpen = false; logout()">
                <LogOut :size="16" />Đăng xuất
              </button>
            </div>
          </div>
        </div>
      </header>
      <main class="page-content">
        <RouterView />
      </main>
    </section>
    <Toast position="bottom-right" />
    <ConfirmDialog />
  </div>
</template>
