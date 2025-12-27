# AidMind NER Service

Microsoft Presidio-based Named Entity Recognition service for PHI/PII redaction.

## Quick Start

### Using Docker (Recommended)

```bash
cd presidio-service

# Build and run
docker-compose up -d

# Check health
curl http://localhost:8001/health
```

### Local Development

```bash
cd presidio-service

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
# or: venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Download spaCy model
python -m spacy download en_core_web_sm

# Run server
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

## API Endpoints

### GET /health

Health check endpoint.

**Response:**
```json
{"status": "ok"}
```

### POST /redact-ner

Perform NER-based redaction.

**Request:**
```json
{
  "session_id": "abc-123",
  "text": "John Smith called from New York about his appointment.",
  "language": "en",
  "entities": ["PERSON", "LOCATION", "ORGANIZATION", "DATE"]
}
```

**Response:**
```json
{
  "redacted_text": "[PERSON_1] called from [LOCATION_1] about his appointment.",
  "counts": {
    "PERSON": 1,
    "LOCATION": 1,
    "ORGANIZATION": 0,
    "DATE": 0
  },
  "spans": [
    {"entity_type": "PERSON", "start": 0, "end": 10},
    {"entity_type": "LOCATION", "start": 24, "end": 32}
  ]
}
```

## Security

- **No PHI logging**: Request bodies are never logged
- **Ephemeral processing**: No text is persisted to disk
- **Read-only container**: Docker runs in read-only mode
- **Non-root user**: Container runs as unprivileged user

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| LOG_LEVEL | Logging level | INFO |

## Integration

The main AidMind backend calls this service at:

```
PRESIDIO_SERVICE_URL=http://localhost:8001
```

If the service is unavailable, the redaction pipeline continues (Layer 2 is skipped).
