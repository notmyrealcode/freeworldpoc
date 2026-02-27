"use client";

import React from "react";
import { type MadlibField } from "../lib/madlib-templates";
import { type SnapFormData, maskSSN } from "../lib/form-schema";

interface MadlibCardProps {
  template: string;
  fields: MadlibField[];
  values: SnapFormData;
  sectionTitle: string;
}

export default function MadlibCard({
  template,
  fields,
  values,
  sectionTitle,
}: MadlibCardProps) {
  const elements = parseTemplate(template, fields, values);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
        {sectionTitle}
      </h3>
      <p className="text-xl leading-relaxed text-gray-800">{elements}</p>
    </div>
  );
}

function parseTemplate(
  template: string,
  fields: MadlibField[],
  values: SnapFormData,
): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  const regex = /\{(\w+)\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    // Push text before this placeholder
    if (match.index > lastIndex) {
      elements.push(
        <span key={`text-${lastIndex}`}>
          {template.slice(lastIndex, match.index)}
        </span>,
      );
    }

    const fieldId = match[1];
    const field = fields.find((f) => f.id === fieldId);
    const rawValue = values[fieldId] ?? "";
    const hasValue = rawValue.trim().length > 0;

    if (hasValue) {
      const displayValue =
        field?.sensitive ? maskSSN(rawValue) : rawValue;
      elements.push(
        <span
          key={`field-${fieldId}`}
          className="inline-flex flex-col items-center mx-1"
        >
          <span className="font-bold text-blue-700 border-b border-blue-200">
            {displayValue}
          </span>
        </span>,
      );
    } else {
      const label = field
        ? field.required
          ? field.label
          : `${field.label} (optional)`
        : fieldId;

      elements.push(
        <span
          key={`blank-${fieldId}`}
          className="inline-flex flex-col items-center mx-1"
        >
          <span className="border-b-2 border-gray-300 min-w-[80px] inline-block">
            &nbsp;
          </span>
          <span className="text-xs text-gray-400">{label}</span>
        </span>,
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Push any trailing text
  if (lastIndex < template.length) {
    elements.push(
      <span key={`text-${lastIndex}`}>{template.slice(lastIndex)}</span>,
    );
  }

  return elements;
}
