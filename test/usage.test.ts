import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { accountIdFromJwt, describeUsage, fetchUsage, parseAuth, parseUsage, USAGE_URL } from "../src/usage.ts"
import { bar, duration, windowLabel } from "../src/format.ts"

// Respuesta real de /wham/usage (identificadores quitados)
const SAMPLE = JSON.stringify({
  plan_type: "plus",
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: { used_percent: 15, limit_window_seconds: 18000, reset_after_seconds: 16691, reset_at: 1789669828 },
    secondary_window: { used_percent: 44, limit_window_seconds: 604800, reset_after_seconds: 156029, reset_at: 1789809166 },
  },
  code_review_rate_limit: null,
  additional_rate_limits: null,
  model_usage: { "gpt-6-astra": { available: true, available_at: null, credits_would_enable: false } },
  credits: { has_credits: false, unlimited: false, balance: "0", approx_local_messages: [0, 0], approx_cloud_messages: [0, 0] },
  spend_control: { reached: false, individual_limit: null },
  rate_limit_reached_type: null,
  promo: null,
  rate_limit_reset_credits: { available_count: 3, applicable_available_count: 0 },
})

function jwt(payload: object): string {
  const b64 = (s: string) => Buffer.from(s).toString("base64url")
  return `${b64('{"alg":"none"}')}.${b64(JSON.stringify(payload))}.sig`
}

test("parseUsage mapea ventanas, plan, créditos y modelos", () => {
  const u = parseUsage(SAMPLE, 1000)
  assert.equal(u.planType, "plus")
  assert.equal(u.allowed, true)
  assert.equal(u.limitReached, false)
  assert.deepEqual(u.primary, { usedPercent: 15, limitWindowSeconds: 18000, resetAfterSeconds: 16691, resetAt: 1789669828 })
  assert.equal(u.secondary?.usedPercent, 44)
  assert.deepEqual(u.credits, { hasCredits: false, unlimited: false, balance: "0" })
  assert.deepEqual(u.models, [{ name: "gpt-6-astra", available: true }])
  assert.equal(u.fetchedAt, 1000)
  assert.equal(u.source, "wham")
})

test("parseUsage rechaza esquemas rotos con mensaje claro", () => {
  assert.throws(() => parseUsage('{"rate_limit":{"primary_window":{"used_percent":"no-numero"}}}'), /esquema inesperado en rate_limit\.primary_window\.used_percent/)
  assert.throws(() => parseUsage("<html>"), /JSON|Unexpected/)
})

test("parseUsage tolera campos faltantes", () => {
  const u = parseUsage("{}")
  assert.equal(u.planType, "desconocido")
  assert.equal(u.primary, undefined)
  assert.equal(u.secondary, undefined)
  assert.equal(u.credits, undefined)
  assert.deepEqual(u.models, [])
})

test("parseAuth solo acepta oauth de openai", () => {
  assert.equal(parseAuth("{}"), undefined)
  assert.equal(parseAuth('{"openai":{"type":"api","key":"x"}}'), undefined)
  assert.equal(parseAuth("no json"), undefined)
  const e = parseAuth('{"openai":{"type":"oauth","access":"a","refresh":"r","expires":123,"accountId":"acc"}}')
  assert.deepEqual(e, { type: "oauth", access: "a", refresh: "r", expires: 123, accountId: "acc" })
})

test("accountIdFromJwt lee el claim de OpenAI", () => {
  const t = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "abc-123", chatgpt_plan_type: "plus" } })
  assert.equal(accountIdFromJwt(t), "abc-123")
  assert.equal(accountIdFromJwt("no.jwt"), undefined)
  assert.equal(accountIdFromJwt(jwt({})), undefined)
})

async function authDir(entry: object | undefined) {
  const dir = await mkdtemp(join(tmpdir(), "codex-hud-"))
  if (entry) await writeFile(join(dir, "auth.json"), JSON.stringify(entry))
  return dir
}

test("fetchUsage: sin auth.json", async () => {
  const dir = await authDir(undefined)
  const r = await fetchUsage({ dataDir: dir })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "no-auth")
})

