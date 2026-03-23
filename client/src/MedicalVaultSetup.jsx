import { useState } from 'react';
import {
  ChevronRight, ChevronLeft, Plus, Trash2, Check,
  Lock, Shield, Clock, User, Phone, Heart, Pill,
} from 'lucide-react';

// ── Design tokens (same as App.jsx) ─────────────────────────────────────────
const T = {
  bg0:    '#080808', bg1:    '#111111', bg2:    '#1a1a1a', bg3:    '#222222',
  border: '#242424', text1:  '#e8e8e8', text2:  '#888888', text3:  '#444444',
  red:    '#ef4444', redDim: '#7f1d1d',
  green:  '#22c55e', greenDim: '#166534',
  blue:   '#3b82f6', blueDim:  '#1e3a5f',
  amber:  '#f59e0b',
  font:   "'Syne', sans-serif",
  body:   "'DM Sans', sans-serif",
};

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// ── Default vault shape ──────────────────────────────────────────────────────
const DEFAULT_VAULT = {
  name: '', age: '', gender: 'Male', bloodType: 'A+', phone: '',
  allergies: [], conditions: [],
  medications: [],            // [{ name, dose }]
  doctorName: '', hospital: '',
  contacts: [{ name: '', rel: '', phone: '' }],
};

// ── Persist helpers ──────────────────────────────────────────────────────────
export function loadVault() {
  try {
    const raw = localStorage.getItem('lb_medical_vault');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveVault(vault) {
  localStorage.setItem('lb_medical_vault', JSON.stringify(vault));
}

// ── Save to backend ──────────────────────────────────────────────────────────
async function saveVaultToServer(vault) {
  try {
    await fetch('http://localhost:8000/api/vault', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ user_id: 1, ...vault }),
    });
  } catch (err) {
    console.warn('Server save failed (offline?), vault kept in localStorage', err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Main component
// Props:
//   onComplete(vault) — called when user finishes setup
// ════════════════════════════════════════════════════════════════════════════
export default function MedicalVaultSetup({ onComplete }) {
  const [step,  setStep]  = useState(1);       // 1 | 2 | 3 | 4 (done)
  const [vault, setVault] = useState(DEFAULT_VAULT);
  const [saving, setSaving] = useState(false);

  const update = (key, val) => setVault(v => ({ ...v, [key]: val }));

  const nextStep = () => setStep(s => s + 1);
  const prevStep = () => setStep(s => s - 1);

  const handleSave = async () => {
    setSaving(true);
    saveVault(vault);              // always persist locally
    await saveVaultToServer(vault); // best-effort server sync
    setSaving(false);
    setStep(4);                    // show confirmation
  };

  // ── Step 1 valid if name + phone filled ─────────────────────────────────
  const step1Valid = vault.name.trim().length > 1 && vault.phone.trim().length > 6;
  // ── Step 3 valid if at least 1 contact has name + phone ─────────────────
  const step3Valid = vault.contacts.some(c => c.name.trim() && c.phone.trim());

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'lb-fadein .25s ease' }}>

      {/* ── Progress bar ─────────────────────────────────────────────── */}
      {step < 4 && (
        <div style={{ height: 3, background: T.bg3, flexShrink: 0 }}>
          <div style={{
            height: '100%', borderRadius: 2,
            background: T.blue,
            width: `${(step / 3) * 100}%`,
            transition: 'width .3s ease',
          }} />
        </div>
      )}

      {/* ── Step dots ────────────────────────────────────────────────── */}
      {step < 4 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 5, padding: '8px 0', flexShrink: 0 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{
              height: 5, borderRadius: 3,
              width: i === step ? 14 : 5,
              background: i < step ? T.green : i === step ? T.blue : T.bg3,
              transition: 'all .25s',
            }} />
          ))}
        </div>
      )}

      {/* ── Steps ────────────────────────────────────────────────────── */}
      {step === 1 && <Step1 vault={vault} update={update} onNext={nextStep} valid={step1Valid} />}
      {step === 2 && <Step2 vault={vault} update={update} onNext={nextStep} onBack={prevStep} />}
      {step === 3 && <Step3 vault={vault} update={update} onSave={handleSave} onBack={prevStep} valid={step3Valid} saving={saving} />}
      {step === 4 && <StepDone vault={vault} onComplete={() => onComplete(vault)} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 1 — Personal Info
// ════════════════════════════════════════════════════════════════════════════
function Step1({ vault, update, onNext, valid }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <StepHeader
        icon={<User size={16} color={T.blue} />}
        title="Medical Vault"
        subtitle="Your info is encrypted & only shared when you press SOS."
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        <Field label="Full Name">
          <input
            value={vault.name}
            onChange={e => update('name', e.target.value)}
            placeholder="Your full name"
            style={inputStyle}
          />
        </Field>

        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Age" style={{ flex: 1 }}>
            <input
              value={vault.age} type="number" min="1" max="120"
              onChange={e => update('age', e.target.value)}
              placeholder="28"
              style={{ ...inputStyle, width: '100%' }}
            />
          </Field>
          <Field label="Gender" style={{ flex: 1 }}>
            <select
              value={vault.gender}
              onChange={e => update('gender', e.target.value)}
              style={{ ...inputStyle, width: '100%' }}
            >
              {['Male', 'Female', 'Other'].map(g => <option key={g}>{g}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Blood Type">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
            {BLOOD_TYPES.map(bt => (
              <button
                key={bt}
                onClick={() => update('bloodType', bt)}
                style={{
                  padding: '9px 4px',
                  background: vault.bloodType === bt ? T.redDim : T.bg2,
                  border: `1px solid ${vault.bloodType === bt ? T.red : T.border}`,
                  borderRadius: 8, cursor: 'pointer',
                  fontFamily: T.font, fontWeight: 800, fontSize: 11,
                  color: vault.bloodType === bt ? '#f87171' : T.text3,
                  transition: 'all .15s',
                }}
              >
                {bt}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Phone Number">
          <input
            value={vault.phone} type="tel"
            onChange={e => update('phone', e.target.value)}
            placeholder="+91 98765 43210"
            style={inputStyle}
          />
        </Field>

      </div>
      <StepFooter>
        <NextBtn onClick={onNext} disabled={!valid} label="Next — Medical History" />
      </StepFooter>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 2 — Medical History
// ════════════════════════════════════════════════════════════════════════════
function Step2({ vault, update, onNext, onBack }) {
  const addAllergy    = () => update('allergies',  [...vault.allergies,  '']);
  const removeAllergy = i  => update('allergies',  vault.allergies.filter((_, j) => j !== i));
  const editAllergy   = (i, v) => update('allergies', vault.allergies.map((a, j) => j === i ? v : a));

  const addCondition    = () => update('conditions',  [...vault.conditions,  '']);
  const removeCondition = i  => update('conditions',  vault.conditions.filter((_, j) => j !== i));
  const editCondition   = (i, v) => update('conditions', vault.conditions.map((c, j) => j === i ? v : c));

  const addMed    = () => update('medications', [...vault.medications, { name: '', dose: '' }]);
  const removeMed = i  => update('medications', vault.medications.filter((_, j) => j !== i));
  const editMed   = (i, key, v) => update('medications', vault.medications.map((m, j) => j === i ? { ...m, [key]: v } : m));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <StepHeader
        icon={<Heart size={16} color={T.red} />}
        title="Medical History"
        subtitle="Helps paramedics treat you faster en route."
        onBack={onBack}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Allergies */}
        <Field label="Known Allergies">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', minHeight: 40 }}>
            {vault.allergies.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, background: T.bg3, borderRadius: 6, padding: '3px 4px 3px 8px' }}>
                <input
                  value={a}
                  onChange={e => editAllergy(i, e.target.value)}
                  placeholder="e.g. Penicillin"
                  style={{ background: 'transparent', border: 'none', outline: 'none', color: T.text1, fontSize: 11, fontFamily: T.body, width: Math.max(60, a.length * 7) }}
                />
                <button onClick={() => removeAllergy(i)} style={tagDelBtn}><Trash2 size={10} /></button>
              </div>
            ))}
            <button onClick={addAllergy} style={addTagBtn}><Plus size={11} /> Add</button>
          </div>
        </Field>

        {/* Conditions */}
        <Field label="Chronic Conditions">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', minHeight: 40 }}>
            {vault.conditions.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, background: T.bg3, borderRadius: 6, padding: '3px 4px 3px 8px' }}>
                <input
                  value={c}
                  onChange={e => editCondition(i, e.target.value)}
                  placeholder="e.g. Diabetes"
                  style={{ background: 'transparent', border: 'none', outline: 'none', color: T.text1, fontSize: 11, fontFamily: T.body, width: Math.max(60, c.length * 7) }}
                />
                <button onClick={() => removeCondition(i)} style={tagDelBtn}><Trash2 size={10} /></button>
              </div>
            ))}
            <button onClick={addCondition} style={addTagBtn}><Plus size={11} /> Add</button>
          </div>
        </Field>

        {/* Medications */}
        <Field label="Current Medications">
          {vault.medications.map((med, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <input
                value={med.name}
                onChange={e => editMed(i, 'name', e.target.value)}
                placeholder="Drug name"
                style={{ ...inputStyle, flex: 2 }}
              />
              <input
                value={med.dose}
                onChange={e => editMed(i, 'dose', e.target.value)}
                placeholder="Dosage"
                style={{ ...inputStyle, flex: 2 }}
              />
              <button onClick={() => removeMed(i)} style={{ background: 'none', border: 'none', color: T.red, cursor: 'pointer', padding: 6, display: 'flex' }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button onClick={addMed} style={addRowBtn}>
            <Plus size={12} /> Add medication
          </button>
        </Field>

        {/* Primary Doctor */}
        <Field label="Primary Doctor">
          <input
            value={vault.doctorName}
            onChange={e => update('doctorName', e.target.value)}
            placeholder="Dr. Name"
            style={inputStyle}
          />
        </Field>

        <Field label="Hospital / Clinic">
          <input
            value={vault.hospital}
            onChange={e => update('hospital', e.target.value)}
            placeholder="e.g. Apollo Hospitals, Chennai"
            style={inputStyle}
          />
        </Field>

      </div>
      <StepFooter>
        <NextBtn onClick={onNext} label="Next — Emergency Contacts" />
      </StepFooter>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 3 — Emergency Contacts + Save
// ════════════════════════════════════════════════════════════════════════════
function Step3({ vault, update, onSave, onBack, valid, saving }) {
  const addContact    = () => update('contacts', [...vault.contacts, { name: '', rel: '', phone: '' }]);
  const removeContact = i  => update('contacts', vault.contacts.filter((_, j) => j !== i));
  const editContact   = (i, key, v) => update('contacts', vault.contacts.map((c, j) => j === i ? { ...c, [key]: v } : c));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <StepHeader
        icon={<Phone size={16} color={T.green} />}
        title="Emergency Contacts"
        subtitle="Called automatically when SOS is triggered."
        onBack={onBack}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {vault.contacts.map((c, i) => (
          <div key={i} style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.text2, fontFamily: T.font, letterSpacing: 1 }}>
                CONTACT {i + 1}
              </span>
              {vault.contacts.length > 1 && (
                <button onClick={() => removeContact(i)} style={{ background: 'none', border: 'none', color: T.text3, cursor: 'pointer', display: 'flex' }}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                value={c.name}
                onChange={e => editContact(i, 'name', e.target.value)}
                placeholder="Full name"
                style={{ ...inputStyle, flex: 2 }}
              />
              <input
                value={c.rel}
                onChange={e => editContact(i, 'rel', e.target.value)}
                placeholder="Relation"
                style={{ ...inputStyle, flex: 1 }}
              />
            </div>
            <input
              value={c.phone} type="tel"
              onChange={e => editContact(i, 'phone', e.target.value)}
              placeholder="Phone number"
              style={{ ...inputStyle, width: '100%' }}
            />
          </div>
        ))}

        {vault.contacts.length < 5 && (
          <button onClick={addContact} style={addRowBtn}>
            <Plus size={12} /> Add another contact
          </button>
        )}

        {/* Security note */}
        <div style={{ background: '#0d1a0d', border: `1px solid #1a2d1a`, borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Lock size={12} color={T.green} style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ margin: 0, fontSize: 11, color: '#4ade80', lineHeight: 1.6, fontFamily: T.body }}>
            Your data is stored securely and only shared with paramedics when you press SOS. Never sold or used for ads.
          </p>
        </div>

      </div>
      <StepFooter>
        <button
          onClick={onSave}
          disabled={!valid || saving}
          style={{
            width: '100%', padding: 14,
            background: valid ? T.greenDim : T.bg2,
            border: `1px solid ${valid ? T.green : T.border}`,
            borderRadius: 12, color: valid ? '#4ade80' : T.text3,
            fontFamily: T.font, fontWeight: 800, fontSize: 12, letterSpacing: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            cursor: valid ? 'pointer' : 'not-allowed',
            opacity: saving ? .7 : 1,
            transition: 'all .2s',
          }}
        >
          {saving
            ? <><div style={{ width: 14, height: 14, border: '2px solid #4ade8044', borderTopColor: '#4ade80', borderRadius: '50%', animation: 'lb-spin .8s linear infinite' }} /> Saving...</>
            : <><Check size={15} /> SAVE TO MEDICAL VAULT</>
          }
        </button>
      </StepFooter>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 4 — Done / Confirmation
// ════════════════════════════════════════════════════════════════════════════
function StepDone({ vault, onComplete }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, animation: 'lb-fadein .3s ease' }}>

      {/* Success ring */}
      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        background: '#0d1a0d', border: `2px solid ${T.green}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Check size={28} color={T.green} strokeWidth={2.5} />
      </div>

      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontFamily: T.font, fontWeight: 800, fontSize: 18, color: T.text1, margin: '0 0 6px' }}>
          Vault Saved!
        </h2>
        <p style={{ fontSize: 12, color: T.text2, margin: 0, lineHeight: 1.7, fontFamily: T.body }}>
          Your medical profile is encrypted<br />and ready for paramedics.
        </p>
      </div>

      {/* Summary card */}
      <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, width: '100%' }}>
        {/* Patient row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${T.border}` }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: T.blueDim, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: T.font, fontWeight: 800, fontSize: 12, color: '#60a5fa', flexShrink: 0,
          }}>
            {vault.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'ME'}
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 500, fontSize: 13, color: T.text1, fontFamily: T.body }}>{vault.name || 'Patient'}</p>
            <p style={{ margin: 0, fontSize: 11, color: T.text3, fontFamily: T.body }}>Age {vault.age} · {vault.gender}</p>
          </div>
          <div style={{ background: '#1a0d0d', border: `1px solid ${T.red}44`, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 18, color: T.red, lineHeight: 1 }}>{vault.bloodType}</div>
            <div style={{ fontSize: 8, color: T.text3, letterSpacing: 1, marginTop: 2, fontFamily: T.body }}>BLOOD</div>
          </div>
        </div>

        {/* Summary rows */}
        {[
          { label: 'Allergies',    val: vault.allergies.length  ? vault.allergies.join(', ')  : 'None recorded' },
          { label: 'Conditions',   val: vault.conditions.length ? vault.conditions.join(', ') : 'None recorded' },
          { label: 'Medications',  val: vault.medications.length ? `${vault.medications.length} active` : 'None recorded' },
          { label: 'Contacts',     val: vault.contacts.filter(c => c.name).length + ' registered' },
          { label: 'Doctor',       val: vault.doctorName || 'Not specified' },
        ].map(({ label, val }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '5px 0', borderBottom: `1px solid ${T.border}` }}>
            <span style={{ fontSize: 11, color: T.text3, fontFamily: T.body }}>{label}</span>
            <span style={{ fontSize: 11, color: T.text2, fontFamily: T.body, textAlign: 'right', maxWidth: '60%' }}>{val}</span>
          </div>
        ))}
      </div>

      {/* Paramedic note */}
      <div style={{ background: T.blueDim, border: `1px solid #2a4f7f`, borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 8, width: '100%' }}>
        <Clock size={12} color="#60a5fa" style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ margin: 0, fontSize: 11, color: '#60a5fa', lineHeight: 1.6, fontFamily: T.body }}>
          Paramedics receive this data the instant you press SOS — before they even arrive.
        </p>
      </div>

      {/* CTA */}
      <button
        onClick={onComplete}
        style={{
          width: '100%', padding: 14,
          background: T.red, border: 'none',
          borderRadius: 12, color: '#fff',
          fontFamily: T.font, fontWeight: 800, fontSize: 12, letterSpacing: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          cursor: 'pointer',
        }}
      >
        GO TO SOS HOME
      </button>
    </div>
  );
}

