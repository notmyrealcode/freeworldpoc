# Client-Driven Field State Machine — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the monolithic Gemini system prompt (which lists all 28+ fields) with a client-side state machine that feeds Gemini one field at a time, eliminating field-batching bugs, tool-call batching, and prompt-based skip logic.

**Architecture:** A flat `FieldDefinition[]` array defines field order with `skipIf` functions. A state machine in the hook (`idle → welcome → asking → confirming → correcting → summary → done`) advances through fields sequentially, injecting per-field instructions via `sendClientContent`. Gemini's tool surface shrinks to 4 tools: `confirm_value`, `field_complete`, `request_correction`, `mark_complete`.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Google Gemini Live API (`@google/genai`), Tailwind CSS 4

---

### Task 1: Create field-definitions.ts

**Files:**
- Create: `src/app/lib/field-definitions.ts`

**Step 1: Create the FieldDefinition type and FIELD_ORDER array**

```typescript
// src/app/lib/field-definitions.ts
import { maskSSN, type SnapFormData } from "./form-schema";

export type FieldType = "text" | "yes_no" | "optional_text";

export interface FieldDefinition {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  hints?: string;
  skipIf?: (formData: SnapFormData) => boolean;
}

export const FIELD_ORDER: FieldDefinition[] = [
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
    skipIf: (data) => data.has_different_mailing?.toLowerCase() === "no" },
  { id: "mailing_city", label: "Mailing City", type: "text", required: true,
    skipIf: (data) => data.has_different_mailing?.toLowerCase() === "no" },
  { id: "mailing_state", label: "Mailing State", type: "text", required: true,
    skipIf: (data) => data.has_different_mailing?.toLowerCase() === "no" },
  { id: "mailing_zip", label: "Mailing ZIP Code", type: "text", required: true,
    skipIf: (data) => data.has_different_mailing?.toLowerCase() === "no" },
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
    skipIf: (data) => data.has_disability?.toLowerCase() !== "yes" },
  { id: "domestic_violence_history", label: "History of Domestic Violence?", type: "yes_no", required: false,
    hints: "be very sensitive, mention this is optional and they don't have to answer" },
  { id: "interested_in_medical", label: "Interested in Medi-Cal?", type: "yes_no", required: true },
  { id: "expedited_low_income", label: "Low Income (Expedited)?", type: "yes_no", required: true,
    hints: "explain these questions help determine if they can get benefits faster" },
  { id: "expedited_housing_costs", label: "High Housing Costs (Expedited)?", type: "yes_no", required: true },
  { id: "expedited_migrant", label: "Migrant/Seasonal Worker (Expedited)?", type: "yes_no", required: true },
];

/** Look up a field's index by its ID. Returns -1 if not found. */
export function fieldIndex(fieldId: string): number {
  return FIELD_ORDER.findIndex((f) => f.id === fieldId);
}

/** Build a "Previously completed" summary string from form data. Masks SSN. */
export function completedFieldsSummary(formData: SnapFormData): string {
  const entries = FIELD_ORDER
    .filter((f) => formData[f.id] !== undefined)
    .map((f) => {
      const value = f.id === "ssn" ? maskSSN(formData[f.id]) : formData[f.id];
      return `${f.id}=${value}`;
    });
  return entries.length > 0 ? entries.join(", ") : "(none yet)";
}
```

**Step 2: Verify the build**

Run: `npm run build`
Expected: Compiles with no errors (file is imported nowhere yet).

**Step 3: Commit**

```bash
git add src/app/lib/field-definitions.ts
git commit -m "feat: add field-definitions.ts with FieldDefinition type, FIELD_ORDER array, and helpers"
```

---

### Task 2: Rewrite gemini-config.ts — simplified prompt + 4 tools

**Files:**
- Modify: `src/app/lib/gemini-config.ts` (full rewrite of SYSTEM_INSTRUCTION and TOOL_DECLARATIONS)

**Step 1: Replace the system instruction**

