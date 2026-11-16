<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import api, { apiMessage } from '../api/client'
import { formatDate, statusLabel, statusSeverity } from '../utils/formatters'
import { waitForCommand } from '../utils/commandTracking'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { ArrowLeft, ArrowRight, CircleAlert, Clock3, Cpu, Fingerprint, KeyRound, LockKeyhole, RotateCw, ShieldCheck, Wifi, WifiOff } from '@lucide/vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const confirm = useConfirm()
const toast = useToast()
const loading = ref(true)
const error = ref('')
const record = ref(null)
const events = ref([])
const permissions = ref([])
const enrollments = ref([])
const commands = ref([])
const credential = ref('')
const credentialOpen = ref(false)
let refreshTimer

const resource = computed(() => route.meta.resource)
const endpoint = computed(() => ({ users: '/users', devices: '/devices', events: '/events' }[resource.value]))
const title = computed(() => resource.value === 'users' ? (record.value?.full_name || 'Người dùng') : resource.value === 'devices' ? (record.value?.device_name || 'Thiết bị') : 'Sự kiện truy cập')
const canOperate = computed(() => ['admin', 'operator'].includes(auth.user?.role))
const commandLabel = (command) => ({
  unlock: 'Mở cửa', lock: 'Khóa cửa', sync_permissions: 'Đồng bộ quyền', restart: 'Khởi động lại thiết bị',
}[command] || command)
const detailRows = computed(() => {
  if (!record.value) return []
  const r = record.value
  if (resource.value === 'users') return [
    ['Mã nhân viên', r.employee_code], ['Email', r.email], ['Số điện thoại', r.phone], ['Phòng ban', r.department],
    ['Trạng thái', statusLabel(r.is_active ? 'active' : 'inactive')], ['Tạo lúc', formatDate(r.created_at)], ['Cập nhật lúc', formatDate(r.updated_at)], ['Ghi chú', r.notes],
  ]
  if (resource.value === 'devices') return [
    ['Mã thiết bị', r.device_code], ['Vị trí', r.location], ['Trạng thái kết nối', statusLabel(r.status)], ['Trạng thái cửa báo gần nhất', statusLabel(r.door_state)],
    ['Cập nhật trạng thái cửa', formatDate(r.door_state_updated_at)], ['Hoạt động', r.is_active ? 'Có' : 'Không'],
    ['Firmware', r.firmware_version], ['Heartbeat gần nhất', formatDate(r.last_seen_at)], ['Tạo lúc', formatDate(r.created_at)], ['Cập nhật lúc', formatDate(r.updated_at)],
  ]
  return [
    ['Kết quả', statusLabel(r.decision)], ['Người dùng', r.access_users?.full_name || 'Không nhận diện'], ['Mã nhân viên', r.access_users?.employee_code],
    ['Thiết bị', r.devices?.device_name || r.devices?.device_code], ['Độ tin cậy', r.confidence === null ? '—' : `${Math.round(r.confidence * 100)}%`],
    ['Nguồn sự kiện', r.event_source], ['Lý do', r.reason], ['Thời gian', formatDate(r.occurred_at)],
  ]
})

const load = async (silent = false) => {
  if (!silent) loading.value = true
  error.value = ''
  try {
    const { data } = await api.get(`${endpoint.value}/${route.params.id}`)
    record.value = data.data
    if (resource.value === 'users') {
      const [eventResponse, permissionResponse, enrollmentResponse] = await Promise.all([
        api.get('/events', { params: { user_id: route.params.id, limit: 8 } }),
        api.get('/permissions', { params: { user_id: route.params.id, limit: 8 } }),
        api.get('/enrollments', { params: { user_id: route.params.id, limit: 8 } }),
      ])
      events.value = eventResponse.data.data
      permissions.value = permissionResponse.data.data
      enrollments.value = enrollmentResponse.data.data
    }
    if (resource.value === 'devices') {
      const [eventResponse, commandResponse] = await Promise.all([
        api.get(`/devices/${route.params.id}/events`, { params: { limit: 8 } }),
        api.get(`/devices/${route.params.id}/commands`, { params: { limit: 8 } }),
      ])
      events.value = eventResponse.data.data
      commands.value = commandResponse.data.data
    }
  } catch (requestError) { error.value = apiMessage(requestError, 'Không thể tải chi tiết') }
  finally { if (!silent) loading.value = false }
}

