/**
 * Utilidades puras de formato: barras de progreso, tiempos y niveles por umbral.
 * Sin dependencias de OpenCode ni de OpenTUI para poder testearlas con Node.
 */

export type Level = "ok" | "warn" | "danger"

/** Nivel de alerta según el porcentaje usado y los umbrales configurados. */
export function level(usedPercent: number, warnAt: number, dangerAt: number): Level {
  if (usedPercent >= dangerAt) return "danger"
  if (usedPercent >= warnAt) return "warn"
  return "ok"
}

/** Barra de progreso de ancho fijo: "▓▓▓░░░░░░░". */
export function bar(usedPercent: number, width = 10, filled = "▓", empty = "░"): string {
  const pct = clamp(usedPercent, 0, 100)
  const n = Math.round((pct / 100) * width)
  return filled.repeat(n) + empty.repeat(Math.max(0, width - n))
}

export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  return Math.min(max, Math.max(min, n))
}

/** Duración compacta: 45s, 12m, 4h38m, 1d19h, 6d. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  if (h < 24) return rm ? `${h}h${pad(rm)}m` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh ? `${d}d${rh}h` : `${d}d`
}

/** Nombre corto de la ventana de límite según su tamaño: "5 h", "7 d", "30 d". */
export function windowLabel(limitWindowSeconds: number): string {
  const h = limitWindowSeconds / 3600
  if (h < 48) return `${Math.round(h)} h`
  return `${Math.round(h / 24)} d`
}

/** Fecha/hora local corta: "hoy 14:30" o "mié 17 14:30" (etiquetas configurables por idioma). */
export function localTime(
  epochSeconds: number,
  now = new Date(),
  labels: { today: string; days: readonly string[] } = { today: "hoy", days: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] },
): string {
  const d = new Date(epochSeconds * 1000)
  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  if (d.toDateString() === now.toDateString()) return `${labels.today} ${hh}:${mm}`
  return `${labels.days[d.getDay()]} ${d.getDate()} ${hh}:${mm}`
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
