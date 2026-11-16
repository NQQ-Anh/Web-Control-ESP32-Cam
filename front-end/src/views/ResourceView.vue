<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import api, { apiMessage } from '../api/client'
import { formatDate, formatNumber, statusLabel, statusSeverity } from '../utils/formatters'
import { waitForCommand } from '../utils/commandTracking'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import {
  ArrowDownToLine, ChevronLeft, ChevronRight, CircleAlert,
  Cpu, Eye, KeyRound, Pencil, Plus, RefreshCw, RotateCw,
  Search, ShieldCheck, Trash2, UserRound, X, LockKeyhole,
} from '@lucide/vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const confirm = useConfirm()
const toast = useToast()
const resource = computed(() => route.meta.resource)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const rows = ref([])
const page = ref(1)
const limit = ref(10)
const total = ref(0)
const searchDraft = ref('')
const search = ref('')
const filter = ref('')
const eventFilters = reactive({ user_id: '', device_id: '', event_type: '', from: '', to: '' })
const dialogOpen = ref(false)
const credentialOpen = ref(false)
const credential = ref('')
const credentialDeviceId = ref('')
const editing = ref(null)
const form = reactive({})
const options = reactive({ users: [], devices: [] })

const configs = {
  users: {
    title: 'Người được cấp quyền', eyebrow: 'QUẢN LÝ NGƯỜI DÙNG', description: 'Danh sách người dùng được nhận diện và cấp quyền ra vào.', endpoint: '/users', createLabel: 'Thêm người dùng', createAllowed: true, filter: 'is_active',
    columns: [{ label: 'Người dùng', key: 'primary', sub: 'employee_code' }, { label: 'Email', key: 'email' }, { label: 'Phòng ban', key: 'department' }, { label: 'Trạng thái', key: 'is_active', type: 'boolean' }, { label: 'Ngày tạo', key: 'created_at', type: 'date' }],
    fields: [{ key: 'employee_code', label: 'Mã nhân viên' }, { key: 'full_name', label: 'Họ và tên', required: true }, { key: 'email', label: 'Email', type: 'email' }, { key: 'phone', label: 'Số điện thoại', type: 'tel' }, { key: 'department', label: 'Phòng ban' }, { key: 'avatar_url', label: 'URL ảnh đại diện', type: 'url' }, { key: 'notes', label: 'Ghi chú', type: 'textarea' }],
  },
  devices: {
    title: 'Thiết bị', eyebrow: 'QUẢN LÝ THIẾT BỊ', description: 'Theo dõi kết nối, firmware và lệnh của từng ESP32-CAM.', endpoint: '/devices', createLabel: 'Thêm thiết bị', createAllowed: true, filter: 'status',
    columns: [{ label: 'Thiết bị', key: 'primary', sub: 'device_code' }, { label: 'Vị trí', key: 'location' }, { label: 'Trạng thái', key: 'status', type: 'status' }, { label: 'Firmware', key: 'firmware_version' }, { label: 'Heartbeat gần nhất', key: 'last_seen_at', type: 'date' }],
    fields: [{ key: 'device_code', label: 'Mã thiết bị', required: true }, { key: 'device_name', label: 'Tên thiết bị', required: true }, { key: 'location', label: 'Vị trí' }, { key: 'firmware_version', label: 'Phiên bản firmware' }],
  },
  enrollments: {
    title: 'Đăng ký khuôn mặt', eyebrow: 'ENROLLMENT TẠI THIẾT BỊ', description: 'Theo dõi yêu cầu; thiết bị chụp và lưu mẫu khuôn mặt tại chỗ.', endpoint: '/enrollments', createLabel: 'Tạo yêu cầu', createAllowed: true, filter: 'status',
    columns: [{ label: 'Người dùng', key: 'primary', sub: 'employee_code' }, { label: 'Thiết bị', key: 'device_name' }, { label: 'Trạng thái', key: 'status', type: 'status' }, { label: 'Tạo lúc', key: 'created_at', type: 'date' }, { label: 'Hoàn tất lúc', key: 'enrolled_at', type: 'date' }],
    fields: [{ key: 'user_id', label: 'Người dùng', type: 'select', optionGroup: 'users', required: true }, { key: 'device_id', label: 'Thiết bị ESP32-CAM', type: 'select', optionGroup: 'devices', required: true }],
  },
  permissions: {
    title: 'Phân quyền truy cập', eyebrow: 'QUYỀN THEO THIẾT BỊ', description: 'Cấp, chỉnh sửa hoặc thu hồi quyền theo thời gian và thiết bị.', endpoint: '/permissions', createLabel: 'Cấp quyền', createAllowed: true, filter: 'is_allowed',
    columns: [{ label: 'Người dùng', key: 'primary', sub: 'employee_code' }, { label: 'Thiết bị', key: 'device_name' }, { label: 'Quyền', key: 'is_allowed', type: 'permission' }, { label: 'Bắt đầu', key: 'valid_from', type: 'date' }, { label: 'Hết hạn', key: 'valid_until', type: 'date' }],
    fields: [{ key: 'user_id', label: 'Người dùng', type: 'select', optionGroup: 'users', required: true }, { key: 'device_id', label: 'Thiết bị ESP32-CAM', type: 'select', optionGroup: 'devices', required: true }, { key: 'valid_from', label: 'Có hiệu lực từ', type: 'datetime', required: true }, { key: 'valid_until', label: 'Có hiệu lực đến', type: 'datetime' }, { key: 'is_allowed', label: 'Quyết định', type: 'select', options: [{ label: 'Cho phép', value: true }, { label: 'Từ chối', value: false }], required: true }, { key: 'reason', label: 'Lý do / ghi chú', type: 'textarea' }],
  },
  events: {
    title: 'Lịch sử truy cập', eyebrow: 'NHẬT KÝ SỰ KIỆN', description: 'Dòng thời gian gồm sự kiện ra vào và lệnh Web cùng kết quả ACK từ thiết bị.', endpoint: '/history', createAllowed: false, filter: 'result',
    columns: [{ label: 'Người / lệnh', key: 'primary', sub: 'employee_code' }, { label: 'Thiết bị', key: 'device_name' }, { label: 'Loại sự kiện', key: 'event_type' }, { label: 'Nguồn', key: 'source' }, { label: 'Kết quả', key: 'decision', type: 'status' }, { label: 'Độ tin cậy', key: 'confidence', type: 'confidence' }, { label: 'Thời gian', key: 'occurred_at', type: 'date' }],
  },
  admins: {
    title: 'Quản trị viên', eyebrow: 'QUẢN TRỊ HỆ THỐNG', description: 'Quản lý tài khoản đăng nhập và vai trò trong hệ thống.', endpoint: '/admins', createLabel: 'Mời quản trị viên', createAllowed: true, filter: 'role',
    columns: [{ label: 'Tài khoản', key: 'primary', sub: 'email' }, { label: 'Vai trò', key: 'role', type: 'status' }, { label: 'Trạng thái', key: 'is_active', type: 'boolean' }, { label: 'Tạo lúc', key: 'created_at', type: 'date' }],
    fields: [{ key: 'email', label: 'Địa chỉ email', type: 'email', required: true }, { key: 'full_name', label: 'Họ và tên', required: true }, { key: 'role', label: 'Vai trò', type: 'select', options: [{ label: 'Quản trị viên', value: 'admin' }, { label: 'Người vận hành', value: 'operator' }, { label: 'Người xem', value: 'viewer' }], required: true }],
  },
}

