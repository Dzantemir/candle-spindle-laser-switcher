// SPDX-License-Identifier: GPL-3.0-only
// Compact Spindle / Laser Toggle Plugin for Candle
// - 1-row icon-only layout (same width as Coordinate System / User Commands, no scrollbars).
// - Button 1 toggles between Spindle ($32=0) and Laser ($32=1).
// - Buttons 2..4 (Focus, Pulse, Laser OFF) are hidden when in Spindle mode ($32=0).
//
// v10 (second audit fixes):
//   - $30/$31 are written SEQUENTIALLY (wait for each ack) and in an order
//     that keeps the interim EEPROM range valid ($31 first when the current
//     minimum is not below the new maximum); a failed write aborts the pair
//     and warns the user instead of leaving a mixed/invalid range behind.
//   - the first time a target range would overwrite DIFFERENT controller
//     values, the switch requires a confirmation click (old -> new values
//     are shown in the tooltip); acknowledged ranges are remembered, so a
//     fresh Candle install with factory-default "Machine info" (0/10000,
//     0/100) can no longer silently overwrite the machine's real limits.
//   - state-machine interlocks: a pending $G laser action re-validates the
//     laser mode and machine readiness at fire time; a tool change and the
//     Laser OFF button cancel pending laser actions; OFF stays enabled as
//     a stop button; expected command strings are matched exactly (other
//     plugins share response index -100, so look-alike answers must not
//     advance the state machines).
//   - a $32 ack that arrives after the 5 s timeout still completes the
//     $30/$31 part of its tool change (orphaned change), and foreign
//     $30/$31/$32 writes during a tool change trigger a $$ resync after it.
//   - Focus/Pulse settings are never rewritten to fit the controller range
//     (clamping happens only at fire time); the speed slider rescales from
//     the last range THIS plugin applied, so Candle's own settings-apply
//     reset no longer collapses the laser speed, and a degenerate slider
//     range now defaults to minimum instead of maximum; getToolLimits()
//     returns null for an invalid range instead of inventing max=min+1.
//   - no modal QMessageBox (it could run inside the response handler with
//     a nested event loop); the pulse timeout covers the dwell time; a
//     pulse started from an active focus restores the pre-focus feed; the
//     focus beam turns itself OFF after 5 minutes; Alarm/Sleep clear the
//     focus state; click handlers check machine readiness themselves.
//
// v9 (audit fixes):
//   - a tool change is REFUSED (nothing is sent) when the Machine-info
//     target range is invalid (max <= 0 or min >= max): in GRBL such a
//     range makes any S>0 produce full PWM power. The refusal is shown
//     in the mode button tooltip and, when available, a message box.
//   - the deferred "toggle after $$ refresh" request now expires after
//     5 s and is cancelled by an external $32 change, so a stale click
//     can never fire later or invert somebody else's mode change.
//   - Focus is shown ON only after GRBL acknowledges M3; an error on
//     G1 or M3 cancels it fail-safe. Pending $G/pulse/focus actions have
//     a 5 s timeout instead of locking the panel forever.
//   - state-machine answers are matched only for this plugin's own
//     commands (response index -100) when the host reports an index.
//   - no invented slider limits: with neither Machine-info nor real
//     controller values known the slider range is left untouched.
//   - translation_ru.qm is recompiled from translation_ru.ts; the
//     hard-coded bilingual settings note override is removed.
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
//     $32, then applies configured $30/$31 limits.
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

// Substitute ALL occurrences of %1..%N placeholders inside a translated
// template (QtScript strings have no .arg()). split/join is used instead
// of String.replace, which would replace only the first occurrence and
// would treat "$" sequences in the replacement specially.
function trFill(template, values)
{
    var s = String(template);
    for (var key in values) {
        s = s.split(key).join(String(values[key]));
    }
    return s;
}

// DeviceIdle (1) + SenderStopped (4): the only states in which this plugin
// may send motion/spindle commands. Checked inside the handlers themselves
// (defense in depth - not only via disabled widgets).
function isMachineReady()
{
    return (deviceState == 1) && (senderState == 4);
}

// Connect a Qt signal if the host build exposes it. Accessing a missing
// signal property yields undefined in QtScript; calling .connect on it
// would abort init() and lose every connection after it.
function connectSignal(sig, fn)
{
    try {
        if (sig && typeof sig.connect === "function") sig.connect(fn);
    } catch (e) {
    }
}

// Vars
var pluginPath = script.path;
var pluginName = script.name ? script.name : "SpindleLaserPlugin";
var designerPluginsPath = app.path + "/designerplugins";
var loader = new QUiLoader();

var deviceState = -1;
var senderState = -1;
var isLaserMode = false; // false = Spindle ($32=0), true = Laser ($32=1)
var focusActive = false;
var focusConfirmPending = false; // M3 sent, waiting for its "ok"
var focusRestoreFeed = null;
var pendingLaserAction = null;
var laserActionTimer = null;
var requestedModeToggleAfterRefresh = false;
var requestedToggleTimer = null;
// One-shot user-visible notice (e.g. a refused tool change), shown in the
// mode button tooltip until the next mode action succeeds.
var userNotice = null;

// Exact command strings of the laser batch currently in flight. Response
// index -100 is shared by ALL plugins/scripts (one ScriptDevice in
// Candle), so look-alike commands from other plugins must not advance
// this plugin's state machines: answers are matched against these.
var expectedFocusCmds = null;   // { g1: "G1 F..", m3: "M3 S.." }
var expectedPulseFinalCmd = null;

// A tool change whose $32 ack arrived only after the 5 s timeout: the
// mode already switched on the controller, the $30/$31 part still has to
// be completed once the real state is known again.
var orphanedToolChange = null;
// A foreign $30/$31/$32 write was seen during our tool change: re-read
// the controller settings ($$) after the change completes.
var needResyncAfterToolChange = false;

