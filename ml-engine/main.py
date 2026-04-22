# ml-engine/main.py
# LiveBridge Triage Engine V3
# Endpoints:
#   POST /predict          — ML model triage (existing)
#   POST /predict-text     — Zero-shot triage via HuggingFace (new)
#   POST /emergency-chat   — AI 911 Operator via Groq (new)
#   GET  /                 — Health check

import os
import re
import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx

load_dotenv()

# ── API keys from .env ────────────────────────────────────────────────────
HF_TOKEN   = os.getenv("HUGGINGFACE_API_TOKEN", "")   # Hugging Face token
GROQ_KEY   = os.getenv("GROQ_API_KEY", "")            # Groq API key

HF_MODEL   = "facebook/bart-large-mnli"
GROQ_MODEL = "llama-3.1-8b-instant"

# ── FastAPI setup ─────────────────────────────────────────────────────────
app = FastAPI(title="LiveBridge Triage Engine V3")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Load ML model bundle (from train.py) ──────────────────────────────────
try:
    bundle          = joblib.load("triage_model.pkl")
    model           = bundle["model"]
    FEATURE_COLS    = bundle["feature_cols"]
    FEATURE_MAPPING = bundle["feature_mapping"]
    print("🧠 ML model loaded successfully!")
except Exception as e:
    print(f"⚠️  Could not load triage_model.pkl: {e}")
    print("   Run: python train.py  to generate it first.")
    model = None


# ══════════════════════════════════════════════════════════════════════════
# SCHEMAS
# ══════════════════════════════════════════════════════════════════════════

class EmergencyRequest(BaseModel):
    """Structured vitals — used by the existing /predict endpoint."""
    blood_loss:           str = "None"
    consciousness:        str = "Awake"
    breathing:            str = "Normal"
    age_group:            str = "Adult"
    is_diabetic:          int = 0
    cardiac_history:      int = 0
    chest_pain_indicator: int = 0
    incident_type:        str = "Medical"
    victim_count:         str = "Single"
    scene_hazard:         int = 0


class TextTriageRequest(BaseModel):
    """Free-text dispatcher notes — used by /predict-text (HuggingFace)."""
    text: str


class ChatRequest(BaseModel):
    """Victim message + current severity — used by /emergency-chat (Groq)."""
    user_message:   str
    severity_score: str = "Unknown"


# ══════════════════════════════════════════════════════════════════════════
# ENDPOINT 1 (existing): Structured ML Triage
# ══════════════════════════════════════════════════════════════════════════

@app.post("/predict")
async def predict_triage(req: EmergencyRequest):
    """Random-Forest triage from structured vitals."""
    if model is None:
        raise HTTPException(status_code=503, detail="ML model not loaded. Run train.py first.")

    try:
        age      = req.age_group.lower()
        consc    = req.consciousness.lower()
        breath   = req.breathing.lower()
        blood    = req.blood_loss.lower()
        incident = req.incident_type.lower()
        victim   = req.victim_count.lower()

        age_score           = 1 if age in ["pediatric", "geriatric"] else 0
        vulnerability_index = age_score + req.is_diabetic + (req.cardiac_history * 2)
        trauma_triad        = 1 if (blood == "severe" and breath in ["labored", "absent"]) else 0
        scene_chaos         = 1 if (req.scene_hazard == 1 or victim in ["multiple", "mass"]) else 0

        def enc(col, val):
            mapped = FEATURE_MAPPING.get(col, {}).get(val)
            if mapped is None:
                raise ValueError(f"Unknown value '{val}' for '{col}'")
            return mapped

        raw = {
            "age_group":            enc("age_group",    age),
            "is_diabetic":          req.is_diabetic,
            "cardiac_history":      req.cardiac_history,
            "chest_pain_indicator": req.chest_pain_indicator,
            "consciousness":        enc("consciousness", consc),
            "breathing":            enc("breathing",     breath),
            "blood_loss":           enc("blood_loss",    blood),
            "incident_type":        enc("incident_type", incident),
            "victim_count":         enc("victim_count",  victim),
            "scene_hazard":         req.scene_hazard,
            "vulnerability_index":  vulnerability_index,
            "trauma_triad":         trauma_triad,
            "scene_chaos":          scene_chaos,
        }

        df           = pd.DataFrame([raw])[FEATURE_COLS]
        prediction   = model.predict(df)[0]
        proba        = model.predict_proba(df)[0]
        confidence   = round(float(max(proba)) * 100, 1)

        severity_map = {"low": "Low", "medium": "High", "high": "High", "critical": "Critical"}
        severity     = severity_map.get(str(prediction).lower(), str(prediction))

        return {
            "severity_score":      severity,
            "confidence":          confidence,
            "vulnerability_score": int(vulnerability_index),
            "chaos_flag":          bool(scene_chaos),
            "trauma_triad":        bool(trauma_triad),
        }

    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ══════════════════════════════════════════════════════════════════════════
# ENDPOINT 2 (NEW): Zero-Shot Text Triage via HuggingFace
# ══════════════════════════════════════════════════════════════════════════

SEVERITY_LABELS = [
    "Critical emergency requiring immediate life-saving intervention",
    "High severity requiring urgent medical attention",
    "Medium severity requiring prompt medical care",
    "Low severity requiring routine medical care",
]