const config = computed(() => configs[resource.value])
const canWrite = computed(() => ['admin', 'operator'].includes(auth.user?.role))
const filterOptions = computed(() => {
  if (config.value?.filter === 'is_active') return [{ label: 'Tất cả trạng thái', value: '' }, { label: 'Đang hoạt động', value: 'true' }, { label: 'Ngừng hoạt động', value: 'false' }]
  if (config.value?.filter === 'is_allowed') return [{ label: 'Tất cả quyền', value: '' }, { label: 'Cho phép', value: 'true' }, { label: 'Từ chối', value: 'false' }]
  if (config.value?.filter === 'status' && resource.value === 'devices') return [{ label: 'Tất cả trạng thái', value: '' }, ...['online', 'offline', 'maintenance'].map((value) => ({ label: statusLabel(value), value }))]
  if (config.value?.filter === 'status') return [{ label: 'Tất cả trạng thái', value: '' }, ...['pending', 'completed', 'failed', 'revoked'].map((value) => ({ label: statusLabel(value), value }))]
  if (config.value?.filter === 'result') return [{ label: 'Tất cả kết quả', value: '' }, ...['allowed', 'denied', 'pending', 'sent', 'acknowledged', 'failed', 'expired'].map((value) => ({ label: statusLabel(value), value }))]
  if (config.value?.filter === 'role') return [{ label: 'Tất cả vai trò', value: '' }, ...['admin', 'operator', 'viewer'].map((value) => ({ label: statusLabel(value), value }))]
  return []
})