Replace the entire `SYSTEM_INSTRUCTION` constant (lines 5–78) with:

```typescript
export const SYSTEM_INSTRUCTION = `You are a friendly, patient CalFresh (SNAP) application assistant helping someone fill out their application over a voice conversation.

## Your role

You collect one piece of information at a time. The system will tell you which field to ask about — you decide how to phrase the question naturally.

## Welcome message

When the conversation starts, briefly introduce yourself:
- You're helping with their CalFresh application
- You'll walk through questions one at a time over voice
- Answers appear on screen so they can double-check
- Nothing is submitted yet, they can correct anything or skip optional questions
- Then ask the first question right away — don't wait for them to say they're ready

Keep the welcome to a few sentences.

## Confirmation flow

1. After the person answers, call confirm_value to display the value on screen.
2. Say something brief like "I've put that on your screen — does it look correct?"
3. STOP and wait for their yes or no. Do NOT call field_complete until they confirm.
4. If they say yes, call field_complete with the confirmed value.
5. If they say no, ask them to repeat it and try confirm_value again.
6. If they reject the value a second time for the same field, ask them to spell it out letter by letter, then use their spelled-out version for confirm_value.

## Corrections

If the person says "go back", "fix my address", "change my name", or similar:
- Look at the "Previously completed" list to find the right field_id
- Call request_correction with that field_id
- The system will give you the field to re-collect with its current value

## Handling silence

- If the person goes quiet, gently check in once: "Take your time. Do you need a moment?"
- If they need time, say "No problem, just let me know when you're ready" — then wait silently
- Only check in about silence ONCE per question. Do not repeatedly ask "are you still there?"

## Tone

- Warm, patient, encouraging
- Simple language
- Don't rush
- For sensitive questions, explain they're optional and can be skipped`;
```

**Step 2: Replace the tool declarations**

Replace the entire `TOOL_DECLARATIONS` array (lines 80–163) with:

```typescript
export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "confirm_value",
    description:
      "Display a value on screen for the applicant to visually confirm. Call this after the person answers a question.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        value: {
          type: Type.STRING,
          description: "The value to display for confirmation",
        },
        prompt: {
          type: Type.STRING,
          description: "A short prompt to display alongside the value",
        },
      },
      required: ["value", "prompt"],
    },
  },
  {
    name: "field_complete",
    description:
      "Signal that the current field is done with the confirmed value. Only call this after the applicant has verbally confirmed the value is correct.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        value: {
          type: Type.STRING,
          description: "The confirmed value for the field",
        },
      },
      required: ["value"],
    },
  },
  {
    name: "request_correction",
    description:
      "The applicant wants to fix a previously completed field. Resolve their natural language request to the correct field_id from the previously-completed list.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        field_id: {
          type: Type.STRING,
          description:
            "The field ID to correct, from the previously-completed list",
        },
      },
      required: ["field_id"],
    },
  },
  {
    name: "mark_complete",
    description:
      "Mark the form section as complete. Call this after all fields have been collected and the applicant confirms the summary is correct.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },
];
```

Note: The `confirm_value` tool no longer has a `field` parameter — the client knows which field is current. The `field_complete` tool replaces both `update_field` and `set_current_question`. The `request_correction` tool is new. `mark_complete` is kept from the original code for the summary → done transition.

**Step 3: Verify the build**

Run: `npm run build`
Expected: Build will fail because `use-gemini-session.ts` still references the old tool names. That's expected — we'll fix it in Task 3.

**Step 4: Commit**

```bash
git add src/app/lib/gemini-config.ts
git commit -m "feat: simplify gemini-config to 4 tools (confirm_value, field_complete, request_correction, mark_complete) and short base prompt"
```

---

### Task 3: Rewrite use-gemini-session.ts — add state machine

This is the largest task. The hook gains a state machine that tracks which field is active, handles skip logic, manages corrections with returnToIndex, and injects per-field messages via `sendClientContent`.

**Files:**
- Modify: `src/app/hooks/use-gemini-session.ts` (major rewrite)

**Step 1: Add imports and state machine types**

At the top of the file, add the import for field definitions and the new types:

```typescript
import {
  FIELD_ORDER,
  fieldIndex,
  completedFieldsSummary,
  type FieldDefinition,
} from "@/app/lib/field-definitions";
```

Add the state machine type:

```typescript
export type FieldMachineState =
  | "idle"
  | "welcome"
  | "asking"
  | "confirming"
  | "correcting"
  | "summary"
  | "done";

