# KB Extractor Service — Flask supervisor + PyMuPDF worker
FROM python:3.12-slim

WORKDIR /app

# System deps for PyMuPDF
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps (service + worker)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy worker code
COPY ../kb_extractor/main.py /app/workers/kb_extractor/main.py

# Copy service code
COPY app.py .

# Security: non-root
RUN useradd -m -u 1000 worker
USER worker

# gunicorn: 1 worker, 2 threads, generous timeout, memory leak mitigation
CMD ["gunicorn", "-b", "0.0.0.0:8080", "app:app", \
     "--workers", "1", \
     "--threads", "2", \
     "--timeout", "1200", \
     "--graceful-timeout", "30", \
     "--max-requests", "100", \
     "--max-requests-jitter", "20"]
