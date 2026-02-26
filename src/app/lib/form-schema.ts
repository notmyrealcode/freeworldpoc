export type FieldType = "text" | "yes_no";

export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  section: string;
  optional?: boolean;
}

export const FORM_SECTIONS = [
  "Applicant Name",
  "Social Security",
  "Home Address",
  "Mailing Address",
  "Contact Information",
  "Language Preferences",
  "Screening Questions",
  "Expedited Service",
] as const;

export type SectionName = (typeof FORM_SECTIONS)[number];

export const FORM_FIELDS: FormField[] = [
  // Applicant Name
  { id: "first_name", label: "First Name", type: "text", section: "Applicant Name" },
  { id: "middle_name", label: "Middle Name", type: "text", section: "Applicant Name", optional: true },
  { id: "last_name", label: "Last Name", type: "text", section: "Applicant Name" },
  { id: "other_names", label: "Other Names (maiden, nicknames)", type: "text", section: "Applicant Name", optional: true },

  // Social Security
  { id: "ssn", label: "Social Security Number", type: "text", section: "Social Security", optional: true },

  // Home Address
  { id: "home_address", label: "Home Address", type: "text", section: "Home Address" },
  { id: "home_city", label: "City", type: "text", section: "Home Address" },
  { id: "home_state", label: "State", type: "text", section: "Home Address" },
  { id: "home_zip", label: "ZIP Code", type: "text", section: "Home Address" },

  // Mailing Address
  { id: "has_different_mailing", label: "Mailing address different from home?", type: "yes_no", section: "Mailing Address" },
  { id: "mailing_address", label: "Mailing Address", type: "text", section: "Mailing Address", optional: true },
  { id: "mailing_city", label: "City", type: "text", section: "Mailing Address", optional: true },
  { id: "mailing_state", label: "State", type: "text", section: "Mailing Address", optional: true },
  { id: "mailing_zip", label: "ZIP Code", type: "text", section: "Mailing Address", optional: true },

  // Contact Information
  { id: "home_phone", label: "Home Phone", type: "text", section: "Contact Information", optional: true },
  { id: "cell_phone", label: "Cell Phone", type: "text", section: "Contact Information", optional: true },
  { id: "work_phone", label: "Work/Alternative Phone", type: "text", section: "Contact Information", optional: true },
  { id: "email", label: "Email Address", type: "text", section: "Contact Information", optional: true },
  { id: "text_opt_in", label: "OK to receive text messages?", type: "yes_no", section: "Contact Information", optional: true },

  // Language Preferences
  { id: "preferred_read_language", label: "Preferred language to read", type: "text", section: "Language Preferences", optional: true },
  { id: "preferred_speak_language", label: "Preferred language to speak", type: "text", section: "Language Preferences", optional: true },
  { id: "is_deaf_hard_of_hearing", label: "Deaf or hard of hearing?", type: "yes_no", section: "Language Preferences", optional: true },

  // Screening Questions
  { id: "is_homeless", label: "Currently homeless?", type: "yes_no", section: "Screening Questions" },
  { id: "has_disability", label: "Has a disability?", type: "yes_no", section: "Screening Questions", optional: true },
  { id: "needs_accommodation", label: "Needs accommodation for disability?", type: "yes_no", section: "Screening Questions", optional: true },
  { id: "domestic_violence_history", label: "History of domestic violence/abuse?", type: "yes_no", section: "Screening Questions", optional: true },
  { id: "interested_in_medical", label: "Interested in Medi-Cal?", type: "yes_no", section: "Screening Questions" },

  // Expedited Service
  { id: "expedited_low_income", label: "Monthly gross income < $150 and cash < $100?", type: "yes_no", section: "Expedited Service" },
  { id: "expedited_housing_costs", label: "Housing costs exceed income + cash?", type: "yes_no", section: "Expedited Service" },
  { id: "expedited_migrant", label: "Migrant/seasonal farmworker with < $100?", type: "yes_no", section: "Expedited Service" },
];

export type SnapFormData = Record<string, string>;

export const VALID_FIELD_IDS = new Set(FORM_FIELDS.map((f) => f.id));

export function getFieldsBySection(section: SectionName): FormField[] {
  return FORM_FIELDS.filter((f) => f.section === section);
}

export function getSectionForField(fieldId: string): string | undefined {
  return FORM_FIELDS.find((f) => f.id === fieldId)?.section;
}

export function maskSSN(value: string): string {
  // Show only last 4 digits: ***-**-1234
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 4) {
    return `***-**-${digits.slice(-4)}`;
  }
  return value;
}
