"""
AidMind NER Service - Microsoft Presidio-based PII/PHI redaction microservice.

SECURITY NOTES:
- No request body logging
- No PHI persisted to disk
- Ephemeral text processing only
"""

import logging
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

# Configure logging - NO request body logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Suppress detailed presidio logs
logging.getLogger("presidio-analyzer").setLevel(logging.WARNING)
logging.getLogger("presidio-anonymizer").setLevel(logging.WARNING)

app = FastAPI(
    title="AidMind NER Service",
    description="Presidio-based NER redaction for PHI/PII minimization",
    version="1.0.0"
)

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Presidio engines at startup
analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()


class RedactRequest(BaseModel):
    session_id: str
    text: str
    language: str = "en"
    entities: List[str] = ["PERSON", "LOCATION", "ORGANIZATION", "DATE_TIME"]


class SpanInfo(BaseModel):
    entity_type: str
    start: int
    end: int


class RedactResponse(BaseModel):
    redacted_text: str
    counts: dict
    spans: List[SpanInfo]


class HealthResponse(BaseModel):
    status: str


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


@app.post("/redact-ner", response_model=RedactResponse)
async def redact_ner(request: RedactRequest):
    """
    Perform NER-based redaction using Microsoft Presidio.
    
    - Detects PERSON, LOCATION, ORGANIZATION, DATE_TIME entities
    - Replaces with numbered placeholders: [PERSON_1], [LOCATION_1], etc.
    - Returns counts and span information (no original text)
    """
    # Log only session_id and text length - NEVER log the actual text
    logger.info(f"Processing redaction for session: {request.session_id}, text_length: {len(request.text)}")
    
    try:
        # Map our entity types to Presidio entity types
        entity_mapping = {
            "PERSON": "PERSON",
            "LOCATION": "LOCATION", 
            "ORGANIZATION": "ORGANIZATION",
            "DATE": "DATE_TIME",
            "DATE_TIME": "DATE_TIME"
        }
        
        presidio_entities = []
        for entity in request.entities:
            mapped = entity_mapping.get(entity.upper())
            if mapped:
                presidio_entities.append(mapped)
        
        # Analyze text for entities
        analyzer_results = analyzer.analyze(
            text=request.text,
            entities=presidio_entities,
            language=request.language
        )
        
        if not analyzer_results:
            logger.info(f"No entities detected for session: {request.session_id}")
            return RedactResponse(
                redacted_text=request.text,
                counts={entity: 0 for entity in request.entities},
                spans=[]
            )
        
        # Sort results by start position (descending) for proper replacement
        sorted_results = sorted(analyzer_results, key=lambda x: x.start, reverse=True)
        
        # Count entities by type and assign numbers
        entity_counters = {}
        entity_replacements = {}
        
        # First pass: count and assign numbers (process in order of appearance)
        for result in sorted(analyzer_results, key=lambda x: x.start):
            entity_type = result.entity_type
            
            # Normalize entity type for output
            output_type = entity_type
            if entity_type == "DATE_TIME":
                output_type = "DATE"
            
            if output_type not in entity_counters:
                entity_counters[output_type] = 0
            
            entity_counters[output_type] += 1
            
            # Create placeholder with consistent numbering
            if entity_type == "ORGANIZATION":
                placeholder = f"[ORG_{entity_counters[output_type]}]"
            else:
                placeholder = f"[{output_type}_{entity_counters[output_type]}]"
            
            entity_replacements[(result.start, result.end)] = placeholder
        
        # Second pass: replace entities in text (reverse order to maintain positions)
        redacted_text = request.text
        spans = []
        
        for result in sorted_results:
            placeholder = entity_replacements.get((result.start, result.end))
            if placeholder:
                redacted_text = (
                    redacted_text[:result.start] + 
                    placeholder + 
                    redacted_text[result.end:]
                )
                
                # Normalize entity type for span info
                span_type = result.entity_type
                if span_type == "DATE_TIME":
                    span_type = "DATE"
                
                spans.append(SpanInfo(
                    entity_type=span_type,
                    start=result.start,
                    end=result.end
                ))
        
        # Build counts object with requested entities
        counts = {}
        for entity in request.entities:
            normalized = entity.upper()
            if normalized == "DATE_TIME":
                normalized = "DATE"
            counts[entity] = entity_counters.get(normalized, 0)
        
        # Reverse spans to match original order
        spans.reverse()
        
        logger.info(f"Redaction complete for session: {request.session_id}, counts: {counts}")
        
        return RedactResponse(
            redacted_text=redacted_text,
            counts=counts,
            spans=spans
        )
        
    except Exception as e:
        logger.error(f"Redaction error for session {request.session_id}: {type(e).__name__}")
        raise HTTPException(status_code=500, detail="Internal redaction error")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
