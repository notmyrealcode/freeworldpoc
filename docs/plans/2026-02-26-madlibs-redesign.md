# Madlibs Form-Filling Redesign

## Goal

Replace the one-question-at-a-time voice assistant UX with a "madlibs" approach: display an entire section of questions as natural sentences with blanks, have the user speak all answers at once, fill in the blanks on screen, and let them correct individual fields before moving to the next section.

## Architecture

**Approach:** Single tool call per section. Gemini receives a madlib template, listens to the user speak the whole thing, extracts all field values, and calls `complete_section` once. Corrections use `fix_field` for individual updates.

**Model:** `gemini-2.5-flash-native-audio-preview-12-2025` (unchanged). Fewer tool calls per section reduces the native audio model's tool-calling reliability problem.

## Madlib Templates

Each section has a natural-language template with blanks. Blanks show an underline with the field name below in small text. Optional fields are labeled "(optional)".

### Applicant Name
"My name is \_\_\_(first name) \_\_\_(middle name, optional) \_\_\_(last name). I also go by \_\_\_(other names, optional)."

### Social Security
"My Social Security number is \_\_\_(SSN, optional)."

### Home Address
"I live at \_\_\_(street address), \_\_\_(city), \_\_\_(state) \_\_\_(ZIP)."

### Mailing Address
"My mailing address **is / is not** different from my home."
If "is": "My mailing address is \_\_\_(street), \_\_\_(city), \_\_\_(state) \_\_\_(ZIP)."

### Contact Information
"My home phone is \_\_\_(home phone, optional). My cell is \_\_\_(cell phone, optional). My work phone is \_\_\_(work phone, optional). My email is \_\_\_(email, optional). I **am / am not** OK with receiving text messages."

### Language Preferences
"I prefer to read in \_\_\_(language, optional). I prefer to speak in \_\_\_(language, optional). I **am / am not** deaf or hard of hearing (optional)."

### Screening Questions
"I **am / am not** currently homeless. I **do / do not** have a disability (optional)."
If "do": "I **do / do not** need accommodation (optional)."
"I **have / have not** experienced domestic violence (optional). I **am / am not** interested in Medi-Cal."

### Expedited Service
"My monthly income **is / is not** under $150 with less than $100 cash. My housing costs **do / do not** exceed my income plus cash. I **am / am not** a migrant or seasonal farmworker with under $100."

## Section State Machine

Each section progresses through:

1. **`prompting`** - Madlib template displayed with empty blanks. Gemini says "Please read the statement on your screen, filling in your information." Mic is listening.
2. **`filling`** - User speaks. Gemini parses and calls `complete_section` with all extracted values. Blanks fill in. Gemini says "Take a look and let me know if anything needs fixing."
3. **`reviewing`** - User reviews filled madlib. "Looks good" -> `next_section` -> advance. "X is wrong, it's Y" -> `fix_field` -> blank updates -> stay in reviewing.
4. **`conditional`** - If a yes/no triggers a follow-up (e.g. mailing address), the follow-up madlib appears and goes back to `prompting` for that sub-section.

## Tools

Replacing the current 4 tools (`confirm_value`, `field_complete`, `request_correction`, `mark_complete`):

- **`complete_section`** - `{ fields: { [field_id]: string } }` - Fill all blanks in the current section at once.
- **`fix_field`** - `{ field_id: string, value: string }` - Update one blank during review.
- **`next_section`** - `{}` - User confirmed section, advance to next.
- **`mark_complete`** - `{}` - Final confirmation after all sections done.

## Voice Behavior

- Gemini receives one section at a time (template + field metadata).
- Prompt: "Please read the statement on your screen, filling in your information."
- After filling: "Take a look and let me know if anything needs fixing, or say 'looks good' to continue."
- Optional fields the user skips get empty string.
- SSN confirmed by last 4 digits only on screen.
- Sensitive questions (homelessness, domestic violence) get a brief compassionate note before the madlib.
- Unclear speech for one field: Gemini asks about just that field, not the whole section.
- Immediate transition between sections - no extra speech when advancing.

## What Gets Removed

- `confirm_value`, `field_complete`, `request_correction` tools
- Field-level state machine (`asking -> confirming -> correcting`)
- `ConfirmationPrompt` component
- Complex tool response text
- `sendFieldMessage` / `buildFieldText` / field-by-field progression
- Per-field progression index tracking (replaced by per-section index)

## UI Changes

- Madlib card replaces single-question display in conversation panel
- Blanks styled as underlines with small field-name labels below
- Filled blanks show the value in bold
- Form sidebar still shows section-level progress
- Audio visualizer unchanged
