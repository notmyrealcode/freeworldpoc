import { type SectionName } from "./form-schema";

export interface MadlibField {
  id: string;
  label: string; // shown below the blank
  required: boolean;
  sensitive?: boolean; // e.g. SSN - mask on display
  hints?: string; // passed to Gemini for context
}

export interface MadlibConditional {
  triggerField: string; // field_id that controls visibility
  triggerValue: string; // value that makes the sub-template appear
  template: string;
  fields: MadlibField[];
}

export interface MadlibSection {
  section: SectionName;
  template: string;
  fields: MadlibField[];
  conditionals?: MadlibConditional[];
}

export const MADLIB_SECTIONS: MadlibSection[] = [
  // 1. Applicant Name
  {
    section: "Applicant Name",
    template:
      "My name is {first_name} {middle_name} {last_name}. I also go by {other_names}.",
    fields: [
      { id: "first_name", label: "first name", required: true },
      { id: "middle_name", label: "middle name", required: false },
      { id: "last_name", label: "last name", required: true },
      { id: "other_names", label: "other names", required: false },
    ],
  },

  // 2. Social Security
  {
    section: "Social Security",
    template: "My Social Security number is {ssn}.",
    fields: [
      {
        id: "ssn",
        label: "SSN",
        required: false,
        sensitive: true,
        hints:
          "Never repeat the full SSN aloud. Confirm only the last 4 digits.",
      },
    ],
  },

  // 3. Home Address
  {
    section: "Home Address",
    template:
      "I live at {home_address}, {home_city}, {home_state} {home_zip}.",
    fields: [
      { id: "home_address", label: "street address", required: true },
      { id: "home_city", label: "city", required: true },
      { id: "home_state", label: "state", required: true },
      { id: "home_zip", label: "ZIP code", required: true },
    ],
  },

  // 4. Mailing Address
  {
    section: "Mailing Address",
    template:
      "My mailing address {has_different_mailing} different from my home.",
    fields: [
      {
        id: "has_different_mailing",
        label: "is / is not",
        required: true,
        hints: "yes/no \u2014 say 'is' or 'is not'",
      },
    ],
    conditionals: [
      {
        triggerField: "has_different_mailing",
        triggerValue: "is",
        template:
          "My mailing address is {mailing_address}, {mailing_city}, {mailing_state} {mailing_zip}.",
        fields: [
          { id: "mailing_address", label: "street address", required: true },
          { id: "mailing_city", label: "city", required: true },
          { id: "mailing_state", label: "state", required: true },
          { id: "mailing_zip", label: "ZIP code", required: true },
        ],
      },
    ],
  },

  // 5. Contact Information
  {
    section: "Contact Information",
    template:
      "My home phone is {home_phone}. My cell is {cell_phone}. My work phone is {work_phone}. My email is {email}. I {text_opt_in} OK with receiving text messages.",
    fields: [
      { id: "home_phone", label: "home phone", required: false },
      { id: "cell_phone", label: "cell phone", required: false },
      { id: "work_phone", label: "work phone", required: false },
      { id: "email", label: "email", required: false },
      { id: "text_opt_in", label: "am / am not", required: true },
    ],
  },

  // 6. Language Preferences
  {
    section: "Language Preferences",
    template:
      "I prefer to read in {preferred_read_language}. I prefer to speak in {preferred_speak_language}. I {is_deaf_hard_of_hearing} deaf or hard of hearing.",
    fields: [
      {
        id: "preferred_read_language",
        label: "language",
        required: false,
      },
      {
        id: "preferred_speak_language",
        label: "language",
        required: false,
      },
      {
        id: "is_deaf_hard_of_hearing",
        label: "am / am not",
        required: false,
      },
    ],
  },

  // 7. Screening Questions
  {
    section: "Screening Questions",
    template:
      "I {is_homeless} currently homeless. I {has_disability} a disability. I {domestic_violence_history} experienced domestic violence. I {interested_in_medical} interested in Medi-Cal.",
    fields: [
      { id: "is_homeless", label: "am / am not", required: true },
      { id: "has_disability", label: "do / do not", required: false },
      {
        id: "domestic_violence_history",
        label: "have / have not",
        required: false,
        hints: "sensitive \u2014 be respectful and let the applicant know this is optional",
      },
      { id: "interested_in_medical", label: "am / am not", required: true },
    ],
    conditionals: [
      {
        triggerField: "has_disability",
        triggerValue: "do",
        template: "I {needs_accommodation} need accommodation for my disability.",
        fields: [
          {
            id: "needs_accommodation",
            label: "do / do not",
            required: false,
          },
        ],
      },
    ],
  },

  // 8. Expedited Service
  {
    section: "Expedited Service",
    template:
      "My monthly income {expedited_low_income} under $150 with less than $100 cash. My housing costs {expedited_housing_costs} exceed my income plus cash. I {expedited_migrant} a migrant or seasonal farmworker with under $100.",
    fields: [
      { id: "expedited_low_income", label: "is / is not", required: true },
      {
        id: "expedited_housing_costs",
        label: "do / do not",
        required: true,
      },
      { id: "expedited_migrant", label: "am / am not", required: true },
    ],
  },
];

/** Look up a madlib section by its name. */
export function getMadlibSection(
  name: SectionName,
): MadlibSection | undefined {
  return MADLIB_SECTIONS.find((s) => s.section === name);
}

/** Collect all field IDs for a section, including fields inside conditionals. */
export function getSectionFieldIds(section: MadlibSection): string[] {
  const ids = section.fields.map((f) => f.id);
  if (section.conditionals) {
    for (const cond of section.conditionals) {
      ids.push(...cond.fields.map((f) => f.id));
    }
  }
  return ids;
}