interface FieldState {
  currentIndex: number;
  returnToIndex: number | null;
  machineState: FieldMachineState;
}
```

**Step 2: Add state machine state and helpers inside the hook**

Inside `useGeminiSession()`, add:

```typescript
const [fieldState, setFieldState] = useState<FieldState>({
  currentIndex: 0,
  returnToIndex: null,
  machineState: "idle",
});
// Keep a ref so the onmessage closure can read the latest field state
const fieldStateRef = useRef<FieldState>(fieldState);
fieldStateRef.current = fieldState;
// Keep a ref for formData so sendFieldMessage can read the latest values
const formDataRef = useRef<SnapFormData>(formData);
formDataRef.current = formData;
```

Add the function to build and send a per-field message:

```typescript
const sendFieldMessage = useCallback(
  (field: FieldDefinition, isCorrection: boolean, currentFormData: SnapFormData) => {
    const session = sessionRef.current;
    if (!session) return;

    const completed = completedFieldsSummary(currentFormData);
    const typeLabel = field.required ? `${field.type}, required` : `${field.type}, optional`;
    const hints = field.hints ? `Hints: ${field.hints}` : "Hints: (none)";

    let text: string;
    if (isCorrection) {
      const currentValue = currentFormData[field.id] ?? "(no value)";
      text = [
        `Correction: ${field.id}`,
        `Label: ${field.label}`,
        `Type: ${typeLabel}`,
        `Current value: ${currentValue}`,
        hints,
        `Previously completed: ${completed}`,
        "",
        "The user wants to correct this value. Ask them for the updated value.",
      ].join("\n");
    } else {
      text = [
        `Next field: ${field.id}`,
        `Label: ${field.label}`,
        `Type: ${typeLabel}`,
        hints,
        `Previously completed: ${completed}`,
        "",
        "Ask the user for this value.",
      ].join("\n");
    }

    session.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: true,
    });
  },
  []
);
```

Add a helper for resuming a field after a correction return (so Gemini doesn't re-ask from scratch):

```typescript
const sendResumeFieldMessage = useCallback(
  (field: FieldDefinition, currentFormData: SnapFormData) => {
    const session = sessionRef.current;
    if (!session) return;

    const completed = completedFieldsSummary(currentFormData);
    const typeLabel = field.required ? `${field.type}, required` : `${field.type}, optional`;
    const hints = field.hints ? `Hints: ${field.hints}` : "Hints: (none)";

    const text = [
      `Resuming: ${field.id}`,
      `Label: ${field.label}`,
      `Type: ${typeLabel}`,
      hints,
      `Previously completed: ${completed}`,
      "",
      "A correction was just completed. Continue collecting this field from where you left off.",
    ].join("\n");

    session.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: true,
    });
  },
  []
);
```

Add the function to advance to the next field (skipping fields whose `skipIf` returns true):

```typescript
const advanceToNextField = useCallback(
  (fromIndex: number, currentFormData: SnapFormData) => {
    let nextIndex = fromIndex;
    while (nextIndex < FIELD_ORDER.length) {
      const field = FIELD_ORDER[nextIndex];
      if (field.skipIf && field.skipIf(currentFormData)) {
        nextIndex++;
        continue;
      }
      break;
    }

    if (nextIndex >= FIELD_ORDER.length) {
      // All fields done — send summary instruction
      setFieldState((prev) => ({
        ...prev,
        currentIndex: nextIndex,
        machineState: "summary",
      }));
      setCurrentQuestion(null);
      sessionRef.current?.sendClientContent({
        turns: [
          {
            role: "user",
            parts: [
              {
                text: "All fields have been collected. Please summarize everything you've gathered and ask if it all looks correct. If the user confirms, call mark_complete to finish.",
              },
            ],
          },
        ],
        turnComplete: true,
      });
    } else {
      const field = FIELD_ORDER[nextIndex];
      setFieldState((prev) => ({
        ...prev,
        currentIndex: nextIndex,
        machineState: "asking",
      }));
      setCurrentQuestion({ field: field.id, question: field.label });
      sendFieldMessage(field, false, currentFormData);
    }
  },
  [sendFieldMessage]
);
```

**Step 3: Rewrite handleFunctionCall for the 4 tools**

Replace the entire `handleFunctionCall` callback with:

```typescript
const handleFunctionCall = useCallback(
  (functionCalls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>) => {
    const responses: Array<{
      id: string;
      name: string;
      response: { result: string };
    }> = [];

    for (const fc of functionCalls) {
      const args = (fc.args ?? {}) as Record<string, string>;
      const id = fc.id ?? "";
      const name = fc.name ?? "";
      const fs = fieldStateRef.current;
      const currentField = FIELD_ORDER[fs.currentIndex];

      switch (name) {
        case "confirm_value": {
          setConfirmationPrompt({
            field: currentField?.id ?? "",
            value: args.value,
            prompt: args.prompt,
          });
          setFieldState((prev) => ({
            ...prev,
            machineState: "confirming",
          }));
          responses.push({
            id,
            name,
            response: {
              result:
                "Value is now displayed on screen. STOP and wait for the user to verbally confirm or deny before calling field_complete. Do NOT call field_complete yet.",
            },
          });
          // Stop processing remaining calls to enforce confirmation gate
          return responses;
        }

        case "field_complete": {
          const confirmedValue = args.value;
          const fieldId = currentField?.id;

          if (fieldId) {
            // Compute updated form data immediately (pure, no side effects)
            const updatedFormData = { ...formDataRef.current, [fieldId]: confirmedValue };
            setFormData(updatedFormData);
            formDataRef.current = updatedFormData; // update ref so subsequent code sees it

            setConfirmationPrompt(null);

            if (fs.returnToIndex !== null) {
              // Correction complete — return to saved position
              const returnIdx = fs.returnToIndex;
              setFieldState({
                currentIndex: returnIdx,
                returnToIndex: null,
                machineState: "asking",
              });
              const returnField = FIELD_ORDER[returnIdx];
              if (returnField) {
                setCurrentQuestion({
                  field: returnField.id,
                  question: returnField.label,
                });
                sendResumeFieldMessage(returnField, updatedFormData);
              }
            } else {
              // Normal flow — advance to next field
              advanceToNextField(fs.currentIndex + 1, updatedFormData);
            }
          }

          responses.push({ id, name, response: { result: "ok" } });
          break;
        }

        case "request_correction": {
          const targetFieldId = args.field_id;
          const targetIndex = fieldIndex(targetFieldId);

          if (targetIndex === -1) {
            responses.push({
              id,
              name,
              response: {
                result: `error: unknown field "${targetFieldId}". Ask the user to clarify which field they want to correct.`,
              },
            });
            break;
          }

          // Validate the field was actually completed
          if (!formDataRef.current[targetFieldId]) {
            responses.push({
              id,
              name,
              response: {
                result: `Field "${targetFieldId}" hasn't been filled yet. Ask the user which completed field they want to correct.`,
              },
            });
            break;
          }

          // Save return point (only if not already in a correction)
          setFieldState((prev) => {
            const returnTo = prev.returnToIndex === null ? prev.currentIndex : prev.returnToIndex;
            return {
              currentIndex: targetIndex,
              returnToIndex: returnTo,
              machineState: "correcting",
            };
          });

          const targetField = FIELD_ORDER[targetIndex];
          setCurrentQuestion({
            field: targetField.id,
            question: targetField.label,
          });
          setConfirmationPrompt(null);
          sendFieldMessage(targetField, true, formDataRef.current);

          responses.push({ id, name, response: { result: "ok" } });
          break;
        }

        case "mark_complete": {
          setFieldState((prev) => ({
            ...prev,
            machineState: "done",
          }));
          setIsComplete(true);
          setConfirmationPrompt(null);
          responses.push({ id, name, response: { result: "ok" } });
          break;
        }

        default: {
          responses.push({
            id,
            name,
            response: { result: `error: unknown tool "${name}"` },
          });
        }
      }
    }

    return responses;
  },
  [advanceToNextField, sendFieldMessage, sendResumeFieldMessage]
);
```

**Step 4: Update startSession to use the state machine**

In `startSession`, after the session is connected and the kick-off message is sent, trigger the first field after Gemini's welcome:

Replace the kick-off `sendClientContent` block (the "Hi, I'm ready to start the application" message) with:

```typescript
// Reset field state for new session
setFieldState({
  currentIndex: 0,
  returnToIndex: null,
  machineState: "welcome",
});

