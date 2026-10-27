# iFlipper

Быстрый, скриптуемый компаньон для **Flipper Zero** — всё, что умеет qFlipper, плюс то, чего он не умеет.

| | qFlipper | iFlipper |
|---|:-:|:-:|
| Инфо об устройстве, батарея, память | ✓ | ✓ (`info`, `--json`) |
| Файловый менеджер | ✓ | ✓ CLI + TUI |
| Обновление прошивки (официальные каналы) | ✓ | ✓ `update` |
| Кастомные прошивки (Unleashed, Momentum, …) из .tgz/URL | ~ | ✓ `update --file / --url` |
| Бэкап / восстановление | только `/int` | **вся флешка**, `.tar.gz`, инкрементально (`--since`) |
| Восстановление только изменённого / одной папки | ✗ | ✓ `restore --only /ext/nfc` |
| Синхронизация папок (как rsync, по MD5) | ✗ | ✓ `sync push/pull --delete --dry-run` |
| Стрим экрана + управление кнопками | ✓ (GUI) | ✓ прямо в терминале (TUI) |
| Скриншоты PNG | ✓ | ✓ `screenshot` |
| Макросы кнопок | ✗ | ✓ `press down down ok` |
| Python API / REPL / скрипты | ✗ | ✓ `shell`, `import iflipper` |
| Подключение по сети (TCP) | ✗ | ✓ `-p tcp://host:port` |
| Виртуальный Flipper без железа | ✗ | ✓ `emulate` |
| Работа по SSH / headless | ✗ | ✓ |

## Установка

```bash
pip install -e .          # Python 3.10+
iflipper --help
```

Linux: если нет доступа к порту — добавьте себя в группу `dialout` (`sudo usermod -aG dialout $USER`).

## Примеры

```bash
iflipper info                               # имя, прошивка, батарея, память
iflipper tui                                # полноэкранный дашборд: файлы, живой экран, лог
iflipper ls -l /ext/subghz
iflipper push garage.sub /ext/subghz        # загрузка с прогресс-баром
iflipper pull /ext/nfc ./nfc-dump           # скачать папку целиком
iflipper sync push ./my-badusb /ext/badusb --delete -n   # посмотреть, что изменится
iflipper backup                             # → Name-YYYYmmdd-HHMMSS.tar.gz
iflipper backup --since old.tar.gz          # не качать заново неизменённые файлы
iflipper restore backup.tar.gz --only /ext/nfc
iflipper update --check                     # доступные версии
iflipper update --channel rc
iflipper update --file ./unleashed-f7-update.tgz
iflipper screenshot                         # PNG
iflipper screenshot --text                  # прямо в терминал
iflipper press down down ok                 # макрос кнопок
iflipper app start "Sub-GHz" /ext/subghz/door.sub
iflipper time --sync                        # выставить часы
iflipper alert                              # найти «свой» флиппер: мигнёт, пискнет, вибрирует
```

Несколько флипперов: `iflipper devices`, затем `-p /dev/ttyACM1` (или `IFLIPPER_PORT`).

### TUI

`iflipper tui`: слева — устройство, батарея, заполненность SD/внутренней памяти, прогресс передачи.
**F1** файлы (`d` скачать, `u` загрузить, `n` папка, `Del` удалить, `r` обновить),
**F2** живой экран (стрелки, `Enter` = OK, `Backspace` = Back, `s` скриншот), **F3** лог.

### Python API

```python
from iflipper import Flipper

with Flipper.connect() as f:          # или Flipper.connect("tcp://127.0.0.1:7777")
    print(f.info()["firmware_version"])
    for top, dirs, files in f.walk("/ext/nfc"):
        print(top, [x.name for x in files])
    f.write("/ext/infrared/tv.ir", open("tv.ir", "rb").read())
    f.press("ok")
    png = f.screenshot()
```

`iflipper shell` открывает REPL с уже подключённым `f`; `iflipper shell script.py` выполняет скрипт.

### Виртуальный Flipper

```bash
iflipper emulate --pty            # создаёт /dev/pts/N — работает как настоящий USB-порт
iflipper emulate --tcp 7777       # iflipper -p tcp://127.0.0.1:7777 tui
```

Эмулятор говорит на настоящем RPC-протоколе: файловая система (`/ext`, `/int` — реальные папки на диске),
экран с меню, кнопки, приложения, часы, установка обновлений. Его используют тесты, и он удобен для разработки.

## Как это устроено

- `src/iflipper/rpc.py` — RPC поверх CLI Flipper: `start_rpc_session`, varint-кадры `PB.Main`, мультиплексирование по `command_id`, стриминг `has_next`.
- `src/iflipper/device.py` — высокоуровневый API (`Flipper`).
- `src/iflipper/sync.py`, `backup.py`, `update.py` — синхронизация, бэкапы, прошивки.
- `src/iflipper/cli.py`, `tui.py` — интерфейсы (click + rich, textual).
- `src/iflipper/emulator.py` — виртуальный Flipper.
- `proto/` — схемы [flipperzero-protobuf](https://github.com/flipperdevices/flipperzero-protobuf); биндинги пересобираются `scripts/gen_proto.sh`.

## Разработка

```bash
pip install -e '.[dev]'
pytest
```
