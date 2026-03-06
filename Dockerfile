FROM python:3.13-slim

WORKDIR /app

# Системные зависимости (postgresql-client для pg_dump)
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*

# Зависимости
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Исходный код
COPY app/ ./app/
COPY static/ ./static/
COPY run.py .

# Папки для данных и логов (перекрываются volumes)
RUN mkdir -p logs data

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--log-level", "info"]
