// Compact Spindle / Laser Toggle Plugin for Candle
// - 1-row icon-only layout (same width as Coordinate System / User Commands, no scrollbars).
// - Button 1 toggles between Spindle ($32=0) and Laser ($32=1).
// - Buttons 2..4 (Focus, Pulse, Laser OFF) are hidden when in Spindle mode ($32=0).
//
// v5 (tool change with DIRECT speed switching):
//   - A mode switch is a TOOL change: besides $32 it switches the machine
//     speed/power limits $30/$31 to the values configured in Candle
//     "Machine info" (spindle speed min/max <-> laser power min/max) - the
//     settings page from the user's screenshot. Values are taken from
//     app.settings at switch time, so editing "Machine info" takes effect
//     on the next switch.
//   - Written DIRECTLY in one batch, no read/compare round-trip:
//         M5  $32=x  $30=max  $31=min
//     grbl applies $-commands itself (identical values simply stay in
//     place), and a tool switch is a rare manual action - no need to read
//     the current values back first.
//   - If a "Machine info" value is unavailable the plugin writes only M5+$32
//     - it never invents limit values for the machine.
//   - The main window spindle slider (slbSpindle) switches its range to the
//     active tool limits (UI-side, nothing extra is sent).
//   - $$ answers are still parsed for the button tooltip (real $30) and to
//     learn the current mode after connect: Candle itself sends $$ after
//     every connect/reset/homing (frmmain.cpp).

script.importExtension("qt.core");
script.importExtension("qt.gui");
script.importExtension("qt.widgets");
script.importExtension("qt.custom");
script.importExtension("qt.uitools");

// Vars
var appPath = app.path;
var pluginPath = script.path;
var pluginName = script.name ? script.name : "SpindleLaserPlugin";
var designerPluginsPath = app.path + "/designerplugins";
var loader = new QUiLoader();

var deviceState = -1;
var senderState = -1;
var isLaserMode = false; // false = Spindle ($32=0), true = Laser ($32=1)
var focusActive = false;

// Real $30/$31 values as currently stored in the controller's EEPROM
// (parsed from $$ dumps and from the "ok" answers to our own $30/$31
// writes - shown in the button tooltip)
var curSMax = 0;
var curSMin = 0;
var curSKnown = false;

var iconSpindle;
var iconLaser;

// Saved settings state for cancel/restore in Settings dialog
var storedConfig = {};

// Ui
var uiPanel;
var uiSettings;

// Cached main window spindle slider (slbSpindle) and last applied limits
var cachedSlider = null;
var lastApplied = { laser: null, min: null, max: null };

function isRussian()
{
    return (!app.settings || !app.settings.language || app.settings.language === "ru");
}

function trText(en, ru)
{
    return isRussian() ? ru : en;
}

// Read an integer from Candle's own settings object ("Machine info" tab:
// spindleSpeedMin/Max, laserPowerMin/Max). app.settings is the frmSettings
// dialog exposed to plugins by Candle's loadPlugins().
function candleInt(propName, fallback)
{
    try {
        if (app.settings && app.settings[propName] !== undefined) {
            var v = parseInt(app.settings[propName], 10);
            if (!isNaN(v) && v >= 0) return v;
        }
    } catch (e) {
    }
    return fallback;
}

// ------------------------------------------------------------------
// Candle main window spindle slider lookup (SliderBox, name slbSpindle)
// ------------------------------------------------------------------

function findWidgetRecursive(w, name)
{
    try {
        if (!w) return null;
        if (String(w.objectName) === name) return w;
        var ch = w.children();
        if (ch && ch.length) {
            for (var i = 0; i < ch.length; i++) {
                var r = findWidgetRecursive(ch[i], name);
                if (r) return r;
            }
        }
    } catch (e) {
    }
    return null;
}

function getSpindleSlider()
{
    if (cachedSlider) return cachedSlider;
    try {
        cachedSlider = findWidgetRecursive(app.window, "slbSpindle");
    } catch (e) {
        cachedSlider = null;
    }
    return cachedSlider;
}

// Speed range of the ACTIVE tool, taken from Candle "Machine info"
function getToolLimits()
{
    var mn, mx;
    if (isLaserMode) {
        mn = candleInt("laserPowerMin", 0);
        mx = candleInt("laserPowerMax", 1000);
    } else {
        mn = candleInt("spindleSpeedMin", 0);
        mx = candleInt("spindleSpeedMax", 10000);
    }
    if (!(mx > mn)) mx = mn + 1;
    return { min: mn, max: mx };
}

