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
    <message>
        <source>Mode: LASER ($32=1) - click to switch to SPINDLE</source>
        <translation>Режим: ЛАЗЕР ($32=1) — нажмите для переключения на ШПИНДЕЛЬ</translation>
    </message>
    <message>
        <source>Mode: SPINDLE ($32=0) - click to switch to LASER</source>
        <translation>Режим: ШПИНДЕЛЬ ($32=0) — нажмите для переключения на ЛАЗЕР</translation>
    </message>
    <message>
        <source>Tool change cancelled: invalid speed range in Machine info (min %1, max %2). Nothing was sent to the controller.</source>
        <translation>Смена инструмента отменена: недопустимый диапазон скоростей в «Информации о станке» (мин. %1, макс. %2). На контроллер ничего не отправлено.</translation>
    </message>
    <message>
        <source>Tool change will write $30: %1 -&gt; %2, $31: %3 -&gt; %4. Click the mode button again within 15 seconds to confirm.</source>
        <translation>Смена инструмента запишет $30: %1 -&gt; %2, $31: %3 -&gt; %4. Нажмите кнопку режима ещё раз в течение 15 секунд для подтверждения.</translation>
    </message>
    <message>
        <source>Tool mode changed, but applying $30/$31 failed. Check $30/$31 in the controller before using the machine.</source>
        <translation>Режим инструмента изменён, но применить $30/$31 не удалось. Проверьте $30/$31 в контроллере перед работой на станке.</translation>
    </message>
    <message>
        <source>Laser focus beam was turned OFF automatically after 5 minutes.</source>
        <translation>Луч фокусировки автоматически выключен через 5 минут.</translation>
    </message>
    <message>
        <source>Spindle / Laser</source>
        <translation>Шпиндель / Лазер</translation>
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
        <source>After GRBL acknowledges $32, the plugin sends $30 and $31 from Candle "Machine info". Both commands appear in the log even when a value is unchanged. The speed slider follows the active tool.</source>
        <translation>После подтверждения $32 плагин отправляет $30 и $31 из вкладки Candle «Информация о станке». Обе команды видны в журнале, даже если значение не меняется. Слайдер соответствует активному инструменту.</translation>
    </message>
</context>
</TS>