const ask = (header, message, label, action, danger = false, trackCommand = false) => confirm.require({
  header, message, acceptLabel: label, rejectLabel: 'Hủy', acceptClass: danger ? 'p-button-danger' : '',
  accept: async () => {
    try {
      const { data } = await action()
      if (trackCommand) {
        toast.add({ severity: 'info', summary: 'Đang chờ ESP32-CAM', detail: 'Lệnh đã được xếp hàng. Giao diện sẽ chỉ báo kết quả sau khi nhận ACK.', life: 4500 })
        const result = await waitForCommand(api, data.data)
        if (result.status === 'acknowledged') {
          toast.add({ severity: 'success', summary: 'Thiết bị đã xác nhận', detail: `ESP32-CAM đã xác nhận: ${commandLabel(data.data.command)}.`, life: 5000 })
        } else if (result.status === 'failed') {
          toast.add({ severity: 'error', summary: 'Thiết bị báo thất bại', detail: result.error_message || 'ESP32-CAM không thực thi được lệnh.', life: 5000 })
        } else if (result.status === 'expired') {
          toast.add({ severity: 'warn', summary: 'Lệnh hết thời gian chờ', detail: 'Chưa nhận được ACK. Lệnh không được gửi lại tự động; hãy kiểm tra trạng thái cửa trước khi thử lại.', life: 6500 })
        } else {
          toast.add({ severity: 'warn', summary: 'Chưa xác minh được kết quả', detail: 'Không thể đọc trạng thái lệnh. Lệnh không được gửi lại; hãy kiểm tra thiết bị và lịch sử lệnh.', life: 6500 })
        }
        await load()
        return
      }
      if (data.data?.device_credential) {
        credential.value = data.data.device_credential
        credentialOpen.value = true
      }
      toast.add({ severity: 'success', summary: 'Đã gửi yêu cầu', detail: data.message || 'Trạng thái đã được cập nhật.', life: 4000 })
      await load()
    } catch (requestError) { toast.add({ severity: 'error', summary: 'Không thể hoàn tất', detail: apiMessage(requestError), life: 4500 }) }
  },
})

const issueCommand = (command) => {
  const labels = { unlock: 'Mở cửa từ xa', lock: 'Khóa cửa từ xa', sync_permissions: 'Đồng bộ quyền', restart: 'Khởi động lại thiết bị' }
  const message = command === 'unlock'
    ? `Xác nhận gửi lệnh mở cửa đến “${record.value.device_name}” tại ${record.value.location || 'vị trí chưa khai báo'}? Lệnh hết hạn sau 30 giây. Chỉ xác nhận thành công sau ACK từ ESP32-CAM.`
    : command === 'lock'
      ? `Xác nhận gửi lệnh khóa cửa đến “${record.value.device_name}”? Thiết bị phải đang trực tuyến; lệnh hết hạn sau 30 giây và chỉ hoàn tất sau ACK.`
      : `Xác nhận gửi lệnh “${labels[command]}” đến thiết bị này?`
  ask(labels[command], message, 'Gửi lệnh', () => api.post(`/devices/${record.value.id}/commands`, { command }), ['unlock', 'lock'].includes(command), true)
}

