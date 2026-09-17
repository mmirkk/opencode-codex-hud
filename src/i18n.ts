/**
 * Idioma de los textos visibles (español / inglés).
 *
 * La preferencia se guarda en el KV del TUI de OpenCode bajo la clave compartida
 * `opencode-plugins.lang`, así el mismo ajuste aplica a todos los plugins de esta familia.
 * El lado server (tools) la lee del archivo kv.json; si no existe, usa `OPENCODE_PLUGINS_LANG`
 * o español.
 */
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type Lang = "es" | "en"
export const LANG_KEY = "opencode-plugins.lang"

export function normalizeLang(v: unknown): Lang | undefined {
  if (typeof v !== "string") return undefined
  const s = v.toLowerCase()
  if (s.startsWith("es")) return "es"
  if (s.startsWith("en")) return "en"
  return undefined
}

/** Lee la preferencia desde kv.json (lado server, sin API de TUI). */
export function readSharedLang(kvPath?: string): Lang {
  const envLang = normalizeLang(process.env.OPENCODE_PLUGINS_LANG)
  const file = kvPath ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode", "kv.json")
  try {
    const kv = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
    return normalizeLang(kv[LANG_KEY]) ?? envLang ?? "es"
  } catch {
    return envLang ?? "es"
  }
}