const valueOf = (row, key) => ({
  primary: row.record_type === 'device_command' ? commandLabel(row.command) : (row.full_name || row.device_name || row.access_users?.full_name || row.actor_name || row.employee_code || '—'),
  employee_code: row.record_type === 'device_command' ? row.actor_name : (row.employee_code || row.access_users?.employee_code),
  device_name: row.devices?.device_name || row.device_name || row.devices?.device_code,
  event_type: row.event_type === 'DOOR_COMMAND' ? 'Lệnh điều khiển cửa' : 'Sự kiện ra vào',
  source: row.source,
}[key] ?? row[key])

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const params = { page: page.value, limit: limit.value }
    if (search.value) params.q = search.value
    if (filter.value !== '') params[config.value.filter] = filter.value
    if (resource.value === 'events') {
      if (eventFilters.user_id) params.user_id = eventFilters.user_id
      if (eventFilters.device_id) params.device_id = eventFilters.device_id
      if (eventFilters.event_type) params.event_type = eventFilters.event_type
      if (eventFilters.from) params.from = new Date(eventFilters.from).toISOString()
      if (eventFilters.to) params.to = new Date(eventFilters.to).toISOString()
    }
    const { data } = await api.get(config.value.endpoint, { params })
    rows.value = data.data || []
    total.value = data.pagination?.total || 0
  } catch (requestError) {
    error.value = apiMessage(requestError, 'Không thể tải dữ liệu')
  } finally { loading.value = false }
}

const loadOptions = async () => {
  if (!['enrollments', 'permissions', 'events'].includes(resource.value)) return
  try {
    const [usersResponse, devicesResponse] = await Promise.all([
      api.get('/users', { params: { limit: 100, is_active: true } }),
      api.get('/devices', { params: { limit: 100, is_active: true } }),
    ])
    options.users = usersResponse.data.data.map((user) => ({ label: `${user.full_name}${user.employee_code ? ` · ${user.employee_code}` : ''}`, value: user.id }))
    options.devices = devicesResponse.data.data.map((device) => ({ label: `${device.device_name} · ${device.device_code}`, value: device.id }))
  } catch (requestError) {
    toast.add({ severity: 'error', summary: 'Không tải được lựa chọn', detail: apiMessage(requestError), life: 4000 })
  }
}

const searchNow = () => { search.value = searchDraft.value.trim(); page.value = 1; load() }
const changeFilter = () => { page.value = 1; load() }
const applyEventFilters = () => { page.value = 1; load() }
const setPage = (nextPage) => { page.value = nextPage; load() }

const resetForm = () => {
  for (const key of Object.keys(form)) delete form[key]
  if (resource.value === 'permissions') {
    form.valid_from = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    form.is_allowed = true
  }
  if (resource.value === 'admins') form.role = 'viewer'
}

const openCreate = async () => {
  editing.value = null
  resetForm()
  await loadOptions()
  dialogOpen.value = true
}

const openEdit = async (row) => {
  editing.value = row
  resetForm()
  await loadOptions()
  for (const field of config.value.fields || []) {
    let value = row[field.key]
    if (field.key === 'valid_from' || field.key === 'valid_until') value = value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : ''
    if (value !== undefined && value !== null) form[field.key] = value
  }
  dialogOpen.value = true
}

const payloadFromForm = () => {
  const payload = {}
  for (const field of config.value.fields || []) {
    let value = form[field.key]
    if (field.type === 'datetime') value = value ? new Date(value).toISOString() : null
    if (typeof value === 'string') value = value.trim()
    if (value === '' && field.type !== 'select') value = null
    if (value !== undefined) payload[field.key] = value
  }
  return payload
}

const submit = async () => {
  saving.value = true
  try {
    const payload = payloadFromForm()
    const isUpdate = Boolean(editing.value)
    const url = `${config.value.endpoint}${isUpdate ? `/${editing.value.id}` : ''}`
    const { data } = isUpdate ? await api.put(url, payload) : await api.post(url, payload)
    dialogOpen.value = false
    if (resource.value === 'devices' && !isUpdate && data.data?.device_credential) {
      credential.value = data.data.device_credential
      credentialDeviceId.value = data.data.device?.id || ''
      credentialOpen.value = true
    }
    toast.add({ severity: 'success', summary: isUpdate ? 'Đã cập nhật' : 'Đã tạo mới', detail: data.message || 'Dữ liệu đã được lưu.', life: 3500 })
    await load()
  } catch (requestError) {
    toast.add({ severity: 'error', summary: 'Không thể lưu', detail: apiMessage(requestError), life: 4500 })
  } finally { saving.value = false }
}