const setActive = () => ask(record.value.is_active ? 'Vô hiệu hóa thiết bị' : 'Kích hoạt thiết bị', record.value.is_active ? 'Thiết bị sẽ ngừng xác thực và lệnh đang chờ sẽ hết hạn.' : 'Thiết bị sẽ được kích hoạt lại ở trạng thái ngoại tuyến.', record.value.is_active ? 'Vô hiệu hóa' : 'Kích hoạt', () => api.patch(`/devices/${record.value.id}/active`, { is_active: !record.value.is_active }), record.value.is_active)
const setStatus = (status) => ask('Cập nhật trạng thái', `Đặt trạng thái thiết bị thành “${statusLabel(status)}”?`, 'Cập nhật', () => api.patch(`/devices/${record.value.id}/status`, { status }))
const rotateCredential = () => ask('Cấp lại credential', 'Credential cũ sẽ mất hiệu lực ngay. Bạn cần cập nhật credential mới lên firmware thiết bị.', 'Cấp credential mới', () => api.post(`/devices/${record.value.id}/credentials/rotate`), true)
const back = () => router.back()
const copyCredential = async () => {
  try { await navigator.clipboard.writeText(credential.value); toast.add({ severity: 'success', summary: 'Đã sao chép', life: 2000 }) }
  catch { toast.add({ severity: 'error', summary: 'Không thể sao chép', detail: 'Hãy chọn credential và sao chép thủ công.', life: 3000 }) }
}

watch(() => route.params.id, () => load())
onMounted(() => {
  load()
  refreshTimer = window.setInterval(() => {
    if (!document.hidden && resource.value === 'devices') load(true)
  }, 15_000)
})
onBeforeUnmount(() => window.clearInterval(refreshTimer))
</script>