// floor(log10(n)) for n >= 1, exact for powers of 10 (QtScript has no
// Math.log10, and Math.log(n)/Math.LN10 is off by one for exact powers
// of 10 due to floating point rounding, e.g. log10(1000) -> 2.999...).
function floorLog10(n)
{
    var p = 0;
    var v = Math.floor(n);
    while (v >= 10) {
        v = Math.floor(v / 10);
        p++;
    }
    return p;
}

// Switch the speeds to the active tool: rescale the current slider position
// into the new tool's range and apply min/max/value (+ ratio, using the same
// step scaling formula Candle itself applies in applySettings()).
// UI-side only: no command is sent to the controller by this function.
function applyToolSpeeds(force)
{
    var slider = getSpindleSlider();
    if (!slider) return;

    var lim = getToolLimits();

    if (!force
            && lastApplied.laser === isLaserMode
            && lastApplied.min === lim.min
            && lastApplied.max === lim.max) {
        return; // already applied - avoid value drift on repeated calls
    }

    // Current slider state (Candle may have changed it on its own)
    var curMin = lim.min;
    var curMax = lim.max;
    var curVal = lim.min;
    try {
        var rMin = parseInt(slider.minimum, 10);
        var rMax = parseInt(slider.maximum, 10);
        var rVal = parseInt(slider.value, 10);
        if (!isNaN(rMin)) curMin = rMin;
        if (!isNaN(rMax)) curMax = rMax;
        if (!isNaN(rVal)) curVal = rVal;
    } catch (e) {
    }

    // Rescale the current speed position into the new tool's range
    var pos = (curMax > curMin) ? (curVal - curMin) / (curMax - curMin) : 1;
    if (pos < 0) pos = 0;
    if (pos > 1) pos = 1;
    var newVal = Math.round(lim.min + pos * (lim.max - lim.min));
    if (newVal < lim.min) newVal = lim.min;
    if (newVal > lim.max) newVal = lim.max;

    try {
        slider.minimum = lim.min;
        slider.maximum = lim.max;
        slider.value = newVal;
        // Same step scaling Candle itself applies in applySettings()
        slider.ratio = Math.pow(10, Math.max(0, floorLog10(lim.max) - 2));
    } catch (e) {
    }

    lastApplied.laser = isLaserMode;
    lastApplied.min = lim.min;
    lastApplied.max = lim.max;
}

function init()
{
    loader.setWorkingDirectory(new QDir(pluginPath));
    loader.addPluginPath(designerPluginsPath);

    iconSpindle = new QIcon(pluginPath + "/images/spindle.png");
    iconLaser = new QIcon(pluginPath + "/images/laser.png");

    app.device.stateChanged.connect(onAppDeviceStateChanged);
    app.sender.stateChanged.connect(onAppSenderStateChanged);
    app.device.responseReceived.connect(onAppResponseReceived);

    app.settingsLoaded.connect(onAppSettingsLoaded);
    app.settingsSaved.connect(onAppSettingsSaved);
    app.settingsAboutToShow.connect(onAppSettingsAboutToShow);
    app.settingsAccepted.connect(onAppSettingsAccepted);
    app.settingsRejected.connect(onAppSettingsRejected);
    app.settingsSetByDefault.connect(onAppSettingsDefault);
}

function createPanelWidget()
{
    var f = new QFile(pluginPath + "/widget.ui");
    if (f.open(QIODevice.ReadOnly)) {
        uiPanel = loader.load(f);
        f.close();

        uiPanel.cmdModeToggle.clicked.connect(onModeToggleClicked);
        uiPanel.cmdFocus.clicked.connect(onFocusClicked);
        uiPanel.cmdPulse.clicked.connect(onPulseClicked);
        uiPanel.cmdLaserOff.clicked.connect(onLaserOffClicked);

        if (uiPanel.actToggleSpindleLaser) app.addAction(uiPanel.actToggleSpindleLaser);
        if (uiPanel.actLaserFocus) app.addAction(uiPanel.actLaserFocus);
        if (uiPanel.actLaserPulse) app.addAction(uiPanel.actLaserPulse);
        if (uiPanel.actLaserOff) app.addAction(uiPanel.actLaserOff);

        updateUiState();
    }
    return uiPanel;
}

function createWindowWidget()
{
}

