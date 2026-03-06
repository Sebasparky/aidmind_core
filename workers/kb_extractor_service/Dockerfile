# KB Extractor Service — lightweight trigger for Cloud Run Job
FROM python:3.12-slim

WORKDIR /app

COPY workers/kb_extractor_service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY workers/kb_extractor_service/app.py /app/app.py

RUN useradd -m -u 1000 worker
USER worker

CMD ["gunicorn","-b","0.0.0.0:8080","app:app","--workers","1","--threads","2","--timeout","30","--graceful-timeout","10","--max-requests","500","--max-requests-jitter","50"]