// Kick off — Gemini will deliver welcome, then we send the first field
try {
  session.sendClientContent({
    turns: [
      {
        role: "user",
        parts: [{ text: "Hi, I'm ready to start the application." }],
      },
    ],
    turnComplete: true,
  });
  setVoiceStatus("processing");
  aiSpeakingRef.current = true;
} catch (e) {
  console.warn("Failed to send kick-off message:", e);
}
```

Then in the `onmessage` callback, after the `turnComplete` handling, add logic to send the first field after Gemini's welcome turn completes. We transition the ref synchronously to prevent double-fire if multiple `turnComplete` events arrive before the React render:

```typescript
// After welcome turn completes, send the first field
if (message.serverContent?.turnComplete) {
  const fs = fieldStateRef.current;
  if (fs.machineState === "welcome") {
    // Transition ref synchronously to prevent double-fire from
    // multiple turnComplete events arriving before React renders
    fieldStateRef.current = { ...fs, machineState: "asking" };

    const currentFormData = formDataRef.current;
    // Find first non-skipped field
    let firstIdx = 0;
    while (firstIdx < FIELD_ORDER.length) {
      const f = FIELD_ORDER[firstIdx];
      if (f.skipIf && f.skipIf(currentFormData)) {
        firstIdx++;
        continue;
      }
      break;
    }
    if (firstIdx < FIELD_ORDER.length) {
      const field = FIELD_ORDER[firstIdx];
      setFieldState({
        currentIndex: firstIdx,
        returnToIndex: null,
        machineState: "asking",
      });
      setCurrentQuestion({ field: field.id, question: field.label });
      sendFieldMessage(field, false, currentFormData);
    }
  }
}
```

**Step 5: Update cleanup to reset field state**

In the `cleanup` callback, add:

```typescript
setFieldState({
  currentIndex: 0,
  returnToIndex: null,
  machineState: "idle",
});
```

**Step 6: Export the machineState from the hook return**

Add `machineState: fieldState.machineState` to the return object, and update the `UseGeminiSessionReturn` interface:

```typescript
interface UseGeminiSessionReturn {
  isConnected: boolean;
  isPaused: boolean;
  isComplete: boolean;
  currentQuestion: CurrentQuestion | null;
  confirmationPrompt: ConfirmationPrompt | null;
  formData: SnapFormData;
  error: string | null;
  voiceStatus: VoiceStatus;
  machineState: FieldMachineState;
  startSession: () => Promise<void>;
  stopSession: () => void;
  pauseSession: () => void;
  resumeSession: () => void;
}
```

**Step 7: Remove the old VALID_FIELD_IDS import**

Remove the `VALID_FIELD_IDS` import from `@/app/lib/form-schema` since we no longer need it — the state machine implicitly validates fields via `FIELD_ORDER`.

**Step 8: Verify the build**

Run: `npm run build`
Expected: May have type errors in page.tsx (new `machineState` prop not consumed yet). Fix in Task 4.

**Step 9: Commit**

```bash
git add src/app/hooks/use-gemini-session.ts
git commit -m "feat: rewrite use-gemini-session with client-driven field state machine"
```

---

### Task 4: Update page.tsx — pass machineState through

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Destructure machineState from hook and pass if needed**

Add `machineState` to the destructured hook return. Currently no component needs it directly, but we expose it for future use/debugging:

```typescript
const {
  isConnected,
  isPaused,
  isComplete,
  currentQuestion,
  confirmationPrompt,
  formData,
  error,
  voiceStatus,
  machineState,
  startSession,
  stopSession,
  pauseSession,
  resumeSession,
} = useGeminiSession();
```

No other changes needed — `ConversationPanel` and `FormSidebar` already receive the props they need.

**Step 2: Verify the build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: destructure machineState from hook in page.tsx"
```

