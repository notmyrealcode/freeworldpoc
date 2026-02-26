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

export type SnapFormData = Record<string, string>;

export function maskSSN(value: string): string {
  // Show only last 4 digits: ***-**-1234
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 4) {
    return `***-**-${digits.slice(-4)}`;
  }
  return value;
}
