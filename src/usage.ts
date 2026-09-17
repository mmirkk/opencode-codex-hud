/**
 * Lectura de la cuota del plan ChatGPT/Codex.
 *
 * Fuente primaria: `GET https://chatgpt.com/backend-api/wham/usage` con el access token OAuth
 * que OpenCode guarda en `<datos>/auth.json` bajo la clave `openai`. El plugin NUNCA
 * refresca el token por su cuenta (eso lo hace OpenCode al hablar con el modelo y
 * rota el refresh token); si está vencido lo informa y espera.
 *
 * Los errores vienen clasificados (`no-auth`, `expired`, `unauthorized`, `ratelimited`,
 * `http`, `network`, `parse`) para que el TUI decida el ritmo de reintento.
 */
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

export const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"

export type RateWindow = {
  usedPercent: number
  limitWindowSeconds: number
  resetAfterSeconds: number
  /** epoch en segundos */
  resetAt: number
}

export type Usage = {
  planType: string
  allowed: boolean
  limitReached: boolean
  primary?: RateWindow
  secondary?: RateWindow
  credits?: {
    hasCredits: boolean
    unlimited: boolean
    balance: string
  }
  /** modelos con disponibilidad reportada (p. ej. gpt-6-astra) */
  models: Array<{ name: string; available: boolean }>
  /** nombre del perfil de límite (header x-codex-bengalfox-limit-name), solo con el sondeo */
  limitName?: string
  /** de dónde salió el dato */
  source: "wham" | "probe"
  /** epoch en milisegundos */
  fetchedAt: number
}

export type OAuthEntry = {
  type: "oauth"
  access: string
  refresh?: string
  /** epoch en milisegundos */
  expires: number
  accountId?: string
}

export type UsageErrorCode = "no-auth" | "expired" | "unauthorized" | "ratelimited" | "http" | "network" | "parse"

export type UsageError = {
  ok: false
  code: UsageErrorCode
  message: string
  /** HTTP status cuando aplica */
  status?: number
  /** segundos sugeridos por `Retry-After` (solo `ratelimited`) */
  retryAfterSeconds?: number
}

export type UsageResult = { ok: true; usage: Usage; accountId?: string } | UsageError

/**
 * Directorio de DATOS de OpenCode, donde vive auth.json.
 * Ojo: no es `path.state` (~/.local/state/opencode) sino ~/.local/share/opencode
 * (o $XDG_DATA_HOME/opencode), igual que Global.Path.data en OpenCode.
 */
export function dataDir(override?: string): string {
  if (override) return override
  const xdg = process.env.XDG_DATA_HOME
  if (xdg) return join(xdg, "opencode")
  return join(homedir(), ".local", "share", "opencode")
}

/** Ruta del auth.json: `OPENCODE_AUTH_PATH` si está definida, si no `<datos>/auth.json`. */
export function authPath(dir: string): string {
  return process.env.OPENCODE_AUTH_PATH || join(dir, "auth.json")
}

export async function readOpenAIAuth(dir: string): Promise<OAuthEntry | undefined> {
  let raw: string
  try {
    raw = await readFile(authPath(dir), "utf8")
  } catch {
    return undefined
  }
  return parseAuth(raw)
}

