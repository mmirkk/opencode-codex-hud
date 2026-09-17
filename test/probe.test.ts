import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MODELS_URL, RESPONSES_URL, probeUsage, usageFromHeaders } from "../src/probe.ts"

function headersOf(map: Record<string, string>) {
  return { get: (n: string) => map[n.toLowerCase()] ?? null }
}

async function authDir() {
  const dir = await mkdtemp(join(tmpdir(), "codex-hud-probe-"))
  await writeFile(join(dir, "auth.json"), JSON.stringify({ openai: { type: "oauth", access: "tok", refresh: "r", expires: Date.now() + 60_000, accountId: "acc" } }))
  return dir
}

test("usageFromHeaders mapea x-codex-* (reset-after y reset-at)", () => {
  const now = 1_000_000_000_000
  const u = usageFromHeaders(
    (n) =>
      ({
        "x-codex-primary-used-percent": "81",
        "x-codex-primary-window-minutes": "300",
        "x-codex-primary-reset-after-seconds": "3600",
        "x-codex-secondary-used-percent": "9.5",
        "x-codex-secondary-window-minutes": "10080",
        "x-codex-secondary-reset-at": String(now / 1000 + 120),
        "x-codex-plan-type": "plus",
        "x-codex-bengalfox-limit-name": "default",
      })[n] ?? null,
    now,
  )!
  assert.equal(u.source, "probe")
  assert.equal(u.planType, "plus")
  assert.equal(u.limitName, "default")
  assert.deepEqual(u.primary, { usedPercent: 81, limitWindowSeconds: 18000, resetAfterSeconds: 3600, resetAt: now / 1000 + 3600 })
  assert.equal(u.secondary?.usedPercent, 9.5)
  assert.equal(u.secondary?.resetAfterSeconds, 120)
  assert.equal(usageFromHeaders(() => null), undefined)
})

test("probeUsage descubre modelo, hace el POST y lee headers", async () => {
  const dir = await authDir()
  const calls: Array<{ url: string; method?: string; body?: string; headers: Record<string, string> }> = []
  const r = await probeUsage({
    dataDir: dir,
    fetch: async (url, init) => {
      calls.push({ url, method: init.method, body: init.body, headers: init.headers })
      if (url === MODELS_URL) return { status: 200, text: async () => JSON.stringify({ models: [{ slug: "gpt-5.6-sol" }, { slug: "otro" }] }) }
      return {
        status: 200,
        text: async () => "event: response.completed\ndata: {}\n\n",
        headers: headersOf({ "x-codex-primary-used-percent": "15", "x-codex-primary-window-minutes": "300", "x-codex-primary-reset-after-seconds": "100", "x-codex-plan-type": "plus" }),
      }
    },
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.model, "gpt-5.6-sol")
    assert.equal(r.usage.primary?.usedPercent, 15)
    assert.equal(r.usage.planType, "plus")
  }
  assert.equal(calls.length, 2)
  assert.equal(calls[1]!.url, RESPONSES_URL)
  assert.equal(calls[1]!.method, "POST")
  const body = JSON.parse(calls[1]!.body!)
  assert.equal(body.model, "gpt-5.6-sol")
  assert.equal(body.store, false)
  assert.equal(calls[1]!.headers["chatgpt-account-id"], "acc")
  assert.equal(calls[1]!.headers["originator"], "codex_cli_rs")
})

test("probeUsage: modelo fijo salta el descubrimiento y clasifica 401/429", async () => {
  const dir = await authDir()
  let n = 0
  const r401 = await probeUsage({
    dataDir: dir,
    model: "fijo",
    fetch: async () => {
      n++
      return { status: 401, text: async () => "" }
    },
  })
  assert.equal(n, 1)
  assert.equal(r401.ok, false)
  if (!r401.ok) assert.equal(r401.code, "unauthorized")
  const r429 = await probeUsage({ dataDir: dir, model: "fijo", fetch: async () => ({ status: 429, text: async () => "", headers: headersOf({ "retry-after": "30" }) }) })
  assert.equal(r429.ok, false)
  if (!r429.ok) {
    assert.equal(r429.code, "ratelimited")
    assert.equal(r429.retryAfterSeconds, 30)
  }
  const rNoHeaders = await probeUsage({ dataDir: dir, model: "fijo", fetch: async () => ({ status: 200, text: async () => "", headers: headersOf({}) }) })
  assert.equal(rNoHeaders.ok, false)
  if (!rNoHeaders.ok) assert.equal(rNoHeaders.code, "parse")
})