const confirmAction = ({ header, message, label, action, danger = false, trackCommand = false }) => confirm.require({
  header, message, acceptLabel: label, rejectLabel: 'Hủy', acceptClass: danger ? 'p-button-danger' : '',
  accept: async () => {
    try {
      const result = await action()
      if (trackCommand) {
        toast.add({ severity: 'info', summary: 'Đang chờ ESP32-CAM', detail: 'Lệnh đã được xếp hàng. Đang đợi ACK từ thiết bị.', life: 4500 })
        const command = await waitForCommand(api, result.data.data)
        if (command.status === 'acknowledged') {
          toast.add({ severity: 'success', summary: 'Thiết bị đã xác nhận', detail: `${commandLabel(command.command)} đã được ESP32-CAM xác nhận thực thi.`, life: 5000 })
        } else if (command.status === 'failed') {
          toast.add({ severity: 'error', summary: 'Thiết bị báo thất bại', detail: command.error_message || 'ESP32-CAM không thực thi được lệnh.', life: 5000 })
        } else if (command.status === 'expired') {
          toast.add({ severity: 'warn', summary: 'Lệnh hết thời gian chờ', detail: 'Chưa nhận được ACK. Lệnh không được gửi lại tự động; hãy kiểm tra trạng thái cửa trước khi thử lại.', life: 6500 })
        } else {
          toast.add({ severity: 'warn', summary: 'Chưa xác minh được kết quả', detail: 'Không thể đọc trạng thái lệnh. Lệnh không được gửi lại; hãy kiểm tra thiết bị và lịch sử lệnh.', life: 6500 })
        }
        await load()
        return
      }
      if (result?.data?.data?.device_credential) {
        credential.value = result.data.data.device_credential
        credentialDeviceId.value = result.data.data.device?.id || ''
        credentialOpen.value = true
      }
      toast.add({ severity: 'success', summary: 'Đã hoàn tất', detail: result?.data?.message || 'Thao tác đã được ghi nhận.', life: 3500 })
      await load()
    } catch (requestError) { toast.add({ severity: 'error', summary: 'Thao tác thất bại', detail: apiMessage(requestError), life: 4500 }) }
  },
})

const toggleStatus = (row) => {
  const current = resource.value === 'permissions' ? row.is_allowed : row.is_active
  const next = !current
  const body = resource.value === 'permissions' ? { is_allowed: next } : { is_active: next }
  confirmAction({
    header: next ? 'Kích hoạt quyền' : 'Vô hiệu hóa',
    message: next ? 'Xác nhận kích hoạt mục đã chọn?' : 'Xác nhận vô hiệu hóa? Lịch sử liên quan sẽ được giữ lại.',
    label: next ? 'Kích hoạt' : 'Vô hiệu hóa', danger: !next,
    action: () => api.patch(`${config.value.endpoint}/${row.id}/status`, body),
  })
}

const commandLabel = (command) => ({
  unlock: 'Mở cửa', lock: 'Khóa cửa', sync_permissions: 'Đồng bộ quyền', restart: 'Khởi động lại thiết bị',
}[command] || 'Lệnh')

const removeRow = (row) => confirmAction({
  header: resource.value === 'devices' ? 'Vô hiệu hóa thiết bị' : 'Thu hồi enrollment',
  message: resource.value === 'devices' ? 'Thiết bị sẽ không thể xác thực hoặc nhận lệnh mới. Các lịch sử cũ được giữ nguyên.' : 'Enrollment sẽ bị thu hồi. Không có dữ liệu khuôn mặt nào được tải lên.',
  label: resource.value === 'devices' ? 'Vô hiệu hóa' : 'Thu hồi', danger: true,
  action: () => api.delete(`${config.value.endpoint}/${row.id}`),
})

const manageStatus = (row) => {
  if (resource.value === 'users' || resource.value === 'permissions' || resource.value === 'admins') return toggleStatus(row)
  if (resource.value === 'devices') {
    return confirmAction({ header: 'Vô hiệu hóa thiết bị', message: 'Thiết bị sẽ ngừng xác thực. Có thể kích hoạt lại từ trang chi tiết.', label: 'Vô hiệu hóa', danger: true, action: () => api.patch(`/devices/${row.id}/active`, { is_active: false }) })
  }
  return removeRow(row)
}

