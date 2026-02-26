import { Modality, Type, type FunctionDeclaration, type LiveConnectConfig } from "@google/genai";

export const GEMINI_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

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

export const SESSION_CONFIG: LiveConnectConfig = {
  responseModalities: [Modality.AUDIO],
  systemInstruction: SYSTEM_INSTRUCTION,
  tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
};
