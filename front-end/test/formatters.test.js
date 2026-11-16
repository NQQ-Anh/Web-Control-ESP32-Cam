import test from 'node:test'
import assert from 'node:assert/strict'
import { formatDate, formatNumber, statusLabel, statusSeverity } from '../src/utils/formatters.js'

test('formatNumber uses Vietnamese grouping', () => {
  assert.equal(formatNumber(12000), '12.000')
  assert.equal(formatNumber(undefined), '0')
})

test('formatDate handles missing and invalid values without throwing', () => {
  assert.equal(formatDate(null), '—')
  assert.equal(formatDate('not-a-date'), '—')
  assert.match(formatDate('2026-01-01T00:00:00Z'), /2026/)
})

test('known statuses have Vietnamese labels and severity', () => {
  assert.equal(statusLabel('maintenance'), 'Bảo trì')
  assert.equal(statusLabel('unrecognized'), 'unrecognized')
  assert.equal(statusSeverity('denied'), 'danger')
})
