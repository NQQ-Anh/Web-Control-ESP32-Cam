<script setup>
import { computed, reactive, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import api, { apiMessage } from '../api/client'
import { statusLabel } from '../utils/formatters'
import { useToast } from 'primevue/usetoast'
import { LockKeyhole, ShieldCheck, UserRound } from '@lucide/vue'

const auth = useAuthStore()
const toast = useToast()
const savingProfile = ref(false)
const savingPassword = ref(false)
const profile = reactive({ full_name: auth.user?.full_name || '' })
const passwordForm = reactive({ password: '', confirmation: '' })
const initials = computed(() => (auth.user?.full_name || auth.user?.email || 'AD').split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase())

const saveProfile = async () => {
  savingProfile.value = true
  try {
    const { data } = await api.patch('/auth/me', { full_name: profile.full_name.trim() })
    auth.updateUser(data.data)
    toast.add({ severity: 'success', summary: 'Đã cập nhật', detail: 'Thông tin cá nhân đã được lưu.', life: 3000 })
  } catch (error) { toast.add({ severity: 'error', summary: 'Không thể lưu', detail: apiMessage(error), life: 4000 }) }
  finally { savingProfile.value = false }
}

const changePassword = async () => {
  if (passwordForm.password.length < 12) {
    toast.add({ severity: 'warn', summary: 'Mật khẩu chưa đủ mạnh', detail: 'Hãy dùng ít nhất 12 ký tự.', life: 3500 })
    return
  }
  if (passwordForm.password !== passwordForm.confirmation) {
    toast.add({ severity: 'warn', summary: 'Mật khẩu không khớp', detail: 'Hai ô mật khẩu cần giống nhau.', life: 3500 })
    return
  }
  savingPassword.value = true
  try {
    const { data } = await api.put('/auth/password', { password: passwordForm.password })
    passwordForm.password = ''
    passwordForm.confirmation = ''
    toast.add({ severity: 'success', summary: 'Đã đổi mật khẩu', detail: data.message, life: 3500 })
  } catch (error) { toast.add({ severity: 'error', summary: 'Không thể đổi mật khẩu', detail: apiMessage(error), life: 4000 }) }
  finally { savingPassword.value = false }
}
</script>

<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">
        CÀI ĐẶT TÀI KHOẢN
      </div><h1>Tài khoản cá nhân</h1><p>Cập nhật thông tin và bảo vệ tài khoản quản trị.</p>
    </div>
  </div>
  <div class="profile-grid">
    <section class="panel profile-summary">
      <span class="profile-avatar">{{ initials }}</span><h2>{{ auth.user?.full_name || 'Quản trị viên' }}</h2><p>{{ auth.user?.email || '—' }}</p><Tag
        :value="statusLabel(auth.user?.role)"
        :severity="auth.user?.role === 'admin' ? 'info' : 'secondary'"
      /><div class="profile-divider" /><div class="profile-security">
        <ShieldCheck :size="18" /><span>Xác thực bằng Supabase Auth</span>
      </div><small>Vai trò được lấy từ hồ sơ trên máy chủ.</small>
    </section>

    <div class="profile-forms">
      <section class="panel settings-panel">
        <div class="panel-heading">
          <div><h2>Thông tin cơ bản</h2><p>Tên hiển thị trong hệ thống.</p></div><UserRound
            :size="18"
            class="heading-icon"
          />
        </div><form
          class="settings-form"
          @submit.prevent="saveProfile"
        >
          <div class="form-field">
            <label for="profile-name">Họ và tên</label><InputText
              id="profile-name"
              v-model="profile.full_name"
              maxlength="255"
              required
            />
          </div><div class="form-field">
            <label>Địa chỉ email</label><InputText
              :model-value="auth.user?.email"
              disabled
            />
          </div><Button
            type="submit"
            label="Lưu thay đổi"
            class="button-primary"
            :loading="savingProfile"
          />
        </form>
      </section>

      <section class="panel settings-panel">
        <div class="panel-heading">
          <div><h2>Đổi mật khẩu</h2><p>Chọn mật khẩu mới có ít nhất 12 ký tự.</p></div><LockKeyhole
            :size="18"
            class="heading-icon"
          />
        </div><form
          class="settings-form"
          @submit.prevent="changePassword"
        >
          <div class="form-field">
            <label for="new-password">Mật khẩu mới</label><Password
              id="new-password"
              v-model="passwordForm.password"
              :feedback="true"
              toggle-mask
              autocomplete="new-password"
              required
            />
          </div><div class="form-field">
            <label for="confirm-password">Xác nhận mật khẩu mới</label><Password
              id="confirm-password"
              v-model="passwordForm.confirmation"
              :feedback="false"
              toggle-mask
              autocomplete="new-password"
              required
            />
          </div><Button
            type="submit"
            label="Cập nhật mật khẩu"
            class="button-primary"
            :loading="savingPassword"
          />
        </form>
      </section>
    </div>
  </div>
</template>
