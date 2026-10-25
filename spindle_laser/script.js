// Compact Spindle / Laser Toggle Plugin for Candle
// - 1-row icon-only layout (same width as Coordinate System / User Commands, no scrollbars).
// - Button 1 toggles between Spindle ($32=0) and Laser ($32=1).
// - Buttons 2..4 (Focus, Pulse, Laser OFF) are hidden when in Spindle mode ($32=0).
//
// v6 (unified localization - the official Candle mechanism):
//   - ALL strings go through ONE translation file translation_<lang>.qm
//     which Candle installs before loading script.js:
//       * static .ui strings are translated by QUiLoader itself with the
//         context = <class> element of the .ui file;
//       * runtime strings use qsTr() (empty translation context) - exactly
//         like the official usercommands plugin;
//       * the plugin title from config.ini is translated by Candle with the
//         frmMain context.
//   - no custom language detection (no isRussian/trText heuristics): without
//     a matching .qm qsTr() returns the English source - so the UI is either
//     fully English or fully Russian, never a mix.
//
// v5 (tool change with DIRECT speed switching):
//   - A mode switch is a TOOL change: besides $32 it switches the machine
//     speed/power limits $30/$31 to the values configured in Candle
//     "Machine info" (spindle speed min/max <-> laser power min/max) - the
//     settings page from the user's screenshot. Values are taken from
//     app.settings at switch time, so editing "Machine info" takes effect
//     on the next switch.
//   - On tool change the plugin stops the output, waits for GRBL to acknowledge
//     $32, then applies configured $30/$31 limits. If the limits differ from
//     the actual controller settings, the dialog shows old and target values.
//   - The UI does not switch optimistically: a rejected $32 leaves the prior
//     mode displayed and triggers a fresh $$ report.
//   - If a "Machine info" value is unavailable the plugin never invents it.
//   - The main window spindle slider (slbSpindle) switches its range to the
//     active tool limits (UI-side, nothing extra is sent).
//   - $$ answers are parsed for the real $30/$31/$32 values. Candle sends $$
//     after connect/reset/homing on supported builds (frmmain.cpp).

script.importExtension("qt.core");
script.importExtension("qt.gui");
script.importExtension("qt.widgets");
script.importExtension("qt.custom");
script.importExtension("qt.uitools");

// Candle installs translator functions (qsTr/qsTranslate/...) into the
// engine via installTranslatorFunctions() before evaluating this script.
// Older builds may lack them - fall back to the English source text.
if (typeof qsTr !== "function") {
    qsTr = function(sourceText) { return String(sourceText); };
}

// Substitute %1..%N placeholders inside a translated template
// (QtScript strings have no .arg()).
function trFill(template, values)
{
    var s = String(template);
    for (var key in values) {
        s = s.replace(key, String(values[key]));
    }
    return s;
}

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
var focusRestoreFeed = null;
var pendingLaserAction = null;
var requestedModeToggleAfterRefresh = false;

// Real $30/$31 values as currently stored in the controller's EEPROM
// (parsed from $$ dumps and from the "ok" answers to our own $30/$31
// writes - shown in the button tooltip)
var curSMax = 0;
var curSMin = 0;
var curSMaxKnown = false;
var curSMinKnown = false;
var curSKnown = false;
var curModeKnown = false;

// A tool change is completed only after GRBL acknowledges $32. The speed/power
// limits are then written in a second batch, so a rejected mode change cannot
// still overwrite $30/$31.
var pendingToolChange = null;
var modeChangeTimer = null;

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
    var minProp = isLaserMode ? "laserPowerMin" : "spindleSpeedMin";
    var maxProp = isLaserMode ? "laserPowerMax" : "spindleSpeedMax";
    var mn = candleInt(minProp, null);
    var mx = candleInt(maxProp, null);

    // If Candle does not expose Machine-info values, use the actual GRBL
    // range already read from the controller instead of assuming defaults.
    if (mn === null && curSMinKnown) mn = curSMin;
    if (mx === null && curSMaxKnown) mx = curSMax;
    if (mn === null) mn = 0;
    if (mx === null) mx = isLaserMode ? 1000 : 10000;

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
        // Update the scale before changing the slider's limits and value.
        slider.ratio = Math.pow(10, Math.max(0, floorLog10(lim.max) - 2));
        slider.minimum = lim.min;
        slider.maximum = lim.max;
        slider.value = newVal;
    } catch (e) {
    }

    lastApplied.laser = isLaserMode;
    lastApplied.min = lim.min;
    lastApplied.max = lim.max;
}

