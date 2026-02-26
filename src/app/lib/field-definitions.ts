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
