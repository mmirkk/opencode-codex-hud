/** @jsxImportSource @opentui/solid */
/**
 * opencode-codex-hud — plugin de TUI.
 *
 * Muestra la cuota real del plan ChatGPT (Codex) dentro de OpenCode:
 *  - panel en la sidebar de la sesión y línea en la pantalla de inicio,
 *  - toasts + notificación de escritorio + sonido al cruzar umbrales,
 *  - comando /quota (alias /cuota) con acciones, opciones y estado,
 *  - puente para la tool `hud_notify` del lado server (toast → escritorio),
 *  - snapshot persistido, ritmo lento sin actividad, respaldo por sondeo,
 *  - español / inglés con /quota-lang (preferencia compartida con los demás plugins).
 */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { bar, duration, level, localTime, windowLabel, type Level } from "./format.ts"
import { dayNames, LANG_KEY, normalizeLang, t, type Key, type Lang } from "./i18n.ts"
import { probeUsage } from "./probe.ts"
import { ENV, settingsFrom, type Options } from "./settings.ts"
import { dataDir, fetchUsage, type RateWindow, type Usage, type UsageError, type UsageResult } from "./usage.ts"

export const ID = "opencode-codex-hud"
export type { Options }

type State =
  | { kind: "loading" }
  | { kind: "ok"; usage: Usage }
  | { kind: "error"; error: UsageError; last?: Usage }

const KV = {
  sidebar: `${ID}.sidebar`,
  toasts: `${ID}.toasts`,
  desktop: `${ID}.desktop`,
  levels: `${ID}.levels`,
  snapshot: `${ID}.snapshot`,
  probeModel: `${ID}.probeModel`,
  thresholds: `${ID}.thresholds`,
}

