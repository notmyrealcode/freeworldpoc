# Client-Driven Field State Machine

## Problem

The current architecture gives Gemini a monolithic system prompt with all 28+ fields, their order, confirmation flow rules, skip logic, and correction handling. We rely on prompt engineering to make Gemini ask one field at a time, confirm before advancing, and not batch tool calls. This has caused repeated bugs:

- Gemini asks for multiple fields at once (e.g. first + middle name together)
- Gemini batches tool calls (confirm_value + update_field in one turn), bypassing confirmation
- Gemini double-confirms (system prompt + tool description both instruct it)
- Complex prompt instructions needed to prevent each new failure mode
- Skip logic ("if no disability, skip accommodation") lives in the prompt, not in code

## Solution

Move field sequencing to a **client-side state machine**. The client feeds Gemini one field at a time. Gemini's job shrinks from "orchestrate an entire form" to "have a focused conversation about one field."

## Field Definition

Each field is a data structure on the client:

```typescript
interface FieldDefinition {
  id: string;              // "first_name", "home_address"
  label: string;           // "First Name", "Home Address"
  type: "text" | "yes_no" | "optional_text";
  required: boolean;
  hints?: string;          // "be sensitive", "don't repeat full SSN aloud, confirm last 4 only"
  skipIf?: (formData: SnapFormData) => boolean;
}
```

The field order is a flat array of `FieldDefinition[]`. The client walks through it sequentially.

## State Machine

```
States:
  idle        — no session
  welcome     — session started, Gemini delivering welcome message
  asking      — Gemini is asking about the current field
  confirming  — confirm_value displayed, waiting for user yes/no
  correcting  — user requested a correction to a previous field (returnToIndex is set)
  summary     — all fields done, Gemini summarizing
  done        — mark_complete called

Transitions:
  idle → welcome          : startSession()
  welcome → asking        : client sends first field to Gemini
  asking → confirming     : Gemini calls confirm_value
  confirming → asking     : user says no → Gemini re-asks same field
  confirming → asking     : user says yes → Gemini calls field_complete → client advances
  asking → correcting     : Gemini calls request_correction(field_id) at any point
  correcting → asking     : correction confirmed via field_complete → client returns to saved index
  asking → summary        : last field completed → client sends summary instruction
  summary → done          : Gemini calls mark_complete
```

## Correction Flow with Return-to-Index

When the user says "fix my address" while on field 10:

1. Gemini calls `request_correction("home_address")`
2. Client saves `returnToIndex = 10` (current position)
3. Client rewinds `currentIndex` to the home_address field
4. Client sends the home_address field to Gemini with the current value pre-filled
5. User corrects, Gemini calls `confirm_value`, user confirms, Gemini calls `field_complete`
6. Client sees `returnToIndex !== null`, jumps back to field 10 instead of advancing to home_address + 1
7. Client clears `returnToIndex = null`
8. Normal flow resumes from field 10

**Nested corrections:** If during a correction the user says "also fix my phone number", update `returnToIndex` only if it's currently `null`. If it's already set, keep the original return point. This way nested corrections always return to where the user was before any corrections started.

```typescript
interface FieldState {
  currentIndex: number;
  returnToIndex: number | null;
}

// On request_correction:
if (state.returnToIndex === null) {
  state.returnToIndex = state.currentIndex;
}
state.currentIndex = fieldIndex(correctedFieldId);

// On field_complete:
if (state.returnToIndex !== null) {
  state.currentIndex = state.returnToIndex;
  state.returnToIndex = null;
} else {
  state.currentIndex++;
}
```

## Gemini's Tool Surface

Only **3 tools** at any time:

### confirm_value(value, prompt)
Display a value on screen for the user to visually confirm. Gemini calls this after the user provides an answer.

### field_complete(value)
Signal the current field is done with the confirmed value. The client updates form data and advances the state machine.

### request_correction(field_id)
The user wants to fix a previously completed field. Gemini resolves the user's natural language ("fix my address") to a field_id from the previously-completed list. The client rewinds the state machine.

## What the Client Sends to Gemini

### At session start (system prompt)
A short, static base prompt covering:
- Role: friendly CalFresh application assistant
- Conversation style: warm, patient, one question at a time
- Confirmation flow: call confirm_value to show on screen, ask "does that look right?", wait for yes/no, then call field_complete
- Spelling retry: if rejected twice on same field, ask user to spell it
- Silence handling: check in once, then wait
- Correction handling: if user wants to fix something, use request_correction with the field_id from the completed fields list

No field list. No field order. No skip logic.

### Per field (via sendClientContent)
A user-role message injected when the state machine advances:

```
Next field: first_name
Label: First Name
Type: text, required
Hints: (none)
Previously completed: (none yet)

Ask the user for this value.
```

Later fields include completed context:

```
Next field: home_phone
Label: Home Phone Number
Type: optional_text
Hints: mention this is optional
Previously completed: first_name=Justin, middle_name=M, last_name=Smith, home_address=123 Main St, home_city=Sacramento, home_state=CA, home_zip=95814

Ask the user for this value.
```

The "Previously completed" list gives Gemini enough context to resolve correction requests.

### For corrections
Same format but with the current value:

```
Correction: home_address
Label: Home Address
Type: text, required
Current value: 123 Main St
Previously completed: first_name=Justin, middle_name=M, last_name=Smith

The user wants to correct this value. Ask them for the updated value.
```

## What the Client Controls

