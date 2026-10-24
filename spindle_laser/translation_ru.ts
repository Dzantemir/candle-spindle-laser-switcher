<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE TS>
<TS version="2.1" language="ru_RU">
<context>
    <message>
        <source>Mode: LASER ($32=1, $30=%1, speeds %2-%3) - click to switch to SPINDLE</source>
        <translation>Режим: ЛАЗЕР ($32=1, $30=%1, скорости %2-%3) — нажмите для переключения на ШПИНДЕЛЬ</translation>
    </message>
    <message>
        <source>Mode: LASER ($32=1, speeds %1-%2) - click to switch to SPINDLE</source>
        <translation>Режим: ЛАЗЕР ($32=1, скорости %1-%2) — нажмите для переключения на ШПИНДЕЛЬ</translation>
    </message>
    <message>
        <source>Mode: SPINDLE ($32=0, $30=%1, speeds %2-%3) - click to switch to LASER</source>
        <translation>Режим: ШПИНДЕЛЬ ($32=0, $30=%1, скорости %2-%3) — нажмите для переключения на ЛАЗЕР</translation>
    </message>
    <message>
        <source>Mode: SPINDLE ($32=0, speeds %1-%2) - click to switch to LASER</source>
        <translation>Режим: ШПИНДЕЛЬ ($32=0, скорости %1-%2) — нажмите для переключения на ЛАЗЕР</translation>
    </message>
    <message>
        <source>Laser focus beam ON/OFF (M3 S%1 / M5)</source>
        <translation>Луч фокусировки ВКЛ/ВЫКЛ (M3 S%1 / M5)</translation>
    </message>
    <message>
        <source>Laser test pulse (S%1, %2 ms)</source>
        <translation>Тестовый импульс лазера (S%1, %2 мс)</translation>
    </message>
    <message>
        <source>Turn laser OFF (M5 S0)</source>
        <translation>Выключить лазер (M5 S0)</translation>
    </message>
</context>
<context>
    <name>frmMain</name>
    <message>
        <source>Spindle / Laser</source>
        <translation>Шпиндель / Лазер</translation>
    </message>
</context>
<context>
    <name>SpindleLaser</name>
    <message>
        <source>Spindle / Laser</source>
        <translation>Шпиндель / Лазер</translation>
    </message>
    <message>
        <source>Toggle Spindle ($32=0) / Laser ($32=1)</source>
        <translation>Переключить Шпиндель ($32=0) / Лазер ($32=1)</translation>
    </message>
    <message>
        <source>Laser focus beam ON/OFF</source>
        <translation>Луч фокусировки ВКЛ/ВЫКЛ</translation>
    </message>
    <message>
        <source>Short laser test pulse</source>
        <translation>Короткий тестовый импульс лазера</translation>
    </message>
    <message>
        <source>Laser OFF (M5 S0)</source>
        <translation>Выключить лазер (M5 S0)</translation>
    </message>
    <message>
        <source>Toggle Spindle / Laser ($32)</source>
        <translation>Переключить Шпиндель / Лазер ($32)</translation>
    </message>
    <message>
        <source>Laser test pulse</source>
        <translation>Тестовый импульс лазера</translation>
    </message>
</context>
<context>
    <name>pluginSpindleLaserSettings</name>
    <message>
        <source>Spindle / Laser</source>
        <translation>Шпиндель / Лазер</translation>
    </message>
    <message>
        <source>Focus power (S):</source>
        <translation>Мощность фокуса (S):</translation>
    </message>
    <message>
        <source>Pulse S / Time (ms):</source>
        <translation>Импульс S / Время (мс):</translation>
    </message>
    <message>
        <source>Tool change: on every switch the plugin writes $32 together with the speed/power limits $30/$31 from Candle "Machine info" as ONE direct batch: M5, $32, $30, $31. No read-back: the values are applied right away, and editing "Machine info" takes effect on the next switch. The speed slider follows the active tool.</source>
        <translation>Смена инструмента: при каждом переключении плагин ОДНОЙ посылкой пишет $32 вместе с лимитами скорости/мощности $30/$31 из вкладки «Информация о станке» (мин/макс шпинделя, мин/макс лазера): M5, $32, $30, $31. Без предварительного чтения — значения подставляются сразу; правка «Информации о станке» действует со следующего переключения. Слайдер скоростей следует за активным инструментом.</translation>
    </message>
</context>
</TS>
