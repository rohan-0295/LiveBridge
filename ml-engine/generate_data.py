import pandas as pd
import numpy as np
import random

print("🧬 Initializing Advanced Emergency Medical Simulator...")
print("⚙️ Engineering Base Variables + Super Columns...")

NUM_RECORDS = 200000
data = []

# Mathematically simulating 200,000 unique emergency calls
for _ in range(NUM_RECORDS):
    # --- 1. BASE PATIENT PROFILE (Static Data) ---
    age_group = random.choices(['Pediatric', 'Adult', 'Geriatric'], weights=[0.15, 0.60, 0.25])[0]
    is_diabetic = random.choices([0, 1], weights=[0.85, 0.15])[0]
    cardiac_history = random.choices([0, 1], weights=[0.90, 0.10])[0]
    chest_pain = random.choices([0, 1], weights=[0.85, 0.15])[0]
    
    # --- 2. BASE VITALS (Dynamic Data) ---
    consciousness = random.choices(['Awake', 'Altered', 'Unconscious'], weights=[0.70, 0.20, 0.10])[0]
    breathing = random.choices(['Normal', 'Labored', 'Absent'], weights=[0.75, 0.20, 0.05])[0]
    blood_loss = random.choices(['None', 'Moderate', 'Severe'], weights=[0.60, 0.25, 0.15])[0]
    
    # --- 3. BASE TACTICAL CONTEXT (Dynamic Data) ---
    incident_type = random.choices(['RTA', 'Cardiac', 'Fall', 'Medical', 'Fire'], weights=[0.30, 0.20, 0.15, 0.25, 0.10])[0]
    victim_count = random.choices(['Single', 'Multiple', 'Mass'], weights=[0.80, 0.15, 0.05])[0]
    scene_hazard = random.choices([0, 1], weights=[0.90, 0.10])[0]

    # --- 4. 🧠 FEATURE ENGINEERING (The Super Columns) ---
    
    # Vulnerability Index (Scale 0 to 4)
    age_score = 1 if age_group in ['Pediatric', 'Geriatric'] else 0
    vulnerability_index = age_score + is_diabetic + (cardiac_history * 2)
    
    # Trauma Triad Flag (0 or 1)
    trauma_triad = 1 if (blood_loss == 'Severe' and breathing in ['Labored', 'Absent']) else 0
    
    # Scene Chaos Multiplier (0 or 1)
    scene_chaos = 1 if (scene_hazard == 1 or victim_count in ['Multiple', 'Mass']) else 0

    # --- 5. THE TARGET LOGIC (What the AI will learn) ---
    severity = 'Low' 
    
    # The "Zero Hesitation" Critical Protocol
    if trauma_triad == 1 or consciousness == 'Unconscious':
        severity = 'Critical'
        
    # The Cardiac Protocol (Prioritizes Vulnerable Patients)
    elif chest_pain == 1:
        severity = 'Critical' if vulnerability_index >= 2 else 'High'
        
    # The Tactical Override (Chaos demands faster response)
    elif scene_chaos == 1:
        severity = random.choices(['High', 'Critical'], weights=[0.70, 0.30])[0]
        
    # Standard Trauma Protocol
    elif blood_loss == 'Moderate' or consciousness == 'Altered' or breathing == 'Labored':
        # If the patient is highly vulnerable, bump them to High priority automatically
        severity = 'High' if vulnerability_index >= 2 else 'Medium'
        
    # Default Stable Protocol
    else:
        severity = random.choices(['Low', 'Medium'], weights=[0.80, 0.20])[0]

    data.append([
        age_group, is_diabetic, cardiac_history, chest_pain, 
        consciousness, breathing, blood_loss, incident_type, 
        victim_count, scene_hazard, 
        vulnerability_index, trauma_triad, scene_chaos, 
        severity
    ])

# Save to CSV
columns = [
    'age_group', 'is_diabetic', 'cardiac_history', 'chest_pain_indicator', 
    'consciousness', 'breathing', 'blood_loss', 'incident_type', 
    'victim_count', 'scene_hazard', 
    'vulnerability_index', 'trauma_triad', 'scene_chaos', 
    'severity_score'
]

df = pd.DataFrame(data, columns=columns)
df.to_csv('indian_er_triage_data_v2.csv', index=False)

print(f"✅ Successfully generated {NUM_RECORDS} rows with Feature Engineering!")
print("💾 Saved as 'indian_er_triage_data_v2.csv'")