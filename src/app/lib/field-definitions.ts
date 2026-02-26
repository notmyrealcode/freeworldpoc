import { maskSSN, type SnapFormData, type SectionName } from "./form-schema";

export interface FieldDefinition {
  id: string;
  label: string;
  type: "text" | "yes_no" | "optional_text";
  section: SectionName;
  required: boolean;
  hints?: string;
  skipIf?: (formData: SnapFormData) => boolean;
}

export const FIELD_ORDER: FieldDefinition[] = [
  // Applicant Name
  { id: "first_name", label: "First Name", type: "text", section: "Applicant Name", required: true },
  { id: "middle_name", label: "Middle Name", type: "optional_text", section: "Applicant Name", required: false },
  { id: "last_name", label: "Last Name", type: "text", section: "Applicant Name", required: true },
  { id: "other_names", label: "Other Names", type: "optional_text", section: "Applicant Name", required: false,
    hints: "maiden names, nicknames — mention this is optional" },

  // Social Security
  { id: "ssn", label: "Social Security Number", type: "optional_text", section: "Social Security", required: false,
    hints: "mention they only need to provide it if they have one and are applying for benefits. Never repeat the full SSN aloud. Confirm only the last 4 digits." },

  // Home Address
  { id: "home_address", label: "Home Address (Street)", type: "text", section: "Home Address", required: true },
  { id: "home_city", label: "City", type: "text", section: "Home Address", required: true },
  { id: "home_state", label: "State", type: "text", section: "Home Address", required: true },
  { id: "home_zip", label: "ZIP Code", type: "text", section: "Home Address", required: true },

  // Mailing Address
  { id: "has_different_mailing", label: "Mailing address different from home?", type: "yes_no", section: "Mailing Address", required: true,
    hints: "ask if their mailing address is different from their home address" },
  { id: "mailing_address", label: "Mailing Address (Street)", type: "text", section: "Mailing Address", required: true,
    // Values are normalized to "Yes"/"No" by field_complete; toLowerCase is belt-and-suspenders
    skipIf: (data) => data.has_different_mailing?.toLowerCase() === "no" },
  { id: "mailing_city", label: "City", type: "text", section: "Mailing Address", required: true,
    skipIf: (data) => data.has_different_mailing?.toLowerCase() === "no" },
  { id: "mailing_state", label: "State", type: "text", section: "Mailing Address", required: true,
    skipIf: (data) => data.has_different_mailing?.toLowerCase() === "no" },
  { id: "mailing_zip", label: "ZIP Code", type: "text", section: "Mailing Address", required: true,
    skipIf: (data) => data.has_different_mailing?.toLowerCase() === "no" },

  // Contact Information
  { id: "home_phone", label: "Home Phone", type: "optional_text", section: "Contact Information", required: false,
    hints: "mention this is optional" },
  { id: "cell_phone", label: "Cell Phone", type: "optional_text", section: "Contact Information", required: false,
    hints: "mention this is optional" },
  { id: "work_phone", label: "Work/Alternative Phone", type: "optional_text", section: "Contact Information", required: false,
    hints: "mention this is optional" },
  { id: "email", label: "Email Address", type: "optional_text", section: "Contact Information", required: false,
    hints: "mention this is optional" },
  { id: "text_opt_in", label: "OK to receive text messages?", type: "yes_no", section: "Contact Information", required: true },

  // Language Preferences
  { id: "preferred_read_language", label: "Preferred language to read", type: "optional_text", section: "Language Preferences", required: false,
    hints: "ask if they prefer a language other than English — mention this is optional" },
  { id: "preferred_speak_language", label: "Preferred language to speak", type: "optional_text", section: "Language Preferences", required: false,
    hints: "ask if they prefer a language other than English — mention this is optional" },
  { id: "is_deaf_hard_of_hearing", label: "Deaf or hard of hearing?", type: "yes_no", section: "Language Preferences", required: false,
    hints: "mention this is optional" },

  // Screening Questions
  { id: "is_homeless", label: "Currently homeless?", type: "yes_no", section: "Screening Questions", required: true,
    hints: "be sensitive when asking this" },
  { id: "has_disability", label: "Has a disability?", type: "yes_no", section: "Screening Questions", required: false,
    hints: "mention this is optional" },
  { id: "needs_accommodation", label: "Needs accommodation for disability?", type: "yes_no", section: "Screening Questions", required: false,
    hints: "mention this is optional",
    skipIf: (data) => data.has_disability?.toLowerCase() !== "yes" },
  { id: "domestic_violence_history", label: "History of domestic violence/abuse?", type: "yes_no", section: "Screening Questions", required: false,
    hints: "be very sensitive, mention this is optional and they don't have to answer" },
  { id: "interested_in_medical", label: "Interested in Medi-Cal?", type: "yes_no", section: "Screening Questions", required: true },

  // Expedited Service
  { id: "expedited_low_income", label: "Monthly gross income < $150 and cash < $100?", type: "yes_no", section: "Expedited Service", required: true,
    hints: "explain these questions help determine if they can get benefits faster" },
  { id: "expedited_housing_costs", label: "Housing costs exceed income + cash?", type: "yes_no", section: "Expedited Service", required: true },
  { id: "expedited_migrant", label: "Migrant/seasonal farmworker with < $100?", type: "yes_no", section: "Expedited Service", required: true },
];

/** Look up a field's index by its ID. Returns -1 if not found. */
export function fieldIndex(fieldId: string): number {
  return FIELD_ORDER.findIndex((f) => f.id === fieldId);
}

/** Get all fields belonging to a given section. */
export function getFieldsBySection(section: SectionName): FieldDefinition[] {
  return FIELD_ORDER.filter((f) => f.section === section);
}

/** Build a "Previously completed" summary string from form data. Masks SSN. */
export function completedFieldsSummary(formData: SnapFormData): string {
  const entries = FIELD_ORDER
    .filter((f) => formData[f.id] !== undefined)
    .map((f) => {
      const value = f.id === "ssn" ? maskSSN(formData[f.id] ?? "") : formData[f.id];
      return `${f.id}=${value}`;
    });
  return entries.length > 0 ? entries.join(", ") : "(none yet)";
}