function createSettingsWidget()
{
    var f = new QFile(pluginPath + "/settings.ui");
    if (f.open(QIODevice.ReadOnly)) {
        uiSettings = loader.load(f);
        f.close();

        if (uiSettings && uiSettings.lblNote) {
            uiSettings.lblNote.wordWrap = true;
            uiSettings.lblNote.text = trText(
                "Tool change: on every switch the plugin writes $32 together with the speed/power "
                + "limits $30/$31 from Candle \"Machine info\" as ONE direct batch: M5, $32, $30, $31. "
                + "No read-back: the values are applied right away, and editing \"Machine info\" "
                + "takes effect on the next switch. The speed slider follows the active tool.",
                "Смена инструмента: при каждом переключении плагин ОДНОЙ посылкой пишет $32 вместе с лимитами "
                + "скорости/мощности $30/$31 из вкладки «Информация о станке» (мин/макс шпинделя, мин/макс "
                + "лазера): M5, $32, $30, $31. Без предварительного чтения — значения подставляются сразу; "
                + "правка «Информации о станке» действует со следующего переключения. Слайдер скоростей "
                + "следует за активным инструментом."
            );
        }
    }
    return uiSettings;
}

function setLaserButtonsVisible(vis)
{
    if (!uiPanel) return;
    uiPanel.cmdFocus.visible = vis;
    uiPanel.cmdPulse.visible = vis;
    uiPanel.cmdLaserOff.visible = vis;
    if (uiPanel.actLaserFocus) uiPanel.actLaserFocus.enabled = vis && (deviceState == 1) && (senderState == 4);
    if (uiPanel.actLaserPulse) uiPanel.actLaserPulse.enabled = vis && (deviceState == 1) && (senderState == 4);
    if (uiPanel.actLaserOff) uiPanel.actLaserOff.enabled = vis && (deviceState == 1) && (senderState == 4);
}

function updateUiState()
{
    if (!uiPanel) return;

    var lim = getToolLimits();
    var fPwr = uiSettings ? uiSettings.spnFocusPower.value : 10;
    var pPwr = uiSettings ? uiSettings.spnPulsePower.value : 100;
    var pMs  = uiSettings ? uiSettings.spnPulseMs.value : 200;

    // 1. Update single toggle button icon, checked state, and tooltip
    uiPanel.cmdModeToggle.blockSignals(true);
    uiPanel.cmdModeToggle.checked = isLaserMode;
    uiPanel.cmdModeToggle.blockSignals(false);

    // Keep the menu action in sync with the connection state, otherwise it
    // stays enabled while disconnected and silently does nothing (official
    // usercommands plugin updates storedActions enabled state the same way).
    if (uiPanel.actToggleSpindleLaser) {
        uiPanel.actToggleSpindleLaser.enabled = (deviceState == 1) && (senderState == 4);
    }

    // Real machine $30 (when known) + active tool speed range
    var sTxt = (curSKnown ? ("$30=" + curSMax + ", ") : "")
            + trText("speeds ", "скорости ") + lim.min + "-" + lim.max;

    if (isLaserMode) {
        uiPanel.cmdModeToggle.icon = iconLaser;
        uiPanel.cmdModeToggle.toolTip = trText(
            "Mode: LASER ($32=1, " + sTxt + ") — click to switch to SPINDLE",
            "Режим: ЛАЗЕР ($32=1, " + sTxt + ") — нажмите для переключения на ШПИНДЕЛЬ"
        );
    } else {
        uiPanel.cmdModeToggle.icon = iconSpindle;
        uiPanel.cmdModeToggle.toolTip = trText(
            "Mode: SPINDLE ($32=0, " + sTxt + ") — click to switch to LASER",
            "Режим: ШПИНДЕЛЬ ($32=0, " + sTxt + ") — нажмите для переключения на ЛАЗЕР"
        );
    }

    // 2. Hide or show laser buttons depending on whether Laser mode is active
    setLaserButtonsVisible(isLaserMode);

    // 3. Update laser buttons state & tooltips
    uiPanel.cmdFocus.blockSignals(true);
    uiPanel.cmdFocus.checked = focusActive;
    uiPanel.cmdFocus.blockSignals(false);
    uiPanel.cmdFocus.backgroundColor = focusActive ? new QColor(255, 170, 0) : new QColor(0, 0, 0, 0);

    uiPanel.cmdFocus.toolTip = trText(
        "Laser focus beam ON/OFF (M3 S" + fPwr + " / M5)",
        "Луч фокусировки ВКЛ/ВЫКЛ (M3 S" + fPwr + " / M5)"
    );
    uiPanel.cmdPulse.toolTip = trText(
        "Laser test pulse (S" + pPwr + ", " + pMs + " ms)",
        "Тестовый импульс лазера (S" + pPwr + ", " + pMs + " мс)"
    );
    uiPanel.cmdLaserOff.toolTip = trText(
        "Turn laser OFF (M5 S0)",
        "Выключить лазер (M5 S0)"
    );
}

