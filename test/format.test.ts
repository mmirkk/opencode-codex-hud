import { test } from "node:test"
import assert from "node:assert/strict"
import { bar, duration, level, localTime, windowLabel } from "../src/format.ts"

test("level por umbrales", () => {
  assert.equal(level(10, 75, 90), "ok")
  assert.equal(level(75, 75, 90), "warn")
  assert.equal(level(89.9, 75, 90), "warn")
  assert.equal(level(90, 75, 90), "danger")
  assert.equal(level(150, 75, 90), "danger")
})

test("bar de ancho fijo", () => {
  assert.equal(bar(0), "░░░░░░░░░░")
  assert.equal(bar(15), "▓▓░░░░░░░░")
  assert.equal(bar(44), "▓▓▓▓░░░░░░")
  assert.equal(bar(100), "▓▓▓▓▓▓▓▓▓▓")
  assert.equal(bar(250), "▓▓▓▓▓▓▓▓▓▓")
  assert.equal(bar(NaN), "░░░░░░░░░░")
  assert.equal(bar(50, 4), "▓▓░░")
})

test("duration compacta", () => {
  assert.equal(duration(0), "0s")
  assert.equal(duration(45), "45s")
  assert.equal(duration(60), "1m")
  assert.equal(duration(16691), "4h38m")
  assert.equal(duration(3600), "1h")
  assert.equal(duration(156029), "1d19h")
  assert.equal(duration(86400 * 6), "6d")
  assert.equal(duration(-5), "0s")
})

test("windowLabel", () => {
  assert.equal(windowLabel(18000), "5 h")
  assert.equal(windowLabel(3600), "1 h")
  assert.equal(windowLabel(604800), "7 d")
  assert.equal(windowLabel(86400 * 30), "30 d")
})

test("localTime hoy vs otro día", () => {
  const now = new Date(2026, 8, 17, 10, 0, 0)
  const today = new Date(2026, 8, 17, 14, 30, 0)
  assert.equal(localTime(today.getTime() / 1000, now), "hoy 14:30")
  const later = new Date(2026, 8, 19, 9, 5, 0) // sábado 19
  assert.equal(localTime(later.getTime() / 1000, now), "sáb 19 09:05")
})
