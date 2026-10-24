# Spindle / Laser — tool switcher plugin for Candle

A compact icon panel for Candle that switches tools **SPINDLE ($32=0) ↔ LASER
($32=1)** — together with the speeds (the `$30`/`$31` S-parameter range).

**One click = a complete tool change.** Values are taken from Candle's
**"Machine info"** tab and sent to the controller as a single batch:

<img width="237" height="106" alt="{78D09F4F-39C0-4B51-8ED1-D253A2F906DD}" src="https://github.com/user-attachments/assets/615ae941-24fb-40c6-bec0-e30663521595" />
<img width="238" height="95" alt="{BBEBFC11-9C50-4DDF-880F-8D9F0FF21E1D}" src="https://github.com/user-attachments/assets/6c283e4e-1e36-48a8-a0f7-033a47ddc26e" />



```
M5          stop the tool before switching the mode
$32=1       enable laser mode
$30=1000    laser max power   ┐ substituted from the
$31=0       laser min power   ┘ "Machine info" tab
```

(when switching to the spindle — the same, but `$32=0` and the spindle speed
min/max instead of the laser power).

## Features

- **Speeds switch together with the tool.** On every spindle↔laser switch the
  plugin sends `M5`, `$32` and the `$30`/`$31` limits of the new tool in one
  batch: spindle — min/max speed, laser — min/max power from "Machine info".
- **Direct write, no preliminary read/compare.** A "read → compare → write
  only what differs" cycle is unnecessary: grbl v1.1 itself does not rewrite
  EEPROM values that are identical to the current ones, and a tool switch is
  a rare manual action, not a stream of commands. One click — one batch, no
  extra `$$` round-trips.
- **Values are always fresh.** The limits are read from Candle's settings at
  click time instead of being copied into plugin settings: editing
  "Machine info" takes effect on the next switch.
- **The "Speed" slider follows the tool.** The range of the speed slider in
  Candle's main window switches to the active tool's limits, the current
  position is rescaled proportionally (50% → 50%). UI-side only — nothing
  extra is sent to the controller.
- **No invented limits.** If a value is missing in "Machine info", only
  `M5`+`$32` is sent to the controller.
- **Synchronization with the real machine state.** The `$$` query that
  Candle itself sends after every connect/reset/homing is recognized: the
  mode and the controller's real `$30` (shown in the button tooltip) are
  picked up from the answer. The last mode is remembered and restored on
  startup. On disconnect the state resets — everything is re-read on the
  next connection.

## Panel buttons

| Button | What it does | Commands sent |
|--------|--------------|---------------|
| **Mode** (spindle/laser icon) | tool change | `M5` + `$32=x` + `$30=…` + `$31=…` |
| **Focus** | focus beam ON/OFF — laser mode only | `M3 S…` / `M5` + `S0` |
| **Pulse** | short laser test pulse — laser mode only | `M3 S…` + `G4 P…` + `M5` |
| **Off** | turn the laser off | `M5` + `S0` |

The Focus, Pulse and Off buttons are hidden automatically in spindle mode.
The mode button tooltip shows the controller's real `$30` and the speed range
of the active tool.

## Plugin settings

- **Focus power (S)** — beam power for the Focus button;
- **Pulse S / duration (ms)** — test pulse parameters;
- an explanation of how the tool change works.

Speeds are not duplicated in the plugin settings — they are always taken
from "Machine info".

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

- **v5 (current)** — speeds switch with the tool: on every switch `$30`/`$31`
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

## Files

- `script.js` — plugin logic;
- `widget.ui` — the panel (4 buttons: Mode, Focus, Pulse, Off);
- `settings.ui` — the settings page (focus, pulse, explanation);
- `translation_ru.ts` / `translation_ru.qm` — Russian localization;
- `config.ini` — plugin manifest.

## License

GPL-3.0 (same as Candle). Files are saved in UTF-8.