const tui: TuiPlugin = async (api, options) => {
  const cfg = settingsFrom(options)
  const savedThr = api.kv.get<{ warnAt: number; dangerAt: number } | undefined>(KV.thresholds, undefined)
  const [thr, setThr] = createSignal<{ warnAt: number; dangerAt: number }>(savedThr && typeof savedThr.warnAt === "number" ? savedThr : { warnAt: cfg.warnAt, dangerAt: cfg.dangerAt })
  const warnAt = () => thr().warnAt
  const dangerAt = () => thr().dangerAt
  const [state, setState] = createSignal<State>({ kind: "loading" })
  const [updatedAt, setUpdatedAt] = createSignal<number>(0)
  const [source, setSource] = createSignal<"wham" | "probe">("wham")
  const [paused, setPaused] = createSignal<string | undefined>(undefined)
  const [showSidebar, setShowSidebar] = createSignal<boolean>(api.kv.get<boolean>(KV.sidebar, cfg.sidebar))
  const [toastsOn, setToastsOn] = createSignal<boolean>(api.kv.get<boolean>(KV.toasts, cfg.toasts))
  const [desktopOn, setDesktopOn] = createSignal<boolean>(api.kv.get<boolean>(KV.desktop, cfg.desktop))

  // ── idioma (compartido entre plugins vía KV) ───────────────────────────────
  const [lang, setLang] = createSignal<Lang>(normalizeLang(api.kv.get<string>(LANG_KEY, "")) ?? normalizeLang(process.env.OPENCODE_PLUGINS_LANG) ?? "es")
  const tr = (key: Key, params?: Record<string, string | number>) => t(lang(), key, params)
  const langSync = setInterval(() => {
    const l = normalizeLang(api.kv.get<string>(LANG_KEY, ""))
    if (l && l !== lang()) {
      setLang(l)
      registerCommands()
    }
  }, 3000)
  function switchLang() {
    const next: Lang = lang() === "es" ? "en" : "es"
    setLang(next)
    api.kv.set(LANG_KEY, next)
    registerCommands()
    api.ui.toast({ variant: "info", message: t(next, "langChanged"), duration: 2500 })
  }

  const dir = dataDir()
  const theme = () => api.theme.current
  const usageUrl = process.env[ENV + "USAGE_URL"] || undefined

  const colorFor = (lvl: Level) => {
    if (lvl === "danger") return theme().error
    if (lvl === "warn") return theme().warning
    return theme().success
  }
  const shown = (w: RateWindow) => (cfg.display === "usado" ? w.usedPercent : Math.max(0, 100 - w.usedPercent))
  const shownBar = (w: RateWindow) => bar(shown(w), cfg.barWidth)
  const shownLabel = () => (cfg.display === "usado" ? tr("used") : tr("remaining"))
  const lastUsage = (s: State) => (s.kind === "ok" ? s.usage : s.kind === "error" ? s.last : undefined)
  const localTimeL = (epoch: number) => localTime(epoch, new Date(), { today: tr("today"), days: dayNames(lang()) })

  /** mensaje largo de un error, en el idioma actual */
  function messageFor(e: UsageError): string {
    switch (e.code) {
      case "no-auth":
        return tr("msg_no_auth")
      case "expired":
        return tr("msg_expired")
      case "unauthorized":
        return tr("msg_unauthorized", { s: e.status ?? "" })
      case "ratelimited":
        return tr("msg_ratelimited", { r: e.retryAfterSeconds ? ` · ${e.retryAfterSeconds}s` : "" })
      case "http":
        return tr("msg_http", { s: e.status ?? "?" })
      case "network":
        return tr("msg_network", { e: e.message.replace(/^[^:]*:\s*/, "") })
      default:
        return tr("msg_parse", { e: e.message.replace(/^[^:]*:\s*/, "") })
    }
  }
  function shortError(e: UsageError): string {
    switch (e.code) {
      case "no-auth":
        return tr("err_no_auth")
      case "expired":
        return tr("err_expired")
      case "unauthorized":
        return tr("err_unauthorized")
      case "ratelimited":
        return tr("err_ratelimited")
      case "network":
        return tr("err_network")
      case "http":
        return tr("err_http", { s: e.status ?? "?" })
      default:
        return tr("err_parse")
    }
  }

  // ── snapshot de la sesión anterior ─────────────────────────────────────────
  const snap = api.kv.get<Usage | undefined>(KV.snapshot, undefined)
  if (snap && typeof snap === "object" && typeof snap.fetchedAt === "number") {
    setState({ kind: "ok", usage: snap })
    setUpdatedAt(snap.fetchedAt)
  }

  // ── consulta ───────────────────────────────────────────────────────────────
  let inFlight = false
  let failures = 0
  let whamFailures = 0
  let probeCycles = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastActivity = Date.now()
  let authWarned = false
  let probeAnnounced = false
  let firstFetchDone = false

  async function query(): Promise<UsageResult> {
    if (source() === "probe") {
      probeCycles += 1
      if (probeCycles % 10 === 0) {
        const r = await fetchUsage({ dataDir: dir, usageUrl })
        if (r.ok) {
          setSource("wham")
          whamFailures = 0
          api.ui.toast({ variant: "info", title: tr("quota"), message: tr("probeOff"), duration: 4000 })
          return r
        }
      }
      const model = cfg.probeModel || api.kv.get<string>(KV.probeModel, "")
      const r = await probeUsage({ dataDir: dir, model: model || undefined })
      if (r.ok && r.model && r.model !== model) api.kv.set(KV.probeModel, r.model)
      return r
    }
    const r = await fetchUsage({ dataDir: dir, usageUrl })
    if (!r.ok && cfg.fallbackProbe && (r.code === "parse" || (r.code === "http" && (r.status === 404 || r.status === 410)))) {
      whamFailures += 1
      if (whamFailures >= 2) {
        setSource("probe")
        probeCycles = 0
        if (!probeAnnounced) {
          probeAnnounced = true
          api.ui.toast({ variant: "warning", title: tr("quota"), message: tr("probeOn"), duration: 10_000 })
        }
        return query()
      }
    } else if (r.ok) {
      whamFailures = 0
    }
    return r
  }

  async function refresh(reason: "timer" | "manual" | "event") {
    if (inFlight) return
    if (paused() && reason === "timer") return
    inFlight = true
    let retryAfter: number | undefined
    try {
      const res = await query()
      const prev = state()
      const before = lastUsage(prev)
      if (res.ok) {
        failures = 0
        setPaused(undefined)
        authWarned = false
        setState({ kind: "ok", usage: res.usage })
        setUpdatedAt(Date.now())
        api.kv.set(KV.snapshot, res.usage)
        notifyThresholds(res.usage, before, !firstFetchDone && !!snap)
        firstFetchDone = true
        if (reason === "manual" || cfg.toastMode === "always") {
          api.ui.toast({ variant: "success", title: tr("quota"), message: summary(res.usage), duration: 4000 })
        }
      } else {
        setState({ kind: "error", error: res, last: before })
        if (res.code === "expired" || res.code === "unauthorized" || res.code === "no-auth") {
          setPaused(res.code)
          if (!authWarned) {
            authWarned = true
            api.ui.toast({ variant: "warning", title: tr("quota"), message: messageFor(res), duration: 8000 })
          }
        } else if (res.code === "ratelimited") {
          retryAfter = Math.max(60, res.retryAfterSeconds ?? 0)
          if (reason === "manual") api.ui.toast({ variant: "warning", title: tr("quota"), message: messageFor(res) })
        } else {
          const fallbackCandidate = cfg.fallbackProbe && res.code === "http" && (res.status === 404 || res.status === 410)
          if (!fallbackCandidate) failures += 1
          if (reason === "manual") api.ui.toast({ variant: "warning", title: tr("quota"), message: messageFor(res) })
        }
      }
    } catch (e) {
      failures += 1
      setState({ kind: "error", error: { ok: false, code: "network", message: (e as Error).message }, last: lastUsage(state()) })
    } finally {
      inFlight = false
      schedule(retryAfter)
    }
  }

  function schedule(retryAfterSeconds?: number) {
    if (timer) clearTimeout(timer)
    if (paused()) return
    const idle = Date.now() - lastActivity > cfg.idleAfterMinutes * 60_000
    let base = cfg.intervalSeconds
    if (source() === "probe") base = Math.max(base, 600)
    if (idle) base = Math.max(base, 600)
    const factor = Math.min(2 ** Math.min(failures, 4), 10)
    let ms = Math.min(base * 1000 * factor, 600_000)
    if (retryAfterSeconds) ms = Math.max(ms, retryAfterSeconds * 1000)
    timer = setTimeout(() => void refresh("timer"), ms)
  }

  function resume(reason: "event" | "manual") {
    if (paused()) setPaused(undefined)
    void refresh(reason)
  }

  // ── avisos ─────────────────────────────────────────────────────────────────
  type Levels = { primary?: Level; secondary?: Level; limit?: boolean }
  function notifyThresholds(u: Usage, prev: Usage | undefined, fromSnapshot: boolean) {
    const saved = api.kv.get<Levels>(KV.levels, {})
    const next: Levels = {
      primary: u.primary ? level(u.primary.usedPercent, warnAt(), dangerAt()) : undefined,
      secondary: u.secondary ? level(u.secondary.usedPercent, warnAt(), dangerAt()) : undefined,
      limit: u.limitReached,
    }
    api.kv.set(KV.levels, next)
    if (cfg.toastMode === "never") return

    const rank = (l?: Level) => (l === "danger" ? 2 : l === "warn" ? 1 : 0)
    const windows: Array<["primary" | "secondary", RateWindow | undefined]> = [
      ["primary", u.primary],
      ["secondary", u.secondary],
    ]
    for (const [key, w] of windows) {
      if (!w) continue
      const before = rank(saved[key])
      const after = rank(next[key])
      const label = windowLabel(w.limitWindowSeconds)
      const pw = prev ? (key === "primary" ? prev.primary : prev.secondary) : undefined
      if (after > before) {
        const danger = next[key] === "danger"
        const msg = tr("windowUsed", { w: label, p: w.usedPercent, t: duration(w.resetAfterSeconds) })
        if (toastsOn()) api.ui.toast({ variant: danger ? "error" : "warning", title: tr("quota"), message: msg, duration: 8000 })
        if (desktopOn() && danger) {
          void api.attention.notify({ title: tr("quota"), message: msg, notification: { when: "always" }, sound: cfg.sound ? { name: "error" } : false })
        }
      } else if (pw && pw.usedPercent > w.usedPercent + 20) {
        if (toastsOn()) {
          api.ui.toast({ variant: "info", title: tr("quota"), message: tr("windowReset", { w: label, away: fromSnapshot ? tr("whileAway") : "", p: w.usedPercent }), duration: 5000 })
        }
      }
    }
    if (u.limitReached && !saved.limit) {
      const msg = tr("limitReached")
      if (toastsOn()) api.ui.toast({ variant: "error", title: tr("quota"), message: msg, duration: 10_000 })
      if (desktopOn()) {
        void api.attention.notify({ title: tr("quota"), message: msg, notification: { when: "always" }, sound: cfg.sound ? { name: "error" } : false })
      }
    }
  }

  function summary(u: Usage): string {
    const parts: string[] = []
    if (u.primary) parts.push(`${windowLabel(u.primary.limitWindowSeconds)} ${shown(u.primary)}%`)
    if (u.secondary) parts.push(`${windowLabel(u.secondary.limitWindowSeconds)} ${shown(u.secondary)}%`)
    return `${u.planType} · ${parts.join(" · ")} ${shownLabel()}`
  }

  // ── eventos ────────────────────────────────────────────────────────────────
  api.event.on("tui.toast.show", (event) => {
    const p = event.properties
    if (!p.title?.startsWith("🔔")) return
    if (!desktopOn()) return
    void api.attention.notify({
      title: p.title.replace(/^🔔\s*/, "") || "OpenCode",
      message: p.message,
      notification: { when: "blurred" },
      sound: cfg.sound ? { name: p.variant === "error" ? "error" : "done" } : false,
    })
  })

  let idleDebounce: ReturnType<typeof setTimeout> | undefined
  api.event.on("session.idle", () => {
    lastActivity = Date.now()
    if (idleDebounce) clearTimeout(idleDebounce)
    idleDebounce = setTimeout(() => resume("event"), 2500)
  })
  api.event.on("session.status", () => {
    lastActivity = Date.now()
  })
  api.event.on("session.created", () => {
    lastActivity = Date.now()
  })

  api.lifecycle.onDispose(() => {
    if (timer) clearTimeout(timer)
    if (idleDebounce) clearTimeout(idleDebounce)
    clearInterval(langSync)
    if (layerDispose) layerDispose()
  })

  // ── comandos de la paleta (se re-registran al cambiar de idioma) ───────────
  let layerDispose: (() => void) | undefined
  function registerCommands() {
    if (layerDispose) layerDispose()
    layerDispose = api.keymap.registerLayer({
      commands: [
        { name: `${ID}.show`, title: tr("cmdShow"), desc: tr("cmdShowDesc"), category: "Codex", namespace: "palette", slashName: "quota", slashAliases: ["cuota", "usage", "codex"], run: () => openDialog() },
        { name: `${ID}.refresh`, title: tr("cmdRefresh"), category: "Codex", namespace: "palette", slashName: "quota-refresh", slashAliases: ["cuota-actualizar"], run: () => resume("manual") },
        { name: `${ID}.toggle`, title: tr("cmdToggle"), category: "Codex", namespace: "palette", slashName: "quota-panel", slashAliases: ["cuota-panel"], run: () => toggleSidebar() },
        { name: `${ID}.thresholds`, title: tr("cmdThresholds"), category: "Codex", namespace: "palette", slashName: "quota-thresholds", slashAliases: ["cuota-umbrales"], run: () => openThresholds() },
        { name: `${ID}.lang`, title: tr("cmdLang"), category: "Codex", namespace: "palette", slashName: "quota-lang", slashAliases: ["cuota-idioma", "language", "idioma"], run: () => switchLang() },
      ],
    }) as unknown as () => void
  }
  registerCommands()

  function openThresholds() {
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title={tr("thrPrompt")}
        placeholder="75 90"
        value={`${warnAt()} ${dangerAt()}`}
        onConfirm={(value) => {
          const m = value.trim().match(/^(\d{1,3})\D+(\d{1,3})$/)
          const a = m ? Number(m[1]) : NaN
          const b = m ? Number(m[2]) : NaN
          if (!m || a < 1 || b < 1 || a > 100 || b > 100 || a >= b) {
            api.ui.toast({ variant: "warning", title: tr("quota"), message: tr("thrBad"), duration: 5000 })
            return
          }
          api.ui.dialog.clear()
          setThr({ warnAt: a, dangerAt: b })
          api.kv.set(KV.thresholds, { warnAt: a, dangerAt: b })
          api.kv.set(KV.levels, {})
          api.ui.toast({ variant: "success", title: tr("quota"), message: tr("thrSet", { a, b }), duration: 4000 })
        }}
        onCancel={() => api.ui.dialog.clear()}
      />
    ))
  }

  function toggleSidebar() {
    const v = !showSidebar()
    setShowSidebar(v)
    api.kv.set(KV.sidebar, v)
    api.ui.toast({ variant: "info", message: v ? tr("panelShown") : tr("panelHidden"), duration: 2000 })
  }

  function openDialog() {
    const s = state()
    const u = lastUsage(s)
    const title = u ? `Codex · ${summary(u)}` : tr("quota")
    const attentionOff = !api.tuiConfig.attention.enabled
    const info = (title: string, description: string) => ({ title, value: "noop", description, category: tr("catStatus") })

    const resets = [u?.primary, u?.secondary]
      .filter((w): w is RateWindow => !!w)
      .map((w) => `${windowLabel(w.limitWindowSeconds)} ${tr("resetsIn", { t: duration(w.resetAfterSeconds) })} (${localTimeL(w.resetAt)})`)
      .join(" · ")
    const options = [
      { title: tr("refreshS"), value: "refresh", category: tr("catActions") },
      { title: tr("optThresholds", { a: warnAt(), b: dangerAt() }), value: "thresholds", category: tr("catActions") },
      { title: tr("optLang"), value: "lang", category: tr("catActions") },
      { title: tr("optPanelS", { v: showSidebar() ? tr("visible") : tr("hidden") }), value: "sidebar", category: tr("catOptions") },
      { title: tr("optToastsS", { v: toastsOn() ? tr("on") : tr("off") }), value: "toasts", category: tr("catOptions") },
      { title: tr("optDesktopS", { v: attentionOff ? tr("optDesktopOffS") : desktopOn() ? tr("onF") : tr("offF") }), value: "desktop", category: tr("catOptions") },
      ...(resets ? [info(tr("resetRow"), resets)] : []),
      ...(u?.source === "probe" ? [info(tr("sourceProbe"), "")] : []),
      ...(s.kind === "error" ? [info(tr("lastError"), messageFor(s.error))] : []),
      ...(paused() ? [info(tr("paused"), tr("pausedDesc"))] : []),
    ]

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={title}
        placeholder={tr("pickAction")}
        options={options}
        onSelect={(opt) => {
          switch (opt.value) {
            case "refresh":
              api.ui.dialog.clear()
              resume("manual")
              break
            case "lang":
              api.ui.dialog.clear()
              switchLang()
              break
            case "thresholds":
              openThresholds()
              break
            case "sidebar":
              api.ui.dialog.clear()
              toggleSidebar()
              break
            case "toasts": {
              const v = !toastsOn()
              setToastsOn(v)
              api.kv.set(KV.toasts, v)
              api.ui.dialog.clear()
              api.ui.toast({ variant: "info", message: v ? tr("toastsOn") : tr("toastsOff"), duration: 2000 })
              break
            }
            case "desktop": {
              const v = !desktopOn()
              setDesktopOn(v)
              api.kv.set(KV.desktop, v)
              api.ui.dialog.clear()
              api.ui.toast({ variant: "info", message: v ? tr("desktopOn") : tr("desktopOff"), duration: 2000 })
              break
            }
            default:
              break
          }
        }}
      />
    ))
  }

  // ── vistas ─────────────────────────────────────────────────────────────────
  function WindowRow(props: { w: RateWindow }) {
    const lvl = createMemo(() => level(props.w.usedPercent, warnAt(), dangerAt()))
    return (
      <box flexDirection="row" gap={1}>
        <text fg={theme().textMuted}>{windowLabel(props.w.limitWindowSeconds).padEnd(4)}</text>
        <text fg={colorFor(lvl())}>{shownBar(props.w)}</text>
        <text fg={colorFor(lvl())}>{`${String(shown(props.w)).padStart(3)}%`}</text>
        <text fg={theme().textMuted}>{`· ${duration(props.w.resetAfterSeconds)}`}</text>
      </box>
    )
  }

  function staleText(): string {
    const at = updatedAt()
    if (!at) return ""
    const age = Date.now() - at
    if (age < cfg.intervalSeconds * 3000) return ""
    return tr("ago", { t: duration(age / 1000) })
  }

  function Panel(props: { compact?: boolean }) {
    const [open, setOpen] = createSignal(true)
    const s = createMemo(() => state())
    const usage = createMemo(() => lastUsage(s()))
    const stale = createMemo(() => s().kind === "error")
    const errorText = createMemo(() => {
      const v = s()
      return v.kind === "error" ? shortError(v.error) : ""
    })
    const headline = createMemo(() => {
      const u = usage()
      if (!u) return "Codex"
      return `Codex · ${u.planType}${u.limitReached ? ` · ${tr("limit")}` : ""}`
    })
    const headColor = createMemo(() => {
      const u = usage()
      if (u?.limitReached) return theme().error
      if (stale()) return theme().warning
      return theme().text
    })
    const primary = createMemo(() => usage()?.primary)
    const secondary = createMemo(() => usage()?.secondary)
    const credits = createMemo(() => {
      const c = usage()?.credits
      return c?.hasCredits ? (c.unlimited ? "∞" : c.balance) : undefined
    })
    const age = createMemo(() => {
      updatedAt()
      s()
      lang()
      return staleText()
    })
    return (
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => setOpen((x) => !x)}>
          <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          <text fg={headColor()}>
            <b>{headline()}</b>
          </text>
          <Show when={stale()}>
            <text fg={theme().warning}>{errorText()}</text>
          </Show>
          <Show when={!stale() && age()}>
            <text fg={theme().textMuted}>{age()}</text>
          </Show>
        </box>
        <Show when={open()}>
          <Show when={usage()} fallback={<text fg={theme().textMuted}>{s().kind === "loading" ? tr("querying") : tr("noData")}</text>}>
            <box paddingLeft={props.compact ? 0 : 2}>
              <Show when={primary()}>
                <WindowRow w={primary()!} />
              </Show>
              <Show when={secondary()}>
                <WindowRow w={secondary()!} />
              </Show>
              <Show when={credits()}>
                <text fg={theme().textMuted}>{`${tr("credits")}: ${credits()}`}</text>
              </Show>
            </box>
          </Show>
        </Show>
      </box>
    )
  }

  function HomeLine() {
    const s = createMemo(() => state())
    const u = createMemo(() => lastUsage(s()))
    const fallbackText = createMemo(() => {
      const v = s()
      return v.kind === "loading" ? tr("queryingQuota") : v.kind === "error" ? shortError(v.error) : tr("noData")
    })
    const seg = (w: RateWindow) => ({
      label: windowLabel(w.limitWindowSeconds),
      pct: `${shown(w)}%`,
      color: colorFor(level(w.usedPercent, warnAt(), dangerAt())),
      reset: duration(w.resetAfterSeconds),
    })
    const segs: Accessor<ReturnType<typeof seg>[]> = createMemo(() => {
      const v = u()
      if (!v) return []
      return [v.primary, v.secondary].filter((w): w is RateWindow => !!w).map(seg)
    })
    return (
      <box flexDirection="row" gap={1}>
        <text fg={theme().textMuted}>Codex</text>
        <Show when={u()} fallback={<text fg={theme().textMuted}>{fallbackText()}</text>}>
          <text fg={theme().text}>{u()!.planType}</text>
          <For each={segs()}>
            {(x) => (
              <box flexDirection="row">
                <text fg={theme().textMuted}>{`· ${x.label} `}</text>
                <text fg={x.color}>{x.pct}</text>
                <text fg={theme().textMuted}>{` (${x.reset})`}</text>
              </box>
            )}
          </For>
        </Show>
        <text fg={theme().textMuted}>{`${shownLabel()} · /quota`}</text>
      </box>
    )
  }

  api.slots.register({
    order: cfg.order,
    slots: {
      sidebar_content() {
        return (
          <Show when={showSidebar()}>
            <Panel />
          </Show>
        )
      },
      ...(cfg.home
        ? {
            home_bottom() {
              return <HomeLine />
            },
          }
        : {}),
    },
  })

  void refresh("timer")
}

const plugin: TuiPluginModule & { id: string } = { id: ID, tui }

export default plugin