// ------------------------------------------------------------------
// Tool change (spindle <-> laser): switch the mode AND the speeds
// ------------------------------------------------------------------

// Speed/power limits for the tool being switched TO, taken from Candle
// "Machine info" (the settings page on the user's screenshot) at switch
// time - always fresh. Returns null when a value is not configured there:
// the plugin must never write invented limits to the controller.
function toolTargets(laser)
{
    return {
        max: candleInt(laser ? "laserPowerMax" : "spindleSpeedMax", null),
        min: candleInt(laser ? "laserPowerMin" : "spindleSpeedMin", null),
        mode: laser ? 1 : 0
    };
}

// One DIRECT batch: M5, $32, $30, $31 - the "Machine info" values for the
// new tool. No preliminary read/compare: grbl applies $-commands itself
// (identical values simply stay in place), and a tool switch is a rare
// manual action, so an extra $$ round-trip is not needed.
// M5 goes first (grbl refuses a $32 change while the tool is running).
function applyToolChange(targetLaserMode)
{
    focusActive = false;
    isLaserMode = targetLaserMode; // UI switches immediately, machine follows

    var t = toolTargets(targetLaserMode);
    var cmds = ["M5", "$32=" + t.mode];
    if (t.max != null) cmds.push("$30=" + t.max);
    if (t.min != null) cmds.push("$31=" + t.min);
    app.device.sendCommands(cmds.join("\n"));

    applyToolSpeeds(false); // <- slider speeds follow the tool
    updateUiState();
}

function onModeToggleClicked()
{
    applyToolChange(!isLaserMode);
}

function onFocusClicked()
{
    if (!isLaserMode) return;

    var fPwr = uiSettings ? uiSettings.spnFocusPower.value : 10;
    if (!focusActive) {
        focusActive = true;
        app.device.sendCommands("M3 S" + fPwr);
    } else {
        focusActive = false;
        app.device.sendCommands("M5\nS0");
    }
    updateUiState();
}

function onPulseClicked()
{
    if (!isLaserMode) return;

    var pPwr = uiSettings ? uiSettings.spnPulsePower.value : 100;
    var pMs  = uiSettings ? uiSettings.spnPulseMs.value : 200;
    var pSec = (pMs / 1000.0).toFixed(3);

    focusActive = false;
    app.device.sendCommands("M3 S" + pPwr + "\nG4 P" + pSec + "\nM5");
    updateUiState();
}

function onLaserOffClicked()
{
    focusActive = false;
    app.device.sendCommands("M5\nS0");
    updateUiState();
}

function onAppDeviceStateChanged(status)
{
    var ready = (status == 1) && (senderState == 4);
    if (uiPanel) {
        uiPanel.setEnabled(ready);
    }

    if (status == -1) {
        focusActive = false;
        curSKnown = false;         // the machine may be different on the next connect
    }

    deviceState = status;
    updateUiState();
}

function onAppSenderStateChanged(status)
{
    var ready = (status == 4) && (deviceState == 1);
    if (uiPanel) {
        uiPanel.setEnabled(ready);
    }
    senderState = status;
    updateUiState();
}

