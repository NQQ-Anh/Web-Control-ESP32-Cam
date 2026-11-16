<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { apiMessage } from '../api/client'
import { ArrowRight, CircleAlert, Fingerprint, ScanFace, ShieldCheck, Signal } from '@lucide/vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const email = ref('')
const password = ref('')
const loading = ref(false)
const successMessage = ref(route.query.confirmed ? 'Email đã được xác minh. Bạn có thể đăng nhập.' : '')
const errorMessage = ref(route.query.expired ? 'Phiên làm việc đã hết hạn. Đăng nhập lại để tiếp tục.' : '')

const submit = async () => {
  errorMessage.value = ''
  loading.value = true
  try {
    await auth.login({ email: email.value.trim(), password: password.value })
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') && !route.query.redirect.startsWith('//')
      ? route.query.redirect
      : '/dashboard'
    await router.replace(redirect)
  } catch (error) {
    errorMessage.value = apiMessage(error, 'Không thể đăng nhập. Kiểm tra lại thông tin và thử lại.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <section class="login-showcase">
      <div class="showcase-grid" />
      <div class="login-brand">
        <span class="login-brand-mark"><ScanFace :size="23" /></span><strong>FaceAccess</strong>
      </div>
      <div class="showcase-copy">
        <div class="showcase-eyebrow">
          <span /> SMART ACCESS CONTROL
        </div>
        <h1>An toàn hơn,<br><em>thông minh hơn.</em></h1>
        <p>Kiểm soát ra vào tập trung, kết nối bảo mật với hệ thống thiết bị nhận diện khuôn mặt của bạn.</p>
        <div class="showcase-points">
          <div><span><Fingerprint :size="17" /></span><strong>Nhận diện tại thiết bị</strong><small>Dữ liệu khuôn mặt được giữ cục bộ</small></div>
          <div><span><ShieldCheck :size="17" /></span><strong>Phân quyền an toàn</strong><small>Quản lý quyền truy cập theo vai trò</small></div>
          <div><span><Signal :size="17" /></span><strong>Theo dõi thời gian thực</strong><small>Trạng thái và lịch sử từ thiết bị</small></div>
        </div>
      </div>
      <div class="showcase-foot">
        <span>FACE ACCESS CONTROL SYSTEM</span><span>© 2026</span>
      </div>
      <div class="showcase-orb orb-one" /><div class="showcase-orb orb-two" />
    </section>

    <section class="login-panel">
      <div class="login-card">
        <div class="login-mobile-brand">
          <span class="login-brand-mark"><ScanFace :size="23" /></span><strong>FaceAccess</strong>
        </div>
        <div class="login-heading">
          <span class="login-kicker">CHÀO MỪNG TRỞ LẠI</span><h2>Đăng nhập</h2><p>Nhập email và mật khẩu đã đăng ký.</p>
        </div>

        <form
          class="login-form"
          @submit.prevent="submit"
        >
          <div class="form-field">
            <label for="email">Địa chỉ email</label><InputText
              id="email"
              v-model="email"
              type="email"
              autocomplete="username"
              placeholder="ten@congty.vn"
              required
            />
          </div>
          <div class="form-field">
            <div class="field-label-row">
              <label for="password">Mật khẩu</label><span class="secure-note"><ShieldCheck :size="13" /> Kết nối bảo mật</span>
            </div><Password
              id="password"
              v-model="password"
              :feedback="false"
              toggle-mask
              autocomplete="current-password"
              placeholder="Nhập mật khẩu"
              required
            />
          </div>
          <div
            v-if="successMessage"
            class="login-success"
          >
            <ShieldCheck :size="16" /><span>{{ successMessage }}</span>
          </div>
          <div
            v-if="errorMessage"
            class="login-error"
          >
            <CircleAlert :size="17" /><span>{{ errorMessage }}</span>
          </div>
          <Button
            type="submit"
            class="login-submit"
            :loading="loading"
            label="Đăng nhập hệ thống"
          >
            <template #icon>
              <ArrowRight :size="17" />
            </template>
          </Button>
        </form>

        <div class="login-assurance">
          <ShieldCheck :size="16" /><span>Phiên đăng nhập được xác thực qua Supabase Auth</span>
        </div>
        <div class="auth-switch">
          Chưa có tài khoản? <RouterLink to="/register">Đăng ký ngay</RouterLink>
        </div>
      </div>
      <div class="login-panel-foot">
        <span>Hệ thống quản lý ra vào FaceAccess</span><span>Đăng ký bằng email cá nhân hoặc công ty</span>
      </div>
    </section>
  </div>
</template>
