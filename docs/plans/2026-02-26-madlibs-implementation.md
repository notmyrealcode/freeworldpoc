# Madlibs Form-Filling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the field-by-field voice assistant with section-based madlibs — display natural sentences with blanks, user speaks all answers at once, Gemini fills them in with one tool call, user reviews and corrects.

**Architecture:** Each section is a madlib template (natural sentences with `{field_id}` placeholders). The UI renders these as styled blanks with labels. Gemini receives one section at a time, listens to the user read the madlib aloud, and calls `complete_section` with all extracted values. Corrections use `fix_field`. The section state machine is `prompting -> filling -> reviewing -> (conditional) -> next section`.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, `@google/genai` Live API, `gemini-2.5-flash-native-audio-preview-12-2025`

---

### Task 1: Define Madlib Templates Data Structure

**Files:**
- Create: `src/app/lib/madlib-templates.ts`

**Step 1: Create the madlib templates file**

This file defines the template string and field metadata for each section. Each template uses `{field_id}` for text blanks and `{field_id}` for yes/no choices (with label showing "is / is not" etc). Each section also lists which fields are conditional.

See the design doc at `docs/plans/2026-02-26-madlibs-redesign.md` for the full template text for each section.

Key types:

```typescript
export interface MadlibField {
  id: string;
  label: string;           // shown below the blank
  required: boolean;
  sensitive?: boolean;      // e.g. SSN - mask on display
  hints?: string;           // passed to Gemini for context
}

export interface MadlibConditional {
  triggerField: string;     // field_id that controls visibility
  triggerValue: string;     // value that makes the sub-template appear
  template: string;
  fields: MadlibField[];
}

export interface MadlibSection {
  section: SectionName;
  template: string;
  fields: MadlibField[];
  conditionals?: MadlibConditional[];
}
```

The `MADLIB_SECTIONS` array has 8 entries, one per section. Sections with conditionals: Mailing Address (triggered by `has_different_mailing === "is"`), Screening Questions (triggered by `has_disability === "do"`).

Helper functions:
- `getMadlibSection(name: SectionName): MadlibSection | undefined`
- `getSectionFieldIds(section: MadlibSection): string[]` — includes conditional field IDs

**Step 2: Commit**

```bash
git add src/app/lib/madlib-templates.ts
git commit -m "feat: add madlib template data structure for all form sections"
```

---

### Task 2: Create Madlib Display Component

**Files:**
- Create: `src/app/components/madlib-card.tsx`

**Step 1: Create the MadlibCard component**

Renders a madlib template as styled text. Parses `{field_id}` placeholders from the template string. For each placeholder:
- If the field has a value in `values` prop: render the value in bold blue text with a subtle underline
- If empty: render a blank underline with the field label in small text below

Props:
```typescript
interface MadlibCardProps {
  template: string;
  fields: MadlibField[];
  values: SnapFormData;
  sectionTitle: string;
}
```

Use a regex `/\{(\w+)\}/g` to split the template into text segments and field placeholders. Render inline so the sentence flows naturally with blanks embedded in the text.

Styling: white card with rounded corners and border. Section title in small uppercase above. Template text at `text-xl` size. Blanks have `min-w-[80px]` so they're visible even when empty. Filled values are `font-bold text-blue-700`. SSN values get masked via `maskSSN()`.

**Step 2: Commit**

```bash
git add src/app/components/madlib-card.tsx
git commit -m "feat: add MadlibCard component for rendering templates with blanks"
```

---

### Task 3: New Gemini Config — Tools and System Prompt

**Files:**
- Modify: `src/app/lib/gemini-config.ts` (full rewrite of SYSTEM_INSTRUCTION and TOOL_DECLARATIONS)

**Step 1: Rewrite system prompt**

Replace the current field-level prompt with a madlibs-oriented one. Key behavior:
1. Welcome: one sentence, then system sends first section
2. For each section: say "Please read the statement on your screen, filling in your information"
3. Listen, extract all values, call `complete_section` once
4. Say "Take a look and let me know if anything needs fixing"
5. Handle `fix_field` for corrections, `next_section` when confirmed
6. Sensitive sections get a compassionate note
7. First section gets a brief explanation of how madlibs work
8. Never spell things back, everything on screen
9. Stay on topic, no off-topic answers

**Step 2: Replace tool declarations**

Remove: `confirm_value`, `field_complete`, `request_correction`
Add: `complete_section`, `fix_field`, `next_section`
Keep: `mark_complete` (unchanged)

Tool schemas:
- `complete_section`: `{ fields: OBJECT }` — map of field_id to string value
- `fix_field`: `{ field_id: STRING, value: STRING }`
- `next_section`: `{}` (no params)
- `mark_complete`: `{}` (no params)

Keep: `GEMINI_MODEL`, `Modality.AUDIO`, `FunctionCallingConfigMode.AUTO`, the `toolConfig` type assertion hack.

**Step 3: Commit**

```bash
git add src/app/lib/gemini-config.ts
git commit -m "feat: rewrite gemini config for section-based madlibs tools and prompt"
```

---

### Task 4: Rewrite the Session Hook

**Files:**
- Modify: `src/app/hooks/use-gemini-session.ts` (major rewrite)

This is the biggest task. Replace the field-level state machine with a section-level one.

**Step 1: Replace state types**

Remove: `CurrentQuestion`, `ConfirmationPrompt`, `FieldMachineState`, `FieldState`

Add:
```typescript
type SectionMachineState = "idle" | "welcome" | "prompting" | "reviewing" | "conditional" | "summary" | "done";

interface SectionState {
  currentSectionIndex: number;
  machineState: SectionMachineState;
}
```

