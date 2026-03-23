from fastapi import FastAPI
from pydantic import BaseModel

# Initialize the AI Web Server
app = FastAPI()

# Define what the incoming injury data will look like
class InjuryData(BaseModel):
    blood_loss: str
    consciousness: str
    breathing: str

# 1. Health Check Route
@app.get("/")
def read_root():
    return {"message": "🧠 LiveBridge AI Engine is awake!"}

# 2. Triage Prediction Route
@app.post("/predict")
def predict_severity(data: InjuryData):
    # TODO: Connect actual Scikit-Learn Random Forest model here.
    # For today, we use simple dummy logic to test the connection.
    
    if data.consciousness == "Unconscious" or data.breathing == "Labored":
        score = "Critical"
    elif data.blood_loss == "High":
        score = "High"
    else:
        score = "Low"
        
    return {"severity_score": score}