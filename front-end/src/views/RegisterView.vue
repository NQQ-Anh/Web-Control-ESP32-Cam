<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import api, { apiMessage } from '../api/client'
import { ArrowRight, CircleAlert, ScanFace, ShieldCheck } from '@lucide/vue'

const router = useRouter()
const auth = useAuthStore()
const form = reactive({ full_name: '', email: '', password: '', confirmation: '' })
const loading = ref(false)
const error = ref('')
const confirmationMessage = ref('')

const submit = async () => {
  error.value = ''
  confirmationMessage.value = ''
  if (form.password !== form.confirmation) {
    error.value = 'Hai mật khẩu không khớp.'
    return
  }
  if (form.password.length < 12) {
    error.value = 'Mật khẩu cần có ít nhất 12 ký tự.'
    return
  }

  loading.value = true
  try {
    const { data } = await api.post('/auth/register', {
      full_name: form.full_name,
      email: form.email.trim(),
      password: form.password,
    })
    if (data.data.session && data.data.user) {
      auth.completeRegistration(data.data)
      await router.replace('/dashboard')
      return
    }
    confirmationMessage.value = data.message || 'Nếu email có thể đăng ký, hướng dẫn xác minh sẽ được gửi đến hộp thư.'
  } catch (requestError) {
    error.value = apiMessage(requestError, 'Không thể tạo tài khoản. Hãy kiểm tra thông tin và thử lại.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="invite-page">
    <section class="invite-card register-card">
      <div class="invite-brand">
        <span class="login-brand-mark"><ScanFace :size="23" /></span><strong>FaceAccess</strong>
      </div>
      <div class="invite-heading">
        <span class="login-kicker">TẠO TÀI KHOẢN MỚI</span>
        <h1>Đăng ký</h1>
        <p>Tạo tài khoản để truy cập hệ thống. Tài khoản mới bắt đầu với quyền chỉ xem.</p>
      </div>

      <form
        class="login-form"
        @submit.prevent="submit"
      >
        <div class="form-field">
          <label for="register-name">Họ và tên</label>
          <InputText
            id="register-name"
            v-model="form.full_name"
            autocomplete="name"
            maxlength="255"
            placeholder="Nguyễn Văn A"
            required
          />
        </div>
        <div class="form-field">
          <label for="register-email">Email</label>
          <InputText
            id="register-email"
            v-model="form.email"
            type="email"
            autocomplete="email"
            maxlength="254"
            placeholder="ten@congty.vn"
            required
          />
        </div>
        <div class="form-field">
          <label for="register-password">Mật khẩu</label>
          <Password
            id="register-password"
            v-model="form.password"
            :feedback="true"
            maxlength="128"
            toggle-mask
            autocomplete="new-password"
            placeholder="Ít nhất 12 ký tự"
            required
          />
        </div>
        <div class="form-field">
          <label for="register-confirmation">Xác nhận mật khẩu</label>
          <Password
            id="register-confirmation"
            v-model="form.confirmation"
            :feedback="false"
            maxlength="128"
            toggle-mask
            autocomplete="new-password"
            placeholder="Nhập lại mật khẩu"
            required
          />
        </div>
        <div
          v-if="error"
          class="login-error"
        >
          <CircleAlert :size="16" /><span>{{ error }}</span>
        </div>
        <div
          v-if="confirmationMessage"
          class="register-success"
          role="status"
        >
          <ShieldCheck :size="17" /><span>{{ confirmationMessage }}</span>
        </div>
        <Button
          type="submit"
          class="login-submit"
          label="Tạo tài khoản"
          :loading="loading"
        >
          <template #icon>
            <ArrowRight :size="17" />
          </template>
        </Button>
      </form>
      <div class="auth-switch">
        Đã có tài khoản? <RouterLink to="/login">Đăng nhập</RouterLink>
      </div>
      <div class="login-assurance">
        <ShieldCheck :size="16" /><span>Email được xác thực qua Supabase Auth</span>
      </div>
    </section>
  </main>
</template>
