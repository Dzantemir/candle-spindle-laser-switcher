# Spindle / Laser — tool switcher plugin for Candle

A compact icon panel for Candle that switches tools **SPINDLE ($32=0) ↔ LASER
($32=1)** — together with the speeds (the `$30`/`$31` S-parameter range).

**One click = a tool change request.** The plugin reads the controller's
actual `$30`/`$31`/`$32` values, sends `M5`, `S0`, `G0` and `$32=x`, then waits
for GRBL to acknowledge `$32`. Both `$30` and `$31` limits from Candle's **"Machine info"** are sent after
that acknowledgement whenever their target values are available, even when one
value already matches the controller. Target limits are applied automatically;
no QtScript-dependent confirmation dialog can silently block the switch. If GRBL rejects the mode command, the interface is refreshed
from the controller's reported settings.

## Features

- **Acknowledged mode switching.** The UI changes only after GRBL acknowledges
  `$32`. The configured Machine-info `$30`/`$31` limits are applied after that
  acknowledgement; a rejected command causes a fresh `$$` query.
- **Complete range applied on every switch.** After GRBL acknowledges `$32`, the
  plugin explicitly sends both `$30` and `$31` whenever their Machine-info target
  values are available. This keeps the max/min pair explicit in the command log,
  even if one target equals the current value.
- **Values are always fresh.** The limits are read from Candle's settings at
  click time instead of being copied into plugin settings: editing
  "Machine info" takes effect on the next switch.
- **The "Speed" slider follows the tool.** The range of the speed slider in
  Candle's main window switches to the active tool's limits, the current
  position is rescaled proportionally (50% → 50%). UI-side only — nothing
  extra is sent to the controller.
- **No invented limits.** If a value is missing in "Machine info", the plugin keeps that current controller
  limit unchanged; it still sends `M5`, `S0` and `$32`.
- **Synchronization with the real machine state.** The `$$` query that
  Candle itself sends after every connect/reset/homing is recognized: the
  mode and the controller's real `$30` (shown in the button tooltip) are
  picked up from the answer. The last mode is remembered and restored on
  startup. On disconnect the state resets — everything is re-read on the
  next connection.
- **Uniform localization.** One translation file (`translation_ru.qm`)
  covers everything — panel buttons, tooltips, the settings page and all
  runtime messages — through the standard Candle mechanism (see below).

## Panel buttons

| Button | What it does | Commands sent |
|--------|--------------|---------------|
| **Mode** (spindle/laser icon) | tool change | `M5`, `S0`, `$32=x`; then `$30=…` and `$31=…` after `ok` |
| **Focus** | focus beam ON/OFF — laser mode only | query `$G`, then `G1 F…` (no axis words) + `M3 S…`; off uses `M5`, `S0`, `G0 F…` |
| **Pulse** | short laser test pulse — laser mode only | query `$G`, then `G1 F…` + `M3 S…` + `G4 P…` + `M5` + `S0` + restore `G0 F…` |
| **Off** | turn the laser off | `M5` + `S0` + `G0` |

The Focus, Pulse and Off buttons are hidden automatically in spindle mode.
The mode button tooltip shows the controller's real `$30` and the speed range
of the active tool.

## Plugin settings

- **Focus power (S)** — beam power for the Focus button;
- **Pulse S / duration (ms)** — test pulse parameters;
- an explanation of how the tool change works.

Speeds are not duplicated in the plugin settings — they are always taken
from "Machine info".

## Localization

The plugin uses the **standard Candle localization mechanism** — exactly like
the official usercommands plugin. One file, `translation_ru.qm`, covers every
user-visible string:

- static panel/settings strings (labels, tooltips, placeholders) are
  translated by Qt's QUiLoader itself (context = the `<class>` of the `.ui`);
- runtime messages use `qsTr()` from the script engine (empty context);
- the panel title "Spindle / Laser" is translated by Candle (frmMain context).

