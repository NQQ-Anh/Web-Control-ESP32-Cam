<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import api, { apiMessage } from '../api/client'
import { ArrowRight, CircleAlert, ScanFace, ShieldCheck } from '@lucide/vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const form = reactive({ password: '', confirmation: '' })
const loading = ref(false)
const error = ref('')
const tokenHash = computed(() => typeof route.query.token_hash === 'string' ? route.query.token_hash : '')

const submit = async () => {
  error.value = ''
  if (!tokenHash.value) { error.value = 'Liên kết lời mời không có mã xác minh.'; return }
  if (form.password.length < 12) { error.value = 'Mật khẩu cần có ít nhất 12 ký tự.'; return }
  if (form.password !== form.confirmation) { error.value = 'Hai mật khẩu không khớp.'; return }
  loading.value = true
  try {
    const { data } = await api.post('/auth/accept-invite', { token_hash: tokenHash.value, password: form.password })
    auth.completeInvite(data.data)
    await router.replace('/dashboard')
  } catch (requestError) { error.value = apiMessage(requestError, 'Không thể xác minh lời mời.') }
  finally { loading.value = false }
}
</script>

<template>
  <div class="invite-page">
    <div class="invite-card">
      <div class="invite-brand">
        <span class="login-brand-mark"><ScanFace :size="23" /></span><strong>FaceAccess</strong>
      </div><div class="invite-heading">
        <span class="login-kicker">HOÀN TẤT THAM GIA HỆ THỐNG</span><h1>Thiết lập tài khoản</h1><p>Tạo mật khẩu để đăng nhập vào hệ thống kiểm soát ra vào.</p>
      </div><form
        class="login-form"
        @submit.prevent="submit"
      >
        <div class="form-field">
          <label for="invite-password">Mật khẩu mới</label><Password
            id="invite-password"
            v-model="form.password"
            :feedback="true"
            toggle-mask
            autocomplete="new-password"
            required
          />
        </div><div class="form-field">
          <label for="invite-confirmation">Xác nhận mật khẩu</label><Password
            id="invite-confirmation"
            v-model="form.confirmation"
            :feedback="false"
            toggle-mask
            autocomplete="new-password"
            required
          />
        </div><div
          v-if="error"
          class="login-error"
        >
          <CircleAlert :size="16" /><span>{{ error }}</span>
        </div><Button
          type="submit"
          class="login-submit"
          label="Xác minh và tiếp tục"
          :loading="loading"
        >
          <template #icon>
            <ArrowRight :size="17" />
          </template>
        </Button>
      </form><div class="login-assurance">
        <ShieldCheck :size="16" /><span>Lời mời được xác thực qua Supabase Auth</span>
      </div>
    </div>
  </div>
</template>
