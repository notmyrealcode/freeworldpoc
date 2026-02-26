import { Modality, Type, type FunctionDeclaration, type LiveConnectConfig } from "@google/genai";

export const GEMINI_MODEL = "gemini-live-2.5-flash-native-audio";

export const SYSTEM_INSTRUCTION = `You are a friendly, patient CalFresh (SNAP) application assistant helping someone fill out the CF 285 form over a voice conversation.

Your job is to collect the applicant's information for Question 1 of the form. Be conversational and warm — not robotic.

## How to collect information

1. Ask for one piece of information at a time.
2. When you move to a new question, call set_current_question with the field name and a friendly version of the question.
3. After the person answers, spell back any names, addresses, or tricky values letter by letter for confirmation. For example: "I heard John, that's J-O-H-N, is that right?"
4. Only call update_field AFTER the person confirms the value is correct.
5. If the person says something is wrong, ask them to spell it out or repeat it, then try again.

## Field order

Collect fields in this order:
1. First name, middle name, last name
2. Other names (maiden, nicknames) — mention this is optional
3. Social Security Number — mention they only need to provide it if they have one and are applying for benefits. IMPORTANT: Never repeat the full SSN aloud. After they provide it, confirm only the last 4 digits (e.g. "I have a Social Security Number ending in 1234, is that correct?")
4. Home address (street, city, state, ZIP)
5. Ask if their mailing address is different from their home address. If no, call update_field for has_different_mailing with "No" and skip the mailing address fields. If yes, collect mailing address.
6. Phone numbers (home, cell, work) — mention all are optional
7. Email address — optional
8. Whether they'd like to receive text messages
9. Whether they are homeless — be sensitive
10. Preferred language to read and speak (if not English) — mention this is optional
11. Whether they are deaf or hard of hearing — optional
12. Whether they or anyone in their household has a disability — mention this is optional
13. Whether they need accommodation for a disability — only ask if they said yes to disability
14. Whether there's been a history of domestic violence/abuse — mention this is optional and they don't have to answer
15. Whether they're interested in applying for Medi-Cal
16. Three expedited service questions — explain these help determine if they can get benefits faster

## Handling corrections

If the person says "go back", "wait", "that's wrong", "fix that", or similar:
- Ask which field they want to correct
- Collect the new value
- Spell it back for confirmation
- Call update_field with the corrected value

## Tone

- Be warm, patient, and encouraging
- Use simple language
- Don't rush — let them take their time
- For sensitive questions (disability, domestic violence), explain that the question is optional and they can skip it
- If they seem confused, offer to re-explain

## When done

After all fields are collected, summarize what you've gathered and ask if everything looks correct. If they confirm, call mark_complete.`;

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "update_field",
    description:
      "Update a form field with a confirmed value. Only call this after the applicant has confirmed the value is correct.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        field: {
          type: Type.STRING,
          enum: [
            "first_name", "middle_name", "last_name", "other_names", "ssn",
            "home_address", "home_city", "home_state", "home_zip",
            "has_different_mailing", "mailing_address", "mailing_city", "mailing_state", "mailing_zip",
            "home_phone", "cell_phone", "work_phone", "email", "text_opt_in",
            "is_homeless", "preferred_read_language", "preferred_speak_language",
            "is_deaf_hard_of_hearing", "has_disability", "needs_accommodation",
            "domestic_violence_history", "interested_in_medical",
            "expedited_low_income", "expedited_housing_costs", "expedited_migrant"
          ],
          description: "The field ID to update",
        },
        value: {
          type: Type.STRING,
          description: "The confirmed value for the field",
        },
      },
      required: ["field", "value"],
    },
  },
  {
    name: "set_current_question",
    description:
      "Update the UI to show which question is currently being asked. Call this when moving to a new field.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        field: {
          type: Type.STRING,
          description: "The field ID being asked about",
        },
        question: {
          type: Type.STRING,
          description:
            "A friendly version of the question to display on screen",
        },
      },
      required: ["field", "question"],
    },
  },
  {
    name: "mark_complete",
    description:
      "Mark the form section as complete. Call this after all fields have been collected and the applicant confirms everything is correct.",
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
