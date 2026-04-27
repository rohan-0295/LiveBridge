# ml-engine/main.py — LiveBridge Triage Engine V4 (Final Edition)
# ✅ Part 2 ML: lifespan() pre-warms HuggingFace BART model on startup
# ✅ Part 2 ML: Groq 429 rate-limit and timeout → graceful fallback, never crashes
# ✅ Part 2 ML: /predict always returns JSON (never 500) so Node SOS route stays alive
# ✅ Part 2 ML: /predict-text returns cached fallback during HF cold start

import os
import asyncio
import joblib
import pandas as pd
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx

load_dotenv()

# ── API keys ──────────────────────────────────────────────────────────────────
HF_TOKEN   = os.getenv("HUGGINGFACE_API_TOKEN", "")
GROQ_KEY   = os.getenv("GROQ_API_KEY", "")
HF_MODEL   = "facebook/bart-large-mnli"
GROQ_MODEL = "llama-3.1-8b-instant"

# ── Severity labels for HF zero-shot ─────────────────────────────────────────
SEVERITY_LABELS = [
    "Critical emergency requiring immediate life-saving intervention",
    "High severity requiring urgent medical attention",
    "Medium severity requiring prompt medical care",
    "Low severity requiring routine medical care",
]
LABEL_TO_SCORE = {
    "Critical emergency requiring immediate life-saving intervention": "Critical",
    "High severity requiring urgent medical attention":                "High",
    "Medium severity requiring prompt medical care":                   "High",
    "Low severity requiring routine medical care":                     "Low",
}

# ── Global model state ────────────────────────────────────────────────────────
model              = None
FEATURE_COLS       = None
FEATURE_MAPPING    = None
hf_model_warmed_up = False


