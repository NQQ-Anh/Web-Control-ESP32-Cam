<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api/client'
import { displayError, formatDate, formatNumber, statusLabel, statusSeverity } from '../utils/formatters'
import {
  ArrowRight, ArrowUpRight, BadgeCheck, CircleAlert, Clock3,
  Cpu, History, RefreshCw, ShieldCheck, UsersRound, Wifi, WifiOff,
} from '@lucide/vue'

const router = useRouter()
const loading = ref(true)
const error = ref('')
const summary = ref(null)
const accessDays = ref([])
const recentEvents = ref([])
const deviceStats = ref(null)
let refreshTimer
const historyActionLabel = (event) => ({
  unlock: 'Mở cửa từ Web', lock: 'Khóa cửa từ Web', sync_permissions: 'Đồng bộ quyền', restart: 'Khởi động lại thiết bị',
}[event.action] || (event.record_type === 'device_command' ? 'Lệnh điều khiển' : 'Kiểm tra ra vào'))

const maxDaily = computed(() => Math.max(1, ...accessDays.value.map((day) => day.total)))
const successRate = computed(() => {
  const total = summary.value?.access_today?.total || 0
  return total ? Math.round((summary.value.access_today.allowed / total) * 100) : 0
})
const chartPoints = computed(() => {
  if (!accessDays.value.length) return ''
  const width = 700
  const height = 205
  const step = width / Math.max(1, accessDays.value.length - 1)
  return accessDays.value.map((day, index) => {
    const y = height - ((day.total / maxDaily.value) * (height - 24)) - 12
    return `${index * step},${y}`
  }).join(' ')
})

const load = async (silent = false) => {
  if (!silent) loading.value = true
  error.value = ''
  try {
    const [summaryResponse, statsResponse, eventsResponse, devicesResponse] = await Promise.all([
      api.get('/dashboard/summary'),
      api.get('/dashboard/access-statistics'),
      api.get('/history?limit=7'),
      api.get('/dashboard/device-statistics'),
    ])
    summary.value = summaryResponse.data.data
    accessDays.value = statsResponse.data.data
    recentEvents.value = eventsResponse.data.data
    deviceStats.value = devicesResponse.data.data
  } catch (requestError) {
    error.value = displayError(requestError)
  } finally {
    if (!silent) loading.value = false
  }
}

const openEvent = (id) => router.push({ name: 'event-detail', params: { id } })
onMounted(() => {
  load()
  refreshTimer = window.setInterval(() => {
    if (!document.hidden) load(true)
  }, 15_000)
})
onBeforeUnmount(() => window.clearInterval(refreshTimer))
</script>