const issueCommand = (row, command) => {
  const names = { unlock: 'Mở cửa từ xa', lock: 'Khóa cửa từ xa', sync_permissions: 'Đồng bộ quyền', restart: 'Khởi động lại thiết bị' }
  const message = command === 'unlock'
    ? `Xác nhận gửi lệnh mở cửa đến “${row.device_name}” tại ${row.location || 'vị trí chưa khai báo'}? Lệnh hết hạn sau 30 giây và chỉ được xem là hoàn tất sau khi thiết bị xác nhận.`
    : command === 'lock'
      ? `Xác nhận gửi lệnh khóa cửa đến “${row.device_name}”? Thiết bị phải đang trực tuyến; lệnh hết hạn sau 30 giây.`
    : `Xác nhận gửi lệnh “${names[command]}” đến thiết bị “${row.device_name}”?`
  confirmAction({ header: names[command], message, label: 'Gửi lệnh', danger: ['unlock', 'lock'].includes(command), trackCommand: true, action: () => api.post(`/devices/${row.id}/commands`, { command }) })
}

const downloadCsv = async () => {
  try {
    const params = {}
    if (search.value) params.q = search.value
    if (filter.value !== '') params[config.value.filter] = filter.value
    if (eventFilters.user_id) params.user_id = eventFilters.user_id
    if (eventFilters.device_id) params.device_id = eventFilters.device_id
    if (eventFilters.event_type) params.event_type = eventFilters.event_type
    if (eventFilters.from) params.from = new Date(eventFilters.from).toISOString()
    if (eventFilters.to) params.to = new Date(eventFilters.to).toISOString()
    const { data } = await api.get('/history/export', { params, responseType: 'blob' })
    const url = URL.createObjectURL(data)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `access-history-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (requestError) { toast.add({ severity: 'error', summary: 'Không thể xuất CSV', detail: apiMessage(requestError), life: 4000 }) }
}

const showDetail = (row) => {
  const name = { users: 'user-detail', devices: 'device-detail', events: 'event-detail' }[resource.value]
  if (name) router.push({ name, params: { id: row.id } })
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))
const firstRow = computed(() => total.value ? (page.value - 1) * limit.value + 1 : 0)
const lastRow = computed(() => Math.min(total.value, page.value * limit.value))
const fieldOptions = (field) => field.optionGroup ? options[field.optionGroup] : field.options
const copyCredential = async () => {
  try {
    await navigator.clipboard.writeText(credential.value)
    toast.add({ severity: 'success', summary: 'Đã sao chép', detail: 'Credential đã được sao chép.', life: 2000 })
  } catch {
    toast.add({ severity: 'error', summary: 'Không thể sao chép', detail: 'Trình duyệt không cho phép clipboard. Hãy chọn và sao chép thủ công.', life: 3000 })
  }
}
const copyDeviceId = async () => {
  try {
    await navigator.clipboard.writeText(credentialDeviceId.value)
    toast.add({ severity: 'success', summary: 'Đã sao chép', detail: 'UUID thiết bị đã được sao chép.', life: 2000 })
  } catch {
    toast.add({ severity: 'error', summary: 'Không thể sao chép', detail: 'Trình duyệt không cho phép clipboard. Hãy chọn và sao chép UUID thủ công.', life: 3000 })
  }
}

watch(resource, async () => {
  page.value = 1; search.value = ''; searchDraft.value = ''; filter.value = ''
  Object.assign(eventFilters, { user_id: '', device_id: '', event_type: '', from: '', to: '' })
  await loadOptions(); await load()
})
onMounted(async () => { await loadOptions(); await load() })
</script>

<template>
  <div
    v-if="config"
    class="resource-page"
  >
    <div class="page-heading resource-heading">
      <div>
        <div class="eyebrow">
          {{ config.eyebrow }}
        </div><h1>{{ config.title }}</h1><p>{{ config.description }}</p>
      </div>
      <div class="heading-actions">
        <Button
          v-if="resource === 'events'"
          class="button-secondary"
          @click="downloadCsv"
        >
          <template #icon>
            <ArrowDownToLine :size="16" />
          </template><span>Xuất CSV</span>
        </Button>
        <Button
          v-if="config.createAllowed && canWrite"
          class="button-primary"
          @click="openCreate"
        >
          <template #icon>
            <Plus :size="17" />
          </template><span>{{ config.createLabel }}</span>
        </Button>
      </div>
    </div>

    <section class="panel resource-panel">
      <div class="resource-toolbar">
        <div class="search-wrap">
          <Search :size="17" /><InputText
            v-model="searchDraft"
            :placeholder="resource === 'events' ? 'Tìm trong lý do hoặc nguồn sự kiện' : 'Tìm kiếm...'"
            @keyup.enter="searchNow"
          /><button
            v-if="searchDraft"
            class="clear-search"
            aria-label="Xóa tìm kiếm"
            @click="searchDraft = ''; searchNow()"
          >
            <X :size="15" />
          </button>
        </div>
        <Select
          v-if="config.filter"
          v-model="filter"
          :options="filterOptions"
          option-label="label"
          option-value="value"
          class="filter-select"
          @change="changeFilter"
        />
        <template v-if="resource === 'events'">
          <Select
            v-model="eventFilters.event_type"
            :options="[{ label: 'Tất cả loại sự kiện', value: '' }, { label: 'Sự kiện ra vào', value: 'face' }, { label: 'Lệnh điều khiển cửa', value: 'door_command' }]"
            option-label="label"
            option-value="value"
            class="filter-select"
            @change="applyEventFilters"
          />
          <Select
            v-model="eventFilters.user_id"
            :options="[{ label: 'Tất cả người dùng', value: '' }, ...options.users]"
            option-label="label"
            option-value="value"
            class="filter-select event-owner-filter"
            @change="applyEventFilters"
          />
          <Select
            v-model="eventFilters.device_id"
            :options="[{ label: 'Tất cả thiết bị', value: '' }, ...options.devices]"
            option-label="label"
            option-value="value"
            class="filter-select event-device-filter"
            @change="applyEventFilters"
          />
          <input
            v-model="eventFilters.from"
            class="event-filter-date"
            type="datetime-local"
            aria-label="Từ thời điểm"
            @change="applyEventFilters"
          >
          <input
            v-model="eventFilters.to"
            class="event-filter-date"
            type="datetime-local"
            aria-label="Đến thời điểm"
            @change="applyEventFilters"
          >
        </template>
        <Button
          class="button-secondary toolbar-search"
          @click="searchNow"
        >
          <template #icon>
            <Search :size="15" />
          </template><span>Tìm kiếm</span>
        </Button>
        <Button
          class="icon-button table-refresh"
          aria-label="Làm mới"
          :loading="loading"
          @click="load"
        >
          <RefreshCw :size="16" />
        </Button>
      </div>

      <div
        v-if="error && !loading"
        class="inline-error"
      >
        <CircleAlert :size="17" /><span>{{ error }}</span><Button
          label="Thử lại"
          class="button-link"
          @click="load"
        />
      </div>
      <div
        v-if="loading"
        class="table-loading"
      >
        <Skeleton
          v-for="row in 6"
          :key="row"
          height="54px"
          border-radius="8px"
        />
      </div>
      <div
        v-else-if="!error && rows.length"
        class="table-scroll"
      >
        <table class="data-table">
          <thead>
            <tr>
              <th
                v-for="column in config.columns"
                :key="column.key"
              >
                {{ column.label }}
              </th><th class="actions-heading">
                Thao tác
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.record_type ? `${row.record_type}:${row.id}` : row.id"
            >
              <td
                v-for="column in config.columns"
                :key="column.key"
              >
                <div
                  v-if="column.key === 'primary'"
                  class="table-primary"
                >
                  <span
                    class="table-avatar"
                    :class="resource === 'devices' ? 'device-avatar' : ''"
                  >{{ resource === 'devices' ? 'ESP' : String(valueOf(row, column.key) || '?').split(/\s+/).slice(-2).map((part) => part[0]).join('').toUpperCase() }}</span><span><strong>{{ valueOf(row, column.key) }}</strong><small>{{ valueOf(row, column.sub) || '—' }}</small></span>
                </div>
                <Tag
                  v-else-if="column.type === 'status'"
                  :value="statusLabel(row[column.key])"
                  :severity="statusSeverity(row[column.key])"
                />
                <Tag
                  v-else-if="column.type === 'boolean' || column.type === 'permission'"
                  :value="column.type === 'permission' ? (row.is_allowed ? 'Cho phép' : 'Từ chối') : (row.is_active ? 'Hoạt động' : 'Đã khóa')"
                  :severity="column.type === 'permission' ? statusSeverity(row.is_allowed ? 'allowed' : 'denied') : statusSeverity(row.is_active ? 'active' : 'inactive')"
                />
                <span
                  v-else-if="column.type === 'date'"
                  class="table-date"
                >{{ formatDate(row[column.key]) }}</span>
                <span
                  v-else-if="column.type === 'confidence'"
                  class="confidence-value"
                >{{ row.confidence === null ? '—' : `${Math.round(row.confidence * 100)}%` }}</span>
                <span
                  v-else
                  class="table-muted"
                >{{ valueOf(row, column.key) || '—' }}</span>
              </td>
              <td class="row-actions">
                <button
                  v-if="['users', 'devices'].includes(resource) || (resource === 'events' && row.record_type === 'access_event')"
                  class="row-icon-action"
                  aria-label="Xem chi tiết"
                  title="Xem chi tiết"
                  @click="showDetail(row)"
                >
                  <Eye :size="16" />
                </button>
                <button
                  v-if="['users', 'devices', 'permissions', 'admins'].includes(resource) && canWrite"
                  class="row-icon-action"
                  aria-label="Chỉnh sửa"
                  title="Chỉnh sửa"
                  @click="openEdit(row)"
                >
                  <Pencil :size="15" />
                </button>
                <button
                  v-if="['users', 'permissions', 'admins'].includes(resource) && canWrite"
                  class="row-icon-action"
                  :aria-label="row.is_active || row.is_allowed ? 'Vô hiệu hóa' : 'Kích hoạt lại'"
                  :title="row.is_active || row.is_allowed ? 'Vô hiệu hóa' : 'Kích hoạt lại'"
                  @click="manageStatus(row)"
                >
                  <ShieldCheck :size="15" />
                </button>
                <template v-if="resource === 'devices' && canWrite">
                  <button
                    class="row-icon-action row-action-command"
                    title="Khóa cửa từ xa"
                    aria-label="Khóa cửa từ xa"
                    :disabled="!row.is_active || row.status !== 'online'"
                    @click="issueCommand(row, 'lock')"
                  >
                    <LockKeyhole :size="15" />
                  </button>
                  <button
                    class="row-icon-action row-action-sync"
                    title="Đồng bộ quyền"
                    aria-label="Đồng bộ quyền"
                    @click="issueCommand(row, 'sync_permissions')"
                  >
                    <RotateCw :size="15" />
                  </button>
                  <button
                    class="row-icon-action row-action-command"
                    title="Khởi động lại"
                    aria-label="Khởi động lại"
                    @click="issueCommand(row, 'restart')"
                  >
                    <Cpu :size="15" />
                  </button>
                  <button
                    class="row-icon-action row-action-unlock"
                    title="Mở cửa từ xa"
                    aria-label="Mở cửa từ xa"
                    :disabled="!row.is_active || row.status !== 'online'"
                    @click="issueCommand(row, 'unlock')"
                  >
                    <KeyRound :size="15" />
                  </button>
                </template>
                <button
                  v-if="['enrollments', 'devices'].includes(resource) && canWrite"
                  class="row-icon-action row-action-delete"
                  title="Thu hồi / vô hiệu hóa"
                  aria-label="Thu hồi hoặc vô hiệu hóa"
                  @click="removeRow(row)"
                >
                  <Trash2 :size="15" />
                </button>
                <span
                  v-if="!canWrite && resource !== 'events'"
                  class="read-only-label"
                >Chỉ xem</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-else-if="!error"
        class="panel-empty resource-empty"
      >
        <span class="empty-art"><UserRound
          v-if="resource === 'users'"
          :size="24"
        /><Cpu
          v-else-if="resource === 'devices'"
          :size="24"
        /><ShieldCheck
          v-else-if="resource === 'permissions'"
          :size="24"
        /><KeyRound
          v-else-if="resource === 'enrollments'"
          :size="24"
        /><CircleAlert
          v-else
          :size="24"
        /></span><strong>{{ search || filter ? 'Không tìm thấy kết quả' : 'Chưa có dữ liệu' }}</strong><span>{{ search || filter ? 'Thay đổi từ khóa hoặc bộ lọc rồi thử lại.' : 'Dữ liệu sẽ hiển thị tại đây khi có bản ghi thật từ hệ thống.' }}</span><Button
          v-if="config.createAllowed && canWrite && !search && !filter"
          class="button-secondary"
          @click="openCreate"
        >
          <template #icon>
            <Plus :size="15" />
          </template><span>{{ config.createLabel }}</span>
        </Button>
      </div>

      <div
        v-if="!loading && !error && total"
        class="table-pagination"
      >
        <span>Hiển thị <strong>{{ formatNumber(firstRow) }}–{{ formatNumber(lastRow) }}</strong> trên <strong>{{ formatNumber(total) }}</strong></span><div>
          <button
            class="page-button"
            :disabled="page <= 1"
            aria-label="Trang trước"
            @click="setPage(page - 1)"
          >
            <ChevronLeft :size="17" />
          </button><span class="page-counter">Trang {{ page }} / {{ totalPages }}</span><button
            class="page-button"
            :disabled="page >= totalPages"
            aria-label="Trang sau"
            @click="setPage(page + 1)"
          >
            <ChevronRight :size="17" />
          </button>
        </div>
      </div>
    </section>

    <Dialog
      v-model:visible="dialogOpen"
      modal
      :header="editing ? `Chỉnh sửa ${config.title.toLowerCase()}` : config.createLabel"
      :style="{ width: 'min(620px, calc(100vw - 32px))' }"
      :breakpoints="{ '640px': 'calc(100vw - 24px)' }"
      class="form-dialog"
    >
      <form
        class="resource-form"
        @submit.prevent="submit"
      >
        <div
          v-for="field in config.fields"
          :key="field.key"
          class="form-field"
          :class="{ 'form-field-wide': field.type === 'textarea' }"
        >
          <label :for="`field-${field.key}`">{{ field.label }} <span v-if="field.required">*</span></label>
          <Select
            v-if="field.type === 'select'"
            :id="`field-${field.key}`"
            v-model="form[field.key]"
            :options="fieldOptions(field)"
            option-label="label"
            option-value="value"
            :placeholder="`Chọn ${field.label.toLowerCase()}`"
            :required="field.required"
          />
          <Textarea
            v-else-if="field.type === 'textarea'"
            :id="`field-${field.key}`"
            v-model="form[field.key]"
            rows="3"
            auto-resize
          />
          <Password
            v-else-if="field.type === 'password'"
            :id="`field-${field.key}`"
            v-model="form[field.key]"
            :feedback="false"
            toggle-mask
            :required="field.required"
          />
          <InputText
            v-else
            :id="`field-${field.key}`"
            v-model="form[field.key]"
            :type="field.type === 'datetime' ? 'datetime-local' : (field.type || 'text')"
            :required="field.required && !editing"
            :autocomplete="field.type === 'email' ? 'email' : 'off'"
          />
        </div>
        <div
          v-if="resource === 'enrollments'"
          class="form-note"
        >
          <ScanFace :size="17" /><span>Thiết bị sẽ nhận yêu cầu khi đồng bộ. Khuôn mặt được xử lý và lưu tại ESP32-CAM; API không tải ảnh sinh trắc học lên cloud.</span>
        </div>
        <div
          v-if="resource === 'admins' && !editing"
          class="form-note"
        >
          <ShieldCheck :size="17" /><span>Hệ thống gửi email mời xác minh đến địa chỉ này. Vai trò được cấp bởi backend.</span>
        </div>
        <div
          v-if="resource === 'devices' && !editing"
          class="form-note"
        >
          <KeyRound :size="17" /><span>Credential ngẫu nhiên chỉ hiển thị một lần sau khi tạo. Hãy lưu an toàn để cấu hình thiết bị.</span>
        </div>
        <div class="dialog-actions">
          <Button
            type="button"
            label="Hủy"
            class="button-secondary"
            @click="dialogOpen = false"
          /><Button
            type="submit"
            :label="editing ? 'Lưu thay đổi' : 'Tạo mới'"
            class="button-primary"
            :loading="saving"
          />
        </div>
      </form>
    </Dialog>

    <Dialog
      v-model:visible="credentialOpen"
      modal
      header="Lưu credential thiết bị"
      :style="{ width: 'min(520px, calc(100vw - 32px))' }"
      class="credential-dialog"
    >
      <div class="credential-content">
        <div class="credential-warning">
          <ShieldCheck :size="20" /><p>Hãy chép UUID vào DEVICE_ID và credential vào DEVICE_CREDENTIAL trong firmware. Credential chỉ xuất hiện lần này.</p>
        </div>
        <template v-if="credentialDeviceId">
          <label>Device ID (UUID)</label><code>{{ credentialDeviceId }}</code>
        </template>
        <label>Device credential</label><code>{{ credential }}</code><div class="dialog-actions">
          <Button
            v-if="credentialDeviceId"
            type="button"
            label="Sao chép UUID"
            class="button-secondary"
            @click="copyDeviceId"
          />
          <Button
            type="button"
            label="Sao chép credential"
            class="button-secondary"
            @click="copyCredential"
          /><Button
            type="button"
            label="Đã lưu an toàn"
            class="button-primary"
            @click="credentialOpen = false; credential = ''; credentialDeviceId = ''"
          />
        </div>
      </div>
    </Dialog>
  </div>
</template>
