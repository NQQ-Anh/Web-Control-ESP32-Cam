import test from 'node:test'
import assert from 'node:assert/strict'
import { waitForCommand } from '../src/utils/commandTracking.js'

const pendingCommand = {
  id: 'command-1',
  command: 'unlock',
  status: 'pending',
  expires_at: new Date(Date.now() + 60_000).toISOString(),
}

test('waitForCommand reads until the device returns a terminal ACK', async () => {
  const statuses = ['sent', 'acknowledged']
  let requests = 0
  const result = await waitForCommand({
    get: async () => ({ data: { data: { ...pendingCommand, status: statuses[requests++] } } }),
  }, pendingCommand, { intervalMs: 0, sleep: async () => {} })

  assert.equal(result.status, 'acknowledged')
  assert.equal(requests, 2)
})

test('waitForCommand reports an expired command and does not create or resend it', async () => {
  let requests = 0
  const api = {
    get: async () => {
      requests += 1
      return { data: { data: { ...pendingCommand, status: 'expired' } } }
    },
    post: async () => assert.fail('Command tracking must never resend a command'),
  }

  const result = await waitForCommand(api, pendingCommand)
  assert.equal(result.status, 'expired')
  assert.equal(requests, 1)
})

test('waitForCommand reports unknown after status reads fail', async () => {
  let requests = 0
  const result = await waitForCommand({
    get: async () => {
      requests += 1
      throw new Error('network unavailable')
    },
  }, pendingCommand, { intervalMs: 0, graceMs: 0, maxWaitMs: 0, now: () => 1000, sleep: async () => {} })

  assert.equal(result.status, 'unknown')
  assert.equal(requests, 1)
})
