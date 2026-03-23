import pandas as pd
from sklearn.ensemble import RandomForestClassifier
import joblib

print("🧠 1. Loading the new V2 dataset...")
df = pd.read_csv('indian_er_triage_data_v2.csv')

print("🔢 2. Converting text to machine-readable math...")
feature_mapping = {
    'age_group': {'Pediatric': 0, 'Adult': 1, 'Geriatric': 2},
    'consciousness': {'Awake': 0, 'Altered': 1, 'Unconscious': 2},
    'breathing': {'Normal': 0, 'Labored': 1, 'Absent': 2},
    'blood_loss': {'None': 0, 'Moderate': 1, 'Severe': 2},
    'incident_type': {'RTA': 0, 'Cardiac': 1, 'Fall': 2, 'Medical': 3, 'Fire': 4},
    'victim_count': {'Single': 0, 'Multiple': 1, 'Mass': 2}
}

# Apply the mapping
df.replace(feature_mapping, inplace=True)

# Split into inputs (X) and the answer key (y)
X = df.drop('severity_score', axis=1) # X is everything EXCEPT the answer
y = df['severity_score']              # y is ONLY the answer

print(f"🌲 3. Training Advanced Random Forest on {len(df)} records...")
# class_weight='balanced' penalizes the AI heavily if it misses a 'Critical' case!
model = RandomForestClassifier(n_estimators=50, random_state=42, class_weight='balanced', n_jobs=-1)
model.fit(X, y)

print("💾 4. Saving the trained AI brain...")
joblib.dump(model, 'triage_model.pkl')

print("✅ SUCCESS: Advanced AI Model saved as 'triage_model.pkl'!")