---

### Task 5: Clean up form-schema.ts — remove VALID_FIELD_IDS

**Files:**
- Modify: `src/app/lib/form-schema.ts`

**Step 1: Remove VALID_FIELD_IDS**

`VALID_FIELD_IDS` was used by the old `handleFunctionCall` to validate field names from `update_field`. The new state machine doesn't need it. Remove:

```typescript
// DELETE this line:
export const VALID_FIELD_IDS = new Set(FORM_FIELDS.map((f) => f.id));
```

**Step 2: Verify nothing else imports VALID_FIELD_IDS**

Search the codebase for `VALID_FIELD_IDS`. After the Task 3 changes, the only import was in `use-gemini-session.ts` which we already removed.

**Step 3: Verify the build**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/app/lib/form-schema.ts
git commit -m "chore: remove unused VALID_FIELD_IDS from form-schema"
```

---

### Task 6: Verify end-to-end — build + manual smoke test

**Files:** None (verification only)

**Step 1: Run the full build**

Run: `npm run build`
Expected: Clean build, no errors, no warnings.

**Step 2: Run the dev server**

Run: `npm run dev`

**Step 3: Manual smoke test checklist**

Test these scenarios:
1. Start a session → Gemini delivers welcome → first field (first_name) appears
2. Say a name → Gemini calls confirm_value → value appears on screen
3. Say "yes" → Gemini calls field_complete → advances to middle_name
4. Say "skip" or "none" → Gemini calls field_complete with "N/A" or similar → advances
5. Reach has_different_mailing → say "No" → mailing fields are skipped
6. Say "fix my first name" mid-conversation → Gemini calls request_correction → goes back to first_name → after correction, returns to where you were
7. Complete all fields → summary appears → confirm → Gemini calls mark_complete → "Section Complete" shown

**Step 4: Commit any fixes found during smoke test**

```bash
git add -A
git commit -m "fix: address issues found during manual smoke testing"
```

---

## Summary of changes

| File | Change |
|------|--------|
| `src/app/lib/field-definitions.ts` | **NEW** — FieldDefinition type, FIELD_ORDER array, helper functions |
| `src/app/lib/gemini-config.ts` | **REWRITE** — Short base prompt (~40 lines vs ~80), 4 tools (confirm_value, field_complete, request_correction, mark_complete) replacing 4 tools (update_field, set_current_question, confirm_value, mark_complete) |
| `src/app/hooks/use-gemini-session.ts` | **MAJOR REWRITE** — State machine (FieldState, FieldMachineState), per-field sendClientContent, correction routing with returnToIndex, new handleFunctionCall |
| `src/app/page.tsx` | **MINOR** — Destructure machineState |
| `src/app/lib/form-schema.ts` | **MINOR** — Remove unused VALID_FIELD_IDS |
| `src/app/components/conversation-panel.tsx` | **NO CHANGES** — Already receives currentQuestion/confirmationPrompt from hook |
| `src/app/components/form-sidebar.tsx` | **NO CHANGES** — Already uses form-schema for display |