# ── STARTUP: pre-load RF model + warm HF BART ─────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Runs ONCE before the server accepts any requests.
    1. Loads RandomForest from disk (synchronous — must finish before serving).
    2. Fires async HF warm-up in background so the first real prediction is instant.
    """
    global model, FEATURE_COLS, FEATURE_MAPPING

    # Load RandomForest bundle
    # Load RandomForest bundle
    # Load RandomForest bundle (Bulletproof Loader)
    try:
        bundle = joblib.load("triage_model.pkl")
        
        # 1. Handle if train.py saved it as a dictionary
        if isinstance(bundle, dict):
            model           = bundle.get("model", bundle)
            FEATURE_COLS    = bundle.get("feature_cols", [])
            FEATURE_MAPPING = bundle.get("feature_mapping", {})
            
        # 2. Handle if train.py saved it as a list containing a single dictionary
        elif isinstance(bundle, list) and len(bundle) == 1 and isinstance(bundle[0], dict):
            model           = bundle[0].get("model")
            FEATURE_COLS    = bundle[0].get("feature_cols", [])
            FEATURE_MAPPING = bundle[0].get("feature_mapping", {})
            
        # 3. Handle if train.py saved it as a strict list [model, cols, mapping]
        elif isinstance(bundle, list) and len(bundle) >= 3:
            model           = bundle[0]
            FEATURE_COLS    = bundle[1]
            FEATURE_MAPPING = bundle[2]
            
        # 4. Handle if train.py just saved the raw model object directly
        # 4. Handle if train.py just saved the raw model object directly
        else:
            model = bundle
            # Safely grab the exact columns the model was trained on
            FEATURE_COLS = list(getattr(model, "feature_names_in_", [
                "age_group", "is_diabetic", "cardiac_history", "chest_pain_indicator",
                "consciousness", "breathing", "blood_loss", "incident_type",
                "victim_count", "scene_hazard", "vulnerability_index", "trauma_triad", "scene_chaos"
            ]))
            
            # Inject the missing text-to-number translation dictionary
            FEATURE_MAPPING = {
                "age_group":     {"adult": 0, "geriatric": 1, "pediatric": 2},
                "consciousness": {"altered": 0, "awake": 1, "unconscious": 2},
                "breathing":     {"absent": 0, "labored": 1, "normal": 2},
                "blood_loss":    {"moderate": 0, "none": 1, "severe": 2},
                "incident_type": {"medical": 0, "trauma": 1},
                "victim_count":  {"single": 0, "multiple": 1, "mass": 2}
            }

        print("🧠 RandomForest triage model loaded OK")
    except Exception as e:
        print(f"⚠️  Could not load triage_model.pkl: {e}")
        print("   Run: python train.py  to generate it first.")

    # Pre-warm HF BART asynchronously (non-blocking — server becomes live immediately)
    if HF_TOKEN:
        asyncio.create_task(_warm_up_hf_model())
    else:
        print("⚠️  HUGGINGFACE_API_TOKEN not set — skipping HF warm-up")

    yield   # server starts accepting requests here

    print("👋 ML engine shutting down")


async def _warm_up_hf_model():
    """
    Sends a dummy payload to HF so BART is loaded into their inference workers.
    After this, real requests get sub-second responses instead of 20s cold starts.
    Non-fatal — startup completes regardless of whether this succeeds.
    """
    global hf_model_warmed_up
    print("🔥 HuggingFace BART warm-up → starting...")
    try:
        async with httpx.AsyncClient(timeout=65.0) as client:
            r = await client.post(
                f"https://api-inference.huggingface.co/models/{HF_MODEL}",
                headers={"Authorization": f"Bearer {HF_TOKEN}"},
                json={
                    "inputs":     "patient unresponsive, severe bleeding from leg",
                    "parameters": {"candidate_labels": SEVERITY_LABELS, "multi_label": False},
                },
            )
        if r.status_code == 200:
            hf_model_warmed_up = True
            print("🔥 HuggingFace BART warm-up ✅ — model is hot")
        elif r.status_code == 503:
            print("🔥 HuggingFace BART still loading on their servers (503) — will retry on first request")
        else:
            print(f"⚠️  HF warm-up got status {r.status_code}")
    except Exception as e:
        print(f"⚠️  HF warm-up failed (non-fatal): {e}")


# ── FastAPI app ────────────────────────────────────────────────────────────────
app = FastAPI(title="LiveBridge Triage Engine V4", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schemas ───────────────────────────────────────────────────────────────────
class EmergencyRequest(BaseModel):
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
    text: str

class ChatRequest(BaseModel):
    user_message:   str
    severity_score: str = "Unknown"

@app.post("/predict")
async def predict_triage(req: EmergencyRequest):
    if model is None:
        print("⚠️  /predict called but model not loaded — returning Unknown")
        return {"severity_score": "Unknown", "confidence": 0, "fallback": True,
                "message": "ML model not loaded. Run python train.py first."}
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
                print(f"⚠️  Unknown value '{val}' for '{col}' — using 0")
                return 0
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

        df         = pd.DataFrame([raw])[FEATURE_COLS]
        prediction = model.predict(df)[0]
        proba      = model.predict_proba(df)[0]
        confidence = round(float(max(proba)) * 100, 1)
        sev_map    = {"low": "Low", "medium": "High", "high": "High", "critical": "Critical"}
        severity   = sev_map.get(str(prediction).lower(), str(prediction))

        return {
            "severity_score":      severity,
            "confidence":          confidence,
            "vulnerability_score": int(vulnerability_index),
            "chaos_flag":          bool(scene_chaos),
            "trauma_triad":        bool(trauma_triad),
        }

    except Exception as e:
        # Return Unknown gracefully — SOS route must not crash
        print(f"⚠️  /predict runtime error: {e} — returning Unknown")
        return {"severity_score": "Unknown", "confidence": 0, "fallback": True, "error": str(e)}




@app.post("/predict-text")
async def predict_text_triage(req: TextTriageRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="'text' field cannot be empty.")

    if not HF_TOKEN:
        return {"severity_score": "Unknown", "confidence": 0, "fallback": True,
                "message": "HUGGINGFACE_API_TOKEN not configured."}

    try:
        async with httpx.AsyncClient(timeout=35.0) as client:
            response = await client.post(
                f"https://api-inference.huggingface.co/models/{HF_MODEL}",
                headers={"Authorization": f"Bearer {HF_TOKEN}"},
                json={
                    "inputs":     req.text,
                    "parameters": {"candidate_labels": SEVERITY_LABELS, "multi_label": False},
                },
            )

        if response.status_code == 503:
            # Still loading — non-fatal fallback
            print("⚠️  HF BART cold start (503) — returning Unknown")
            return {"severity_score": "Unknown", "confidence": 0, "fallback": True,
                    "message": "HuggingFace model warming up. Retry in ~20 seconds."}

        if response.status_code == 429:
            return {"severity_score": "Unknown", "confidence": 0, "fallback": True,
                    "message": "HuggingFace rate limit. Please retry."}

        if response.status_code != 200:
            return {"severity_score": "Unknown", "confidence": 0, "fallback": True,
                    "message": f"HuggingFace API error {response.status_code}"}

        result     = response.json()
        top_label  = result["labels"][0]
        top_score  = result["scores"][0]
        severity   = LABEL_TO_SCORE.get(top_label, "Unknown")
        confidence = round(top_score * 100, 1)

        global hf_model_warmed_up
        hf_model_warmed_up = True
        print(f"✅ HF zero-shot: '{req.text[:50]}…' → {severity} ({confidence}%)")

        return {
            "severity_score": severity,
            "confidence":     confidence,
            "raw_label":      top_label,
            "model":          HF_MODEL,
            "all_scores": [
                {"label": LABEL_TO_SCORE.get(lbl, "Unknown"), "raw": lbl, "score": round(sc * 100, 1)}
                for lbl, sc in zip(result["labels"], result["scores"])
            ],
        }

    except httpx.TimeoutException:
        return {"severity_score": "Unknown", "confidence": 0, "fallback": True,
                "message": "HuggingFace timed out."}
    except Exception as e:
        print(f"⚠️  /predict-text error: {e}")
        return {"severity_score": "Unknown", "confidence": 0, "fallback": True, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# /emergency-chat — Groq AI Operator (with rate-limit fallback)
# ═══════════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """You are an AI-assisted 911 Emergency Operator for LiveBridge.
RULES: 2-3 sentences max. Give one clear First Aid instruction. Calm authoritative tone.
NEVER diagnose. End every message confirming help is on the way."""

# Static fallbacks for when Groq is unavailable — keyed by severity
GROQ_FALLBACKS = {
    "Critical": "Emergency services are en route — do NOT move. Apply firm pressure to any bleeding with your hands and keep still. Help is almost there.",
    "High":     "Help is on the way — stay calm and keep still. If safe, sit down and focus on slow steady breathing. Paramedics will arrive shortly.",
    "Low":      "I can see your SOS and help is coming. Stay where you are and remain as calm as you can. Paramedics are en route to your location.",
    "Unknown":  "Emergency services have your location and are on the way. Stay calm, stay still, and stay on the line.",
}

@app.post("/emergency-chat")
async def emergency_chat(req: ChatRequest):
    if not req.user_message.strip():
        raise HTTPException(status_code=400, detail="'user_message' cannot be empty.")

    # No Groq key — return static fallback immediately (not an error)
    if not GROQ_KEY:
        return {"response": GROQ_FALLBACKS.get(req.severity_score, GROQ_FALLBACKS["Unknown"]),
                "severity_score": req.severity_score, "model": "fallback", "tokens_used": 0, "fallback": True}

    try:
        async with httpx.AsyncClient(timeout=18.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_KEY}", "Content-Type": "application/json"},
                json={
                    "model":       GROQ_MODEL,
                    "messages":    [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user",   "content": f"[Severity={req.severity_score}] {req.user_message}"},
                    ],
                    "max_tokens":  150,
                    "temperature": 0.4,
                },
            )

        # 429 rate-limit — use static fallback, no error shown to victim
        if response.status_code == 429:
            print("⚠️  Groq rate-limited — using static fallback")
            return {"response": GROQ_FALLBACKS.get(req.severity_score, GROQ_FALLBACKS["Unknown"]),
                    "severity_score": req.severity_score, "model": "fallback_429", "tokens_used": 0, "fallback": True}

        if response.status_code == 401:
            raise HTTPException(status_code=401, detail="Invalid GROQ_API_KEY.")

        if response.status_code != 200:
            print(f"⚠️  Groq {response.status_code} — using fallback")
            return {"response": GROQ_FALLBACKS.get(req.severity_score, GROQ_FALLBACKS["Unknown"]),
                    "severity_score": req.severity_score, "model": f"fallback_{response.status_code}", "tokens_used": 0, "fallback": True}

        data    = response.json()
        message = data["choices"][0]["message"]["content"].strip()
        tokens  = data.get("usage", {}).get("total_tokens", 0)
        print(f"✅ Groq ({tokens} tokens): {message[:70]}…")

        return {"response": message, "severity_score": req.severity_score,
                "model": GROQ_MODEL, "tokens_used": tokens}

    except httpx.TimeoutException:
        print("⚠️  Groq timeout — using static fallback")
        return {"response": GROQ_FALLBACKS.get(req.severity_score, GROQ_FALLBACKS["Unknown"]),
                "severity_score": req.severity_score, "model": "fallback_timeout", "tokens_used": 0, "fallback": True}
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️  /emergency-chat error: {e}")
        return {"response": GROQ_FALLBACKS.get(req.severity_score, GROQ_FALLBACKS["Unknown"]),
                "severity_score": req.severity_score, "model": "fallback_error", "tokens_used": 0, "fallback": True}



@app.get("/")
async def health():
    return {
        "status":          "LiveBridge Triage Engine V4",
        "model_loaded":    model is not None,
        "hf_configured":   bool(HF_TOKEN),
        "hf_warmed_up":    hf_model_warmed_up,
        "groq_configured": bool(GROQ_KEY),
        "endpoints":       ["/predict", "/predict-text", "/emergency-chat"],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, reload=False)