test("fetchUsage: token vencido no llama a la red", async () => {
  const dir = await authDir({ openai: { type: "oauth", access: "a", refresh: "r", expires: 1000 } })
  let called = false
  const r = await fetchUsage({
    dataDir: dir,
    now: 2000,
    fetch: async () => {
      called = true
      return { status: 200, text: async () => SAMPLE }
    },
  })
  assert.equal(called, false)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "expired")
})

test("fetchUsage: manda Bearer y ChatGPT-Account-Id y parsea", async () => {
  const token = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "from-jwt" } })
  const dir = await authDir({ openai: { type: "oauth", access: token, refresh: "r", expires: Date.now() + 60_000 } })
  let seenUrl = ""
  let seenHeaders: Record<string, string> = {}
  const r = await fetchUsage({
    dataDir: dir,
    fetch: async (url, init) => {
      seenUrl = url
      seenHeaders = init.headers
      return { status: 200, text: async () => SAMPLE }
    },
  })
  assert.equal(seenUrl, USAGE_URL)
  assert.equal(seenHeaders["Authorization"], `Bearer ${token}`)
  assert.equal(seenHeaders["ChatGPT-Account-Id"], "from-jwt")
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.accountId, "from-jwt")
    assert.equal(r.usage.primary?.usedPercent, 15)
  }
})

test("fetchUsage: clasifica 401/403, 429 con Retry-After, otros HTTP y respuesta rota", async () => {
  const dir = await authDir({ openai: { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 60_000 } })
  const r1 = await fetchUsage({ dataDir: dir, fetch: async () => ({ status: 401, text: async () => "" }) })
  assert.equal(r1.ok, false)
  if (!r1.ok) {
    assert.equal(r1.code, "unauthorized")
    assert.equal(r1.status, 401)
  }
  const r429 = await fetchUsage({ dataDir: dir, fetch: async () => ({ status: 429, text: async () => "", headers: { get: (n: string) => (n === "retry-after" ? "120" : null) } }) })
  assert.equal(r429.ok, false)
  if (!r429.ok) {
    assert.equal(r429.code, "ratelimited")
    assert.equal(r429.retryAfterSeconds, 120)
  }
  const r404 = await fetchUsage({ dataDir: dir, fetch: async () => ({ status: 404, text: async () => "" }) })
  assert.equal(r404.ok, false)
  if (!r404.ok) {
    assert.equal(r404.code, "http")
    assert.equal(r404.status, 404)
  }
  const r2 = await fetchUsage({ dataDir: dir, fetch: async () => ({ status: 200, text: async () => "<html>" }) })
  assert.equal(r2.ok, false)
  if (!r2.ok) assert.equal(r2.code, "parse")
  const r3 = await fetchUsage({
    dataDir: dir,
    fetch: async () => {
      throw new Error("ECONNRESET")
    },
  })
  assert.equal(r3.ok, false)
  if (!r3.ok) assert.equal(r3.code, "network")
})

test("describeUsage arma el texto para el agente", () => {
  const u = parseUsage(SAMPLE)
  const txt = describeUsage(u, { bar: (p) => bar(p, 10), duration, windowLabel })
  assert.match(txt, /Plan ChatGPT: plus/)
  assert.match(txt, /5 h\s+▓▓░░░░░░░░\s+15% usado \(85% restante\)\s+reset en 4h38m/)
  assert.match(txt, /7 d\s+▓▓▓▓░░░░░░\s+44% usado \(56% restante\)\s+reset en 1d19h/)
  assert.doesNotMatch(txt, /Créditos/)
})

test("OPENCODE_AUTH_PATH tiene prioridad sobre el directorio de datos", async () => {
  const dir = await authDir(undefined)
  const other = await mkdtemp(join(tmpdir(), "codex-hud-auth-"))
  const custom = join(other, "mi-auth.json")
  await writeFile(custom, JSON.stringify({ openai: { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 60_000 } }))
  process.env.OPENCODE_AUTH_PATH = custom
  try {
    const r = await fetchUsage({ dataDir: dir, fetch: async () => ({ status: 200, text: async () => SAMPLE }) })
    assert.equal(r.ok, true)
  } finally {
    delete process.env.OPENCODE_AUTH_PATH
  }
})
