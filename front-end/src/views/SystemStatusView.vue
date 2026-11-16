<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import api, { apiMessage } from '../api/client'
import { formatDate, formatNumber } from '../utils/formatters'
import { Activity, Cloud, Cpu, RefreshCw, ShieldCheck } from '@lucide/vue'

const status = ref(null)
const loading = ref(true)
const error = ref('')
let refreshTimer

const connectionCards = computed(() => {
  if (!status.value) return []
  return [
    { title: 'Backend Express', state: status.value.backend.status, label: 'API đang hoạt động', icon: Activity },
    { title: 'Supabase', state: status.value.database.status, label: 'Cơ sở dữ liệu đã kết nối', icon: Cloud },
  ]
})

const load = async (silent = false) => {
  if (!silent) loading.value = true
  error.value = ''
  try {
    const { data } = await api.get('/system/status')
    status.value = data.data
  } catch (requestError) {
    error.value = apiMessage(requestError, 'Không thể tải trạng thái hệ thống')
  } finally {
    if (!silent) loading.value = false
  }
}

const durationLabel = (seconds) => {
  const total = Number(seconds) || 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  return hours ? `${hours} giờ ${minutes} phút` : `${minutes} phút`
}

onMounted(() => {
  load()
  refreshTimer = window.setInterval(() => {
    if (!document.hidden) load(true)
  }, 15_000)
})
onBeforeUnmount(() => window.clearInterval(refreshTimer))
</script>

<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">
        CẤU HÌNH VÀ KẾT NỐI
      </div>
      <h1>Cài đặt hệ thống</h1>
      <p>Trạng thái kết nối và các ngưỡng vận hành đang dùng. Khóa bí mật không được hiển thị ở đây.</p>
    </div>
    <Button
      class="button-secondary"
      :loading="loading"
      @click="load()"
    >
      <template #icon>
        <RefreshCw :size="16" />
      </template><span>Làm mới</span>
    </Button>
  </div>

  <div
    v-if="loading && !status"
    class="system-status-grid"
  >
    <Skeleton
      v-for="card in 2"
      :key="card"
      height="130px"
      border-radius="14px"
    />
    <Skeleton
      height="260px"
      border-radius="14px"
    />
    <Skeleton
      height="260px"
      border-radius="14px"
    />
  </div>
  <div
    v-else-if="error && !status"
    class="state-card state-error"
  >
    <h3>Không tải được trạng thái hệ thống</h3><p>{{ error }}</p>
    <Button
      label="Thử lại"
      class="button-primary"
      @click="load()"
    />
  </div>

  <template v-else-if="status">
    <div
      v-if="error"
      class="inline-error"
    >
      {{ error }} · đang hiển thị lần kiểm tra thành công gần nhất.
    </div>
    <div class="system-status-grid">
      <section
        v-for="card in connectionCards"
        :key="card.title"
        class="panel system-connection-card"
      >
        <span class="system-connection-icon"><component
          :is="card.icon"
          :size="20"
        /></span>
        <div><small>{{ card.title }}</small><strong>{{ card.label }}</strong><span>Kiểm tra {{ formatDate(status.checked_at) }}</span></div>
        <Tag
          :value="card.state === 'connected' || card.state === 'online' ? 'Đã kết nối' : 'Mất kết nối'"
          :severity="card.state === 'connected' || card.state === 'online' ? 'success' : 'danger'"
        />
      </section>

      <section class="panel settings-panel system-config-panel">
        <div class="panel-heading">
          <div><h2>Thời gian và trạng thái thiết bị</h2><p>Giá trị hiện tại của backend, không chứa credential.</p></div><Cpu
            :size="18"
            class="heading-icon"
          />
        </div>
        <dl class="system-config-list">
          <div><dt>Heartbeat quá hạn sau</dt><dd>{{ formatNumber(status.device.offline_after_seconds) }} giây</dd></div>
          <div><dt>Chu kỳ kiểm tra offline</dt><dd>{{ formatNumber(status.device.heartbeat_monitor_interval_seconds) }} giây</dd></div>
          <div><dt>Cache quyền offline tối đa</dt><dd>{{ formatNumber(status.device.offline_cache_max_age_seconds) }} giây</dd></div>
          <div><dt>Hạn lệnh khóa / mở khóa</dt><dd>{{ formatNumber(status.device.door_command_timeout_seconds) }} giây</dd></div>
          <div><dt>Hạn lệnh đồng bộ / khởi động lại</dt><dd>{{ formatNumber(status.device.other_command_timeout_seconds) }} giây</dd></div>
          <div><dt>JWT truy cập của thiết bị</dt><dd>{{ formatNumber(status.device.device_access_token_ttl_seconds) }} giây</dd></div>
          <div><dt>Yêu cầu HTTPS cho thiết bị</dt><dd>{{ status.device.device_https_required ? 'Bắt buộc trong production' : 'Chưa bắt buộc ở môi trường hiện tại' }}</dd></div>
        </dl>
      </section>

      <section class="panel settings-panel system-config-panel">
        <div class="panel-heading">
          <div><h2>Luồng giao tiếp</h2><p>Web và thiết bị đều đi qua Express.</p></div><ShieldCheck
            :size="18"
            class="heading-icon"
          />
        </div>
        <div class="system-flow">
          <div><strong>Vue 3</strong><span>Gọi REST API với phiên người dùng</span></div><i>↓</i>
          <div><strong>Express</strong><span>Xác thực, kiểm tra quyền và ghi nhật ký</span></div><i>↓</i>
          <div><strong>Supabase</strong><span>PostgreSQL, Auth và dữ liệu hệ thống</span></div>
          <div class="system-device-flow">
            <strong>ESP32-CAM</strong><span>Device token, heartbeat, polling lệnh và ACK</span>
          </div>
        </div>
        <p class="system-note">
          Trạng thái cửa chỉ xác định được sau khi firmware gửi <code>door_state</code> trong heartbeat. Giá trị chưa được báo sẽ hiển thị là chưa xác định.
        </p>
      </section>

      <section class="panel settings-panel system-runtime-panel">
        <div class="panel-heading">
          <div><h2>Tiến trình backend</h2><p>Thông tin vận hành không nhạy cảm.</p></div><Activity
            :size="18"
            class="heading-icon"
          />
        </div>
        <dl class="system-config-list">
          <div><dt>Node.js</dt><dd>{{ status.backend.node_version }}</dd></div>
          <div><dt>Thời gian hoạt động</dt><dd>{{ durationLabel(status.backend.uptime_seconds) }}</dd></div>
          <div><dt>Độ trễ truy vấn Supabase</dt><dd>{{ formatNumber(status.database.latency_ms) }} ms</dd></div>
          <div><dt>Cập nhật giao diện</dt><dd>Mỗi {{ formatNumber(status.updates.recommended_interval_seconds) }} giây khi trang đang mở</dd></div>
        </dl>
      </section>
    </div>
  </template>
</template>
