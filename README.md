# Candle Spindle / Laser Switcher Plugin (`spindle_laser`)

Компактный плагин для **[Candle](https://github.com/Denvi/Candle)** (GRBL CNC Controller), позволяющий в один клик переключаться между режимами **Шпиндель (`$32=0`)** и **Лазер (`$32=1`)** с автоматическим скрытием лазерных кнопок при работе фрезой.

A compact plugin for **[Candle](https://github.com/Denvi/Candle)** that toggles between **Spindle (`$32=0`)** and **Laser (`$32=1`)** modes with a single button and automatically hides laser-specific controls when in Spindle mode.


<img width="456" height="133" alt="123" src="https://github.com/user-attachments/assets/113fc03d-320e-4a36-a4a0-1095dbd408b1" />


---

## RU — Описание и возможности

### Особенности
* **Одна кнопка-переключатель (Шпиндель ↔ Лазер):**
  * В режиме **Шпиндель (`$32=0`)** отображает иконку фрезы, отправляет `M5`, `S0`, `$32=0` и (опционально) прописывает обороты `$30` / `$31` для шпинделя.
  * В режиме **Лазер (`$32=1`)** меняет иконку на лазер, отправляет `M5`, `$32=1` и (опционально) прописывает максимальную/минимальную мощность `$30` / `$31` для лазера.
* **Умное скрытие кнопок лазера:**
  * Когда выбран режим **Шпиндель (`$32=0`)**, все кнопки управления лазером **скрыты**, чтобы не занимать место и исключить случайное включение луча во время фрезеровки.
  * Как только активируется режим **Лазер (`$32=1`)**, в том же ряду справа появляются 3 кнопки управления лазером:
    1. **Фокус (Focus)** — включает/выключает слабый тестовый луч для наведения и фокусировки (`G1 F1000 M3 S10` / `M5 S0`). Пока луч включён, кнопка подсвечивается жёлтым цветом.
    2. **Импульс (Pulse)** — подаёт короткую тестовую вспышку заданной мощности и длительности (по умолчанию `S100` на `200 мс`) для постановки контрольной точки.
    3. **Выкл (OFF)** — мгновенное отключение лазера (`M5 S0`).
* **Компактный размер без прокрутки:**
  * Панель выполнена в один ряд из 4 кнопок `48×48` (идентично штатным панелям «Система координат» и «Пользовательские команды»), не растягивает боковую панель Candle и не вызывает появление полос прокрутки.
* **Автоопределение режима при подключении:**
  * При соединении со станком плагин автоматически опрашивает `$$`, считывает текущее состояние `$32` из EEPROM контроллера Grbl и синхронизирует интерфейс.
* **Гибкие настройки и горячие клавиши:**
  * Собственная вкладка в **`Сервис → Настройки → Шпиндель / Лазер`** (`$30`/`$31` для шпинделя и лазера, мощность фокуса `S`, мощность и длительность импульса, автоопрос `$$`).
  * Поддержка назначения горячих клавиш в **`Сервис → Настройки → Сочетания клавиш`**.

### Установка
1. Скопируйте папку **`spindle_laser`** в директорию **`candleplugins`** вашей программы Candle:
   ```text
   Candle/
   └── candleplugins/
       ├── camera/
       ├── coordinatesystem/
       ├── emergencybutton/
       ├── usercommands/
       └── spindle_laser/        <-- сюда
           ├── images/
           ├── config.ini
           ├── script.js
           ├── settings.ui
           ├── translation_ru.qm
           ├── translation_ru.ts
           └── widget.ui
   ```
2. Перезапустите **Candle**.
3. Убедитесь, что панель включена в меню **«Окна» → «Панели» → «Шпиндель / Лазер»**.

---

## EN — Features & Installation

### Features
* **Single Toggle Button (Spindle ↔ Laser):**
  * **Spindle Mode (`$32=0`):** displays the endmill icon, sends `M5`, `S0`, `$32=0`, and optionally updates `$30`/`$31` to your spindle RPM range.
  * **Laser Mode (`$32=1`):** switches the button icon to a laser head, sends `M5`, `$32=1`, and optionally updates `$30`/`$31` to your laser power range.
* **Auto-Hiding Laser Controls:**
  * In **Spindle mode (`$32=0`)**, laser command buttons are completely hidden (`visible = false`).
  * In **Laser mode (`$32=1`)**, three laser buttons appear next to the mode toggle:
    1. **Focus** — toggles a low-power focusing beam (`G1 F1000 M3 S10` / `M5 S0`) and highlights the button in amber while the beam is active.
    2. **Pulse** — fires a short test pulse (`S100` for `200 ms` by default) to mark the origin on the workpiece.
    3. **OFF** — immediately turns the laser off (`M5 S0`).
* **Native Compact Layout:**
  * Single-row 4-column `StyledToolButton` (`48×48`) layout that fits Candle's side dock with zero horizontal or vertical scrollbars.
* **Auto-Sync with Grbl (`$$`):**
  * Queries `$$` on connection and listens to `$32=` responses to always reflect the real state of the controller.
* **Settings & Shortcuts:**
  * Configurable in **`Service → Settings → Spindle / Laser`** and supports keyboard shortcuts in **`Service → Settings → Shortcuts`**.

### Installation
1. Copy the **`spindle_laser`** folder into the **`candleplugins`** directory of your Candle installation.
2. Restart **Candle**.
3. Enable the panel via **Windows → Panels → Spindle / Laser** (if not enabled automatically).

---

## License
GPL-3.0 (compatible with Candle and Grbl).
