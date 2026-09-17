/**
 * opencode-codex-hud — plugin del lado server.
 *
 * Aporta dos tools al agente:
 *  - `codex_usage`: cuota actual del plan ChatGPT (para que el modelo pueda responder
 *    "¿cuánto me queda?" o decidir no arrancar una tarea larga).
 *  - `hud_notify`: aviso visible al usuario (toast en el TUI; el plugin de TUI lo
 *    convierte además en notificación de escritorio + sonido cuando la terminal
 *    no tiene foco). Útil al terminar tareas largas o cuando se necesita al humano.
 */
import { tool, type Plugin, type PluginModule } from "@opencode-ai/plugin"
import { bar, duration, windowLabel } from "./format.ts"
import { probeUsage } from "./probe.ts"
import { readSharedLang } from "./i18n.ts"
import { dataDir, describeUsage, fetchUsage } from "./usage.ts"

export const ID = "opencode-codex-hud"

const server: Plugin = async ({ client }) => {
  const dir = dataDir()

  return {
    tool: {
      codex_usage: tool({
        description:
          "Devuelve la cuota actual del plan ChatGPT (Codex) del usuario: ventana de 5 h y semanal con % usado y tiempo hasta el reinicio, plan y créditos. Usala si el usuario pregunta cuánto le queda o antes de una tarea muy larga.",
        args: {},
        async execute() {
          let res = await fetchUsage({ dataDir: dir })
          if (!res.ok && (res.code === "parse" || (res.code === "http" && (res.status === 404 || res.status === 410)))) {
            // la API de uso no responde: sondeo de respaldo (consume ~10 tokens)
            res = await probeUsage({ dataDir: dir, model: process.env.OPENCODE_CODEX_HUD_PROBE_MODEL || undefined })
          }
          const lang = readSharedLang()
          if (!res.ok) return `${lang === "en" ? "Could not read the quota" : "No pude leer la cuota"}: ${res.message}`
          return describeUsage(res.usage, { bar: (p) => bar(p, 10), duration, windowLabel }, lang)
        },
      }),
      hud_notify: tool({
        description:
          "Muestra un aviso visible al usuario en OpenCode (toast, y notificación de escritorio con sonido si la terminal no tiene foco). Usala cuando termines una tarea larga, cuando necesites una decisión del usuario o ante un error que requiera su atención. Mensaje corto, en el idioma del usuario.",
        args: {
          message: tool.schema.string().min(1).max(300).describe("Texto del aviso (corto)"),
          title: tool.schema.string().max(60).optional().describe("Título opcional"),
          variant: tool.schema.enum(["info", "success", "warning", "error"]).optional().describe("Tipo de aviso; default info"),
        },
        async execute(args) {
          const title = `🔔 ${args.title?.trim() || "OpenCode"}`
          const res = await client.tui.showToast({
            body: { title, message: args.message, variant: args.variant ?? "info", duration: 8000 },
          })
          const en = readSharedLang() === "en"
          if (res.error) return en ? "Could not show the notification (no TUI connected?)." : "No se pudo mostrar el aviso (¿no hay TUI conectado?)."
          return en ? "Notification shown." : "Aviso mostrado."
        },
      }),
    },
  }
}

const plugin: PluginModule & { id: string } = { id: ID, server }

export default plugin
