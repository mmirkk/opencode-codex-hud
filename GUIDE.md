# opencode-codex-hud — Guide / Guía

## English

**What it does.** Shows your ChatGPT (Codex) plan quota in OpenCode: 5-hour and weekly windows, % left and time to reset. Sidebar panel, home-screen line and alerts when you approach the limit.

**Install**

```bash
opencode plugin "C:/path/to/opencode-codex-hud" -g
```

Restart OpenCode. Requires OpenCode ≥ 1.18 and the OpenAI provider connected via `/connect` → *Sign in with ChatGPT*.

**Commands**

| Command | Aliases | What it does |
|---|---|---|
| `/quota` | `/cuota`, `/usage` | Opens the menu: Refresh · Thresholds · Language · Panel · Alerts · Desktop, plus one line with the reset times |
| `/quota-refresh` | `/cuota-actualizar` | Refresh now |
| `/quota-panel` | `/cuota-panel` | Show or hide the sidebar panel |
| `/quota-thresholds` | `/cuota-umbrales` | Change the alert thresholds: type `soft strong` in % used, e.g. `75 90`. Persisted |
| `/quota-lang` | `/cuota-idioma` | Español ⇄ English (also applies to the MCP plugin) |

**Alerts.** Toast when passing the soft threshold (75% by default), red toast + desktop notification + sound when passing the strong one (90%) or reaching the limit. Only when it gets worse. For desktop notifications, in `~/.config/opencode/tui.json`: `{ "attention": { "enabled": true } }`.

**Agent.** Tools `codex_usage` (reads your quota) and `hud_notify` (toast + desktop notification; ask it to "notify me when done").

**Options** in `tui.json` (all optional): `["opencode-codex-hud", { "intervalSeconds": 60, "warnAt": 75, "dangerAt": 90, "display": "restante" }]`. Others: `toasts`, `desktop`, `sound`, `sidebar`, `home`, `barWidth`, `order`, `idleAfterMinutes`, `fallbackProbe`, `probeModel`. Whatever you change from `/quota` overrides these and is persisted.

**How it works.** Reads the OAuth token from `~/.local/share/opencode/auth.json` and calls `GET chatgpt.com/backend-api/wham/usage` (free) every 60 s and after each turn. If that API stops responding, it falls back to an `x-codex-*` header probe (~10 tokens, every 10 min). It never modifies the token.

---

## Español

**Qué hace.** Muestra la cuota de tu plan ChatGPT (Codex) en OpenCode: ventana de 5 h y semanal, % restante y tiempo hasta el reinicio. Panel en la sidebar, línea en la pantalla de inicio y avisos al acercarte al límite.

**Instalar**

```bash
opencode plugin "C:/ruta/a/opencode-codex-hud" -g
```

Reiniciá OpenCode. Requiere OpenCode ≥ 1.18 y el proveedor OpenAI conectado con `/connect` → *Sign in with ChatGPT*.

**Comandos**

| Comando | Alias | Qué hace |
|---|---|---|
| `/quota` | `/cuota`, `/usage` | Abre el menú: Actualizar · Umbrales · Idioma · Panel · Avisos · Escritorio, y una línea con los reinicios |
| `/quota-refresh` | `/cuota-actualizar` | Consulta ahora |
| `/quota-panel` | `/cuota-panel` | Muestra u oculta el panel de la sidebar |
| `/quota-thresholds` | `/cuota-umbrales` | Cambia los umbrales de aviso: escribís `suave fuerte` en % usado, por ejemplo `75 90`. Se guardan |
| `/quota-lang` | `/cuota-idioma` | Español ⇄ English (aplica también al plugin de MCP) |

**Avisos.** Toast al pasar el umbral suave (75 % por defecto) y toast rojo + notificación de escritorio + sonido al pasar el fuerte (90 %) o alcanzar el límite. Solo avisa cuando empeora. Para la notificación de escritorio, en `~/.config/opencode/tui.json`: `{ "attention": { "enabled": true } }`.

**Agente.** Tools `codex_usage` (lee tu cuota) y `hud_notify` (te avisa con toast y notificación de escritorio; pedile "avisame cuando termines").

**Opciones** en `tui.json` (todas opcionales): `["opencode-codex-hud", { "intervalSeconds": 60, "warnAt": 75, "dangerAt": 90, "display": "restante" }]`. Otras: `toasts`, `desktop`, `sound`, `sidebar`, `home`, `barWidth`, `order`, `idleAfterMinutes`, `fallbackProbe`, `probeModel`. Lo que cambies desde `/quota` pisa estas opciones y queda guardado.

**Cómo funciona.** Lee el token OAuth de `~/.local/share/opencode/auth.json` y consulta `GET chatgpt.com/backend-api/wham/usage` (gratis) cada 60 s y al terminar cada turno. Si esa API deja de responder, pasa a un sondeo por headers `x-codex-*` (~10 tokens, cada 10 min). Nunca modifica el token.