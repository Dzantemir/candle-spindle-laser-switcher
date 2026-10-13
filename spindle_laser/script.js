// Compact Spindle / Laser Toggle Plugin for Candle
// - 1-row icon-only layout (same width as Coordinate System / User Commands, no scrollbars).
// - Button 1 toggles between Spindle ($32=0) and Laser ($32=1).
// - Buttons 2..4 (Focus, Pulse, Laser OFF) are hidden when in Spindle mode ($32=0).

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
var queriedOnConnect = false;

var iconSpindle;
var iconLaser;

// Saved settings state for cancel/restore in Settings dialog
var storedConfig = {};

// Ui
var uiPanel;
var uiSettings;

function isRussian()
{
    return (!app.settings || !app.settings.language || app.settings.language === "ru");
}

function trText(en, ru)
{
    return isRussian() ? ru : en;
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
}

function updateUiState()
{
    if (!uiPanel) return;

    var sMax = uiSettings ? uiSettings.spnSpindleMax.value : 10000;
    var lMax = uiSettings ? uiSettings.spnLaserMax.value : 1000;
    var fPwr = uiSettings ? uiSettings.spnFocusPower.value : 10;
    var pPwr = uiSettings ? uiSettings.spnPulsePower.value : 100;
    var pMs  = uiSettings ? uiSettings.spnPulseMs.value : 200;

    // 1. Update single toggle button icon, checked state, and tooltip
    uiPanel.cmdModeToggle.blockSignals(true);
    uiPanel.cmdModeToggle.checked = isLaserMode;
    uiPanel.cmdModeToggle.blockSignals(false);

    if (isLaserMode) {
        uiPanel.cmdModeToggle.icon = iconLaser;
        uiPanel.cmdModeToggle.toolTip = trText(
            "Mode: LASER ($32=1, $30=" + lMax + ") — click to switch to SPINDLE ($32=0)",
            "Режим: ЛАЗЕР ($32=1, $30=" + lMax + ") — нажмите для переключения на ШПИНДЕЛЬ ($32=0)"
        );
    } else {
        uiPanel.cmdModeToggle.icon = iconSpindle;
        uiPanel.cmdModeToggle.toolTip = trText(
            "Mode: SPINDLE ($32=0, $30=" + sMax + ") — click to switch to LASER ($32=1)",
            "Режим: ШПИНДЕЛЬ ($32=0, $30=" + sMax + ") — нажмите для переключения на ЛАЗЕР ($32=1)"
        );
    }

    // 2. Hide or show laser buttons depending on whether Laser mode is active
    setLaserButtonsVisible(isLaserMode);

    // 3. Update laser buttons state & tooltips
    uiPanel.cmdFocus.blockSignals(true);
    uiPanel.cmdFocus.checked = focusActive;
    uiPanel.cmdFocus.blockSignals(false);
    uiPanel.cmdFocus.backgroundColor = focusActive ? new QColor(0xffffaa00) : new QColor(0, 0, 0, 0);

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

function applyModeToController(targetLaserMode)
{
    var updateS = uiSettings ? uiSettings.chkUpdateS.checked : true;
    var cmds = ["M5"];

    if (targetLaserMode) {
        cmds.push("$32=1");
        if (updateS) {
            var lMax = uiSettings ? uiSettings.spnLaserMax.value : 1000;
            var lMin = uiSettings ? uiSettings.spnLaserMin.value : 0;
            cmds.push("$30=" + lMax);
            cmds.push("$31=" + lMin);
        }
    } else {
        cmds.push("S0");
        cmds.push("$32=0");
        if (updateS) {
            var sMax = uiSettings ? uiSettings.spnSpindleMax.value : 10000;
            var sMin = uiSettings ? uiSettings.spnSpindleMin.value : 0;
            cmds.push("$30=" + sMax);
            cmds.push("$31=" + sMin);
        }
    }

    focusActive = false;
    isLaserMode = targetLaserMode;

    app.device.sendCommands(cmds.join("\n"));
    updateUiState();
}

function onModeToggleClicked()
{
    applyModeToController(!isLaserMode);
}

function onFocusClicked()
{
    if (!isLaserMode) return;

    var fPwr = uiSettings ? uiSettings.spnFocusPower.value : 10;
    if (!focusActive) {
        focusActive = true;
        app.device.sendCommands("G1 F1000\nM3 S" + fPwr);
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
    app.device.sendCommands("G1 F1000\nM3 S" + pPwr + "\nG4 P" + pSec + "\nM5\nS0");
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
        queriedOnConnect = false;
        focusActive = false;
    } else if (ready && !queriedOnConnect) {
        queriedOnConnect = true;
        var autoQuery = uiSettings ? uiSettings.chkAutoQuery.checked : true;
        if (autoQuery) {
            app.device.sendCommand("$$");
        }
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

    var updated = false;

    if (response.indexOf("$32=") !== -1) {
        var m32 = response.match(/\$32=(\d+)/);
        if (m32) {
            isLaserMode = (parseInt(m32[1], 10) !== 0);
            if (!isLaserMode) focusActive = false;
            updated = true;
        }
    } else if (command && command.indexOf("$32=") === 0 && response.indexOf("ok") !== -1) {
        isLaserMode = (command.indexOf("$32=1") === 0);
        if (!isLaserMode) focusActive = false;
        updated = true;
    }

    if (command === "M5" && response.indexOf("ok") !== -1) {
        focusActive = false;
        updated = true;
    }

    if (updated) {
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

    if (uiSettings) {
        uiSettings.chkUpdateS.checked = toBool(s.value("updateS", true), true);
        uiSettings.spnSpindleMax.value = parseInt(s.value("spindleMax", 10000), 10) || 10000;
        uiSettings.spnSpindleMin.value = parseInt(s.value("spindleMin", 0), 10) || 0;
        uiSettings.spnLaserMax.value = parseInt(s.value("laserMax", 1000), 10) || 1000;
        uiSettings.spnLaserMin.value = parseInt(s.value("laserMin", 0), 10) || 0;
        uiSettings.spnFocusPower.value = parseInt(s.value("focusPower", 10), 10) || 10;
        uiSettings.spnPulsePower.value = parseInt(s.value("pulsePower", 100), 10) || 100;
        uiSettings.spnPulseMs.value = parseInt(s.value("pulseMs", 200), 10) || 200;
        uiSettings.chkAutoQuery.checked = toBool(s.value("autoQuery", true), true);
    }

    isLaserMode = toBool(s.value("lastLaserMode", false), false);
    updateUiState();
}

function onAppSettingsSaved()
{
    var s = getStorage();
    if (uiSettings) {
        s.setValue("updateS", uiSettings.chkUpdateS.checked);
        s.setValue("spindleMax", uiSettings.spnSpindleMax.value);
        s.setValue("spindleMin", uiSettings.spnSpindleMin.value);
        s.setValue("laserMax", uiSettings.spnLaserMax.value);
        s.setValue("laserMin", uiSettings.spnLaserMin.value);
        s.setValue("focusPower", uiSettings.spnFocusPower.value);
        s.setValue("pulsePower", uiSettings.spnPulsePower.value);
        s.setValue("pulseMs", uiSettings.spnPulseMs.value);
        s.setValue("autoQuery", uiSettings.chkAutoQuery.checked);
    }
    s.setValue("lastLaserMode", isLaserMode);
}

function onAppSettingsAboutToShow()
{
    if (!uiSettings) return;
    storedConfig = {
        updateS: uiSettings.chkUpdateS.checked,
        spindleMax: uiSettings.spnSpindleMax.value,
        spindleMin: uiSettings.spnSpindleMin.value,
        laserMax: uiSettings.spnLaserMax.value,
        laserMin: uiSettings.spnLaserMin.value,
        focusPower: uiSettings.spnFocusPower.value,
        pulsePower: uiSettings.spnPulsePower.value,
        pulseMs: uiSettings.spnPulseMs.value,
        autoQuery: uiSettings.chkAutoQuery.checked
    };
}

function onAppSettingsAccepted()
{
    updateUiState();
}

function onAppSettingsRejected()
{
    if (!uiSettings || !storedConfig) return;
    uiSettings.chkUpdateS.checked = storedConfig.updateS;
    uiSettings.spnSpindleMax.value = storedConfig.spindleMax;
    uiSettings.spnSpindleMin.value = storedConfig.spindleMin;
    uiSettings.spnLaserMax.value = storedConfig.laserMax;
    uiSettings.spnLaserMin.value = storedConfig.laserMin;
    uiSettings.spnFocusPower.value = storedConfig.focusPower;
    uiSettings.spnPulsePower.value = storedConfig.pulsePower;
    uiSettings.spnPulseMs.value = storedConfig.pulseMs;
    uiSettings.chkAutoQuery.checked = storedConfig.autoQuery;
}

function onAppSettingsDefault()
{
    if (!uiSettings) return;
    uiSettings.chkUpdateS.checked = true;
    uiSettings.spnSpindleMax.value = 10000;
    uiSettings.spnSpindleMin.value = 0;
    uiSettings.spnLaserMax.value = 1000;
    uiSettings.spnLaserMin.value = 0;
    uiSettings.spnFocusPower.value = 10;
    uiSettings.spnPulsePower.value = 100;
    uiSettings.spnPulseMs.value = 200;
    uiSettings.chkAutoQuery.checked = true;
}