- **Field ordering** — deterministic, array-driven
- **Form data updates** — field_complete triggers setFormData
- **Question display** — client sets currentQuestion from field definition
- **Skip logic** — client evaluates skipIf before sending the field (code, not prompt)
- **Advancement** — client moves to next field only after field_complete
- **Correction routing** — client manages returnToIndex
- **Summary trigger** — client sends summary instruction after last field

## What Gemini Controls

- **Conversational tone** — how to ask each question naturally
- **Confirmation wording** — how to prompt "does that look right?"
- **Spelling/retry logic** — decides when to ask user to spell vs repeat
- **Correction resolution** — maps "fix my address" to the right field_id
- **Welcome message** — delivered once at session start

## Field Order

```typescript
const FIELD_ORDER: FieldDefinition[] = [
  { id: "first_name", label: "First Name", type: "text", required: true },
  { id: "middle_name", label: "Middle Name", type: "optional_text", required: false },
  { id: "last_name", label: "Last Name", type: "text", required: true },
  { id: "other_names", label: "Other Names", type: "optional_text", required: false,
    hints: "maiden names, nicknames — mention this is optional" },
  { id: "ssn", label: "Social Security Number", type: "optional_text", required: false,
    hints: "mention they only need to provide it if they have one and are applying for benefits. Never repeat the full SSN aloud. Confirm only the last 4 digits." },
  { id: "home_address", label: "Home Address (Street)", type: "text", required: true },
  { id: "home_city", label: "Home City", type: "text", required: true },
  { id: "home_state", label: "Home State", type: "text", required: true },
  { id: "home_zip", label: "Home ZIP Code", type: "text", required: true },
  { id: "has_different_mailing", label: "Different Mailing Address?", type: "yes_no", required: true,
    hints: "ask if their mailing address is different from their home address" },
  { id: "mailing_address", label: "Mailing Address (Street)", type: "text", required: true,
    skipIf: (data) => data.has_different_mailing === "No" },
  { id: "mailing_city", label: "Mailing City", type: "text", required: true,
    skipIf: (data) => data.has_different_mailing === "No" },
  { id: "mailing_state", label: "Mailing State", type: "text", required: true,
    skipIf: (data) => data.has_different_mailing === "No" },
  { id: "mailing_zip", label: "Mailing ZIP Code", type: "text", required: true,
    skipIf: (data) => data.has_different_mailing === "No" },
  { id: "home_phone", label: "Home Phone", type: "optional_text", required: false,
    hints: "mention this is optional" },
  { id: "cell_phone", label: "Cell Phone", type: "optional_text", required: false,
    hints: "mention this is optional" },
  { id: "work_phone", label: "Work Phone", type: "optional_text", required: false,
    hints: "mention this is optional" },
  { id: "email", label: "Email Address", type: "optional_text", required: false,
    hints: "mention this is optional" },
  { id: "text_opt_in", label: "Receive Text Messages?", type: "yes_no", required: true },
  { id: "is_homeless", label: "Currently Homeless?", type: "yes_no", required: true,
    hints: "be sensitive when asking this" },
  { id: "preferred_read_language", label: "Preferred Language to Read", type: "optional_text", required: false,
    hints: "ask if they prefer a language other than English — mention this is optional" },
  { id: "preferred_speak_language", label: "Preferred Language to Speak", type: "optional_text", required: false,
    hints: "ask if they prefer a language other than English — mention this is optional" },
  { id: "is_deaf_hard_of_hearing", label: "Deaf or Hard of Hearing?", type: "yes_no", required: false,
    hints: "mention this is optional" },
  { id: "has_disability", label: "Disability in Household?", type: "yes_no", required: false,
    hints: "mention this is optional" },
  { id: "needs_accommodation", label: "Needs Disability Accommodation?", type: "yes_no", required: false,
    hints: "mention this is optional",
    skipIf: (data) => data.has_disability !== "Yes" },
  { id: "domestic_violence_history", label: "History of Domestic Violence?", type: "yes_no", required: false,
    hints: "be very sensitive, mention this is optional and they don't have to answer" },
  { id: "interested_in_medical", label: "Interested in Medi-Cal?", type: "yes_no", required: true },
  { id: "expedited_low_income", label: "Low Income (Expedited)?", type: "yes_no", required: true,
    hints: "explain these questions help determine if they can get benefits faster" },
  { id: "expedited_housing_costs", label: "High Housing Costs (Expedited)?", type: "yes_no", required: true },
  { id: "expedited_migrant", label: "Migrant/Seasonal Worker (Expedited)?", type: "yes_no", required: true },
];
```

## Benefits Over Current Architecture

- **No more field-batching bugs** — Gemini literally cannot ask for multiple fields
- **No more tool-call batching** — only 3 tools with clear single-step semantics
- **Simpler prompt** — ~15 lines base prompt vs ~80 lines today
- **Skip logic in code** — `skipIf` functions, not prompt engineering
- **Deterministic field order** — impossible for Gemini to skip or reorder
- **Easier to add/reorder fields** — edit the array, no prompt changes
- **Correction with return** — state machine handles it, Gemini just resolves the field name

## Files Affected

- `src/app/lib/field-definitions.ts` — **new** — FieldDefinition type + FIELD_ORDER array
- `src/app/hooks/use-gemini-session.ts` — major rewrite: add state machine, field advancement, correction routing, per-field message injection
- `src/app/lib/gemini-config.ts` — drastically simplified: short base prompt, 3 tool declarations
- `src/app/components/conversation-panel.tsx` — minor: currentQuestion now comes from field definition, not Gemini tool call
- `src/app/page.tsx` — minor: pass-through changes if hook interface changes
- `src/app/lib/form-schema.ts` — may consolidate with field-definitions.ts
