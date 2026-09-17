/**
 * Fuente de RESPALDO: sondeo mínimo a `POST /backend-api/codex/responses` y lectura de los
 * headers `x-codex-*` de la respuesta (misma técnica que Codex CLI y otros plugins).
 *
 * Consume cuota (~10 tokens y una request por consulta), por eso solo se usa cuando
 * `/wham/usage` deja de responder, y con un intervalo mucho más largo.
 */
import { accountIdFromJwt, httpError, readOpenAIAuth, type FetchLike, type Usage, type UsageResult } from "./usage.ts"

export const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses"
export const MODELS_URL = "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0"

function baseHeaders(access: string, accountId?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${access}`,
    accept: "application/json",
    "openai-beta": "responses=experimental",
    originator: "codex_cli_rs",
    "User-Agent": "opencode-codex-hud",
  }
  if (accountId) h["chatgpt-account-id"] = accountId
  return h
}

/** Primer slug de modelo disponible para la cuenta (para el sondeo). */
export async function discoverModel(input: { access: string; accountId?: string; fetch: FetchLike; signal?: AbortSignal }): Promise<string | undefined> {
  try {
    const res = await input.fetch(MODELS_URL, { headers: baseHeaders(input.access, input.accountId), signal: input.signal })
    if (res.status !== 200) return undefined
    const json = JSON.parse(await res.text()) as { models?: Array<{ slug?: string }> }
    return json.models?.find((m) => typeof m.slug === "string")?.slug
  } catch {
    return undefined
  }
}

/** Convierte los headers `x-codex-*` de una respuesta en un `Usage`. */
export function usageFromHeaders(get: (name: string) => string | null, now = Date.now()): Usage | undefined {
  const n = (name: string) => {
    const v = get(name)
    if (v === null || v === "") return undefined
    const x = Number(v)
    return Number.isFinite(x) ? x : undefined
  }
  const win = (prefix: string) => {
    const used = n(`${prefix}-used-percent`)
    if (used === undefined) return undefined
    const minutes = n(`${prefix}-window-minutes`) ?? 0
    let resetAfter = n(`${prefix}-reset-after-seconds`)
    const resetAt = n(`${prefix}-reset-at`)
    if (resetAfter === undefined && resetAt !== undefined) resetAfter = Math.max(0, resetAt - Math.round(now / 1000))
    return {
      usedPercent: used,
      limitWindowSeconds: minutes * 60,
      resetAfterSeconds: resetAfter ?? 0,
      resetAt: resetAt ?? Math.round(now / 1000) + (resetAfter ?? 0),
    }
  }
  const primary = win("x-codex-primary")
  const secondary = win("x-codex-secondary")
  if (!primary && !secondary) return undefined
  return {
    planType: get("x-codex-plan-type") ?? "desconocido",
    allowed: true,
    limitReached: [primary, secondary].some((w) => w && w.usedPercent >= 100),
    primary,
    secondary,
    models: [],
    limitName: get("x-codex-bengalfox-limit-name") ?? undefined,
    source: "probe",
    fetchedAt: now,
  }
}

export async function probeUsage(input: {
  dataDir: string
  model?: string
  fetch?: FetchLike
  timeoutMs?: number
  now?: number
}): Promise<UsageResult & { model?: string }> {
  const auth = await readOpenAIAuth(input.dataDir)
  if (!auth) return { ok: false, code: "no-auth", message: "No hay login OAuth de OpenAI en auth.json (usá /connect → OpenAI → ChatGPT)." }
  const now = input.now ?? Date.now()
  if (auth.expires && auth.expires < now) {
    return { ok: false, code: "expired", message: "Token OAuth de OpenAI vencido; OpenCode lo renueva al enviar el próximo mensaje." }
  }
  const accountId = auth.accountId ?? accountIdFromJwt(auth.access)
  const doFetch: FetchLike = input.fetch ?? ((url, init) => fetch(url, init))
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), input.timeoutMs ?? 20_000)
  try {
    const model = input.model || (await discoverModel({ access: auth.access, accountId, fetch: doFetch, signal: ctrl.signal }))
    if (!model) return { ok: false, code: "parse", message: "No pude determinar un modelo para el sondeo (configurá `probeModel`)." }
    const body = JSON.stringify({
      model,
      instructions: "You are a coding assistant.",
      input: [{ role: "user", content: [{ type: "input_text", text: "reply ok" }] }],
      store: false,
      stream: true,
    })
    const res = await doFetch(RESPONSES_URL, {
      method: "POST",
      headers: { ...baseHeaders(auth.access, accountId), "content-type": "application/json", accept: "text/event-stream" },
      body,
      signal: ctrl.signal,
    })
    // consumimos el cuerpo (es minúsculo) para cerrar la conexión
    await res.text().catch(() => "")
    if (res.status !== 200) return { ...httpError(res, "El sondeo de cuota"), model }
    const usage = usageFromHeaders((name) => res.headers?.get(name) ?? null, now)
    if (!usage) return { ok: false, code: "parse", message: "El sondeo respondió sin headers x-codex-*.", model }
    return { ok: true, usage, accountId, model }
  } catch (e) {
    return { ok: false, code: "network", message: `Sin conexión con chatgpt.com: ${(e as Error).message}` }
  } finally {
    clearTimeout(timer)
  }
}