// Confirmation gate for overwriting controller limits: a first click
// arms confirmStamp, a second click within 15 s proceeds and remembers
// the acknowledged target range (persisted in the plugin storage).
var confirmStamp = null;
var confirmTimer = null;
var acknowledgedRanges = {};    // { "L:0-100": true, ... }

// Safety auto-off for the stationary focus beam.
var focusAutoOffTimer = null;

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
var storedConfig = null;

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

// Speed range of the ACTIVE tool, taken from Candle "Machine info".
// Returns null when neither "Machine info" nor the real controller
// values ($$ report) provide a usable range - the plugin must not
// invent limits (not even for the UI slider, whose value the user can
// then apply to the machine from Candle's own controls).
function getToolLimits()
{
    var minProp = isLaserMode ? "laserPowerMin" : "spindleSpeedMin";
    var maxProp = isLaserMode ? "laserPowerMax" : "spindleSpeedMax";
    var mn = candleInt(minProp, null);
    var mx = candleInt(maxProp, null);

    // A non-positive maximum is "not configured", not a real limit.
    if (mx !== null && mx <= 0) mx = null;

    // If Candle does not expose Machine-info values, use the actual GRBL
    // range already read from the controller instead of assuming defaults.
    if (mn === null && curSMinKnown) mn = curSMin;
    if (mx === null && curSMaxKnown) mx = curSMax;
    if (mn === null || mx === null) return null;

    // An invalid range is unusable everywhere - do not "repair" it into
    // an invented min..min+1 range for the slider/tooltip either.
    if (!(mx > mn)) return null;
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
    if (!lim) return; // no trustworthy range known - leave the slider alone

    if (!force
            && lastApplied.laser === isLaserMode
            && lastApplied.min === lim.min
            && lastApplied.max === lim.max) {
        return; // already applied - avoid value drift on repeated calls
    }

    // Source range for the rescale. Candle's own applySettings() resets
    // the slider to the SPINDLE range (keeping the numeric value) right
    // before settingsAccepted reaches us, so the slider's live min/max
    // cannot be trusted as the "from" range once we have applied one
    // ourselves: rescale from lastApplied instead, otherwise accepting
    // the settings dialog in laser mode collapses e.g. 50% to ~0%.
    var curMin = (lastApplied.min !== null) ? lastApplied.min : lim.min;
    var curMax = (lastApplied.max !== null) ? lastApplied.max : lim.max;
    var curVal = lim.min;
    try {
        if (lastApplied.min === null || lastApplied.max === null) {
            var rMin = parseInt(slider.minimum, 10);
            var rMax = parseInt(slider.maximum, 10);
            if (!isNaN(rMin)) curMin = rMin;
            if (!isNaN(rMax)) curMax = rMax;
        }
        var rVal = parseInt(slider.value, 10);
        if (!isNaN(rVal)) curVal = rVal;
    } catch (e) {
    }

    // Rescale the current speed position into the new tool's range.
    // A degenerate source range defaults to the MINIMUM (fail-safe),
    // never to full speed/power.
    var pos = (curMax > curMin) ? (curVal - curMin) / (curMax - curMin) : 0;
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
        // Only remember the range as applied when the writes succeeded.
        lastApplied.laser = isLaserMode;
        lastApplied.min = lim.min;
        lastApplied.max = lim.max;
    } catch (e) {
    }
}

function updateLaserPowerControls()
{
    // NEVER rewrite the user's Focus/Pulse preferences to fit the range
    // of the currently connected controller: clamping the spin boxes
    // here would persist controller-sized values as user settings (and
    // a minimum forced up to a spindle-range $31 could later turn the
    // "focus" beam into full power once the correct laser range is
    // applied). Powers are clamped at fire time by clampLaserPower()
    // instead. This function only makes sure the spin boxes keep their
    // full design-time range so any preference stays editable.
    if (!uiSettings) return;

    var controls = [uiSettings.spnFocusPower, uiSettings.spnPulsePower];
    for (var i = 0; i < controls.length; i++) {
        var c = controls[i];
        if (!c) continue;
        try {
            if (Number(c.minimum) !== 1) c.minimum = 1;
            if (Number(c.maximum) !== 100000) c.maximum = 100000;
        } catch (e) {
        }
    }
}

// Pure clamp of a requested test power to the real controller range.
// Returns null while no trustworthy $30/$31 range is known. No side
// effects (used for both firing and tooltips).
function clampLaserPower(requested)
{
    if (!curSMaxKnown || curSMax < 1 ||
        (curSMinKnown && curSMin > curSMax)) {
        return null;
    }

    var minPower = curSMinKnown ? Math.max(1, curSMin) : 1;
    var power = parseInt(requested, 10);
    if (isNaN(power)) power = minPower;
    if (power < minPower) power = minPower;
    if (power > curSMax) power = curSMax;
    return power;
}

function laserPowerForTest(requested)
{
    var power = clampLaserPower(requested);
    if (power === null) {
        // Candle normally queries $$ on connect. Request a fresh report and
        // refuse to fire the laser until the real controller limit is known.
        try { app.device.sendCommands("$$"); } catch (e) {}
    }
    return power;
}

// The one and only "output OFF" batch: stop the spindle/laser, zero S
// and return to the safe G0 modal state, optionally restoring a feed.
function sendLaserOff(restoreFeed)
{
    if (restoreFeed === null || restoreFeed === undefined || isNaN(restoreFeed)) {
        app.device.sendCommands("M5\nS0\nG0");
    } else {
        app.device.sendCommands("M5\nS0\nG0 F" + formatGcodeNumber(restoreFeed));
    }
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
            // Do not leave the UI locked if GRBL never acknowledged the
            // command. If the $32 write itself is still unacknowledged,
            // remember the change as orphaned: its late ack (or the $$
            // refresh below) must still complete the $30/$31 part -
            // otherwise the machine would stay in the new mode with the
            // old tool's speed range.
            if (pendingToolChange.stage == "mode") {
                orphanedToolChange = {
                    targetLaserMode: pendingToolChange.targetLaserMode,
                    max: pendingToolChange.max,
                    min: pendingToolChange.min
                };
            } else {
                showUserNotice(qsTr("Tool mode changed, but applying $30/$31 failed. Check $30/$31 in the controller before using the machine."));
            }
            pendingToolChange = null;
            needResyncAfterToolChange = false;
            try { app.device.sendCommands("$$"); } catch (e) {}
            updateUiState();
        });
    }
    modeChangeTimer.start(5000);
}

