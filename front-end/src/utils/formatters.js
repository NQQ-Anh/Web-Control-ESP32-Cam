export const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(Number(value) || 0)

export const formatDate = (value, options = {}) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
    ...options,
  }).format(date)
}

export const statusLabel = (value) => ({
  online: 'Trực tuyến', offline: 'Ngoại tuyến', maintenance: 'Bảo trì',
  allowed: 'Cho phép', denied: 'Từ chối', pending: 'Đang chờ', completed: 'Hoàn tất',
  failed: 'Thất bại', revoked: 'Đã thu hồi', acknowledged: 'Đã xác nhận', sent: 'Đã gửi',
  expired: 'Hết thời gian', unknown: 'Chưa xác định', locked: 'Đã khóa', unlocked: 'Đã mở khóa',
  active: 'Đang hoạt động', inactive: 'Ngừng hoạt động', admin: 'Quản trị viên',
  operator: 'Người vận hành', viewer: 'Người xem',
}[value] || value || '—')

export const statusSeverity = (value) => ({
  online: 'success', allowed: 'success', completed: 'success', acknowledged: 'success', active: 'success',
  pending: 'warn', sent: 'info', maintenance: 'warn', operator: 'info', unlocked: 'warn', locked: 'success',
  offline: 'danger', denied: 'danger', failed: 'danger', expired: 'danger', revoked: 'secondary', inactive: 'secondary', viewer: 'secondary', unknown: 'secondary',
}[value] || 'secondary')

export const displayError = (error) => error?.response?.data?.message || error?.message || 'Không thể tải dữ liệu.'