LABEL_TO_SCORE = {
    "Critical emergency requiring immediate life-saving intervention": "Critical",
    "High severity requiring urgent medical attention":                "High",
    "Medium severity requiring prompt medical care":                   "High",   # merge Medium → High
    "Low severity requiring routine medical care":                     "Low",
}

@app.post("/predict-text")
async def predict_text_triage(req: TextTriageRequest):
    """
    Zero-shot classification on free-form dispatcher notes.
    Uses facebook/bart-large-mnli via the HuggingFace Inference API.
    No training data needed — the model reads natural language directly.
    """
    if not HF_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="HUGGINGFACE_API_TOKEN not set in .env — cannot call HuggingFace API."
        )
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="'text' field cannot be empty.")

    hf_url     = f"https://api-inference.huggingface.co/models/{HF_MODEL}"
    hf_payload = {
        "inputs":     req.text,
        "parameters": {
            "candidate_labels":   SEVERITY_LABELS,
            "multi_label":        False,
        },
    }
    headers = {"Authorization": f"Bearer {HF_TOKEN}"}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(hf_url, json=hf_payload, headers=headers)

        if response.status_code == 503:
            # Model is loading — HuggingFace cold-start
            raise HTTPException(
                status_code=503,
                detail="HuggingFace model is warming up (cold start). Retry in ~20 seconds."
            )
        if response.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"HuggingFace API error {response.status_code}: {response.text[:200]}"
            )

        result      = response.json()
        top_label   = result["labels"][0]
        top_score   = result["scores"][0]
        severity    = LABEL_TO_SCORE.get(top_label, "Unknown")
        confidence  = round(top_score * 100, 1)

        print(f"✅ Zero-shot triage: '{req.text[:60]}...' → {severity} ({confidence}%)")

        return {
            "severity_score": severity,
            "confidence":     confidence,
            "raw_label":      top_label,
            "model":          HF_MODEL,
            "all_scores": [
                {
                    "label":    LABEL_TO_SCORE.get(lbl, "Unknown"),
                    "raw":      lbl,
                    "score":    round(sc * 100, 1),
                }
                for lbl, sc in zip(result["labels"], result["scores"])
            ],
        }

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="HuggingFace API timed out. Try again.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


# ══════════════════════════════════════════════════════════════════════════
# ENDPOINT 3 (NEW): AI Emergency Operator via Groq
# ══════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """You are an AI-assisted 911 Emergency Operator for the LiveBridge emergency response platform.

STRICT RULES — follow every rule on every response:
1. Keep your response to 2–3 sentences MAXIMUM. Brevity saves lives.
2. Provide one clear, actionable First Aid stabilization instruction.
3. Use a calm, authoritative, reassuring tone — never panic the caller.
4. NEVER diagnose the patient. Never say "you have", "this is", or "it sounds like [condition]".
5. Always end by confirming that help is on the way.
6. If the user says something unrelated to the emergency, gently redirect them.

You have access to the AI triage severity score. Use it to calibrate urgency."""

@app.post("/emergency-chat")
async def emergency_chat(req: ChatRequest):
    """
    AI 911 Dispatcher powered by Groq (llama-3.1-8b-instant).
    Provides calm, concise first-aid guidance while help is en route.
    """
    if not GROQ_KEY:
        raise HTTPException(
            status_code=503,
            detail="GROQ_API_KEY not set in .env — cannot call Groq API."
        )
    if not req.user_message.strip():
        raise HTTPException(status_code=400, detail="'user_message' cannot be empty.")

    # Inject severity context into the user turn
    severity_context = (
        f"[System context: Current AI triage severity = {req.severity_score}. "
        f"Adjust urgency accordingly.]\n\n"
        f"Caller says: {req.user_message}"
    )

    groq_payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": severity_context},
        ],
        "max_tokens":   150,   # enforce brevity at the API level
        "temperature":  0.4,   # low temp = consistent, calm tone
        "top_p":        0.9,
    }
    headers = {
        "Authorization": f"Bearer {GROQ_KEY}",
        "Content-Type":  "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                json=groq_payload,
                headers=headers,
            )

        if response.status_code == 401:
            raise HTTPException(status_code=401, detail="Invalid GROQ_API_KEY.")
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="Groq rate limit reached. Retry in a moment.")
        if response.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Groq API error {response.status_code}: {response.text[:200]}"
            )

        data       = response.json()
        ai_message = data["choices"][0]["message"]["content"].strip()
        tokens     = data.get("usage", {}).get("total_tokens", 0)

        print(f"✅ Emergency chat response ({tokens} tokens): {ai_message[:80]}...")

        return {
            "response":       ai_message,
            "severity_score": req.severity_score,
            "model":          GROQ_MODEL,
            "tokens_used":    tokens,
        }

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Groq API timed out.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


# ══════════════════════════════════════════════════════════════════════════
# HEALTH CHECK
# ══════════════════════════════════════════════════════════════════════════

@app.get("/")
def health():
    return {
        "status":        "LiveBridge Triage Engine V3 running",
        "model_loaded":  model is not None,
        "hf_configured": bool(HF_TOKEN),
        "groq_configured": bool(GROQ_KEY),
        "endpoints": ["/predict", "/predict-text", "/emergency-chat"],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, reload=False)
