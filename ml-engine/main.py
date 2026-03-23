from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import joblib
import pandas as pd

app = FastAPI(title="LiveBridge Triage Engine V2")

# 1. Load the trained brain
try:
    model = joblib.load('triage_model.pkl')
    print("🧠 AI Brain Loaded Successfully!")
except:
    print("❌ ERROR: triage_model.pkl not found. Run train.py first!")

# 2. Define what the incoming Emergency Request looks like
class EmergencyRequest(BaseModel):
    age_group: str          # Pediatric, Adult, Geriatric
    is_diabetic: int        # 0 or 1
    cardiac_history: int    # 0 or 1
    chest_pain_indicator: int
    consciousness: str      # Awake, Altered, Unconscious
    breathing: str          # Normal, Labored, Absent
    blood_loss: str         # None, Moderate, Severe
    incident_type: str      # RTA, Cardiac, Fall, Medical, Fire
    victim_count: str       # Single, Multiple, Mass
    scene_hazard: int       # 0 or 1

# 3. The Mapping Dictionary (Must match train.py exactly)
feature_mapping = {
    'age_group': {'Pediatric': 0, 'Adult': 1, 'Geriatric': 2},
    'consciousness': {'Awake': 0, 'Altered': 1, 'Unconscious': 2},
    'breathing': {'Normal': 0, 'Labored': 1, 'Absent': 2},
    'blood_loss': {'None': 0, 'Moderate': 1, 'Severe': 2},
    'incident_type': {'RTA': 0, 'Cardiac': 1, 'Fall': 2, 'Medical': 3, 'Fire': 4},
    'victim_count': {'Single': 0, 'Multiple': 1, 'Mass': 2}
}

@app.post("/predict")
async def predict_triage(request: EmergencyRequest):
    try:
        # --- A. Feature Engineering (Calculating Super Columns on the fly) ---
        age_score = 1 if request.age_group in ['Pediatric', 'Geriatric'] else 0
        vulnerability_index = age_score + request.is_diabetic + (request.cardiac_history * 2)
        
        trauma_triad = 1 if (request.blood_loss == 'Severe' and request.breathing in ['Labored', 'Absent']) else 0
        
        scene_chaos = 1 if (request.scene_hazard == 1 or request.victim_count in ['Multiple', 'Mass']) else 0

        # --- B. Convert text inputs to numbers ---
        input_data = {
            'age_group': feature_mapping['age_group'][request.age_group],
            'is_diabetic': request.is_diabetic,
            'cardiac_history': request.cardiac_history,
            'chest_pain_indicator': request.chest_pain_indicator,
            'consciousness': feature_mapping['consciousness'][request.consciousness],
            'breathing': feature_mapping['breathing'][request.breathing],
            'blood_loss': feature_mapping['blood_loss'][request.blood_loss],
            'incident_type': feature_mapping['incident_type'][request.incident_type],
            'victim_count': feature_mapping['victim_count'][request.victim_count],
            'scene_hazard': request.scene_hazard,
            'vulnerability_index': vulnerability_index,
            'trauma_triad': trauma_triad,
            'scene_chaos': scene_chaos
        }

        # --- C. Run the AI Prediction ---
        df = pd.DataFrame([input_data])
        prediction = model.predict(df)[0]
        
        return {
            "severity": prediction,
            "vulnerability_score": vulnerability_index,
            "chaos_flag": bool(scene_chaos)
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)