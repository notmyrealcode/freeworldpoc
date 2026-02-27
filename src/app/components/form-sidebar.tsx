"use client";

import {
  FORM_SECTIONS,
  maskSSN,
  type SnapFormData,
  type SectionName,
} from "@/app/lib/form-schema";
import { getFieldsBySection } from "@/app/lib/field-definitions";

interface FormSidebarProps {
  formData: SnapFormData;
  activeField: string | null;
}

function SectionStatus({
  section,
  formData,
  activeField,
}: {
  section: SectionName;
  formData: SnapFormData;
  activeField: string | null;
}) {
  const fields = getFieldsBySection(section);
  const requiredFields = fields.filter((f) => f.required);
  const filledRequired = requiredFields.filter((f) => formData[f.id]);
  const isActive = fields.some((f) => f.id === activeField);

  let status: "complete" | "active" | "pending";
  if (filledRequired.length === requiredFields.length && requiredFields.length > 0) {
    status = "complete";
  } else if (isActive || fields.some((f) => formData[f.id])) {
    status = "active";
  } else {
    status = "pending";
  }

  const statusIcon = {
    complete: (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-700 text-xs">
        ✓
      </span>
    ),
    active: (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs">
        ●
      </span>
    ),
    pending: (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-gray-400 text-xs">
        ○
      </span>
    ),
  };

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1.5">
        {statusIcon[status]}
        <h3 className="text-sm font-semibold text-gray-700">{section}</h3>
      </div>
      <div className="ml-7 space-y-1">
        {fields.map((field) => {
          const value = formData[field.id];
          const isFieldActive = field.id === activeField;

          // Hide fields whose skip condition is met (e.g. mailing address when same as home)
          if (field.skipIf && field.skipIf(formData)) {
            return null;
          }

          // Mask SSN — only show last 4 digits
          const displayValue =
            value && field.id === "ssn" ? maskSSN(value) : value;

          return (
            <div
              key={field.id}
              className={`flex items-baseline gap-2 text-sm ${
                isFieldActive ? "bg-blue-50 -mx-2 px-2 py-0.5 rounded" : ""
              }`}
            >
              <span className="text-gray-500 min-w-[140px] shrink-0">
                {field.label}:
              </span>
              <span
                className={
                  displayValue
                    ? "text-gray-900 font-medium"
                    : "text-gray-300 italic"
                }
              >
                {displayValue || "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FormSidebar({ formData, activeField }: FormSidebarProps) {
  const filledCount = Object.keys(formData).length;

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-bold text-gray-900">
          Collected Information
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          {filledCount} field{filledCount !== 1 ? "s" : ""} collected
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {FORM_SECTIONS.map((section) => (
          <SectionStatus
            key={section}
            section={section}
            formData={formData}
            activeField={activeField}
          />
        ))}
      </div>
    </div>
  );
}
