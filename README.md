# opencode-codex-hud

## English

Shows your ChatGPT (Codex) plan quota inside OpenCode, including the 5-hour and weekly windows, the percentage remaining, and the time left until each reset. The information stays visible in the sidebar and on the home screen, with alerts as you get closer to the limit.

```text id="qp0oko"
Codex plus · 5 h 84% (2h32m) · 7 d 56% (1d17h) remaining · /quota
```

## Installation

```bash id="b6iilj"
opencode plugin "C:/path/to/opencode-codex-hud" -g
```

Restart OpenCode after installation. OpenCode ≥ 1.18 is required, and the OpenAI provider must be connected through `/connect` → *Sign in with ChatGPT*.

## Usage

| Command             | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `/quota`            | View details and options (alias: `/cuota`)        |
| `/quota-refresh`    | Refresh the quota immediately                     |
| `/quota-panel`      | Show or hide the panel                            |
| `/quota-thresholds` | Change alert thresholds (e.g. `75 90`)            |
| `/quota-lang`       | Español ⇄ English                                 |

The agent can also retrieve your quota using `codex_usage` and notify you through `hud_notify` when a long-running task has finished.

To enable desktop notifications with sound, add the following to `~/.config/opencode/tui.json`:

```json id="0xducg"
{ "attention": { "enabled": true } }
```

For all options, environment variables, implementation details, and usage information, see [GUIA.md](GUIA.md).

## License

MIT

---

## Español

Muestra la cuota de tu plan ChatGPT (Codex) dentro de OpenCode: ventana de 5 h y semanal, % restante y tiempo hasta el reinicio. Siempre a la vista en la sidebar y en la pantalla de inicio, con avisos cuando te acercás al límite.

```
Codex plus · 5 h 84% (2h32m) · 7 d 56% (1d17h) restante · /quota
```

## Instalar

```bash
opencode plugin "C:/ruta/a/opencode-codex-hud" -g
```

Reiniciá OpenCode. Requiere OpenCode ≥ 1.18 y el proveedor OpenAI conectado con `/connect` → *Sign in with ChatGPT*.

## Usar

| Comando | Qué hace |
|---|---|
| `/quota` | Detalle y opciones (alias `/cuota`) |
| `/quota-refresh` | Actualizar ahora |
| `/quota-panel` | Mostrar u ocultar el panel |
| `/quota-thresholds` | Cambiar los umbrales de aviso (ej. `75 90`) |
| `/quota-lang` | Español ⇄ English |

El agente también puede consultar tu cuota (`codex_usage`) y avisarte cuando termina algo largo (`hud_notify`).

Para notificaciones de escritorio con sonido, en `~/.config/opencode/tui.json`:

```json
{ "attention": { "enabled": true } }
```

Guía completa (opciones, variables de entorno, cómo funciona): [GUIDE.md](GUIDE.md).

## Licencia

MIT