const DICT = {
  es: {
    // genérico
    quota: "Cuota Codex",
    remaining: "restante",
    used: "usado",
    plan: "Plan",
    never: "nunca",
    ago: "hace {t}",
    today: "hoy",
    days: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"],
    // panel / home
    querying: "consultando…",
    queryingQuota: "consultando cuota…",
    noData: "sin datos",
    limit: "LÍMITE",
    credits: "créditos",
    // errores cortos
    err_no_auth: "sin login OpenAI",
    err_expired: "token vencido",
    err_unauthorized: "sin autorización",
    err_ratelimited: "429, esperando",
    err_network: "sin conexión",
    err_http: "HTTP {s}",
    err_parse: "respuesta inesperada",
    // errores largos
    msg_no_auth: "No hay login OAuth de OpenAI en auth.json (usá /connect → OpenAI → ChatGPT).",
    msg_expired: "Token OAuth de OpenAI vencido; OpenCode lo renueva al enviar el próximo mensaje.",
    msg_unauthorized: "OpenAI rechazó el token (HTTP {s}). Reconectá con /connect o mandá un mensaje para renovarlo.",
    msg_ratelimited: "Demasiadas consultas (429){r}.",
    msg_http: "La API de uso respondió HTTP {s}.",
    msg_network: "Sin conexión con chatgpt.com: {e}",
    msg_parse: "Respuesta de uso no reconocida: {e}",
    msg_probe_no_model: "No pude determinar un modelo para el sondeo (configurá probeModel).",
    msg_probe_no_headers: "El sondeo respondió sin headers x-codex-*.",
    // toasts
    windowUsed: "Ventana de {w}: {p}% usado · se reinicia en {t}",
    windowReset: "Se reinició la ventana de {w}{away} ({p}% usado).",
    whileAway: " mientras no estabas",
    limitReached: "Límite del plan alcanzado. Las próximas llamadas van a fallar hasta el reinicio.",
    probeOn: "La API de uso no responde; paso al sondeo de respaldo (consume ~10 tokens por consulta, cada 10 min).",
    probeOff: "La API de uso volvió; dejo el sondeo de respaldo.",
    panelShown: "Panel de cuota visible",
    panelHidden: "Panel de cuota oculto",
    toastsOn: "Avisos por umbral activados",
    toastsOff: "Avisos por umbral desactivados",
    desktopOn: "Notificación de escritorio activada",
    desktopOff: "Notificación de escritorio desactivada",
    langChanged: "Idioma: español",
    // comandos
    cmdShow: "Cuota Codex: ver detalle y opciones",
    cmdShowDesc: "Ventanas de 5 h y semanal del plan ChatGPT, créditos y ajustes del HUD",
    cmdRefresh: "Cuota Codex: actualizar ahora",
    cmdToggle: "Cuota Codex: mostrar/ocultar panel",
    cmdLang: "Cuota Codex: cambiar idioma (español/English)",
    // diálogo
    pickAction: "Elegí una acción…",
    catActions: "Acciones",
    catOptions: "Opciones",
    catStatus: "Estado",
    refreshNow: "Actualizar ahora",
    refreshDesc: "auto cada {s}s y al terminar cada turno",
    optPanel: "Panel en la sidebar: {v}",
    optToasts: "Avisos por umbral: {v}",
    optToastsDesc: "al superar {a}% y {b}%",
    optDesktop: "Notificación de escritorio: {v}",
    optDesktopOff: 'requiere "attention": { "enabled": true } en tui.json',
    optLang: "Idioma: esp -> eng",
    refreshS: "Actualizar",
    optThresholds: "Umbrales de aviso: {a}% / {b}%",
    optPanelS: "Panel: {v}",
    optToastsS: "Avisos: {v}",
    optDesktopS: "Escritorio: {v}",
    optDesktopOffS: "apagado en tui.json (attention)",
    resetRow: "Reinicio",
    thrPrompt: "Umbrales en % usado: «suave fuerte» (ej. 75 90)",
    thrSet: "Umbrales: aviso al {a}%, fuerte al {b}%",
    thrBad: "Formato: dos números entre 1 y 100, el primero menor. Ej.: 75 90",
    cmdThresholds: "Cuota Codex: cambiar umbrales de aviso",
    visible: "visible",
    hidden: "oculto",
    on: "activados",
    off: "desactivados",
    onF: "activada",
    offF: "desactivada",
    window: "Ventana {w}",
    resetsIn: "reinicia en {t}",
    limitReachedShort: "LÍMITE ALCANZADO",
    blocked: "bloqueado",
    creditsLine: "Créditos: {v}",
    unlimited: "ilimitados",
    noCredits: "sin créditos extra",
    updated: "actualizado {t}",
    sourceProbe: "fuente: sondeo",
    models: "Modelos",
    unavailable: "(no disponible)",
    lastError: "Último error",
    paused: "Consultas en pausa",
    pausedDesc: "sin token válido; se reanudan al terminar el próximo turno o con «Actualizar ahora»",
    // tool
    toolPlan: "Plan ChatGPT: {p}",
    toolReset: "reset en {t}",
    toolCredits: "Créditos: {v}",
    toolSource: "(fuente: sondeo de respaldo)",
    toolFail: "No pude leer la cuota: {m}",
    notifyShown: "Aviso mostrado.",
    notifyFail: "No se pudo mostrar el aviso (¿no hay TUI conectado?).",
  },
  en: {
    quota: "Codex quota",
    remaining: "left",
    used: "used",
    plan: "Plan",
    never: "never",
    ago: "{t} ago",
    today: "today",
    days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    querying: "checking…",
    queryingQuota: "checking quota…",
    noData: "no data",
    limit: "LIMIT",
    credits: "credits",
    err_no_auth: "no OpenAI login",
    err_expired: "token expired",
    err_unauthorized: "unauthorized",
    err_ratelimited: "429, waiting",
    err_network: "offline",
    err_http: "HTTP {s}",
    err_parse: "unexpected response",
    msg_no_auth: "No OpenAI OAuth login in auth.json (use /connect → OpenAI → ChatGPT).",
    msg_expired: "OpenAI OAuth token expired; OpenCode renews it on your next message.",
    msg_unauthorized: "OpenAI rejected the token (HTTP {s}). Reconnect with /connect or send a message to renew it.",
    msg_ratelimited: "Too many requests (429){r}.",
    msg_http: "Usage API returned HTTP {s}.",
    msg_network: "Cannot reach chatgpt.com: {e}",
    msg_parse: "Unrecognized usage response: {e}",
    msg_probe_no_model: "Could not pick a model for the probe (set probeModel).",
    msg_probe_no_headers: "Probe response had no x-codex-* headers.",
    windowUsed: "{w} window: {p}% used · resets in {t}",
    windowReset: "{w} window reset{away} ({p}% used).",
    whileAway: " while you were away",
    limitReached: "Plan limit reached. Requests will fail until the window resets.",
    probeOn: "Usage API not responding; switching to the fallback probe (~10 tokens per check, every 10 min).",
    probeOff: "Usage API is back; leaving the fallback probe.",
    panelShown: "Quota panel shown",
    panelHidden: "Quota panel hidden",
    toastsOn: "Threshold alerts enabled",
    toastsOff: "Threshold alerts disabled",
    desktopOn: "Desktop notification enabled",
    desktopOff: "Desktop notification disabled",
    langChanged: "Language: English",
    cmdShow: "Codex quota: details and options",
    cmdShowDesc: "5h and weekly windows of your ChatGPT plan, credits and HUD settings",
    cmdRefresh: "Codex quota: refresh now",
    cmdToggle: "Codex quota: show/hide panel",
    cmdLang: "Codex quota: switch language (español/English)",
    pickAction: "Pick an action…",
    catActions: "Actions",
    catOptions: "Options",
    catStatus: "Status",
    refreshNow: "Refresh now",
    refreshDesc: "auto every {s}s and after each turn",
    optPanel: "Sidebar panel: {v}",
    optToasts: "Threshold alerts: {v}",
    optToastsDesc: "when passing {a}% and {b}%",
    optDesktop: "Desktop notification: {v}",
    optDesktopOff: 'requires "attention": { "enabled": true } in tui.json',
    optLang: "Lang: eng -> esp",
    refreshS: "Refresh",
    optThresholds: "Alert thresholds: {a}% / {b}%",
    optPanelS: "Panel: {v}",
    optToastsS: "Alerts: {v}",
    optDesktopS: "Desktop: {v}",
    optDesktopOffS: "off in tui.json (attention)",
    resetRow: "Reset",
    thrPrompt: "Thresholds in % used: “soft strong” (e.g. 75 90)",
    thrSet: "Thresholds: alert at {a}%, strong at {b}%",
    thrBad: "Format: two numbers between 1 and 100, first one lower. E.g.: 75 90",
    cmdThresholds: "Codex quota: change alert thresholds",
    visible: "shown",
    hidden: "hidden",
    on: "on",
    off: "off",
    onF: "on",
    offF: "off",
    window: "{w} window",
    resetsIn: "resets in {t}",
    limitReachedShort: "LIMIT REACHED",
    blocked: "blocked",
    creditsLine: "Credits: {v}",
    unlimited: "unlimited",
    noCredits: "no extra credits",
    updated: "updated {t}",
    sourceProbe: "source: probe",
    models: "Models",
    unavailable: "(unavailable)",
    lastError: "Last error",
    paused: "Checks paused",
    pausedDesc: "no valid token; resumes after the next turn or with “Refresh now”",
    toolPlan: "ChatGPT plan: {p}",
    toolReset: "resets in {t}",
    toolCredits: "Credits: {v}",
    toolSource: "(source: fallback probe)",
    toolFail: "Could not read the quota: {m}",
    notifyShown: "Notification shown.",
    notifyFail: "Could not show the notification (no TUI connected?).",
  },
} as const

export type Key = keyof typeof DICT.es

export function t(lang: Lang, key: Key, params: Record<string, string | number> = {}): string {
  const raw = DICT[lang][key]
  const s = Array.isArray(raw) ? raw.join(",") : String(raw)
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : ""))
}

export function dayNames(lang: Lang): readonly string[] {
  return DICT[lang].days
}
