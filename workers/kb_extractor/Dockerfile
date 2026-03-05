# KB Extractor Worker — PyMuPDF-based PDF text extraction
FROM python:3.12-slim

WORKDIR /app

# System deps for PyMuPDF
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Security: non-root
RUN useradd -m -u 1000 worker
USER worker

CMD ["python", "main.py"]