function updateLaserPowerControls()
{
    // $30/$31 belong to the currently active tool. Never clamp laser-test
    // preferences to spindle limits, or to the old tool limits while a switch
    // is still applying the target range.
    if (!uiSettings || !isLaserMode || pendingToolChange || !curSMaxKnown || curSMax < 1) return;

    var maxPower = Math.min(100000, curSMax);
    var minPower = curSMinKnown ? Math.max(1, curSMin) : 1;
    if (minPower > maxPower) minPower = maxPower;

    var controls = [uiSettings.spnFocusPower, uiSettings.spnPulsePower];
    for (var i = 0; i < controls.length; i++) {
        var c = controls[i];
        if (!c) continue;
        var v = Number(c.value);
        c.minimum = minPower;
        c.maximum = maxPower;
        if (v < minPower) c.value = minPower;
        else if (v > maxPower) c.value = maxPower;
    }
}

function laserPowerForTest(requested)
{
    if (!curSMaxKnown || curSMax < 1 ||
        (curSMinKnown && curSMin > curSMax)) {
        // Candle normally queries $$ on connect. Request a fresh report and
        // refuse to fire the laser until the real controller limit is known.
        try { app.device.sendCommands("$$"); } catch (e) {}
        return null;
    }

    var minPower = curSMinKnown ? Math.max(1, curSMin) : 1;
    var power = parseInt(requested, 10);
    if (isNaN(power)) power = minPower;
    if (power < minPower) power = minPower;
    if (power > curSMax) power = curSMax;
    return power;
}

function stopModeChangeTimer()
{
    if (modeChangeTimer) {
        try { modeChangeTimer.stop(); } catch (e) {}
    }
}

function armModeChangeTimer()
{
    stopModeChangeTimer();
    if (!modeChangeTimer) {
        modeChangeTimer = new QTimer();
        modeChangeTimer.singleShot = true;
        modeChangeTimer.timeout.connect(function () {
            if (!pendingToolChange) return;
            // Do not leave the UI locked if GRBL never acknowledged the command.
            pendingToolChange = null;
            try { app.device.sendCommands("$$"); } catch (e) {}
            updateUiState();
        });
    }
    modeChangeTimer.start(5000);
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
        // Set the runtime note explicitly so it remains accurate even when
        // Candle loads an older compiled translation_ru.qm.
        if (uiSettings.lblNote) {
            var settingsTitle = String(uiSettings.windowTitle);
            if (settingsTitle.indexOf("Шпиндель") >= 0) {
                uiSettings.lblNote.text = "После подтверждения $32 плагин отправляет $30 и $31 из «Информации о станке». Обе команды видны в журнале даже тогда, когда значение не меняется. Слайдер соответствует активному инструменту.";
            } else {
                uiSettings.lblNote.text = "After GRBL acknowledges $32, the plugin sends $30 and $31 from Machine info. Both commands appear in the log even when a value is unchanged. The speed slider follows the active tool.";
            }
        }
        updateLaserPowerControls();
    }
    return uiSettings;
}

