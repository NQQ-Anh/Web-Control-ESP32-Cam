import axios from 'axios'

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api'
const api = axios.create({ baseURL, timeout: 20_000, headers: { 'Content-Type': 'application/json' } })
const sessionKey = 'face-access-session'
let refreshPromise

const readSession = () => {
  try { return JSON.parse(sessionStorage.getItem(sessionKey) || 'null') } catch { return null }
}

export const writeSession = (session) => {
  if (!session?.access_token || !session?.refresh_token) {
    sessionStorage.removeItem(sessionKey)
    return
  }
  sessionStorage.setItem(sessionKey, JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  }))
}

api.interceptors.request.use((config) => {
  const session = readSession()
  if (session?.access_token) config.headers.Authorization = `Bearer ${session.access_token}`
  return config
})

api.interceptors.response.use((response) => response, async (error) => {
  const request = error.config
  const isAuthEndpoint = request?.url?.includes('/auth/login') || request?.url?.includes('/auth/refresh')
  if (error.response?.status !== 401 || !request || request._retried || isAuthEndpoint) throw error

  const current = readSession()
  if (!current?.refresh_token) {
    writeSession(null)
    window.dispatchEvent(new CustomEvent('auth:expired'))
    throw error
  }

  try {
    if (!refreshPromise) {
      refreshPromise = axios.post(`${baseURL}/auth/refresh`, { refresh_token: current.refresh_token }, { timeout: 15_000 })
        .then(({ data }) => {
          writeSession(data.data.session)
          return data.data.session.access_token
        })
        .finally(() => { refreshPromise = undefined })
    }
    const accessToken = await refreshPromise
    request._retried = true
    request.headers.Authorization = `Bearer ${accessToken}`
    return api(request)
  } catch (refreshError) {
    writeSession(null)
    window.dispatchEvent(new CustomEvent('auth:expired'))
    throw refreshError
  }
})

export const apiMessage = (error, fallback = 'Không thể hoàn tất yêu cầu') =>
  error?.response?.data?.message || error?.message || fallback

export default api