The plugin does no language detection of its own: Candle installs the
matching `translation_<lang>.qm` before loading the script, and without one
the UI is simply fully English — so it is either fully English or fully
Russian, never a mix. To add another language: copy `translation_ru.ts`,
translate the strings, compile with `lrelease translation_xx.ts` and put the
`.qm` next to the plugin files.

## Installation

1. Locate your Candle program folder (next to `candle.exe` / `candle`).
2. Copy the whole `spindle_laser` folder into `candleplugins`
   (create it if needed):

```
Candle/
├── candle(.exe)
└── candleplugins/
    └── spindle_laser/
        ├── config.ini
        ├── script.js
        ├── widget.ui
        ├── settings.ui
        ├── translation_ru.ts
        ├── translation_ru.qm
        └── images/            button icons
```

3. Restart Candle — a "Spindle / Laser" row appears in the right panel area.

## Requirements

- Candle with JS plugin support (the `candleplugins` folder);
- **grbl v1.1+** — the `$32` "laser mode" parameter only exists since v1.1;
- a filled "Machine info" tab: spindle speed min/max and laser power min/max —
  this is where the plugin takes `$30`/`$31` from.

## Version history

- **v8 (current)** — explicitly sends both `$30` and `$31` on every successful
  tool switch when the corresponding Machine-info values are available, including
  when a target equals the controller value. This ensures `$31` is not silently
  omitted from the switch log.
- **v7** — fixes for GRBL laser focus/pulse after reset and limits test power to
  the controller `$31`–`$30` range.
- **v6** — unified localization through the standard Candle
  mechanism: one `translation_ru.qm` covers the panel, tooltips, settings
  page and runtime messages (`.ui` strings are translated by QUiLoader,
  runtime strings via `qsTr()`); no more custom language detection — the UI
  is either fully English or fully Russian.
- **v5** — speeds switch with the tool: on every switch `$30`/`$31`
  are substituted from "Machine info" and written immediately — as a single
  `M5 + $32 + $30 + $31` batch, without a read/compare cycle (grbl v1.1 does
  not write identical values to EEPROM).
- **v4** — speed switching via "read → compare → write what differs".
- **v3** — UI-only speed switching (Candle's slider), no `$30`/`$31` writes
  at all; the limits block removed from the settings page.
- **v2** — `$30`/`$31` writes made opt-in (off by default), default values
  taken from "Machine info".
- **v1 (bug)** — on every switch the plugin wrote fixed `$30`/`$31`
  (10000/0 and 1000/0) into EEPROM, ruining the machine's real limits.
  If grbl was already corrupted by that version — restore `$30`/`$31`
  manually from Candle's console.



### Focus and pulse behavior in GRBL laser mode

The Focus and Pulse commands enable constant power with `M3`, then select
the `G1` modal state without axis coordinates. This is necessary because
GRBL 1.1 laser mode suppresses the output in the default `G0` mode. The pulse
sequence ends with `M5`, `S0` and `G0`. Focus/Pulse are disabled until the
controller's actual `$30` maximum has been read; values are constrained by
`$31`/`$30`. This behavior is intended for manual stationary focusing and
should be tested at the lowest practical power with suitable eye protection.

Tool switching waits for the `$32` acknowledgement before applying Candle
Machine-info `$30`/`$31` limits. If `$32` is rejected, the plugin refreshes the
reported settings instead of leaving the UI optimistically switched. Note that
switching tools can intentionally change `$30`/`$31` to the configured target
range.

## Files

- `script.js` — plugin logic;
- `widget.ui` — the panel (4 buttons: Mode, Focus, Pulse, Off);
- `settings.ui` — the settings page (focus, pulse, explanation);
- `translation_ru.ts` / `translation_ru.qm` — Russian localization (all
  strings);
- `config.ini` — plugin manifest.

## License

GPL-3.0 (same as Candle). Files are saved in UTF-8.
