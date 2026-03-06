# KB Extractor Service — Flask supervisor + PyMuPDF worker
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev \
    && rm -rf /var/lib/apt/lists/*

COPY workers/kb_extractor_service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY workers/kb_extractor /app/workers/kb_extractor
COPY workers/kb_extractor_service/app.py /app/app.py

RUN useradd -m -u 1000 worker
USER worker

CMD ["gunicorn","-b","0.0.0.0:8080","app:app","--workers","1","--threads","2","--timeout","1200","--graceful-timeout","30","--max-requests","100","--max-requests-jitter","20"]