// The deferred mode toggle (user clicked while $30/$31/$32 were not yet
// known) must not outlive a few seconds: without an expiry a much later,
// unrelated $$ answer would execute a long-forgotten click - possibly
// inverting a mode that somebody else changed in the meantime.
function stopRequestedToggleTimer()
{
    if (requestedToggleTimer) {
        try { requestedToggleTimer.stop(); } catch (e) {}
    }
}

function cancelRequestedModeToggle()
{
    requestedModeToggleAfterRefresh = false;
    stopRequestedToggleTimer();
}

function armRequestedToggleTimer()
{
    stopRequestedToggleTimer();
    if (!requestedToggleTimer) {
        requestedToggleTimer = new QTimer();
        requestedToggleTimer.singleShot = true;
        requestedToggleTimer.timeout.connect(function () {
            // The refresh never completed in time - forget the click
            // instead of firing it at some unrelated later moment.
            requestedModeToggleAfterRefresh = false;
            updateUiState();
        });
    }
    requestedToggleTimer.start(5000);
}

// Pending laser actions ($G query, pulse, focus confirmation) get the
// same treatment: if GRBL never answers, unlock the panel again instead
// of leaving every laser button disabled until disconnect.
function stopLaserActionTimer()
{
    if (laserActionTimer) {
        try { laserActionTimer.stop(); } catch (e) {}
    }
}

function armLaserActionTimer(extraMs)
{
    stopLaserActionTimer();
    if (!laserActionTimer) {
        laserActionTimer = new QTimer();
        laserActionTimer.singleShot = true;
        laserActionTimer.timeout.connect(function () {
            pendingLaserAction = null;
            expectedPulseFinalCmd = null;
            if (focusConfirmPending) {
                // The laser state is unknown - fail safe OFF.
                focusConfirmPending = false;
                focusActive = false;
                expectedFocusCmds = null;
                stopFocusAutoOffTimer();
                var rf = focusRestoreFeed;
                focusRestoreFeed = null;
                try { sendLaserOff(rf); } catch (e) {}
            }
            updateUiState();
        });
    }
    // A pulse may dwell up to spnPulseMs (5000 ms) inside its G4, and the
    // final ack still has several command round-trips to go, so the base
    // 5 s budget must be extended by the dwell time.
    laserActionTimer.start(5000 + (extraMs ? extraMs : 0));
}

// The confirmation click for overwriting controller limits must happen
// promptly, while the shown old -> new values are still current.
function stopConfirmTimer()
{
    if (confirmTimer) {
        try { confirmTimer.stop(); } catch (e) {}
    }
}

function armConfirmTimer()
{
    stopConfirmTimer();
    if (!confirmTimer) {
        confirmTimer = new QTimer();
        confirmTimer.singleShot = true;
        confirmTimer.timeout.connect(function () {
            confirmStamp = null;
            userNotice = null;
            updateUiState();
        });
    }
    confirmTimer.start(15000);
}

function rangeKeyFor(laser, minValue, maxValue)
{
    return (laser ? "L:" : "S:") + String(minValue) + "-" + String(maxValue);
}

function persistAcknowledgedRanges()
{
    try {
        var s = getStorage();
        var keys = [];
        for (var k in acknowledgedRanges) {
            if (acknowledgedRanges[k]) keys.push(k);
        }
        s.setValue("ackRanges", keys.join(","));
        if (!app.storage) s.sync();
    } catch (e) {
    }
}

// A stationary focus beam must not burn forever: turn it OFF after
// 5 minutes even if the user walked away.
function stopFocusAutoOffTimer()
{
    if (focusAutoOffTimer) {
        try { focusAutoOffTimer.stop(); } catch (e) {}
    }
}

function armFocusAutoOffTimer()
{
    stopFocusAutoOffTimer();
    if (!focusAutoOffTimer) {
        focusAutoOffTimer = new QTimer();
        focusAutoOffTimer.singleShot = true;
        focusAutoOffTimer.timeout.connect(function () {
            if (!focusActive) return;
            focusActive = false;
            focusConfirmPending = false;
            expectedFocusCmds = null;
            var rf = focusRestoreFeed;
            focusRestoreFeed = null;
            try { sendLaserOff(rf); } catch (e) {}
            showUserNotice(qsTr("Laser focus beam was turned OFF automatically after 5 minutes."));
        });
    }
    focusAutoOffTimer.start(300000);
}

// Show a message to the user in the mode button tooltip. Deliberately
// NOT a modal QMessageBox: notices can originate inside the response
// handler, where a modal dialog would spin a nested event loop while
// Candle is still processing serial answers (reentrancy), and not every
// build exposes QMessageBox to QtScript at all.
function showUserNotice(text)
{
    userNotice = String(text);
    updateUiState();
}

