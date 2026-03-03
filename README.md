# FastAPI Log Analyzer

Анализатор лог-файлов PryzivaNetTerminalAddon.

---

## Конфигурация

Все параметры задаются в одном файле — **`.env`** в корне проекта.
Приложение читает его автоматически при запуске. Файл не должен попадать в git.

### Параметры `.env`

#### Сервер

| Параметр | По умолчанию | Описание |
|----------|-------------|----------|
| `HOST` | `127.0.0.1` | Адрес, на котором слушает сервер. На хостинге обычно `0.0.0.0` — доступен снаружи |
| `PORT` | `8000` | Порт сервера. Если хостинг требует другой порт — меняйте здесь |
| `DEBUG` | `false` | Режим отладки. На продакшене всегда `false` |

#### Аутентификация

| Параметр | По умолчанию | Описание |
|----------|-------------|----------|
| `SESSION_SECRET` | генерируется случайно | Секретный ключ для подписи сессий. **Обязательно задать на хостинге** — без него при каждом перезапуске сервера все пользователи будут разлогинены |

Сгенерировать ключ:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

#### База данных (PostgreSQL)

| Параметр | По умолчанию | Описание |
|----------|-------------|----------|
| `DATABASE_URL` | `postgresql+psycopg2://analyzer:analyzer_secret@localhost:5432/log_analyzer` | Строка подключения к PostgreSQL |

Формат строки подключения:
```
postgresql+psycopg2://ПОЛЬЗОВАТЕЛЬ:ПАРОЛЬ@ХОСТ:ПОРТ/БАЗА_ДАННЫХ
```

На хостинге нужно заменить `localhost` на адрес сервера БД, а `analyzer`/`analyzer_secret` — на реальные учётные данные.

#### Папка с лог-файлами

| Параметр | По умолчанию | Описание |
|----------|-------------|----------|
| `LOG_FOLDER` | `logs` | Путь к папке с `.log` файлами. Можно указать абсолютный путь: `/var/data/logs` |

#### Yandex Object Storage (S3) — необязательно

Если задать все три параметра (`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`), включится автоматическая синхронизация логов из облачного хранилища.

| Параметр | По умолчанию | Описание |
|----------|-------------|----------|
| `S3_ENDPOINT` | `https://storage.yandexcloud.net` | URL эндпоинта S3-совместимого хранилища |
| `S3_ACCESS_KEY` | — | Access Key (ключ доступа) |
| `S3_SECRET_KEY` | — | Secret Key (секретный ключ) |
| `S3_BUCKET` | — | Имя бакета |
| `S3_PREFIX` | `logs` | Папка внутри бакета |
| `S3_SYNC_INTERVAL` | `3600` | Интервал синхронизации в секундах (3600 = 1 час) |

---

### Пример `.env` для хостинга

```dotenv
# Сервер
HOST=0.0.0.0
PORT=8000
DEBUG=false

# Сессии
SESSION_SECRET=вставьте_сгенерированный_ключ_сюда

# PostgreSQL
DATABASE_URL=postgresql+psycopg2://myuser:mypassword@db-host:5432/log_analyzer

# Папка с логами
LOG_FOLDER=/var/data/logs

# S3 (если нужна синхронизация из облака)
S3_ENDPOINT=https://storage.yandexcloud.net
S3_ACCESS_KEY=ваш_access_key
S3_SECRET_KEY=ваш_secret_key
S3_BUCKET=имя-бакета
S3_PREFIX=logs
S3_SYNC_INTERVAL=3600
```

---

## Установка и запуск

### 1. Зависимости Python

```bash
pip install -r requirements.txt
```

### 2. База данных PostgreSQL

Создать пользователя и базу:
```sql
CREATE USER analyzer WITH PASSWORD 'analyzer_secret';
CREATE DATABASE log_analyzer OWNER analyzer;
```

Таблицы создаются автоматически при первом запуске.

### 3. Сборка фронтенда

```bash
cd frontend
npm install
npm run build
```

Собранные файлы попадают в `static/dist/` — FastAPI отдаёт их напрямую.

### 4. Запуск

```bash
python run.py
```

Сервер откроется по адресу `http://HOST:PORT`.
По умолчанию: [http://127.0.0.1:8000](http://127.0.0.1:8000)

---

## Файловая структура

```
.env                   ← вся конфигурация (не в git)
run.py                 ← точка входа
app/
  config.py            ← читает .env, экспортирует константы
  main.py              ← FastAPI приложение, все API эндпоинты
  database.py          ← работа с БД (SQLAlchemy ORM)
  models.py            ← ORM-модели таблиц
  db.py                ← engine, SessionLocal, init_db
  auth.py              ← аутентификация, управление сессиями
  log_analyzer.py      ← парсинг лог-файлов
  s3_sync.py           ← синхронизация из S3
logs/                  ← лог-файлы для анализа (задаётся LOG_FOLDER)
static/dist/           ← собранный React SPA
frontend/              ← исходники React (Vite + TypeScript + Tailwind)
```

---

## Учётные данные по умолчанию

После первого запуска создаются два системных аккаунта:

| Логин | Пароль | Роль |
|-------|--------|------|
| `admin` | `admin123` | Администратор |
| `viewer` | `viewer123` | Просмотр |

**Смените пароли сразу после развёртывания** через страницу «Аккаунты».