const AuthSchema = z
  .object({
    openai: z
      .object({
        type: z.literal("oauth"),
        access: z.string().min(1),
        refresh: z.string().optional(),
        expires: z.number().optional(),
        accountId: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export function parseAuth(raw: string): OAuthEntry | undefined {
  try {
    const parsed = AuthSchema.safeParse(JSON.parse(raw))
    if (!parsed.success || !parsed.data.openai) return undefined
    const e = parsed.data.openai
    return { type: "oauth", access: e.access, refresh: e.refresh, expires: e.expires ?? 0, accountId: e.accountId }
  } catch {
    return undefined
  }
}

/** Saca el chatgpt_account_id del JWT cuando auth.json no lo trae. */
export function accountIdFromJwt(token: string): string | undefined {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>
    const auth = payload["https://api.openai.com/auth"]
    if (auth && typeof auth === "object") {
      const id = (auth as Record<string, unknown>)["chatgpt_account_id"]
      if (typeof id === "string") return id
    }
  } catch {
    // token no decodificable: seguimos sin accountId
  }
  return undefined
}

// ── esquema tolerante de /wham/usage ────────────────────────────────────────
const num = z.union([z.number(), z.string().transform((s) => Number(s))]).pipe(z.number())
const WindowSchema = z
  .object({
    used_percent: num,
    limit_window_seconds: num.optional(),
    reset_after_seconds: num.optional(),
    reset_at: num.optional(),
  })
  .passthrough()
const UsageSchema = z
  .object({
    plan_type: z.string().optional(),
    rate_limit: z
      .object({
        allowed: z.boolean().optional(),
        limit_reached: z.boolean().optional(),
        primary_window: WindowSchema.nullable().optional(),
        secondary_window: WindowSchema.nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    credits: z
      .object({ has_credits: z.boolean().optional(), unlimited: z.boolean().optional(), balance: z.union([z.string(), z.number()]).optional() })
      .passthrough()
      .nullable()
      .optional(),
    model_usage: z.record(z.string(), z.object({ available: z.boolean().optional() }).passthrough().nullable()).nullable().optional(),
  })
  .passthrough()

function window(w: z.infer<typeof WindowSchema> | null | undefined): RateWindow | undefined {
  if (!w) return undefined
  return {
    usedPercent: w.used_percent,
    limitWindowSeconds: w.limit_window_seconds ?? 0,
    resetAfterSeconds: w.reset_after_seconds ?? 0,
    resetAt: w.reset_at ?? 0,
  }
}

/** Parsea el JSON de /wham/usage. Lanza si el JSON no es válido o no matchea el esquema. */
export function parseUsage(raw: string, now = Date.now()): Usage {
  const parsed = UsageSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`esquema inesperado${issue ? ` en ${issue.path.join(".") || "raíz"}: ${issue.message}` : ""}`)
  }
  const j = parsed.data
  const rl = j.rate_limit ?? {}
  return {
    planType: j.plan_type ?? "desconocido",
    allowed: rl.allowed !== false,
    limitReached: rl.limit_reached === true,
    primary: window(rl.primary_window),
    secondary: window(rl.secondary_window),
    credits: j.credits
      ? { hasCredits: j.credits.has_credits === true, unlimited: j.credits.unlimited === true, balance: String(j.credits.balance ?? "0") }
      : undefined,
    models: Object.entries(j.model_usage ?? {}).map(([name, m]) => ({ name, available: m?.available !== false })),
    source: "wham",
    fetchedAt: now,
  }
}

export type FetchInit = { method?: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }
export type FetchResponse = { status: number; text(): Promise<string>; headers?: { get(name: string): string | null } }
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>

export function retryAfter(res: FetchResponse): number | undefined {
  const raw = res.headers?.get("retry-after")
  if (!raw) return undefined
  const n = Number(raw)
  if (Number.isFinite(n)) return Math.max(0, n)
  const t = Date.parse(raw)
  return Number.isNaN(t) ? undefined : Math.max(0, Math.round((t - Date.now()) / 1000))
}

/** Clasifica un status HTTP no exitoso. */
export function httpError(res: FetchResponse, what: string): UsageError {
  if (res.status === 401 || res.status === 403) {
    return { ok: false, code: "unauthorized", status: res.status, message: `${what}: HTTP ${res.status}. Reconectá OpenAI con /connect (o mandá un mensaje para renovar el token).` }
  }
  if (res.status === 429) {
    const s = retryAfter(res)
    return { ok: false, code: "ratelimited", status: 429, retryAfterSeconds: s, message: `${what}: demasiadas consultas (429)${s ? `, reintento en ${s}s` : ""}.` }
  }
  return { ok: false, code: "http", status: res.status, message: `${what}: HTTP ${res.status}.` }
}

export async function fetchUsage(input: {
  dataDir: string
  fetch?: FetchLike
  timeoutMs?: number
  now?: number
  /** URL alternativa (pruebas) */
  usageUrl?: string
}): Promise<UsageResult> {
  const auth = await readOpenAIAuth(input.dataDir)
  if (!auth) {
    return { ok: false, code: "no-auth", message: "No hay login OAuth de OpenAI en auth.json (usá /connect → OpenAI → ChatGPT)." }
  }
  const now = input.now ?? Date.now()
  if (auth.expires && auth.expires < now) {
    return { ok: false, code: "expired", message: "Token OAuth de OpenAI vencido; OpenCode lo renueva al enviar el próximo mensaje." }
  }
  const accountId = auth.accountId ?? accountIdFromJwt(auth.access)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.access}`,
    Accept: "application/json",
    "User-Agent": "opencode-codex-hud",
  }
  if (accountId) headers["ChatGPT-Account-Id"] = accountId
  const doFetch: FetchLike = input.fetch ?? ((url, init) => fetch(url, init))
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), input.timeoutMs ?? 15_000)
  try {
    const res = await doFetch(input.usageUrl ?? USAGE_URL, { headers, signal: ctrl.signal })
    const body = await res.text()
    if (res.status !== 200) return httpError(res, "La API de uso")
    try {
      return { ok: true, usage: parseUsage(body, now), accountId }
    } catch (e) {
      return { ok: false, code: "parse", message: `Respuesta de uso no reconocida: ${(e as Error).message}` }
    }
  } catch (e) {
    return { ok: false, code: "network", message: `Sin conexión con chatgpt.com: ${(e as Error).message}` }
  } finally {
    clearTimeout(timer)
  }
}

/** Texto plano de la cuota, para la tool del agente (español o inglés). */
export function describeUsage(
  u: Usage,
  fmt: { bar: (p: number) => string; duration: (s: number) => string; windowLabel: (s: number) => string },
  lang: "es" | "en" = "es",
): string {
  const L = lang === "en"
    ? { plan: "ChatGPT plan", limit: "LIMIT REACHED", used: "used", left: "left", reset: "resets in", credits: "Credits", unlimited: "unlimited", source: "(source: fallback probe)" }
    : { plan: "Plan ChatGPT", limit: "LÍMITE ALCANZADO", used: "usado", left: "restante", reset: "reset en", credits: "Créditos", unlimited: "ilimitados", source: "(fuente: sondeo de respaldo)" }
  const lines: string[] = [`${L.plan}: ${u.planType}${u.limitName ? ` (${u.limitName})` : ""}${u.limitReached ? ` · ${L.limit}` : ""}`]
  for (const w of [u.primary, u.secondary]) {
    if (!w) continue
    lines.push(
      `${fmt.windowLabel(w.limitWindowSeconds).padEnd(4)} ${fmt.bar(w.usedPercent)} ${String(w.usedPercent).padStart(3)}% ${L.used} (${Math.max(0, 100 - w.usedPercent)}% ${L.left})  ${L.reset} ${fmt.duration(w.resetAfterSeconds)}`,
    )
  }
  if (u.credits?.hasCredits) lines.push(`${L.credits}: ${u.credits.unlimited ? L.unlimited : u.credits.balance}`)
  if (u.source === "probe") lines.push(L.source)
  return lines.join("\n")
}
