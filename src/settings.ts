/**
 * Opciones del plugin (tupla `["opencode-codex-hud", {...}]` en tui.json) con overrides por
 * variables de entorno `OPENCODE_CODEX_HUD_*`. Módulo puro, sin JSX, para poder testearlo con Node.
 */

export type Options = {
  /** segundos entre consultas (mín. 20). Default 60. */
  intervalSeconds?: number
  /** % usado a partir del cual avisa (toast). Default 75. */
  warnAt?: number
  /** % usado a partir del cual avisa fuerte (toast rojo + escritorio + sonido). Default 90. */
  dangerAt?: number
  /** toasts al cruzar umbrales. Default true. */
  toasts?: boolean
  /** notificación de escritorio (requiere attention.enabled en tui.json). Default true. */
  desktop?: boolean
  /** sonido en avisos fuertes. Default true. */
  sound?: boolean
  /** panel en la sidebar de la sesión. Default true. */
  sidebar?: boolean
  /** línea en la pantalla de inicio. Default true. */
  home?: boolean
  /** ancho de la barra. Default 10. */
  barWidth?: number
  /** orden del panel en la sidebar (menor = más arriba). Default 350. */
  order?: number
  /** qué porcentaje mostrar: "restante" (como la app de ChatGPT) o "usado". Default "restante". */
  display?: "restante" | "usado"
  /** minutos sin actividad tras los cuales se consulta cada 10 min en vez de cada `intervalSeconds`. Default 30. */
  idleAfterMinutes?: number
  /** si /wham/usage deja de responder, usar el sondeo por headers (consume ~10 tokens por consulta). Default true. */
  fallbackProbe?: boolean
  /** modelo para el sondeo de respaldo; vacío = se descubre de la cuenta. */
  probeModel?: string
}

export type Settings = Required<Options> & { toastMode: "on-change" | "always" | "never" }

export const DEFAULTS: Settings = {
  intervalSeconds: 60,
  warnAt: 75,
  dangerAt: 90,
  toasts: true,
  desktop: true,
  sound: true,
  sidebar: true,
  home: true,
  barWidth: 10,
  order: 350,
  display: "restante",
  idleAfterMinutes: 30,
  fallbackProbe: true,
  probeModel: "",
  toastMode: "on-change",
}

export const ENV = "OPENCODE_CODEX_HUD_"

export function settingsFrom(options: Record<string, unknown> | undefined, env: Record<string, string | undefined> = process.env): Settings {
  const o = options ?? {}
  const envNum = (k: string) => {
    const v = env[ENV + k]
    if (v === undefined || v === "") return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  const envBool = (k: string) => {
    const v = env[ENV + k]?.toLowerCase()
    if (v === undefined || v === "") return undefined
    return ["1", "true", "yes", "on"].includes(v) ? true : ["0", "false", "no", "off"].includes(v) ? false : undefined
  }
  const num = (k: keyof Options, envKey: string, min: number, max: number) => {
    const v = envNum(envKey) ?? Number(o[k])
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : (DEFAULTS[k] as number)
  }
  const bool = (k: keyof Options, envKey: string) => envBool(envKey) ?? (typeof o[k] === "boolean" ? (o[k] as boolean) : (DEFAULTS[k] as boolean))
  const pollMs = envNum("POLL_MS")
  const toastEnv = env[ENV + "TOASTS"]?.toLowerCase()
  const toastMode: Settings["toastMode"] = toastEnv === "always" || toastEnv === "never" ? toastEnv : "on-change"
  const display = env[ENV + "DISPLAY"] ?? o["display"]
  const probeModel = env[ENV + "PROBE_MODEL"] ?? o["probeModel"]
  return {
    intervalSeconds: pollMs !== undefined ? Math.min(3600, Math.max(20, pollMs / 1000)) : num("intervalSeconds", "INTERVAL_SECONDS", 20, 3600),
    warnAt: num("warnAt", "WARN_AT", 1, 100),
    dangerAt: num("dangerAt", "DANGER_AT", 1, 100),
    toasts: toastEnv === "never" ? false : bool("toasts", "TOASTS_ENABLED"),
    desktop: bool("desktop", "DESKTOP"),
    sound: bool("sound", "SOUND"),
    sidebar: bool("sidebar", "SIDEBAR"),
    home: bool("home", "HOME"),
    barWidth: num("barWidth", "BAR_WIDTH", 4, 40),
    order: num("order", "ORDER", 0, 10_000),
    display: display === "usado" ? "usado" : "restante",
    idleAfterMinutes: num("idleAfterMinutes", "IDLE_AFTER_MINUTES", 1, 1440),
    fallbackProbe: bool("fallbackProbe", "FALLBACK_PROBE"),
    probeModel: typeof probeModel === "string" ? probeModel : "",
    toastMode,
  }
}