function setLaserButtonsVisible(vis)
{
    if (!uiPanel) return;
    uiPanel.cmdFocus.visible = vis;
    uiPanel.cmdPulse.visible = vis;
    uiPanel.cmdLaserOff.visible = vis;
    var ready = (deviceState == 1) && (senderState == 4) && !pendingToolChange && !pendingLaserAction;
    var safePowerKnown = curSMaxKnown && curSMax > 0 &&
        (!curSMinKnown || curSMin <= curSMax);
    if (uiPanel.actLaserFocus) uiPanel.actLaserFocus.enabled = vis && ready && safePowerKnown;
    if (uiPanel.actLaserPulse) uiPanel.actLaserPulse.enabled = vis && ready && safePowerKnown;
    if (uiPanel.actLaserOff) uiPanel.actLaserOff.enabled = vis && ready;
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
        uiPanel.actToggleSpindleLaser.enabled = (deviceState == 1) && (senderState == 4) &&
            !pendingToolChange && !pendingLaserAction;
    }

    // Real machine $30 (when known) + active tool speed range
    if (isLaserMode) {
        uiPanel.cmdModeToggle.icon = iconLaser;
        uiPanel.cmdModeToggle.toolTip = curSKnown
            ? trFill(qsTr("Mode: LASER ($32=1, $30=%1, speeds %2-%3) - click to switch to SPINDLE"),
                     { "%1": curSMax, "%2": lim.min, "%3": lim.max })
            : trFill(qsTr("Mode: LASER ($32=1, speeds %1-%2) - click to switch to SPINDLE"),
                     { "%1": lim.min, "%2": lim.max });
    } else {
        uiPanel.cmdModeToggle.icon = iconSpindle;
        uiPanel.cmdModeToggle.toolTip = curSKnown
            ? trFill(qsTr("Mode: SPINDLE ($32=0, $30=%1, speeds %2-%3) - click to switch to LASER"),
                     { "%1": curSMax, "%2": lim.min, "%3": lim.max })
            : trFill(qsTr("Mode: SPINDLE ($32=0, speeds %1-%2) - click to switch to LASER"),
                     { "%1": lim.min, "%2": lim.max });
    }

    // 2. Hide or show laser buttons depending on whether Laser mode is active.
    // Focus/Pulse remain disabled until the real GRBL $30 power limit is known.
    setLaserButtonsVisible(isLaserMode);
    var machineReady = (deviceState == 1) && (senderState == 4);
    uiPanel.cmdModeToggle.enabled = machineReady && !pendingToolChange && !pendingLaserAction;
    var safePowerKnown = curSMaxKnown && curSMax > 0 &&
        (!curSMinKnown || curSMin <= curSMax);
    uiPanel.cmdFocus.enabled = machineReady && isLaserMode && safePowerKnown && !pendingToolChange && !pendingLaserAction;
    uiPanel.cmdPulse.enabled = machineReady && isLaserMode && safePowerKnown && !pendingToolChange && !pendingLaserAction;
    uiPanel.cmdLaserOff.enabled = machineReady && isLaserMode && !pendingToolChange && !pendingLaserAction;

    // 3. Update laser buttons state & tooltips
    uiPanel.cmdFocus.blockSignals(true);
    uiPanel.cmdFocus.checked = focusActive;
    uiPanel.cmdFocus.blockSignals(false);
    uiPanel.cmdFocus.backgroundColor = focusActive ? new QColor(255, 170, 0) : new QColor(0, 0, 0, 0);

    uiPanel.cmdFocus.toolTip = trFill(
        qsTr("Laser focus beam ON/OFF (M3 S%1 / M5)"),
        { "%1": fPwr }
    );
    uiPanel.cmdPulse.toolTip = trFill(
        qsTr("Laser test pulse (S%1, %2 ms)"),
        { "%1": pPwr, "%2": pMs }
    );
    uiPanel.cmdLaserOff.toolTip = qsTr("Turn laser OFF (M5 S0)");
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
    // Use Candle's Machine-info values when exposed by this Candle build.
    // If a min/max property is unavailable, preserve the already-read real
    // controller value. This guarantees that a mode switch still sends an
    // explicit $30 AND $31 rather than silently omitting $31 when it is equal
    // to the current setting or the property is not exposed by the host.
    var maxValue = candleInt(laser ? "laserPowerMax" : "spindleSpeedMax", null);
    var minValue = candleInt(laser ? "laserPowerMin" : "spindleSpeedMin", null);
    if (maxValue == null && curSMaxKnown) maxValue = curSMax;
    if (minValue == null && curSMinKnown) minValue = curSMin;
    return {
        max: maxValue,
        min: minValue,
        mode: laser ? 1 : 0
    };
}

