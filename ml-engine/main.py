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
    age_group: str          
    is_diabetic: int        
    cardiac_history: int    
    chest_pain_indicator: int
    consciousness: str      
    breathing: str          
    blood_loss: str         
    incident_type: str      
    victim_count: str       
    scene_hazard: int       

# 3. The Mapping Dictionary (Converted to lowercase to prevent matching errors!)
feature_mapping = {
    'age_group': {'pediatric': 0, 'adult': 1, 'geriatric': 2},
    'consciousness': {'awake': 0, 'altered': 1, 'unconscious': 2},
    'breathing': {'normal': 0, 'labored': 1, 'absent': 2},
    'blood_loss': {'none': 0, 'moderate': 1, 'severe': 2},
    'incident_type': {'rta': 0, 'cardiac': 1, 'fall': 2, 'medical': 3, 'fire': 4},
    'victim_count': {'single': 0, 'multiple': 1, 'mass': 2}
}

@app.post("/predict")
async def predict_triage(request: EmergencyRequest):
    try:
        # Force all incoming text to lowercase so it never fails
        age = request.age_group.lower()
        consc = request.consciousness.lower()
        breath = request.breathing.lower()
        blood = request.blood_loss.lower()
        incident = request.incident_type.lower()
        victim = request.victim_count.lower()

        # --- A. Feature Engineering ---
        age_score = 1 if age in ['pediatric', 'geriatric'] else 0
        vulnerability_index = age_score + request.is_diabetic + (request.cardiac_history * 2)
        
        trauma_triad = 1 if (blood == 'severe' and breath in ['labored', 'absent']) else 0
        
        scene_chaos = 1 if (request.scene_hazard == 1 or victim in ['multiple', 'mass']) else 0

        # --- B. Convert text inputs to numbers ---
        input_data = {
            'age_group': feature_mapping['age_group'][age],
            'is_diabetic': request.is_diabetic,
            'cardiac_history': request.cardiac_history,
            'chest_pain_indicator': request.chest_pain_indicator,
            'consciousness': feature_mapping['consciousness'][consc],
            'breathing': feature_mapping['breathing'][breath],
            'blood_loss': feature_mapping['blood_loss'][blood],
            'incident_type': feature_mapping['incident_type'][incident],
            'victim_count': feature_mapping['victim_count'][victim],
            'scene_hazard': request.scene_hazard,
            'vulnerability_index': vulnerability_index,
            'trauma_triad': trauma_triad,
            'scene_chaos': scene_chaos
        }

        # --- C. Run the AI Prediction ---
        df = pd.DataFrame([input_data])
        prediction = model.predict(df)[0]
        
        return {
            "severity_score": str(prediction), 
            "vulnerability_score": int(vulnerability_index),
            "chaos_flag": bool(scene_chaos)
        }

    except Exception as e:
        print("❌ ML Engine Error:", str(e)) # This prints exact errors to your terminal!
        raise HTTPException(status_code=400, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)