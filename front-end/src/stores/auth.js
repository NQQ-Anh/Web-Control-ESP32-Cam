import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import api, { writeSession } from '../api/client'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const accessToken = ref(null)
  const initialized = ref(false)

  const isAuthenticated = computed(() => Boolean(accessToken.value && user.value))
  const isAdmin = computed(() => user.value?.role === 'admin')

  const applySession = (session) => {
    accessToken.value = session?.access_token || null
    writeSession(session)
  }

  const login = async (credentials) => {
    const { data } = await api.post('/auth/login', credentials)
    applySession(data.data.session)
    user.value = data.data.user
    initialized.value = true
  }

  const restore = async () => {
    if (initialized.value) return isAuthenticated.value
    initialized.value = true
    try {
      const saved = JSON.parse(sessionStorage.getItem('face-access-session') || 'null')
      if (!saved?.access_token) return false
      accessToken.value = saved.access_token
      const { data } = await api.get('/auth/me')
      user.value = data.data
      return true
    } catch {
      clearSession()
      return false
    }
  }

  const updateUser = (profile) => { user.value = { ...user.value, ...profile } }
  const completeInvite = (data) => {
    applySession(data.session)
    user.value = data.user
    initialized.value = true
  }
  const completeRegistration = completeInvite

  const clearSession = () => {
    user.value = null
    accessToken.value = null
    writeSession(null)
  }

  const logout = async () => {
    try { await api.post('/auth/logout') } finally { clearSession() }
  }

  return { user, accessToken, initialized, isAuthenticated, isAdmin, login, restore, updateUser, completeInvite, completeRegistration, clearSession, logout }
})