<template>
  <div class="page-heading dashboard-heading">
    <div>
      <div class="eyebrow">
        TỔNG QUAN HỆ THỐNG
      </div><h1>Chào buổi sáng</h1><p>Theo dõi hoạt động kiểm soát ra vào hôm nay.</p>
    </div>
    <Button
      class="button-secondary refresh-button"
      :loading="loading"
      @click="load"
    >
      <template #icon>
        <RefreshCw :size="16" />
      </template><span>Làm mới dữ liệu</span>
    </Button>
  </div>

  <div
    v-if="loading"
    class="dashboard-loading"
  >
    <Skeleton
      v-for="item in 4"
      :key="item"
      height="118px"
      border-radius="14px"
    />
    <Skeleton
      height="300px"
      border-radius="14px"
    />
    <Skeleton
      height="300px"
      border-radius="14px"
    />
  </div>
  <div
    v-else-if="error && !summary"
    class="state-card state-error"
  >
    <div class="state-icon error-icon">
      <CircleAlert :size="22" />
    </div><h3>Không tải được tổng quan</h3><p>{{ error }}</p><Button
      label="Thử lại"
      class="button-primary"
      @click="load"
    />
  </div>

  <template v-else-if="summary">
    <div class="stats-grid">
      <article class="stat-card">
        <div class="stat-top">
          <span class="stat-icon stat-blue"><UsersRound :size="18" /></span><span class="stat-trend"><ArrowUpRight :size="14" /> HỒ SƠ</span>
        </div><div class="stat-value">
          {{ formatNumber(summary.users.total) }}
        </div><div class="stat-caption">
          Người được cấp quyền
        </div><div class="stat-foot">
          <span class="dot dot-green" />{{ formatNumber(summary.users.active) }} đang hoạt động <span class="foot-divider">·</span>{{ formatNumber(summary.enrollments.completed) }} enrollment hoàn tất
        </div>
      </article>
      <article class="stat-card">
        <div class="stat-top">
          <span class="stat-icon stat-violet"><Cpu :size="18" /></span><span class="stat-trend">THIẾT BỊ</span>
        </div><div class="stat-value">
          {{ formatNumber(summary.devices.total) }}
        </div><div class="stat-caption">
          Thiết bị đã đăng ký
        </div><div class="stat-foot">
          <span class="dot dot-green" />{{ formatNumber(summary.devices.online) }} trực tuyến <span class="foot-divider">·</span><span class="dot dot-red" />{{ formatNumber(summary.devices.offline) }} ngoại tuyến
        </div>
      </article>
      <article class="stat-card">
        <div class="stat-top">
          <span class="stat-icon stat-teal"><History :size="18" /></span><span class="stat-trend">HÔM NAY</span>
        </div><div class="stat-value">
          {{ formatNumber(summary.access_today.total) }}
        </div><div class="stat-caption">
          Lượt kiểm tra ra vào
        </div><div class="stat-foot">
          <span class="dot dot-green" />{{ formatNumber(summary.access_today.allowed) }} được cho phép <span class="foot-divider">·</span>{{ formatNumber(summary.web_unlocks_today) }} lệnh Web mở cửa đã ACK
        </div>
      </article>
      <article class="stat-card">
        <div class="stat-top">
          <span class="stat-icon stat-amber"><ShieldCheck :size="18" /></span><span class="stat-trend">TỶ LỆ THÀNH CÔNG</span>
        </div><div class="stat-value">
          {{ successRate }}<small>%</small>
        </div><div class="stat-caption">
          Lượt truy cập được phép
        </div><div class="stat-foot">
          <span class="dot dot-red" />{{ formatNumber(summary.access_today.denied) }} lượt bị từ chối
        </div>
      </article>
    </div>

    <div class="dashboard-grid">
      <section class="panel access-chart-panel">
        <div class="panel-heading">
          <div><h2>Hoạt động truy cập</h2><p>Lượt kiểm tra trong 7 ngày gần nhất</p></div><div class="chart-legend">
            <span><i class="legend-line" />Tất cả lượt</span><span><i class="legend-dot legend-allowed" />Cho phép</span>
          </div>
        </div>
        <div class="chart-summary">
          <strong>{{ formatNumber(accessDays.reduce((total, day) => total + day.total, 0)) }}</strong><span>lượt trong tuần</span><span class="chart-change"><ArrowUpRight :size="14" /> dữ liệu thực</span>
        </div>
        <div class="line-chart-wrap">
          <div class="chart-y-labels">
            <span>{{ maxDaily }}</span><span>{{ Math.round(maxDaily * .66) }}</span><span>{{ Math.round(maxDaily * .33) }}</span><span>0</span>
          </div>
          <svg
            class="line-chart"
            viewBox="0 0 700 220"
            preserveAspectRatio="none"
            role="img"
            aria-label="Biểu đồ lượt truy cập 7 ngày"
          >
            <defs><linearGradient
              id="chartFill"
              x1="0"
              x2="0"
              y1="0"
              y2="1"
            ><stop
              offset="0%"
              stop-color="#477cf4"
              stop-opacity=".17"
            /><stop
              offset="100%"
              stop-color="#477cf4"
              stop-opacity="0"
            /></linearGradient></defs>
            <line
              v-for="line in [24, 82, 140, 198]"
              :key="line"
              x1="0"
              :y1="line"
              x2="700"
              :y2="line"
              class="chart-gridline"
            />
            <polygon
              v-if="chartPoints"
              :points="`0,220 ${chartPoints} 700,220`"
              fill="url(#chartFill)"
            />
            <polyline
              v-if="chartPoints"
              :points="chartPoints"
              fill="none"
              class="chart-line"
            />
            <circle
              v-for="(day, index) in accessDays"
              :key="day.date"
              :cx="index * (700 / Math.max(1, accessDays.length - 1))"
              :cy="198 - ((day.total / maxDaily) * 174)"
              r="4.5"
              class="chart-point"
            ><title>{{ day.date }} · {{ day.total }} lượt</title></circle>
          </svg>
        </div>
        <div class="chart-x-labels">
          <span
            v-for="day in accessDays"
            :key="day.date"
          >{{ day.date.slice(5) }}</span>
        </div>
      </section>

      <section class="panel device-health-panel">
        <div class="panel-heading">
          <div><h2>Tình trạng thiết bị</h2><p>Trạng thái được ghi nhận từ backend</p></div><Cpu
            :size="19"
            class="heading-icon"
          />
        </div>
        <div
          v-if="deviceStats"
          class="device-health-content"
        >
          <div class="access-ratio-row">
            <div
              class="access-donut"
              :style="{ '--success-rate': `${successRate}%` }"
            >
              <span>{{ successRate }}<small>%</small></span>
            </div><div class="ratio-legend">
              <strong>Tỷ lệ được cho phép</strong><div><i class="health-dot health-online" />{{ formatNumber(summary.access_today.allowed) }} cho phép</div><div><i class="health-dot health-offline" />{{ formatNumber(summary.access_today.denied) }} bị từ chối</div>
            </div>
          </div>
          <div class="health-total">
            <strong>{{ formatNumber(deviceStats.counts.online + deviceStats.counts.offline + deviceStats.counts.maintenance) }}</strong><span>thiết bị đang quản lý</span>
          </div>
          <div class="health-bars">
            <div><span class="health-label"><i class="health-dot health-online" />Trực tuyến</span><strong>{{ formatNumber(deviceStats.counts.online) }}</strong></div><div class="health-track">
              <i
                class="health-fill fill-online"
                :style="{ width: `${deviceStats.counts.online ? Math.max(5, deviceStats.counts.online / Math.max(1, summary.devices.total) * 100) : 0}%` }"
              />
            </div><div><span class="health-label"><i class="health-dot health-offline" />Ngoại tuyến</span><strong>{{ formatNumber(deviceStats.counts.offline) }}</strong></div><div class="health-track">
              <i
                class="health-fill fill-offline"
                :style="{ width: `${deviceStats.counts.offline ? Math.max(5, deviceStats.counts.offline / Math.max(1, summary.devices.total) * 100) : 0}%` }"
              />
            </div><div><span class="health-label"><i class="health-dot health-maintenance" />Bảo trì</span><strong>{{ formatNumber(deviceStats.counts.maintenance) }}</strong></div><div class="health-track">
              <i
                class="health-fill fill-maintenance"
                :style="{ width: `${deviceStats.counts.maintenance ? Math.max(5, deviceStats.counts.maintenance / Math.max(1, summary.devices.total) * 100) : 0}%` }"
              />
            </div>
          </div>
          <div class="door-state-summary">
            <span>Trạng thái cửa báo lần gần nhất</span>
            <div><strong>{{ formatNumber(deviceStats.door_state_counts.locked) }}</strong><small>Đã khóa</small></div>
            <div><strong>{{ formatNumber(deviceStats.door_state_counts.unlocked) }}</strong><small>Đã mở khóa</small></div>
            <div><strong>{{ formatNumber(deviceStats.door_state_counts.unknown) }}</strong><small>Chưa xác định</small></div>
          </div>
          <RouterLink
            class="panel-link"
            to="/devices"
          >Xem danh sách thiết bị <ArrowRight :size="15" /></RouterLink>
        </div>
      </section>
    </div>

    <div class="dashboard-bottom-grid">
      <section class="panel recent-panel">
        <div class="panel-heading">
          <div><h2>Hoạt động gần đây</h2><p>Sự kiện ra vào và lệnh điều khiển theo thời gian</p></div><RouterLink
            to="/events"
            class="text-link"
          >Xem tất cả <ArrowRight :size="14" /></RouterLink>
        </div>
        <div
          v-if="recentEvents.length"
          class="recent-list"
        >
          <button
            v-for="event in recentEvents"
            :key="event.id"
            class="recent-row"
            :disabled="event.record_type === 'device_command'"
            @click="event.record_type === 'access_event' && openEvent(event.id)"
          >
            <span
              class="event-status-icon"
              :class="event.record_type === 'device_command' ? 'event-command' : event.decision === 'allowed' ? 'event-allowed' : 'event-denied'"
            ><Cpu
              v-if="event.record_type === 'device_command'"
              :size="17"
            /><BadgeCheck
              v-else-if="event.decision === 'allowed'"
              :size="17"
            /><CircleAlert
              v-else
              :size="17"
            /></span>
            <span class="event-main"><strong>{{ event.actor_name || event.access_users?.full_name || 'Không nhận diện' }}</strong><small>{{ historyActionLabel(event) }} <span>·</span> {{ event.devices?.device_name || event.devices?.device_code || 'Thiết bị' }} <span>·</span> {{ event.source }}</small></span>
            <Tag
              :value="statusLabel(event.decision)"
              :severity="statusSeverity(event.decision)"
            />
            <span class="event-time"><Clock3 :size="13" />{{ formatDate(event.occurred_at) }}</span>
          </button>
        </div>
        <div
          v-else
          class="panel-empty"
        >
          <History :size="23" /><strong>Chưa có hoạt động</strong><span>Sự kiện ra vào và kết quả lệnh sẽ xuất hiện tại đây.</span>
        </div>
      </section>
      <section class="panel alerts-panel">
        <div class="panel-heading">
          <div><h2>Cần chú ý</h2><p>Cảnh báo dựa trên trạng thái hiện tại</p></div><CircleAlert
            :size="19"
            class="heading-icon"
          />
        </div>
        <div
          v-if="deviceStats?.offline_devices?.length"
          class="alert-list"
        >
          <RouterLink
            v-for="device in deviceStats.offline_devices.slice(0, 4)"
            :key="device.id"
            :to="`/devices/${device.id}`"
            class="alert-row"
          ><span class="alert-device-icon"><WifiOff :size="16" /></span><span><strong>{{ device.device_name }}</strong><small>{{ device.location || device.device_code }} · {{ device.last_seen_at ? `Hoạt động ${formatDate(device.last_seen_at)}` : 'Chưa có heartbeat' }}</small></span><ArrowRight :size="15" /></RouterLink>
          <RouterLink
            v-if="deviceStats.offline_devices.length > 4"
            to="/devices"
            class="alert-more"
          >Và {{ deviceStats.offline_devices.length - 4 }} thiết bị khác đang ngoại tuyến</RouterLink>
        </div>
        <div
          v-else
          class="all-clear"
        >
          <span><Wifi :size="17" /></span><strong>Không có thiết bị ngoại tuyến</strong><small>Không phát hiện cảnh báo từ trạng thái backend.</small>
        </div>
      </section>
    </div>
  </template>
</template>