// Tool switching first stops the output and requests $32. Only after the
// controller acknowledges $32 are the target Machine-info $30/$31 limits
// written. Both limits are sent on every switch when available, even if one
// equals the current setting, so the full range is explicit in the command log.
// Do not depend on QMessageBox being exposed by a particular Candle QtScript build.
function applyToolChange(targetLaserMode)
{
    if (pendingToolChange) return;

    var t = toolTargets(targetLaserMode);
    // A safe comparison requires the actual controller settings. Candle sends
    // $$ after connect; if they are not known yet, refresh and ask the user to
    // retry instead of silently overwriting unknown $30/$31 values.
    if (!curModeKnown || !curSMaxKnown || !curSMinKnown) {
        // A freshly reset GRBL may not yet have reported its settings. Refresh
        // them and resume the requested toggle once the real $32/$30/$31 are
        // known; do not leave the button disabled forever waiting for $$.
        requestedModeToggleAfterRefresh = true;
        try { app.device.sendCommands("$$"); } catch (e) {
            requestedModeToggleAfterRefresh = false;
        }
        updateUiState();
        return;
    }

    // Machine-info limits are deliberately applied automatically on a tool
    // change. Some Candle QtScript builds do not expose QMessageBox; using it
    // here caused a silent return and made the mode toggle appear broken.
    var restoreFeedForModeSwitch = focusRestoreFeed;
    focusActive = false;
    focusRestoreFeed = null;
    pendingToolChange = {
        targetLaserMode: targetLaserMode,
        max: t.max,
        min: t.min,
        stage: "mode",
        waitMax: false,
        waitMin: false,
        failed: false
    };

    // First stop the output and force the safe G0 modal state. If Focus had
    // temporarily set F, restore that feed before switching tools. Do not
    // update the UI or write new speed limits until $32 is acknowledged.
    var stopCommands = "M5\nS0\nG0";
    if (restoreFeedForModeSwitch !== null && !isNaN(restoreFeedForModeSwitch)) {
        stopCommands += " F" + formatGcodeNumber(restoreFeedForModeSwitch);
    }
    stopCommands += "\n$32=" + t.mode;
    app.device.sendCommands(stopCommands);
    armModeChangeTimer();
    updateUiState();
}

function onModeToggleClicked()
{
    if (!pendingToolChange) applyToolChange(!isLaserMode);
}

// The GRBL 1.1 laser-mode documentation permits G1 without axis words to
// change the modal motion state without moving an axis, but a positive F is
// required. Query $G first so the prior modal feed can be restored afterward.
// With no previously set feed (F0), use F100 only for the stationary test and
// restore F0 under G0 when finished.
function formatGcodeNumber(value)
{
    var n = Number(value);
    if (isNaN(n) || !isFinite(n)) n = 0;
    return String(Number(n.toFixed(3)));
}

function requestLaserAction(kind, power, seconds)
{
    if (!isLaserMode || pendingToolChange || pendingLaserAction) return;
    pendingLaserAction = { kind: kind, power: power, seconds: seconds, stage: "query" };
    try {
        app.device.sendCommands("$G");
    } catch (e) {
        pendingLaserAction = null;
        updateUiState();
    }
    updateUiState();
}

function onFocusClicked()
{
    if (!isLaserMode || pendingToolChange || pendingLaserAction) return;

    if (focusActive) {
        focusActive = false;
        var restoreFeed = (focusRestoreFeed === null) ? null : focusRestoreFeed;
        focusRestoreFeed = null;
        if (restoreFeed === null || isNaN(restoreFeed)) {
            app.device.sendCommands("M5\nS0\nG0");
        } else {
            app.device.sendCommands("M5\nS0\nG0 F" + formatGcodeNumber(restoreFeed));
        }
        updateUiState();
        return;
    }

    var requested = uiSettings ? uiSettings.spnFocusPower.value : 10;
    var fPwr = laserPowerForTest(requested);
    if (fPwr === null) {
        updateUiState();
        return;
    }
    requestLaserAction("focus-on", fPwr, 0);
}

function onPulseClicked()
{
    if (!isLaserMode || pendingToolChange || pendingLaserAction) return;

    var requested = uiSettings ? uiSettings.spnPulsePower.value : 100;
    var pPwr = laserPowerForTest(requested);
    if (pPwr === null) {
        updateUiState();
        return;
    }
    var pMs  = uiSettings ? uiSettings.spnPulseMs.value : 200;
    var pSec = (pMs / 1000.0).toFixed(3);

    focusActive = false;
    requestLaserAction("pulse", pPwr, pSec);
    updateUiState();
}

