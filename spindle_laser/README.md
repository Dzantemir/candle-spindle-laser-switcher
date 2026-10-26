# Spindle / Laser — tool switcher plugin for Candle

A compact icon panel for Candle that switches tools **SPINDLE ($32=0) ↔ LASER
($32=1)** — together with the speeds (the `$30`/`$31` S-parameter range).

**One click = a tool change request.** The plugin reads the controller's
actual `$30`/`$31`/`$32` values, sends `M5`, `S0`, `G0` and `$32=x`, then waits
for GRBL to acknowledge `$32`. Both `$30` and `$31` limits from Candle's **"Machine info"** are then written
one at a time (each acknowledged by GRBL, in the order that keeps the
interim range valid), even when one value already matches the controller.
The first time a target range would overwrite **different** values in the
controller, the switch asks for a confirmation click instead: the mode
button tooltip shows the old → new `$30`/`$31` values, nothing is sent yet,
and clicking Mode again within 15 seconds confirms (the range is then
remembered, so later switches stay one-click). This prevents a fresh
Candle installation's factory-default "Machine info" values (spindle
0/10000, laser 0/100) from silently replacing the machine's real limits.
If GRBL rejects the mode command, the interface is refreshed
from the controller's reported settings.

## Features

- **Acknowledged mode switching.** The UI changes only after GRBL acknowledges
  `$32`. The configured Machine-info `$30`/`$31` limits are applied after that
  acknowledgement; a rejected command causes a fresh `$$` query.
- **Complete range applied on every switch.** After GRBL acknowledges `$32`, the
  plugin explicitly writes both `$30` and `$31` whenever their Machine-info target
  values are available — one at a time and in the order that keeps the interim
  EEPROM range valid (`$31` first when the current minimum is not below the new
  maximum). This keeps the max/min pair explicit in the command log, even if one
  target equals the current value, and a failed write aborts the pair with a
  warning instead of leaving a mixed range behind.
- **Values are always fresh.** The limits are read from Candle's settings at
  click time instead of being copied into plugin settings: editing
  "Machine info" takes effect on the next switch.
- **The "Speed" slider follows the tool.** The range of the speed slider in
  Candle's main window switches to the active tool's limits, the current
  position is rescaled proportionally (50% → 50%). UI-side only — nothing
  extra is sent to the controller.
- **No invented limits, no silent overwrites.** If a value is missing in
  "Machine info", the plugin keeps that current controller limit unchanged.
  An invalid target range (`max ≤ 0` or `min ≥ max`) refuses the tool change
  entirely — nothing is sent and the reason is shown to the user. And the
  first time a target range differs from what the controller currently has,
  the switch requires a confirmation click showing the old → new values
  (acknowledged ranges are remembered).
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
| **Mode** (spindle/laser icon) | tool change | `M5`, `S0`, `G0`, `$32=x`; after `ok` `$30=…`/`$31=…` sequentially (first use of a new range: confirmation click) |
| **Focus** | focus beam ON/OFF — laser mode only, auto-OFF after 5 minutes | query `$G`, then `G1 F…` (no axis words) + `M3 S…`; off uses `M5`, `S0`, `G0 F…` |
| **Pulse** | short laser test pulse — laser mode only | query `$G`, then `G1 F…` + `M3 S…` + `G4 P…` + `M5` + `S0` + restore `G0 F…` |
| **Off** | turn the laser off, cancel pending laser actions | `M5` + `S0` + `G0` |

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
        ├── LICENSE
        └── images/            button icons
```

3. Restart Candle — a "Spindle / Laser" row appears in the right panel area.

## Requirements

- a current Candle build with JS plugin support (the `candleplugins`
  folder, "Machine info" laser fields and the plugin storage API;
  developed against the current Denvi/Candle sources);
- **grbl v1.1+** — the `$32` "laser mode" parameter only exists since v1.1;
- a filled "Machine info" tab: spindle speed min/max and laser power min/max —
  this is where the plugin takes `$30`/`$31` from.

## Version history

- **v10 (current)** — second audit fixes: `$30`/`$31` are written sequentially
  (acknowledged one at a time) in the order that keeps the interim EEPROM
  range valid; overwriting different controller limits needs a confirmation
  click the first time (factory-default "Machine info" values can no longer
  silently replace the machine's real limits); laser actions are re-validated
  at fire time and are cancelled by tool changes and by the always-enabled
  OFF button; expected command strings are matched exactly (response index
  -100 is shared by all plugins); a late `$32` acknowledgement still
  completes the limits; Focus/Pulse user values are no longer rewritten to
  the controller range (clamping happens at fire time only); the speed
  slider no longer collapses after accepting Candle settings in laser mode;
  the modal message box is removed; focus auto-OFF after 5 minutes;
  Alarm/Sleep clear the focus state; assorted interlock, timeout and
  documentation fixes.
- **v9** — audit fixes: a tool change is refused (nothing is sent)
  when the Machine-info range is invalid (`max ≤ 0` or `min ≥ max` — in GRBL
  such a range makes any S>0 output full power); the deferred
  toggle-after-`$$` request expires after 5 s and is cancelled by an external
  `$32` change; Focus lights up only after GRBL acknowledges `M3`, and pending
  laser actions have a 5 s timeout; state-machine answers are matched only for
  the plugin's own commands; no invented slider limits when no trustworthy
  range is known; `translation_ru.qm` recompiled from `translation_ru.ts`
  (the hard-coded settings-note override is removed); root README
  synchronized, LICENSE file added, unused `refresh.png` removed.
- **v8** — explicitly sends both `$30` and `$31` on every successful
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

The Focus and Pulse commands first query `$G` to learn the current modal
feed `F`, then select the `G1` modal state without axis coordinates
(`G1 F…`) and only then enable constant power with `M3`. This is necessary
because GRBL 1.1 laser mode suppresses the output in the default `G0` mode.
The pulse sequence ends with `M5`, `S0` and `G0` restoring the previous feed;
the focus beam turns itself OFF after 5 minutes. Focus/Pulse are disabled
until the controller's actual `$30` maximum has been read; the power that is
actually sent is clamped to `$31`/`$30` at fire time (and is still subject
to GRBL's spindle-speed override, if one is set in Candle). This behavior
is intended for manual stationary focusing and should be tested at the
lowest practical power with suitable eye protection.

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

GPL-3.0 (same as Candle) — see the `LICENSE` file in the repository root.
Files are saved in UTF-8.