function init()
{
    loader.setWorkingDirectory(new QDir(pluginPath));
    loader.addPluginPath(designerPluginsPath);

    iconSpindle = new QIcon(pluginPath + "/images/spindle.png");
    iconLaser = new QIcon(pluginPath + "/images/laser.png");

    connectSignal(app.device.stateChanged, onAppDeviceStateChanged);
    connectSignal(app.sender.stateChanged, onAppSenderStateChanged);
    connectSignal(app.device.responseReceived, onAppResponseReceived);

    connectSignal(app.settingsLoaded, onAppSettingsLoaded);
    connectSignal(app.settingsSaved, onAppSettingsSaved);
    connectSignal(app.settingsAboutToShow, onAppSettingsAboutToShow);
    connectSignal(app.settingsAccepted, onAppSettingsAccepted);
    connectSignal(app.settingsRejected, onAppSettingsRejected);
    connectSignal(app.settingsSetByDefault, onAppSettingsDefault);
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
        // The note label is translated by QUiLoader from the compiled
        // translation_<lang>.qm like every other static string - no
        // runtime override (and no language guessing) here.
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
    var readyBasic = isMachineReady();
    var ready = readyBasic && !pendingToolChange && !pendingLaserAction;
    var safePowerKnown = curSMaxKnown && curSMax > 0 &&
        (!curSMinKnown || curSMin <= curSMax);
    if (uiPanel.actLaserFocus) uiPanel.actLaserFocus.enabled = vis && ready && safePowerKnown;
    if (uiPanel.actLaserPulse) uiPanel.actLaserPulse.enabled = vis && ready && safePowerKnown;
    // OFF is a stop button: it stays available while other actions are
    // pending so the user can always cancel/stop the output.
    if (uiPanel.actLaserOff) uiPanel.actLaserOff.enabled = vis && readyBasic;
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

    // Real machine $30 (when known) + active tool speed range. With no
    // trustworthy range known yet, show the mode without any speeds
    // rather than displaying invented limits.
    if (isLaserMode) {
        uiPanel.cmdModeToggle.icon = iconLaser;
        uiPanel.cmdModeToggle.toolTip = !lim
            ? qsTr("Mode: LASER ($32=1) - click to switch to SPINDLE")
            : curSKnown
            ? trFill(qsTr("Mode: LASER ($32=1, $30=%1, speeds %2-%3) - click to switch to SPINDLE"),
                     { "%1": curSMax, "%2": lim.min, "%3": lim.max })
            : trFill(qsTr("Mode: LASER ($32=1, speeds %1-%2) - click to switch to SPINDLE"),
                     { "%1": lim.min, "%2": lim.max });
    } else {
        uiPanel.cmdModeToggle.icon = iconSpindle;
        uiPanel.cmdModeToggle.toolTip = !lim
            ? qsTr("Mode: SPINDLE ($32=0) - click to switch to LASER")
            : curSKnown
            ? trFill(qsTr("Mode: SPINDLE ($32=0, $30=%1, speeds %2-%3) - click to switch to LASER"),
                     { "%1": curSMax, "%2": lim.min, "%3": lim.max })
            : trFill(qsTr("Mode: SPINDLE ($32=0, speeds %1-%2) - click to switch to LASER"),
                     { "%1": lim.min, "%2": lim.max });
    }
    if (userNotice) {
        uiPanel.cmdModeToggle.toolTip = userNotice + "\n" + uiPanel.cmdModeToggle.toolTip;
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
    // OFF is a stop button: never lock it behind a pending action.
    uiPanel.cmdLaserOff.enabled = machineReady && isLaserMode;

    // 3. Update laser buttons state & tooltips
    uiPanel.cmdFocus.blockSignals(true);
    uiPanel.cmdFocus.checked = focusActive;
    uiPanel.cmdFocus.blockSignals(false);
    uiPanel.cmdFocus.backgroundColor = focusActive ? new QColor(255, 170, 0) : new QColor(0, 0, 0, 0);

    // Show the power that will actually be sent (clamped to the real
    // controller range), not just the raw spin-box preference.
    var fEff = clampLaserPower(fPwr);
    var pEff = clampLaserPower(pPwr);
    uiPanel.cmdFocus.toolTip = trFill(
        qsTr("Laser focus beam ON/OFF (M3 S%1 / M5)"),
        { "%1": (fEff === null ? fPwr : fEff) }
    );
    uiPanel.cmdPulse.toolTip = trFill(
        qsTr("Laser test pulse (S%1, %2 ms)"),
        { "%1": (pEff === null ? pPwr : pEff), "%2": pMs }
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

// $30/$31 write order that keeps the interim EEPROM range valid at
// every step: writing the maximum first is only safe while the CURRENT
// minimum is still below the new maximum; otherwise the minimum must be
// lowered first. (With $31 >= $30 GRBL outputs full PWM for any S>0,
// so an invalid interim pair must never be stored - a failed or
// interrupted pair would otherwise persist in EEPROM.)
function buildLimitQueue(maxValue, minValue)
{
    var qMax = { cmd: "$30=" + maxValue };
    var qMin = { cmd: "$31=" + minValue };
    if (curSMinKnown && !(Number(curSMin) < Number(maxValue))) {
        return [qMin, qMax];
    }
    return [qMax, qMin];
}

// Send the next queued $30/$31 write of the pending tool change. The
// limits are written one at a time, each acknowledged before the next
// is sent, so a failed write aborts the pair before it can store an
// invalid combination.
function sendNextLimitCommand()
{
    if (!pendingToolChange || !pendingToolChange.limitQueue
            || pendingToolChange.limitQueue.length === 0) {
        return false;
    }
    app.device.sendCommands(pendingToolChange.limitQueue[0].cmd);
    armModeChangeTimer();
    return true;
}

// Complete the $30/$31 part of a tool change whose $32 was applied by
// the controller but acknowledged too late (after the 5 s timeout).
// Called whenever fresh controller state becomes known.
function maybeStartOrphanedLimits()
{
    if (!orphanedToolChange || pendingToolChange
            || !curModeKnown || !curSMaxKnown || !curSMinKnown) {
        return false;
    }
    if (isLaserMode !== orphanedToolChange.targetLaserMode) {
        orphanedToolChange = null; // the mode change itself never happened
        return false;
    }
    if (Number(curSMax) === Number(orphanedToolChange.max)
            && Number(curSMin) === Number(orphanedToolChange.min)) {
        orphanedToolChange = null; // limits already match the target
        return false;
    }
    pendingToolChange = {
        targetLaserMode: orphanedToolChange.targetLaserMode,
        max: orphanedToolChange.max,
        min: orphanedToolChange.min,
        stage: "limits",
        modeCmd: null,
        limitQueue: buildLimitQueue(orphanedToolChange.max, orphanedToolChange.min)
    };
    orphanedToolChange = null;
    sendNextLimitCommand();
    return true;
}

// Tool switching first stops the output and requests $32. Only after the
// controller acknowledges $32 are the target Machine-info $30/$31 limits
// written (sequentially, see buildLimitQueue/sendNextLimitCommand).
function applyToolChange(targetLaserMode)
{
    if (pendingToolChange) return;
    if (!isMachineReady()) {
        cancelRequestedModeToggle();
        updateUiState();
        return;
    }
    // A mode click supersedes any pending laser test action: never let
    // a queued $G answer fire the laser across a tool change.
    pendingLaserAction = null;
    expectedPulseFinalCmd = null;
    stopLaserActionTimer();

    var t = toolTargets(targetLaserMode);

    // A safe comparison requires the actual controller settings. Candle sends
    // $$ after connect; if they are not known yet, refresh and ask the user to
    // retry instead of silently overwriting unknown $30/$31 values.
    if (!curModeKnown || !curSMaxKnown || !curSMinKnown) {
        // A freshly reset GRBL may not yet have reported its settings. Refresh
        // them and resume the requested toggle once the real $32/$30/$31 are
        // known; do not leave the button disabled forever waiting for $$.
        // The request expires after a few seconds (armRequestedToggleTimer)
        // so it can never fire at an unrelated later moment. The target
        // validation below runs when the toggle resumes from the $$ answer.
        requestedModeToggleAfterRefresh = true;
        armRequestedToggleTimer();
        try { app.device.sendCommands("$$"); } catch (e) {
            cancelRequestedModeToggle();
        }
        updateUiState();
        return;
    }

    // Never write an invalid S range to the controller's EEPROM. With
    // $31 >= $30 (or a non-positive $30) GRBL's PWM calculation saturates:
    // any S>0 then produces full power. Previously the target values were
    // sent unchecked - refuse the whole tool change instead and tell the
    // user, sending nothing at all.
    if (t.max === null || t.max === undefined || t.min === null || t.min === undefined
            || !(t.max > 0) || t.min < 0 || t.min >= t.max) {
        showUserNotice(trFill(
            qsTr("Tool change cancelled: invalid speed range in Machine info (min %1, max %2). Nothing was sent to the controller."),
            { "%1": t.min, "%2": t.max }));
        return;
    }

    // Overwriting the controller's EEPROM limits with DIFFERENT values
    // needs an explicit confirmation the first time each target range
    // is used: a fresh Candle installation always exposes factory
    // defaults (spindle 0/10000, laser 0/100) in "Machine info", which
    // are indistinguishable from deliberately configured values and
    // would otherwise silently replace the machine's real limits.
    // First click only shows old -> new; a second click within 15 s
    // confirms and remembers the range (persisted), so routine tool
    // changes stay one-click afterwards.
    var rangeDiffers = !(Number(curSMin) === Number(t.min)
            && Number(curSMax) === Number(t.max));
    var rKey = rangeKeyFor(targetLaserMode, t.min, t.max);
    if (rangeDiffers && !acknowledgedRanges[rKey]) {
        if (confirmStamp && confirmStamp.key === rKey) {
            acknowledgedRanges[rKey] = true;
            persistAcknowledgedRanges();
            confirmStamp = null;
            stopConfirmTimer();
        } else {
            confirmStamp = { key: rKey };
            armConfirmTimer();
            showUserNotice(trFill(
                qsTr("Tool change will write $30: %1 -> %2, $31: %3 -> %4. Click the mode button again within 15 seconds to confirm."),
                { "%1": curSMax, "%2": t.max, "%3": curSMin, "%4": t.min }));
            return;
        }
    }

    userNotice = null;
    confirmStamp = null;
    stopConfirmTimer();
    orphanedToolChange = null;
    var restoreFeedForModeSwitch = focusRestoreFeed;
    focusActive = false;
    focusConfirmPending = false;
    expectedFocusCmds = null;
    stopFocusAutoOffTimer();
    stopLaserActionTimer();
    cancelRequestedModeToggle();
    focusRestoreFeed = null;
    pendingToolChange = {
        targetLaserMode: targetLaserMode,
        max: t.max,
        min: t.min,
        stage: "mode",
        modeCmd: "$32=" + t.mode,
        limitQueue: null
    };

    // First stop the output and force the safe G0 modal state. If Focus had
    // temporarily set F, restore that feed before switching tools. Do not
    // update the UI or write new speed limits until $32 is acknowledged.
    var stopCommands = "M5\nS0\nG0";
    if (restoreFeedForModeSwitch !== null && !isNaN(restoreFeedForModeSwitch)) {
        stopCommands += " F" + formatGcodeNumber(restoreFeedForModeSwitch);
    }
    stopCommands += "\n" + pendingToolChange.modeCmd;
    app.device.sendCommands(stopCommands);
    armModeChangeTimer();
    updateUiState();
}

function onModeToggleClicked()
{
    if (!isMachineReady()) { updateUiState(); return; }
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

function requestLaserAction(kind, power, seconds, restoreFeedOverride)
{
    if (!isLaserMode || !isMachineReady() || pendingToolChange || pendingLaserAction) return;
    pendingLaserAction = {
        kind: kind, power: power, seconds: seconds, stage: "query",
        restoreFeedOverride: (restoreFeedOverride === undefined ? null : restoreFeedOverride)
    };
    try {
        app.device.sendCommands("$G");
        armLaserActionTimer();
    } catch (e) {
        pendingLaserAction = null;
        stopLaserActionTimer();
        updateUiState();
    }
    updateUiState();
}

function onFocusClicked()
{
    if (!isLaserMode || !isMachineReady() || pendingToolChange || pendingLaserAction) return;

    if (focusActive || focusConfirmPending) {
        focusActive = false;
        focusConfirmPending = false;
        expectedFocusCmds = null;
        stopFocusAutoOffTimer();
        stopLaserActionTimer();
        var restoreFeed = (focusRestoreFeed === null) ? null : focusRestoreFeed;
        focusRestoreFeed = null;
        sendLaserOff(restoreFeed);
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
    if (!isLaserMode || !isMachineReady() || pendingToolChange || pendingLaserAction) return;

    var requested = uiSettings ? uiSettings.spnPulsePower.value : 100;
    var pPwr = laserPowerForTest(requested);
    if (pPwr === null) {
        updateUiState();
        return;
    }
    var pMs  = uiSettings ? uiSettings.spnPulseMs.value : 200;
    var pSec = (pMs / 1000.0).toFixed(3);

    // If the pulse replaces an active focus beam, the feed to restore
    // afterwards is the PRE-FOCUS feed (focusRestoreFeed): $G during
    // focus reports the temporary test feed, not the user's original.
    var priorRestoreFeed = focusRestoreFeed;
    focusActive = false;
    focusConfirmPending = false;
    expectedFocusCmds = null;
    stopFocusAutoOffTimer();
    requestLaserAction("pulse", pPwr, pSec, priorRestoreFeed);
    updateUiState();
}

function onLaserOffClicked()
{
    // Stop button: also cancels any pending laser action, so a $G
    // answer arriving afterwards can no longer fire the laser.
    pendingLaserAction = null;
    expectedFocusCmds = null;
    expectedPulseFinalCmd = null;
    focusActive = false;
    focusConfirmPending = false;
    stopFocusAutoOffTimer();
    stopLaserActionTimer();
    var restoreFeed = (focusRestoreFeed === null) ? null : focusRestoreFeed;
    focusRestoreFeed = null;
    try { sendLaserOff(restoreFeed); } catch (e) {}
    updateUiState();
}

function onAppDeviceStateChanged(status)
{
    var ready = (status == 1) && (senderState == 4);
    if (uiPanel) {
        uiPanel.setEnabled(ready);
    }

    if (status == 2 || status == 14) {
        // Alarm / Sleep: GRBL has forcibly stopped the output. The
        // plugin must not keep showing a burning focus beam.
        focusActive = false;
        focusConfirmPending = false;
        focusRestoreFeed = null;
        expectedFocusCmds = null;
        expectedPulseFinalCmd = null;
        pendingLaserAction = null;
        stopLaserActionTimer();
        stopFocusAutoOffTimer();
    }

    if (status == -1) {
        // Candle may recreate the main-window slider after reconnect.
        // Forget both the cached widget and the previously applied range.
        cachedSlider = null;
        lastApplied = { laser: null, min: null, max: null };
        focusActive = false;
        focusConfirmPending = false;
        focusRestoreFeed = null;
        expectedFocusCmds = null;
        expectedPulseFinalCmd = null;
        pendingLaserAction = null;
        stopLaserActionTimer();
        stopFocusAutoOffTimer();
        cancelRequestedModeToggle();
        confirmStamp = null;
        stopConfirmTimer();
        orphanedToolChange = null;
        needResyncAfterToolChange = false;
        userNotice = null;
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
    var cmdUpper = cmd.toUpperCase();
    var resp = String(response);
    var respLower = resp.toLowerCase();
    var updated = false;
    var isOk = respLower.indexOf("ok") !== -1;
    var isError = respLower.indexOf("error") !== -1 || respLower.indexOf("alarm") !== -1;
    // Answers to script commands carry the table index -100 (the
    // ScriptDevice::sendCommands default in Candle). NOTE: Candle has
    // ONE ScriptDevice shared by every plugin and user script, so -100
    // means "some script", not necessarily this plugin. Program lines
    // (>= 0), console commands (-1) and Candle's own utility queries
    // (-2/-3) must never drive the state machines, and within -100 the
    // answers are additionally matched against the exact command
    // strings this plugin sent. Hosts that do not report a numeric
    // index keep the old accept-all behaviour.
    var isOwnResponse = (typeof index !== "number") || (index === -100);
    // The tool-change command this plugin is waiting for right now
    // (snapshotted at entry, before the stages below advance it).
    var ownExpectedAtEntry = null;
    if (pendingToolChange) {
        ownExpectedAtEntry = (pendingToolChange.stage == "mode")
            ? pendingToolChange.modeCmd
            : ((pendingToolChange.limitQueue && pendingToolChange.limitQueue.length > 0)
                ? pendingToolChange.limitQueue[0].cmd : null);
    }

    // A $G report is needed to preserve the user's previous modal feed rate.
    // Do not fire if GRBL did not return a valid modal report.
    if (pendingLaserAction && pendingLaserAction.stage == "query" && cmd == "$G" && isOwnResponse) {
        var modalMatch = resp.match(/\[GC:([^\]]+)\]/i);
        var feedMatch = modalMatch ? modalMatch[1].match(/\bF(-?[0-9]+(?:\.[0-9]*)?)/i) : null;
        if (isError || !feedMatch) {
            pendingLaserAction = null;
            stopLaserActionTimer();
            updateUiState();
            return;
        }

        var oldFeed = parseFloat(feedMatch[1]);
        if (isNaN(oldFeed) || oldFeed < 0) {
            pendingLaserAction = null;
            stopLaserActionTimer();
            updateUiState();
            return;
        }
        // Re-validate at fire time: the world may have changed since
        // the click (tool change started, mode flipped externally,
        // machine no longer idle). Never fire across such a change.
        if (!isLaserMode || !curModeKnown || pendingToolChange || !isMachineReady()) {
            pendingLaserAction = null;
            stopLaserActionTimer();
            updateUiState();
            return;
        }

        var action = pendingLaserAction;
        var testFeed = (oldFeed > 0) ? oldFeed : 100;
        var feedForTest = formatGcodeNumber(testFeed);
        pendingLaserAction = null;
        stopLaserActionTimer();

        if (action.kind == "focus-on") {
            focusRestoreFeed = oldFeed;
            // Not "on" yet: the button lights up only when GRBL
            // acknowledges the M3 command itself (see below).
            focusConfirmPending = true;
            expectedFocusCmds = {
                g1: "G1 F" + feedForTest,
                m3: "M3 S" + action.power
            };
            app.device.sendCommands(expectedFocusCmds.g1 + "\n" + expectedFocusCmds.m3);
            armLaserActionTimer();
        } else if (action.kind == "pulse") {
            // A pulse replacing an active focus restores the PRE-FOCUS
            // feed; $G during focus only reports the test feed.
            var effectiveRestoreFeed = oldFeed;
            if (action.restoreFeedOverride !== null
                    && action.restoreFeedOverride !== undefined
                    && !isNaN(action.restoreFeedOverride)) {
                effectiveRestoreFeed = Number(action.restoreFeedOverride);
            }
            var restore = formatGcodeNumber(effectiveRestoreFeed);
            // Keep controls locked until the final G0/F restore is acknowledged.
            pendingLaserAction = { kind: "pulse-running", stage: "running" };
            expectedPulseFinalCmd = "G0 F" + restore;
            // The pulse batch ends with the output OFF and the feed
            // restored - no focus state survives it.
            focusRestoreFeed = null;
            app.device.sendCommands("G1 F" + feedForTest + "\nM3 S" + action.power +
                "\nG4 P" + action.seconds + "\nM5\nS0\n" + expectedPulseFinalCmd);
            var dwellMs = Math.round(parseFloat(action.seconds) * 1000);
            armLaserActionTimer(isNaN(dwellMs) ? 0 : dwellMs);
        }
        updateUiState();
        return;
    }

    if (pendingLaserAction && pendingLaserAction.stage == "running" &&
        pendingLaserAction.kind == "pulse-running" && expectedPulseFinalCmd
        && cmd === expectedPulseFinalCmd && isOwnResponse) {
        pendingLaserAction = null;
        expectedPulseFinalCmd = null;
        stopLaserActionTimer();
        updateUiState();
    }

    if (expectedFocusCmds && cmd === expectedFocusCmds.g1 && isError
            && (focusActive || focusConfirmPending) && isOwnResponse) {
        // Fail safe: if GRBL rejects the modal G1 command, cancel focus and
        // make a best-effort explicit laser-off/safe-mode request.
        var failedFocusFeed = focusRestoreFeed;
        focusActive = false;
        focusConfirmPending = false;
        expectedFocusCmds = null;
        stopLaserActionTimer();
        stopFocusAutoOffTimer();
        focusRestoreFeed = null;
        try { sendLaserOff(failedFocusFeed); } catch (e) {}
        updateUiState();
    }

    // Focus becomes "on" only when GRBL acknowledges the M3 itself. An
    // error on M3 means the beam never started: clear the pending state
    // and fail safe OFF instead of showing a burning focus beam.
    if (focusConfirmPending && expectedFocusCmds && cmd === expectedFocusCmds.m3 && isOwnResponse) {
        if (isOk) {
            focusConfirmPending = false;
            focusActive = true;
            stopLaserActionTimer();
            armFocusAutoOffTimer();
            updated = true;
        } else if (isError) {
            focusConfirmPending = false;
            focusActive = false;
            expectedFocusCmds = null;
            stopLaserActionTimer();
            stopFocusAutoOffTimer();
            var m3FailedFeed = focusRestoreFeed;
            focusRestoreFeed = null;
            try { sendLaserOff(m3FailedFeed); } catch (e) {}
            updated = true;
        }
    }

    // Process the $32 acknowledgement before changing the visible mode. Only
    // once GRBL accepts the mode do we apply the new Machine-info $30/$31.
    // The command string must match OUR $32 write exactly: another
    // plugin's opposite $32 (same response index -100) must not advance
    // this state machine.
    if (pendingToolChange && pendingToolChange.stage == "mode"
            && cmd === pendingToolChange.modeCmd && isOwnResponse) {
        if (isOk) {
            curModeKnown = true;
            isLaserMode = pendingToolChange.targetLaserMode;
            focusActive = false;
            focusConfirmPending = false;
            expectedFocusCmds = null;
            stopFocusAutoOffTimer();
            pendingToolChange.stage = "limits";
            // Always write both settings on a successful mode switch,
            // even if one target equals the controller value (GRBL
            // skips identical EEPROM bytes, and the complete range
            // stays explicit in the command log) - but sequentially
            // and in the order that keeps the interim range valid.
            // curSMin/curSMax still hold the pre-write controller
            // values at this point, which the ordering needs.
            pendingToolChange.limitQueue = buildLimitQueue(
                pendingToolChange.max, pendingToolChange.min);
            sendNextLimitCommand();
            updated = true;
        } else if (isError) {
            pendingToolChange = null;
            stopModeChangeTimer();
            needResyncAfterToolChange = false;
            // Refresh reported settings rather than assuming either state.
            try { app.device.sendCommands("$$"); } catch (e) {}
            updated = true;
        }
    } else if (pendingToolChange && pendingToolChange.stage == "limits"
            && pendingToolChange.limitQueue && pendingToolChange.limitQueue.length > 0
            && cmd === pendingToolChange.limitQueue[0].cmd && isOwnResponse) {
        if (isError) {
            // Abort the pair: thanks to the safe write order, whatever
            // was already written forms a valid range with the old
            // remaining value. Warn the user and re-read the truth.
            pendingToolChange = null;
            stopModeChangeTimer();
            needResyncAfterToolChange = false;
            try { app.device.sendCommands("$$"); } catch (e) {}
            showUserNotice(qsTr("Tool mode changed, but applying $30/$31 failed. Check $30/$31 in the controller before using the machine."));
            updated = true;
        } else if (isOk) {
            pendingToolChange.limitQueue.shift();
            if (pendingToolChange.limitQueue.length > 0) {
                sendNextLimitCommand();
            } else {
                pendingToolChange = null;
                stopModeChangeTimer();
                if (needResyncAfterToolChange) {
                    needResyncAfterToolChange = false;
                    try { app.device.sendCommands("$$"); } catch (e) {}
                }
            }
            updated = true;
        }
    }

    // A foreign $30/$31/$32 write during our tool change is not allowed
    // to drive the stages above (exact-match), but it does mean the
    // values we believe in may be stale afterwards: resync with $$
    // once the change completes.
    if (ownExpectedAtEntry !== null && isOk && cmd !== ownExpectedAtEntry
            && (cmd.indexOf("$32=") === 0 || cmd.indexOf("$30=") === 0
                || cmd.indexOf("$31=") === 0)) {
        needResyncAfterToolChange = true;
    }

    // Real $30/$31 as reported by GRBL (normally in the $$ response).
    // Decimal values are accepted as well (grblHAL/FluidNC-style output
    // such as $30=1000.000 must not be silently truncated).
    if (resp.indexOf("$30=") !== -1) {
        var m30 = resp.match(/\$30=(\d+(?:\.\d+)?)/);
        if (m30) {
            curSMax = parseFloat(m30[1]);
            curSMaxKnown = true;
            curSKnown = curSMaxKnown && curSMinKnown;
            updated = true;
        }
    }
    if (resp.indexOf("$31=") !== -1) {
        var m31 = resp.match(/\$31=(\d+(?:\.\d+)?)/);
        if (m31) {
            curSMin = parseFloat(m31[1]);
            curSMinKnown = true;
            curSKnown = curSMaxKnown && curSMinKnown;
            updated = true;
        }
    }
    // ...and from our own successful $30/$31 writes
    if (cmd.indexOf("$30=") === 0 && isOk) {
        curSMax = parseFloat(cmd.substring(4));
        curSMaxKnown = true;
        curSKnown = curSMaxKnown && curSMinKnown;
        updated = true;
    }
    if (cmd.indexOf("$31=") === 0 && isOk) {
        curSMin = parseFloat(cmd.substring(4));
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
            if (!isLaserMode) { focusActive = false; focusConfirmPending = false; }
            updated = true;
        }
    } else if (cmd.indexOf("$32=") === 0 && isOk && !pendingToolChange) {
        curModeKnown = true;
        isLaserMode = (cmd.indexOf("$32=1") === 0);
        if (!isLaserMode) { focusActive = false; focusConfirmPending = false; }
        // Somebody else (console, another plugin) changed the mode
        // deliberately - a deferred toggle click of ours must not
        // invert their change back.
        cancelRequestedModeToggle();
        updated = true;
    }

    if (cmdUpper.indexOf("M5") !== -1 && isOk) {
        focusActive = false;
        focusConfirmPending = false;
        stopFocusAutoOffTimer();
        updated = true;
    }

    updateLaserPowerControls();
    // A tool change that timed out earlier still owes the controller
    // its $30/$31 limits - complete it before anything else.
    if (maybeStartOrphanedLimits()) {
        applyToolSpeeds(false);
        updateUiState();
        return;
    }
    if (requestedModeToggleAfterRefresh && curModeKnown && curSMaxKnown &&
        curSMinKnown && !pendingToolChange && !pendingLaserAction) {
        cancelRequestedModeToggle();
        applyToolChange(!isLaserMode); // invert the freshly read controller mode
        // Even when applyToolChange refused or asked for a confirmation
        // click, the slider must follow the freshly learned mode.
        applyToolSpeeds(false);
        updateUiState();
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

    // One-time migration: drop every obsolete key. v1/v2 stored an
    // unsafe "$30/$31 update" option with fixed limit values; v3 stored an
    // "auto $$ on connect" flag - Candle itself queries $$ after every
    // connect/reset/homing, so the plugin no longer needs its own query.
    // The removals are idempotent; the stored version tracks the plugin
    // version that last migrated the settings (v10).
    if (parseInt(s.value("configVersion", 1), 10) < 10) {
        s.remove("updateS");
        s.remove("spindleMax");
        s.remove("spindleMin");
        s.remove("laserMax");
        s.remove("laserMin");
        s.remove("autoQuery");
        s.setValue("configVersion", 10);
        if (!app.storage) s.sync();
    }

    // Target ranges the user has already confirmed for overwriting the
    // controller limits (see applyToolChange).
    acknowledgedRanges = {};
    var ackList = String(s.value("ackRanges", "") || "").split(",");
    for (var i = 0; i < ackList.length; i++) {
        var k = String(ackList[i]).replace(/^\s+|\s+$/g, "");
        if (k) acknowledgedRanges[k] = true;
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
    // The user may just have fixed the values a notice complained
    // about - do not keep showing the stale text.
    userNotice = null;
    // "Machine info" limits may have changed - re-apply the active tool speeds
    applyToolSpeeds(true);
    updateUiState();
}

function onAppSettingsRejected()
{
    // Restore only when a snapshot was really taken in
    // onAppSettingsAboutToShow - assigning undefined snapshot fields
    // would corrupt the spin boxes on hosts that skip that callback.
    if (uiSettings && storedConfig
            && storedConfig.focusPower !== undefined
            && storedConfig.pulsePower !== undefined
            && storedConfig.pulseMs !== undefined) {
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