<template>
  <div class="detail-page">
    <div class="page-heading detail-heading">
      <div>
        <button
          class="back-link"
          @click="back"
        >
          <ArrowLeft :size="15" />Quay lại danh sách
        </button><div class="eyebrow">
          {{ resource === 'users' ? 'HỒ SƠ NGƯỜI DÙNG' : resource === 'devices' ? 'THÔNG TIN THIẾT BỊ' : 'NHẬT KÝ KHÔNG THỂ CHỈNH SỬA' }}
        </div><h1>{{ title }}</h1><p>{{ resource === 'events' ? 'Sự kiện được ghi nhận từ thiết bị và không thể sửa hoặc xóa.' : 'Thông tin và hoạt động liên quan được tải từ API hệ thống.' }}</p>
      </div><div
        v-if="resource === 'devices' && record"
        class="detail-status"
      >
        <Tag
          :value="statusLabel(record.status)"
          :severity="statusSeverity(record.status)"
        /><span
          class="detail-active"
          :class="record.is_active ? 'is-active' : 'is-inactive'"
        >{{ record.is_active ? 'Đang kích hoạt' : 'Đã vô hiệu hóa' }}</span>
      </div>
    </div>

    <div
      v-if="loading"
      class="detail-loading"
    >
      <Skeleton
        height="270px"
        border-radius="14px"
      /><Skeleton
        height="230px"
        border-radius="14px"
      />
    </div>
    <div
      v-else-if="error && !record"
      class="state-card state-error"
    >
      <CircleAlert :size="23" /><h3>Không tải được thông tin</h3><p>{{ error }}</p><Button
        label="Thử lại"
        class="button-primary"
        @click="load"
      />
    </div>
    <template v-else-if="record">
      <div
        v-if="error"
        class="inline-error"
      >
        {{ error }}
      </div>
      <section class="panel detail-card">
        <div class="detail-card-heading">
          <div
            class="detail-avatar"
            :class="resource === 'devices' ? 'device-avatar' : ''"
          >
            {{ resource === 'devices' ? 'ESP' : resource === 'events' ? 'EV' : (record.full_name || 'U').split(/\s+/).slice(-2).map((part) => part[0]).join('').toUpperCase() }}
          </div><div><h2>{{ title }}</h2><p>{{ resource === 'users' ? record.employee_code || 'Chưa có mã nhân viên' : resource === 'devices' ? record.device_code : record.id }}</p></div><Tag
            v-if="resource === 'events'"
            :value="statusLabel(record.decision)"
            :severity="statusSeverity(record.decision)"
          />
        </div>
        <div class="detail-fields">
          <div
            v-for="[label, value] in detailRows"
            :key="label"
            class="detail-field"
          >
            <span>{{ label }}</span><strong>{{ value || '—' }}</strong>
          </div>
        </div>
      </section>

      <section
        v-if="resource === 'devices' && canOperate"
        class="panel device-control-panel"
      >
        <div class="panel-heading">
          <div><h2>Điều khiển thiết bị</h2><p>Lệnh được xác nhận sau khi thiết bị gửi ACK.</p></div><Cpu
            :size="19"
            class="heading-icon"
          />
        </div>
        <div class="device-control-actions">
          <Button
            class="button-primary"
            :disabled="!record.is_active || record.status !== 'online'"
            @click="issueCommand('unlock')"
          >
            <template #icon>
              <KeyRound :size="16" />
            </template><span>Mở cửa từ xa</span>
          </Button>
          <Button
            class="button-danger-outline"
            :disabled="!record.is_active || record.status !== 'online'"
            @click="issueCommand('lock')"
          >
            <template #icon>
              <LockKeyhole :size="16" />
            </template><span>Khóa cửa từ xa</span>
          </Button>
          <Button
            class="button-secondary"
            :disabled="!record.is_active"
            @click="issueCommand('sync_permissions')"
          >
            <template #icon>
              <RotateCw :size="16" />
            </template><span>Đồng bộ quyền</span>
          </Button>
          <Button
            class="button-secondary"
            :disabled="!record.is_active"
            @click="issueCommand('restart')"
          >
            <template #icon>
              <Cpu :size="16" />
            </template><span>Khởi động lại</span>
          </Button>
          <Button
            class="button-secondary"
            @click="rotateCredential"
          >
            <template #icon>
              <ShieldCheck :size="16" />
            </template><span>Cấp lại credential</span>
          </Button>
          <Button
            class="button-secondary"
            :disabled="!record.is_active"
            @click="setStatus(record.status === 'maintenance' ? 'offline' : 'maintenance')"
          >
            <template #icon>
              <WifiOff :size="16" />
            </template><span>{{ record.status === 'maintenance' ? 'Kết thúc bảo trì' : 'Đặt bảo trì' }}</span>
          </Button>
          <Button
            :class="record.is_active ? 'button-danger-outline' : 'button-secondary'"
            @click="setActive"
          >
            <template #icon>
              <Wifi
                v-if="!record.is_active"
                :size="16"
              /><WifiOff
                v-else
                :size="16"
              />
            </template><span>{{ record.is_active ? 'Vô hiệu hóa' : 'Kích hoạt lại' }}</span>
          </Button>
        </div>
      </section>

      <div
        v-if="resource === 'users'"
        class="detail-related-grid"
      >
        <section class="panel related-panel">
          <div class="panel-heading">
            <div><h2>Quyền truy cập</h2><p>Quyền đã cấp cho người dùng</p></div><KeyRound
              :size="18"
              class="heading-icon"
            />
          </div><div
            v-if="permissions.length"
            class="related-list"
          >
            <div
              v-for="item in permissions"
              :key="item.id"
              class="related-row"
            >
              <span><strong>{{ item.devices?.device_name || 'Thiết bị' }}</strong><small>{{ formatDate(item.valid_from) }} – {{ formatDate(item.valid_until) }}</small></span><Tag
                :value="item.is_allowed ? 'Cho phép' : 'Từ chối'"
                :severity="statusSeverity(item.is_allowed ? 'allowed' : 'denied')"
              />
            </div>
          </div><div
            v-else
            class="related-empty"
          >
            Chưa có quyền truy cập.
          </div>
        </section>
        <section class="panel related-panel">
          <div class="panel-heading">
            <div><h2>Đăng ký khuôn mặt</h2><p>Trạng thái do thiết bị xác nhận</p></div><Fingerprint
              :size="18"
              class="heading-icon"
            />
          </div><div
            v-if="enrollments.length"
            class="related-list"
          >
            <div
              v-for="item in enrollments"
              :key="item.id"
              class="related-row"
            >
              <span><strong>{{ item.devices?.device_name || 'Thiết bị' }}</strong><small>{{ formatDate(item.created_at) }}</small></span><Tag
                :value="statusLabel(item.status)"
                :severity="statusSeverity(item.status)"
              />
            </div>
          </div><div
            v-else
            class="related-empty"
          >
            Chưa có yêu cầu đăng ký.
          </div>
        </section>
      </div>

      <section
        v-if="resource === 'devices'"
        class="panel related-panel"
      >
        <div class="panel-heading">
          <div><h2>Sự kiện thiết bị</h2><p>Hoạt động truy cập gần đây từ camera</p></div><RouterLink
            to="/events"
            class="text-link"
          >Lịch sử đầy đủ <ArrowRight :size="14" /></RouterLink>
        </div><div
          v-if="events.length"
          class="related-list"
        >
          <div
            v-for="event in events"
            :key="event.id"
            class="related-row"
          >
            <span><strong>{{ event.decision === 'allowed' ? 'Truy cập được cho phép' : 'Truy cập bị từ chối' }}</strong><small>{{ event.reason || '—' }} · {{ formatDate(event.occurred_at) }}</small></span><Tag
              :value="statusLabel(event.decision)"
              :severity="statusSeverity(event.decision)"
            />
          </div>
        </div><div
          v-else
          class="related-empty"
        >
          Chưa có sự kiện từ thiết bị.
        </div>
      </section>

      <section
        v-if="resource === 'devices'"
        class="panel related-panel"
      >
        <div class="panel-heading">
          <div><h2>Lệnh thiết bị</h2><p>Trạng thái phản hồi của lệnh gần đây</p></div><Cpu
            :size="18"
            class="heading-icon"
          />
        </div><div
          v-if="commands.length"
          class="related-list"
        >
          <div
            v-for="command in commands"
            :key="command.id"
            class="related-row"
          >
            <span><strong>{{ commandLabel(command.command) }}</strong><small>{{ formatDate(command.requested_at) }}<template v-if="command.error_message"> · {{ command.error_message }}</template></small></span><Tag
              :value="statusLabel(command.status)"
              :severity="statusSeverity(command.status)"
            />
          </div>
        </div><div
          v-else
          class="related-empty"
        >
          Chưa có lệnh nào.
        </div>
      </section>

      <section
        v-if="resource === 'users'"
        class="panel related-panel"
      >
        <div class="panel-heading">
          <div><h2>Lịch sử truy cập</h2><p>Sự kiện gần đây của người dùng</p></div><Clock3
            :size="18"
            class="heading-icon"
          />
        </div><div
          v-if="events.length"
          class="related-list"
        >
          <RouterLink
            v-for="event in events"
            :key="event.id"
            :to="{ name: 'event-detail', params: { id: event.id } }"
            class="related-row related-link"
          ><span><strong>{{ event.devices?.device_name || 'Thiết bị' }}</strong><small>{{ formatDate(event.occurred_at) }}</small></span><Tag
            :value="statusLabel(event.decision)"
            :severity="statusSeverity(event.decision)"
          /></RouterLink>
        </div><div
          v-else
          class="related-empty"
        >
          Chưa có lịch sử truy cập.
        </div>
      </section>
    </template>

    <Dialog
      v-model:visible="credentialOpen"
      modal
      header="Credential mới của thiết bị"
      :style="{ width: 'min(520px, calc(100vw - 32px))' }"
    >
      <div class="credential-content">
        <div class="credential-warning">
          <ShieldCheck :size="20" /><p>Credential cũ đã bị thu hồi. Cập nhật credential mới lên firmware; giá trị này không thể xem lại sau khi đóng.</p>
        </div><label>Device credential</label><code>{{ credential }}</code><div class="dialog-actions">
          <Button
            label="Sao chép"
            class="button-secondary"
            @click="copyCredential"
          /><Button
            label="Đã lưu"
            class="button-primary"
            @click="credentialOpen = false; credential = ''"
          />
        </div>
      </div>
    </Dialog>
  </div>
</template>