function onLaserOffClicked()
{
    focusActive = false;
    var restoreFeed = (focusRestoreFeed === null) ? null : focusRestoreFeed;
    focusRestoreFeed = null;
    if (restoreFeed === null || isNaN(restoreFeed)) {
        app.device.sendCommands("M5\nS0\nG0");
    } else {
        app.device.sendCommands("M5\nS0\nG0 F" + formatGcodeNumber(restoreFeed));
    }
    updateUiState();
}

function onAppDeviceStateChanged(status)
{
    var ready = (status == 1) && (senderState == 4);
    if (uiPanel) {
        uiPanel.setEnabled(ready);
    }

    if (status == -1) {
        // Candle may recreate the main-window slider after reconnect.
        // Forget both the cached widget and the previously applied range.
        cachedSlider = null;
        lastApplied = { laser: null, min: null, max: null };
        focusActive = false;
        focusRestoreFeed = null;
        pendingLaserAction = null;
        requestedModeToggleAfterRefresh = false;
        curSMaxKnown = false;
        curSMinKnown = false;
        curSKnown = false;         // the machine may be different on the next connect
        curModeKnown = false;
        pendingToolChange = null;
        stopModeChangeTimer();
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

    var cmd = String(command || "").replace(/^\s+|\s+$/g, "");
    var resp = String(response);
    var respLower = resp.toLowerCase();
    var updated = false;
    var isOk = respLower.indexOf("ok") !== -1;
    var isError = respLower.indexOf("error") !== -1 || respLower.indexOf("alarm") !== -1;

    // A $G report is needed to preserve the user's previous modal feed rate.
    // Do not fire if GRBL did not return a valid modal report.
    if (pendingLaserAction && pendingLaserAction.stage == "query" && cmd == "$G") {
        var modalMatch = resp.match(/\[GC:([^\]]+)\]/i);
        var feedMatch = modalMatch ? modalMatch[1].match(/\bF(-?[0-9]+(?:\.[0-9]*)?)/i) : null;
        if (isError || !feedMatch) {
            pendingLaserAction = null;
            updateUiState();
            return;
        }

        var oldFeed = parseFloat(feedMatch[1]);
        if (isNaN(oldFeed) || oldFeed < 0) {
            pendingLaserAction = null;
            updateUiState();
            return;
        }
        var action = pendingLaserAction;
        var testFeed = (oldFeed > 0) ? oldFeed : 100;
        var restore = formatGcodeNumber(oldFeed);
        var feedForTest = formatGcodeNumber(testFeed);
        pendingLaserAction = null;

        if (action.kind == "focus-on") {
            focusRestoreFeed = oldFeed;
            focusActive = true;
            app.device.sendCommands("G1 F" + feedForTest + "\nM3 S" + action.power);
        } else if (action.kind == "pulse") {
            // Keep controls locked until the final G0/F restore is acknowledged.
            pendingLaserAction = { kind: "pulse-running", stage: "running" };
            app.device.sendCommands("G1 F" + feedForTest + "\nM3 S" + action.power +
                "\nG4 P" + action.seconds + "\nM5\nS0\nG0 F" + restore);
        }
        updateUiState();
        return;
    }

    if (pendingLaserAction && pendingLaserAction.stage == "running" &&
        pendingLaserAction.kind == "pulse-running" && cmd.indexOf("G0 F") === 0) {
        pendingLaserAction = null;
        updateUiState();
    }

    if (cmd.indexOf("G1 F") === 0 && isError && focusActive) {
        // Fail safe: if GRBL rejects the modal G1 command, cancel focus and
        // make a best-effort explicit laser-off/safe-mode request.
        var failedFocusFeed = focusRestoreFeed;
        focusActive = false;
        focusRestoreFeed = null;
        if (failedFocusFeed !== null && !isNaN(failedFocusFeed)) {
            app.device.sendCommands("M5\nS0\nG0 F" + formatGcodeNumber(failedFocusFeed));
        } else {
            app.device.sendCommands("M5\nS0\nG0");
        }
        updateUiState();
    }

    // Process the $32 acknowledgement before changing the visible mode. Only
    // once GRBL accepts the mode do we apply the new Machine-info $30/$31.
    if (pendingToolChange && pendingToolChange.stage == "mode" && cmd.indexOf("$32=") === 0) {
        if (isOk) {
            curModeKnown = true;
            isLaserMode = pendingToolChange.targetLaserMode;
            focusActive = false;
            pendingToolChange.stage = "limits";
            // Always send both settings on a successful mode switch when the
            // corresponding Machine-info value is available. Do not skip $31
            // just because its target currently equals the controller value:
            // the user expects the complete $30/$31 range to be applied and
            // visible in Candle's command log for every tool change.
            pendingToolChange.waitMax = pendingToolChange.max != null;
            pendingToolChange.waitMin = pendingToolChange.min != null;
            pendingToolChange.failed = false;

            var limitCommands = [];
            if (pendingToolChange.waitMax) limitCommands.push("$30=" + pendingToolChange.max);
            if (pendingToolChange.waitMin) limitCommands.push("$31=" + pendingToolChange.min);
            if (limitCommands.length > 0) {
                app.device.sendCommands(limitCommands.join("\n"));
                armModeChangeTimer();
            } else {
                pendingToolChange = null;
                stopModeChangeTimer();
            }
            updated = true;
        } else if (isError) {
            pendingToolChange = null;
            stopModeChangeTimer();
            // Refresh reported settings rather than assuming either state.
            try { app.device.sendCommands("$$"); } catch (e) {}
            updated = true;
        }
    } else if (pendingToolChange && pendingToolChange.stage == "limits" &&
               (cmd.indexOf("$30=") === 0 || cmd.indexOf("$31=") === 0)) {
        if (cmd.indexOf("$30=") === 0) pendingToolChange.waitMax = false;
        if (cmd.indexOf("$31=") === 0) pendingToolChange.waitMin = false;
        if (isError) pendingToolChange.failed = true;
        if (!pendingToolChange.waitMax && !pendingToolChange.waitMin) {
            var limitsFailed = pendingToolChange.failed;
            pendingToolChange = null;
            stopModeChangeTimer();
            if (limitsFailed) {
                try { app.device.sendCommands("$$"); } catch (e) {}
            }
            updated = true;
        }
    }

    // Real $30/$31 as reported by GRBL (normally in the $$ response).
    if (resp.indexOf("$30=") !== -1) {
        var m30 = resp.match(/\$30=(\d+)/);
        if (m30) {
            curSMax = parseInt(m30[1], 10);
            curSMaxKnown = true;
            curSKnown = curSMaxKnown && curSMinKnown;
            updated = true;
        }
    }
    if (resp.indexOf("$31=") !== -1) {
        var m31 = resp.match(/\$31=(\d+)/);
        if (m31) {
            curSMin = parseInt(m31[1], 10);
            curSMinKnown = true;
            curSKnown = curSMaxKnown && curSMinKnown;
            updated = true;
        }
    }
    // ...and from our own successful $30/$31 writes
    if (cmd.indexOf("$30=") === 0 && isOk) {
        curSMax = parseInt(cmd.substring(4), 10);
        curSMaxKnown = true;
        curSKnown = curSMaxKnown && curSMinKnown;
        updated = true;
    }
    if (cmd.indexOf("$31=") === 0 && isOk) {
        curSMin = parseInt(cmd.substring(4), 10);
        curSMinKnown = true;
        curSKnown = curSMaxKnown && curSMinKnown;
        updated = true;
    }

    // Machine $32 learned from $$ or acknowledged from our own $32 write.
    if (resp.indexOf("$32=") !== -1) {
        var m32 = resp.match(/\$32=(\d+)/);
        if (m32) {
            curModeKnown = true;
            isLaserMode = (parseInt(m32[1], 10) !== 0);
            if (!isLaserMode) focusActive = false;
            updated = true;
        }
    } else if (cmd.indexOf("$32=") === 0 && isOk && !pendingToolChange) {
        curModeKnown = true;
        isLaserMode = (cmd.indexOf("$32=1") === 0);
        if (!isLaserMode) focusActive = false;
        updated = true;
    }

    if (cmd.indexOf("M5") !== -1 && isOk) {
        focusActive = false;
        updated = true;
    }

    updateLaserPowerControls();
    if (requestedModeToggleAfterRefresh && curModeKnown && curSMaxKnown &&
        curSMinKnown && !pendingToolChange) {
        requestedModeToggleAfterRefresh = false;
        applyToolChange(!isLaserMode); // invert the freshly read controller mode
        return;
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
    updateLaserPowerControls();

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
    updateLaserPowerControls();
}
