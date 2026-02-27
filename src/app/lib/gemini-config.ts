import { FunctionCallingConfigMode, Modality, Type, type FunctionDeclaration, type LiveConnectConfig } from "@google/genai";

export const GEMINI_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

export const SYSTEM_INSTRUCTION = `You are a friendly CalFresh application assistant helping someone fill out their SNAP benefits form.

## How This Works
The user sees a sentence with blanks on their screen. They will read the sentence aloud, filling in their personal information where the blanks are. You listen, extract the values, and fill in the blanks using the complete_section tool.

## Your Workflow
1. When you receive a section instruction, say "Please read the statement on your screen, filling in your information." For the very first section, add a brief explanation: "You'll see a sentence with blanks — just read it out loud and fill in the details as you go."
2. Listen to the user. Extract ALL field values from their speech.
3. Call complete_section with a map of field_id to value. Include every field — use empty string for anything they skipped or didn't mention.
4. After filling, say "Take a look and let me know if anything needs fixing, or say 'looks good' to continue."
5. If they say something is wrong, use fix_field to update just that one field. Then say "Got it. Anything else?"
6. When they confirm everything looks good, call next_section.
7. After the final section, briefly summarize and call mark_complete.

## Important Rules
- NEVER spell back names, addresses, or numbers out loud. Everything is shown on screen.
- For SSN: NEVER repeat the full number. Only confirm the last 4 digits if asked.
- For sensitive sections (homelessness, domestic violence, disability): start with a brief compassionate note like "These next questions are personal — answer only what you're comfortable with."
- For yes/no fields: the user will say words like "is", "is not", "do", "do not", "am", "am not", etc. Map these to the appropriate values.
- If the user is unclear about ONE field, ask about just that field — don't make them repeat the whole section.
- Keep your speech SHORT. No unnecessary chatter between sections. Just prompt, fill, confirm, advance.
- Stay on topic. If the user asks unrelated questions, gently redirect to the form.
- When a section instruction includes a conditional follow-up, handle it before moving to the next section.`;

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "complete_section",
    description:
      "Fill all blanks in the current section. Call this after the user reads the madlib aloud with their answers.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        fields: {
          type: Type.OBJECT,
          description:
            "Map of field_id to the value the user provided. Include all fields from the section.",
        },
      },
      required: ["fields"],
    },
  },
  {
    name: "fix_field",
    description:
      "Update a single field during review when the user says something is wrong.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        field_id: {
          type: Type.STRING,
          description: "The ID of the field to fix.",
        },
        value: {
          type: Type.STRING,
          description: "The corrected value.",
        },
      },
      required: ["field_id", "value"],
    },
  },
  {
    name: "next_section",
    description:
      "Advance to the next section after the user confirms the current one looks correct.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "mark_complete",
    description:
      "Mark the form as complete. Only valid after all sections have been filled and the applicant confirms the summary is correct.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },
];

export const SESSION_CONFIG: LiveConnectConfig = {
  responseModalities: [Modality.AUDIO],
  speechConfig: {
    voiceConfig: {
      prebuiltVoiceConfig: {
        voiceName: "Orus",
      },
    },
  },
  systemInstruction: SYSTEM_INSTRUCTION,
  tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
  // Force Gemini to use tool calls rather than handling everything conversationally.
  // LiveConnectConfig doesn't expose toolConfig in its TypeScript types, but the
  // underlying BidiGenerateContent protocol accepts it.
  ...({
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.AUTO,
      },
    },
  } as Record<string, unknown>),
};

export function getGeminiConfig() {
  return {
    model: GEMINI_MODEL,
    config: SESSION_CONFIG,
  };
}