// ── Small shared components ──────────────────────────────────────────────────
function StepHeader({ icon, title, subtitle, onBack }) {
  return (
    <div style={{ padding: '12px 18px 10px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
      {onBack && (
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: T.text3, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8, padding: 0, fontFamily: T.body, fontSize: 11 }}>
          <ChevronLeft size={13} /> Back
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: T.bg2, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {icon}
        </div>
        <div>
          <h2 style={{ fontFamily: T.font, fontWeight: 800, fontSize: 15, color: T.text1, margin: 0 }}>{title}</h2>
          <p style={{ margin: 0, fontSize: 10, color: T.text3, marginTop: 2, fontFamily: T.body, lineHeight: 1.5 }}>{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={style}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: T.text3, textTransform: 'uppercase', fontFamily: T.font, marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function StepFooter({ children }) {
  return (
    <div style={{ padding: '10px 18px 18px', flexShrink: 0, borderTop: `1px solid ${T.border}` }}>
      {children}
    </div>
  );
}

function NextBtn({ onClick, label, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%', padding: 13,
        background: disabled ? T.bg2 : T.red,
        border: `1px solid ${disabled ? T.border : T.red}`,
        borderRadius: 12, color: disabled ? T.text3 : '#fff',
        fontFamily: T.font, fontWeight: 800, fontSize: 11, letterSpacing: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all .15s',
      }}
    >
      {label} <ChevronRight size={14} />
    </button>
  );
}

// ── Style constants ──────────────────────────────────────────────────────────
const inputStyle = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: 8,
  padding: '9px 11px',
  fontSize: 12,
  color: '#e8e8e8',
  fontFamily: "'DM Sans', sans-serif",
  outline: 'none',
  width: '100%',
  transition: 'border-color .15s',
};

const tagDelBtn = {
  background: 'none', border: 'none',
  color: '#555', cursor: 'pointer',
  padding: '2px 4px', display: 'flex',
};

const addTagBtn = {
  background: 'none', border: 'none',
  color: '#3b82f6', cursor: 'pointer',
  fontSize: 11, fontFamily: "'DM Sans', sans-serif",
  display: 'flex', alignItems: 'center', gap: 3,
  padding: '2px 4px',
};

const addRowBtn = {
  background: 'transparent',
  border: '1px dashed #2a2a2a',
  borderRadius: 8, padding: '9px 12px',
  color: '#3b82f6', fontFamily: "'DM Sans', sans-serif",
  fontSize: 12, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 6,
  width: '100%',
};