function onAppResponseReceived(command, index, response)
{
    if (!response) return;

    var cmd = String(command || "");
    var resp = String(response);
    var updated = false;

    // Real $30/$31 as reported by the controller - from $$ dumps...
    if (resp.indexOf("$30=") !== -1) {
        var m30 = resp.match(/\$30=(\d+)/);
        if (m30) {
            curSMax = parseInt(m30[1], 10);
            curSKnown = true;
            updated = true;
        }
    }
    if (resp.indexOf("$31=") !== -1) {
        var m31 = resp.match(/\$31=(\d+)/);
        if (m31) {
            curSMin = parseInt(m31[1], 10);
            curSKnown = true;
            updated = true;
        }
    }
    // ...and from our own successful $30/$31 writes
    if (cmd.indexOf("$30=") === 0 && resp.indexOf("ok") !== -1) {
        curSMax = parseInt(cmd.substring(4), 10);
        curSKnown = true;
        updated = true;
    }
    if (cmd.indexOf("$31=") === 0 && resp.indexOf("ok") !== -1) {
        curSMin = parseInt(cmd.substring(4), 10);
        curSKnown = true;
        updated = true;
    }

    // Machine $32 learned from $$ (Candle queries the controller itself
    // after every connect/reset/homing) or acknowledged from our own $32
    // write -> sync mode and tool speeds.
    if (resp.indexOf("$32=") !== -1) {
        var m32 = resp.match(/\$32=(\d+)/);
        if (m32) {
            isLaserMode = (parseInt(m32[1], 10) !== 0);
            if (!isLaserMode) focusActive = false;
            updated = true;
        }
    } else if (cmd.indexOf("$32=") === 0 && resp.indexOf("ok") !== -1) {
        isLaserMode = (cmd.indexOf("$32=1") === 0);
        if (!isLaserMode) focusActive = false;
        updated = true;
    }

    if (cmd.indexOf("M5") !== -1 && resp.indexOf("ok") !== -1) {
        focusActive = false;
        updated = true;
    }

    if (updated) {
        applyToolSpeeds(false);
        updateUiState();
    }
}

function getStorage()
{
    if (app.storage) {
        return app.storage.group(pluginName);
    }
    return new QSettings(pluginPath + "/settings.ini", QSettings.IniFormat);
}

function toBool(val, defVal)
{
    if (val === undefined || val === null || val === "") return defVal;
    if (typeof val === "boolean") return val;
    return (String(val).toLowerCase() === "true" || String(val) === "1");
}

function onAppSettingsLoaded()
{
    var s = getStorage();

    // One-time migration to v5: drop every obsolete key. v1/v2 stored an
    // unsafe "$30/$31 update" option with fixed limit values; v3 stored an
    // "auto $$ on connect" flag - Candle itself queries $$ after every
    // connect/reset/homing, so the plugin no longer needs its own query.
    if (parseInt(s.value("configVersion", 1), 10) < 5) {
        s.remove("updateS");
        s.remove("spindleMax");
        s.remove("spindleMin");
        s.remove("laserMax");
        s.remove("laserMin");
        s.remove("autoQuery");
        s.setValue("configVersion", 5);
        if (!app.storage) s.sync();
    }

    if (uiSettings) {
        uiSettings.spnFocusPower.value = parseInt(s.value("focusPower", 10), 10) || 10;
        uiSettings.spnPulsePower.value = parseInt(s.value("pulsePower", 100), 10) || 100;
        uiSettings.spnPulseMs.value = parseInt(s.value("pulseMs", 200), 10) || 200;
    }

    isLaserMode = toBool(s.value("lastLaserMode", false), false);

    // Candle has just set the slider to the spindle range; switch the speeds
    // to the restored tool so the UI matches the mode right from startup.
    applyToolSpeeds(true);
    updateUiState();
}

function onAppSettingsSaved()
{
    var s = getStorage();
    if (uiSettings) {
        s.setValue("focusPower", uiSettings.spnFocusPower.value);
        s.setValue("pulsePower", uiSettings.spnPulsePower.value);
        s.setValue("pulseMs", uiSettings.spnPulseMs.value);
    }
    s.setValue("lastLaserMode", isLaserMode);
    if (!app.storage) s.sync();
}

function onAppSettingsAboutToShow()
{
    if (!uiSettings) return;
    storedConfig = {
        focusPower: uiSettings.spnFocusPower.value,
        pulsePower: uiSettings.spnPulsePower.value,
        pulseMs: uiSettings.spnPulseMs.value
    };
}

function onAppSettingsAccepted()
{
    // "Machine info" limits may have changed - re-apply the active tool speeds
    applyToolSpeeds(true);
    updateUiState();
}

function onAppSettingsRejected()
{
    if (uiSettings && storedConfig) {
        uiSettings.spnFocusPower.value = storedConfig.focusPower;
        uiSettings.spnPulsePower.value = storedConfig.pulsePower;
        uiSettings.spnPulseMs.value = storedConfig.pulseMs;
    }
    applyToolSpeeds(true);
    updateUiState();
}

function onAppSettingsDefault()
{
    if (!uiSettings) return;
    uiSettings.spnFocusPower.value = 10;
    uiSettings.spnPulsePower.value = 100;
    uiSettings.spnPulseMs.value = 200;
}
