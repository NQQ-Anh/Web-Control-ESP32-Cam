const terminalStatuses = new Set(['acknowledged', 'failed', 'expired'])

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export const waitForCommand = async (api, command, {
  intervalMs = 1500,
  graceMs = 8000,
  maxWaitMs = 125_000,
  sleep = pause,
  now = Date.now,
} = {}) => {
  if (!command?.id) throw new TypeError('A persisted command ID is required')

  let current = command
  if (terminalStatuses.has(current.status)) return current
  let lastError
  const expiresAt = Date.parse(command.expires_at)
  const deadline = Math.min(now() + maxWaitMs, Number.isFinite(expiresAt) ? expiresAt + graceMs : now() + maxWaitMs)

  while (now() <= deadline) {
    try {
      const { data } = await api.get(`/commands/${encodeURIComponent(command.id)}`)
      if (data?.data) current = data.data
      lastError = undefined
      if (terminalStatuses.has(current.status)) return current
    } catch (error) {
      // Status reads are safe to retry. Never recreate or resend the command here.
      lastError = error
    }

    const remaining = deadline - now()
    if (remaining <= 0) break
    await sleep(Math.min(intervalMs, remaining))
  }

  return {
    ...current,
    status: lastError ? 'unknown' : 'expired',
    poll_error_message: lastError?.message,
  }
}