**Step 2: Replace state variables**

Remove: `currentQuestion`, `confirmationPrompt`, `fieldState`, `fieldStateRef`

Add:
- `sectionState` / `sectionStateRef` — tracks current section index and machine state
- `activeMadlib` — the current `MadlibSection | null` being displayed
- `activeConditional` — the current `MadlibConditional | null` (if a conditional sub-section is showing)
- `madlibValues` — `SnapFormData` for the current section's field values

**Step 3: Write `buildSectionInstruction` helper**

Builds the text instruction sent to Gemini when starting a section. Includes:
- Section name
- Template string
- Field list with IDs, labels, required/optional, hints
- Whether it's a conditional follow-up

**Step 4: Rewrite `handleFunctionCall`**

Four tool handlers:

- `complete_section`: Validate required fields. Store all values in `madlibValues` and merge into `formData`. Check for conditionals — if a trigger field matches, set `activeConditional` and return conditional instruction. Otherwise transition to `reviewing`. Tool response: `"OK. Do not speak. Wait for the user's response."`

- `fix_field`: Validate field_id exists in current section (check both main fields and conditional fields). Update value in `madlibValues` and `formData`. Tool response: `"OK. Do not speak. Wait for the user's response."`

- `next_section`: Must be in `reviewing` state. Increment `currentSectionIndex`. If more sections, set new `activeMadlib`, clear `activeConditional` and `madlibValues`, transition to `prompting`, return new section instruction. If all done, transition to `summary`, return summary instruction.

- `mark_complete`: Must be in `summary` state. Set `isComplete`, transition to `done`.

**Step 5: Rewrite `startSession` welcome flow**

After welcome turn completes, send first section instruction:
```typescript
if (ss.machineState === "welcome") {
  setVoiceStatus("processing");
  aiSpeakingRef.current = true;
  const firstSection = MADLIB_SECTIONS[0];
  // update state, set activeMadlib, send instruction via sendClientContent
}
```

**Step 6: Update hook return type**

```typescript
return {
  isConnected, isPaused, isComplete,
  activeMadlib, activeConditional, madlibValues,
  formData, error, voiceStatus, getFrequencyData,
  startSession, stopSession, pauseSession, resumeSession,
};
```

Remove: `currentQuestion`, `confirmationPrompt` from return.

**Step 7: Remove dead code**

Delete: `buildFieldText`, `buildResumeText`, `sendFieldMessage`, `advanceToNextField`, `completedFieldsSummary` import (if unused), `fieldIndex` import (if unused), `FIELD_ORDER` import (if unused).

**Step 8: Commit**

```bash
git add src/app/hooks/use-gemini-session.ts
git commit -m "feat: rewrite session hook for section-based madlibs state machine"
```

---

### Task 5: Update ConversationPanel for Madlibs

**Files:**
- Modify: `src/app/components/conversation-panel.tsx`

**Step 1: Replace question/confirmation display with MadlibCard**

Remove: `CurrentQuestion`, `ConfirmationPrompt` imports and props, confirmation card, currentQuestion display.

Add: Import `MadlibCard`. New props: `activeMadlib`, `activeConditional`, `madlibValues`.

Main display area when connected and not paused:
- If `activeMadlib` is set: render `MadlibCard` for the main template
- If `activeConditional` is also set: render a second `MadlibCard` below
- Keep the audio visualizer, voice status, controls, error display, session timer unchanged

**Step 2: Commit**

```bash
git add src/app/components/conversation-panel.tsx
git commit -m "feat: update ConversationPanel to display MadlibCard instead of single questions"
```

---

### Task 6: Update page.tsx and FormSidebar

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/components/form-sidebar.tsx`

**Step 1: Update page.tsx**

Thread new props from hook to ConversationPanel: `activeMadlib`, `activeConditional`, `madlibValues`. Remove `currentQuestion`, `confirmationPrompt`.

For FormSidebar, pass `activeSection` (section name string) instead of `activeField`:
```tsx
<FormSidebar formData={formData} activeSection={activeMadlib?.section ?? null} />
```

**Step 2: Update FormSidebar**

Change `activeField: string | null` prop to `activeSection: SectionName | null`. In `SectionStatus`, set `isActive` by comparing `section === activeSection` instead of checking individual field IDs.

**Step 3: Commit**

```bash
git add src/app/page.tsx src/app/components/form-sidebar.tsx
git commit -m "feat: thread madlib props through page and update sidebar to highlight by section"
```

---

### Task 7: Clean Up and Verify Build

**Files:**
- Modify: `src/app/lib/field-definitions.ts` — remove `fieldIndex` if unused
- Any other files with dead imports

**Step 1: Remove unused exports and imports**

Check references to `fieldIndex`, `completedFieldsSummary`, `FIELD_ORDER`. Remove any that are no longer used anywhere.

**Step 2: Verify build**

```bash
npm run build
```

Fix any TypeScript errors until the build passes cleanly.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove dead field-level code, verify clean build"
```

---

### Task 8: Manual Testing

Run `npm run dev` and verify:

1. Start conversation - welcome plays, first madlib (Applicant Name) appears with blanks
2. Speak the madlib - all blanks fill in at once via one tool call
3. Say "looks good" - advances to next section
4. Fix a field - say "my city is wrong, it's Sacramento" - that blank updates
5. Conditional - at Mailing Address, say "is" different - follow-up madlib appears
6. Optional skip - skip phone fields by not mentioning them - no error
7. Sensitive section - Screening Questions gets compassionate intro
8. Full flow - complete all 8 sections through to summary
9. Sidebar highlights active section and shows values as filled
