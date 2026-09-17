import { test } from "node:test"
import assert from "node:assert/strict"
import { settingsFrom } from "../src/settings.ts"

test("settingsFrom: defaults, opciones y overrides por entorno", () => {
  const d = settingsFrom(undefined, {})
  assert.equal(d.intervalSeconds, 60)
  assert.equal(d.display, "restante")
  assert.equal(d.toastMode, "on-change")
  assert.equal(d.fallbackProbe, true)

  const o = settingsFrom({ intervalSeconds: 5, warnAt: 50, display: "usado", fallbackProbe: false, probeModel: "m" }, {})
  assert.equal(o.intervalSeconds, 20) // mínimo
  assert.equal(o.warnAt, 50)
  assert.equal(o.display, "usado")
  assert.equal(o.fallbackProbe, false)
  assert.equal(o.probeModel, "m")

  const e = settingsFrom({ warnAt: 50 }, { OPENCODE_CODEX_HUD_POLL_MS: "120000", OPENCODE_CODEX_HUD_WARN_AT: "10", OPENCODE_CODEX_HUD_TOASTS: "always", OPENCODE_CODEX_HUD_DESKTOP: "off", OPENCODE_CODEX_HUD_DISPLAY: "usado" })
  assert.equal(e.intervalSeconds, 120)
  assert.equal(e.warnAt, 10)
  assert.equal(e.toastMode, "always")
  assert.equal(e.desktop, false)
  assert.equal(e.display, "usado")

  const n = settingsFrom({}, { OPENCODE_CODEX_HUD_TOASTS: "never" })
  assert.equal(n.toastMode, "never")
  assert.equal(n.toasts, false)
})
