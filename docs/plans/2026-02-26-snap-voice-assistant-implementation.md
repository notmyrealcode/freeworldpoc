# SNAP Voice Assistant Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Next.js prototype that uses Google Gemini Live API for voice-based filling of the CalFresh CF 285 Q1 (Applicant Information) form, with a real-time sidebar showing collected data.

**Architecture:** Browser connects directly to Gemini Live API via WebSocket using ephemeral tokens (provisioned by a Next.js API route). Gemini is configured with function-calling tools (`update_field`, `set_current_question`, `mark_complete`) that update React state in real-time. Two-panel UI: left panel shows current question + audio controls, right panel shows structured form data.

**Tech Stack:** Next.js 16 (App Router, TypeScript, Turbopack), `@google/genai` ^1.43.0, Web Audio API, Tailwind CSS v4

**Key references:**
- Design doc: `docs/plans/2026-02-26-snap-voice-assistant-design.md`
- Gemini Live API: https://ai.google.dev/gemini-api/docs/live
- Gemini Live Tools: https://ai.google.dev/gemini-api/docs/live-tools
- Ephemeral Tokens: https://ai.google.dev/gemini-api/docs/ephemeral-tokens
- Model: `gemini-live-2.5-flash-native-audio` (stable GA)

---

### Task 1: Scaffold Next.js project

**Files:**
- Create: entire project scaffold via `create-next-app`
- Create: `.env.local` (API key)

**Step 1: Move existing files out of the way, then scaffold**

The project directory already contains `docs/` and `cf285.pdf` from the design phase. Move them temporarily, scaffold, then restore.

```bash
cd /Users/justin/Documents/fwpoc
mkdir /tmp/fwpoc-existing
mv docs cf285.pdf /tmp/fwpoc-existing/ 2>/dev/null || true
npx create-next-app@latest . --yes
mv /tmp/fwpoc-existing/* . && rm -r /tmp/fwpoc-existing
```

The `--yes` flag uses defaults: TypeScript, Tailwind CSS v4, ESLint, App Router, Turbopack, `@/*` alias.

Expected: Project scaffolded with `app/`, `public/`, `package.json`, `tsconfig.json`, etc. plus the existing `docs/` and `cf285.pdf`.

**Step 2: Install the Google GenAI SDK**

```bash
npm install @google/genai
```

**Step 3: Create `.env.local`**

Create `.env.local` at project root:

```bash
GOOGLE_API_KEY=your-gemini-api-key-here
```

**Step 4: Create `.gitignore` entry for env**

Verify `.gitignore` already contains `.env*.local` (create-next-app adds this by default). If not, add it.

**Step 5: Verify dev server starts**

```bash
npm run dev
```

Visit `http://localhost:3000`. Expected: Next.js default page renders.

**Step 6: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Next.js 16 project with @google/genai"
```

---

### Task 2: Form data types and constants

**Files:**
- Create: `src/app/lib/form-schema.ts`

**Step 1: Create the form field schema**

This file defines all CF 285 Q1 fields, their types, labels, and section groupings. Every other file will import from here.

Create `src/app/lib/form-schema.ts`:

```typescript
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
```

**Step 2: Commit**

```bash
git add src/app/lib/form-schema.ts
git commit -m "feat: add CF 285 Q1 form field schema and types"
```

---

### Task 3: Ephemeral token API route

**Files:**
- Create: `src/app/api/token/route.ts`

This API route creates a Gemini ephemeral token server-side (keeping the real API key secret) and returns it to the browser.

**Step 1: Create the API route**

Create `src/app/api/token/route.ts`:

```typescript
import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { headers } from "next/headers";

// Simple in-memory rate limiter: max 5 tokens per IP per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

export async function POST() {
  const headersList = await headers();
  const ip =
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headersList.get("x-real-ip") ??
    "unknown";

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a minute." },
      { status: 429 }
    );
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_API_KEY not configured" },
      { status: 500 }
    );
  }

  const client = new GoogleGenAI({ apiKey });

  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000);

  try {
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        httpOptions: { apiVersion: "v1alpha" },
      },
    });

    return NextResponse.json({ token: token.name });
  } catch (error) {
    console.error("Failed to create ephemeral token:", error);
    return NextResponse.json(
      { error: "Failed to create ephemeral token" },
      { status: 500 }
    );
  }
}
```

**Step 2: Test the route manually**

Start the dev server and test:

```bash
curl -X POST http://localhost:3000/api/token
```

Expected: `{"token":"some-token-string"}` (or an error if the API key isn't set yet — that's fine for now, we just want no compile errors).

**Step 3: Commit**

```bash
git add src/app/api/token/route.ts
git commit -m "feat: add ephemeral token API route for Gemini Live API"
```

---

### Task 4: Gemini session configuration and system prompt

**Files:**
- Create: `src/app/lib/gemini-config.ts`

This file defines the Gemini Live API session configuration: model, system prompt, function declarations, and audio settings.

**Step 1: Create the config file**

Create `src/app/lib/gemini-config.ts`:

```typescript
import { Modality } from "@google/genai";

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

export const TOOL_DECLARATIONS = [
  {
    name: "update_field",
    description:
      "Update a form field with a confirmed value. Only call this after the applicant has confirmed the value is correct.",
    parameters: {
      type: "object",
      properties: {
        field: {
          type: "string",
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
          type: "string",
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
      type: "object",
      properties: {
        field: {
          type: "string",
          description: "The field ID being asked about",
        },
        question: {
          type: "string",
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
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export const SESSION_CONFIG = {
  responseModalities: [Modality.AUDIO],
  systemInstruction: SYSTEM_INSTRUCTION,
  tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
};
```

**Step 2: Commit**

```bash
git add src/app/lib/gemini-config.ts
git commit -m "feat: add Gemini Live API session config with system prompt and tool declarations"
```

---

### Task 5: Audio capture worklet (mic → 16kHz PCM)

**Files:**
- Create: `public/audio-worklet-processor.js`
- Create: `src/app/lib/audio-capture.ts`

The browser captures mic audio via an AudioWorklet, downsamples to 16kHz mono PCM, and provides base64-encoded chunks to send to Gemini.

**Step 1: Create the AudioWorklet processor**

This runs in a separate thread. It receives raw audio from the mic (usually 44.1kHz or 48kHz), downsamples to 16kHz, converts to 16-bit PCM, and posts chunks to the main thread.

Create `public/audio-worklet-processor.js`:

```javascript
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._targetSampleRate = 16000;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // mono
    const ratio = sampleRate / this._targetSampleRate;

    // Downsample by picking samples at the target rate interval
    for (let i = 0; i < channelData.length; i += ratio) {
      const index = Math.floor(i);
      if (index < channelData.length) {
        // Convert float32 [-1,1] to int16
        const s = Math.max(-1, Math.min(1, channelData[index]));
        this._buffer.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
    }

    // Send chunks of 1600 samples (100ms at 16kHz)
    while (this._buffer.length >= 1600) {
      const chunk = this._buffer.splice(0, 1600);
      const pcm16 = new Int16Array(chunk);
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }

    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
```

**Step 2: Create the audio capture module**

Create `src/app/lib/audio-capture.ts`:

```typescript
export class AudioCapture {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private onChunk: ((base64: string) => void) | null = null;

  async start(onChunk: (base64: string) => void): Promise<void> {
    this.onChunk = onChunk;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: { ideal: 48000 },
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    this.audioContext = new AudioContext({ sampleRate: 48000 });
    await this.audioContext.audioWorklet.addModule("/audio-worklet-processor.js");

    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.audioContext, "audio-capture-processor");

    this.workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const pcmBuffer = event.data;
      const base64 = this.arrayBufferToBase64(pcmBuffer);
      this.onChunk?.(base64);
    };

    source.connect(this.workletNode);
    // Don't connect to destination — we don't want to hear our own mic
  }

  stop(): void {
    this.workletNode?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioContext?.close();
    this.workletNode = null;
    this.stream = null;
    this.audioContext = null;
    this.onChunk = null;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
```

**Step 3: Commit**

```bash
git add public/audio-worklet-processor.js src/app/lib/audio-capture.ts
git commit -m "feat: add AudioWorklet-based mic capture with 16kHz PCM downsampling"
```

---

### Task 6: Audio playback (24kHz PCM from Gemini → speaker)

**Files:**
- Create: `src/app/lib/audio-playback.ts`

Gemini sends base64-encoded 24kHz 16-bit mono PCM. We decode it and play it through an AudioContext.

**Step 1: Create the audio playback module**

Create `src/app/lib/audio-playback.ts`:

```typescript
export class AudioPlayback {
  private audioContext: AudioContext;
  private nextStartTime: number = 0;
  private _isPlaying: boolean = false;
  private activeSources: AudioBufferSourceNode[] = [];
  private onPlayingChange: ((playing: boolean) => void) | null = null;

  constructor(onPlayingChange?: (playing: boolean) => void) {
    this.audioContext = new AudioContext({ sampleRate: 24000 });
    this.onPlayingChange = onPlayingChange ?? null;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  private setPlaying(value: boolean): void {
    if (this._isPlaying !== value) {
      this._isPlaying = value;
      this.onPlayingChange?.(value);
    }
  }

  play(base64Pcm: string): void {
    const pcmBytes = atob(base64Pcm);
    const pcmArray = new Int16Array(pcmBytes.length / 2);
    for (let i = 0; i < pcmBytes.length; i += 2) {
      pcmArray[i / 2] =
        pcmBytes.charCodeAt(i) | (pcmBytes.charCodeAt(i + 1) << 8);
    }

    // Convert int16 to float32 for Web Audio
    const float32 = new Float32Array(pcmArray.length);
    for (let i = 0; i < pcmArray.length; i++) {
      float32[i] = pcmArray[i] / 32768;
    }

    const buffer = this.audioContext.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    const currentTime = this.audioContext.currentTime;
    const startTime = Math.max(currentTime, this.nextStartTime);
    source.start(startTime);
    this.nextStartTime = startTime + buffer.duration;

    this.activeSources.push(source);
    this.setPlaying(true);

    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
      if (this.activeSources.length === 0) {
        this.setPlaying(false);
      }
    };
  }

  interrupt(): void {
    // Stop all active sources without recreating the AudioContext
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // Already stopped
      }
    }
    this.activeSources = [];
    this.nextStartTime = 0;
    this.setPlaying(false);
  }

  async resume(): Promise<void> {
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  close(): void {
    this.interrupt();
    this.audioContext.close();
  }
}
```

**Step 2: Commit**

```bash
git add src/app/lib/audio-playback.ts
git commit -m "feat: add 24kHz PCM audio playback for Gemini Live API responses"
```

---

### Task 7: Gemini Live session hook

**Files:**
- Create: `src/app/hooks/use-gemini-session.ts`

This React hook manages the full lifecycle: fetch ephemeral token → connect to Gemini → stream audio in/out → handle function calls → update form state.

**Step 1: Create the session hook**

Create `src/app/hooks/use-gemini-session.ts`:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL, SESSION_CONFIG } from "@/app/lib/gemini-config";
import { AudioCapture } from "@/app/lib/audio-capture";
import { AudioPlayback } from "@/app/lib/audio-playback";
import { VALID_FIELD_IDS, type SnapFormData } from "@/app/lib/form-schema";

export interface CurrentQuestion {
  field: string;
  question: string;
}

interface UseGeminiSessionReturn {
  isConnected: boolean;
  isComplete: boolean;
  currentQuestion: CurrentQuestion | null;
  formData: SnapFormData;
  error: string | null;
  aiSpeaking: boolean;
  startSession: () => Promise<void>;
  stopSession: () => void;
}

export function useGeminiSession(): UseGeminiSessionReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [currentQuestion, setCurrentQuestion] =
    useState<CurrentQuestion | null>(null);
  const [formData, setFormData] = useState<SnapFormData>({});
  const [error, setError] = useState<string | null>(null);
  const [aiSpeaking, setAiSpeaking] = useState(false);

  const sessionRef = useRef<Awaited<
    ReturnType<InstanceType<typeof GoogleGenAI>["live"]["connect"]>
  > | null>(null);
  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const audioPlaybackRef = useRef<AudioPlayback | null>(null);
  // Track speaking state in a ref for the audio capture callback
  const aiSpeakingRef = useRef(false);

  const handleFunctionCall = useCallback(
    (functionCalls: Array<{ id: string; name: string; args: Record<string, string> }>) => {
      const responses: Array<{
        id: string;
        name: string;
        response: { result: string };
      }> = [];

      for (const fc of functionCalls) {
        switch (fc.name) {
          case "update_field":
            if (!VALID_FIELD_IDS.has(fc.args.field)) {
              console.warn(`Unknown field ID from Gemini: "${fc.args.field}"`);
              responses.push({
                id: fc.id,
                name: fc.name,
                response: {
                  result: `error: unknown field "${fc.args.field}". Valid fields: ${[...VALID_FIELD_IDS].join(", ")}`,
                },
              });
              continue;
            }
            setFormData((prev) => ({
              ...prev,
              [fc.args.field]: fc.args.value,
            }));
            break;

          case "set_current_question":
            setCurrentQuestion({
              field: fc.args.field,
              question: fc.args.question,
            });
            break;

          case "mark_complete":
            setIsComplete(true);
            break;
        }

        responses.push({
          id: fc.id,
          name: fc.name,
          response: { result: "ok" },
        });
      }

      return responses;
    },
    []
  );

  const stopSession = useCallback(() => {
    audioCaptureRef.current?.stop();
    audioCaptureRef.current = null;

    sessionRef.current?.close();
    sessionRef.current = null;

    audioPlaybackRef.current?.close();
    audioPlaybackRef.current = null;

    setIsConnected(false);
    setAiSpeaking(false);
    aiSpeakingRef.current = false;
  }, []);

  const startSession = useCallback(async () => {
    // Guard against double-start
    if (sessionRef.current) {
      return;
    }

    try {
      setError(null);
      setIsComplete(false);
      // Preserve existing formData — don't reset on reconnect
      setCurrentQuestion(null);

      // 1. Get ephemeral token
      const tokenRes = await fetch("/api/token", { method: "POST" });
      if (!tokenRes.ok) {
        throw new Error("Failed to get ephemeral token");
      }
      const { token } = await tokenRes.json();

      // 2. Create GenAI client with ephemeral token
      const ai = new GoogleGenAI({ apiKey: token });

      // 3. Set up audio playback with speaking state callback
      const playback = new AudioPlayback((playing) => {
        setAiSpeaking(playing);
        aiSpeakingRef.current = playing;
      });
      await playback.resume();
      audioPlaybackRef.current = playback;

      // 4. Connect to Gemini Live API
      const session = await ai.live.connect({
        model: GEMINI_MODEL,
        config: SESSION_CONFIG,
        callbacks: {
          onopen: () => {
            setIsConnected(true);
          },
          onmessage: (message: Record<string, unknown>) => {
            // Handle audio response
            const serverContent = message.serverContent as
              | {
                  modelTurn?: {
                    parts?: Array<{
                      inlineData?: { data: string; mimeType: string };
                    }>;
                  };
                  interrupted?: boolean;
                }
              | undefined;

            if (serverContent?.interrupted) {
              playback.interrupt();
            }

            if (serverContent?.modelTurn?.parts) {
              for (const part of serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  playback.play(part.inlineData.data);
                }
              }
            }

            // Handle function calls
            const toolCall = message.toolCall as
              | {
                  functionCalls: Array<{
                    id: string;
                    name: string;
                    args: Record<string, string>;
                  }>;
                }
              | undefined;

            if (toolCall?.functionCalls) {
              const responses = handleFunctionCall(toolCall.functionCalls);
              session.sendToolResponse({
                functionResponses: responses,
              });
            }
          },
          onerror: (e: Error) => {
            console.error("Gemini session error:", e);
            setError(e.message);
          },
          onclose: () => {
            setIsConnected(false);
          },
        },
      });

      sessionRef.current = session;

      // 5. Start mic capture — suppress sending while AI is speaking (echo prevention)
      const capture = new AudioCapture();
      audioCaptureRef.current = capture;

      await capture.start((base64Pcm: string) => {
        // Don't send mic audio while AI is speaking to prevent echo feedback loop
        if (aiSpeakingRef.current) {
          return;
        }
        session.sendRealtimeInput({
          audio: {
            data: base64Pcm,
            mimeType: "audio/pcm;rate=16000",
          },
        });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      console.error("Failed to start session:", err);
    }
  }, [handleFunctionCall, stopSession]);

  // Cleanup on unmount — prevent WebSocket/mic/AudioContext leaks
  useEffect(() => {
    return () => {
      audioCaptureRef.current?.stop();
      sessionRef.current?.close();
      audioPlaybackRef.current?.close();
    };
  }, []);

  return {
    isConnected,
    isComplete,
    currentQuestion,
    formData,
    error,
    aiSpeaking,
    startSession,
    stopSession,
  };
}
```

**Step 2: Commit**

```bash
git add src/app/hooks/use-gemini-session.ts
git commit -m "feat: add useGeminiSession hook with audio streaming and function call handling"
```

---

### Task 8: Form sidebar component

**Files:**
- Create: `src/app/components/form-sidebar.tsx`

The right panel showing collected form data grouped by section with completion status.

**Step 1: Create the sidebar component**

Create `src/app/components/form-sidebar.tsx`:

```tsx
"use client";

import {
  FORM_SECTIONS,
  getFieldsBySection,
  maskSSN,
  type SnapFormData,
  type SectionName,
} from "@/app/lib/form-schema";

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
  const requiredFields = fields.filter((f) => !f.optional);
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

          // Hide mailing address fields if they said "No"
          if (
            field.section === "Mailing Address" &&
            field.id !== "has_different_mailing" &&
            formData.has_different_mailing?.toLowerCase() === "no"
          ) {
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
```

**Step 2: Commit**

```bash
git add src/app/components/form-sidebar.tsx
git commit -m "feat: add form sidebar component with section grouping and completion status"
```

---

### Task 9: Conversation panel component

**Files:**
- Create: `src/app/components/conversation-panel.tsx`

The left panel showing the current question, audio visualizer placeholder, start/stop button, and session timer.

**Step 1: Create the conversation panel component**

Create `src/app/components/conversation-panel.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { CurrentQuestion } from "@/app/hooks/use-gemini-session";

interface ConversationPanelProps {
  isConnected: boolean;
  isComplete: boolean;
  currentQuestion: CurrentQuestion | null;
  error: string | null;
  aiSpeaking: boolean;
  onStart: () => void;
  onStop: () => void;
}

function SessionTimer({
  isRunning,
  onTimeout,
}: {
  isRunning: boolean;
  onTimeout: () => void;
}) {
  const [seconds, setSeconds] = useState(0);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    if (!isRunning) {
      setSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      setSeconds((s) => {
        const next = s + 1;
        // Auto-disconnect at 14:30 before Gemini's 15-min hard limit
        if (next >= 14 * 60 + 30) {
          onTimeoutRef.current();
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning]);

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const isWarning = minutes >= 12;

  return (
    <span
      className={`text-sm font-mono ${isWarning ? "text-red-500" : "text-gray-500"}`}
    >
      {String(minutes).padStart(2, "0")}:{String(secs).padStart(2, "0")}
      {isWarning && " (session limit approaching)"}
    </span>
  );
}

export function ConversationPanel({
  isConnected,
  isComplete,
  currentQuestion,
  error,
  aiSpeaking,
  onStart,
  onStop,
}: ConversationPanelProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      {/* Current question display */}
      <div className="flex-1 flex items-center justify-center w-full max-w-lg">
        {!isConnected && !isComplete && (
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-3">
              CalFresh Application Assistant
            </h2>
            <p className="text-gray-600">
              Click the button below to start a voice conversation. The
              assistant will guide you through the application questions.
            </p>
          </div>
        )}

        {isConnected && currentQuestion && (
          <div className="text-center">
            <p className="text-2xl font-medium text-gray-900 leading-relaxed">
              {currentQuestion.question}
            </p>
          </div>
        )}

        {isConnected && !currentQuestion && (
          <div className="text-center">
            <div className="inline-flex items-center gap-2 text-gray-500">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
              </span>
              {aiSpeaking ? "Assistant is speaking..." : "Listening..."}
            </div>
          </div>
        )}

        {isComplete && (
          <div className="text-center">
            <h2 className="text-2xl font-bold text-green-700 mb-3">
              Section Complete
            </h2>
            <p className="text-gray-600">
              All applicant information has been collected. Review the sidebar to
              verify everything is correct.
            </p>
          </div>
        )}
      </div>

      {/* Audio visualizer placeholder */}
      {isConnected && (
        <div className="w-full max-w-md h-16 mb-6 flex items-center justify-center">
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="w-1.5 bg-blue-500 rounded-full animate-pulse"
                style={{
                  height: `${16 + Math.random() * 24}px`,
                  animationDelay: `${i * 0.15}s`,
                  animationDuration: "0.8s",
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="w-full max-w-md mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col items-center gap-3">
        {!isConnected ? (
          <button
            onClick={onStart}
            disabled={isComplete}
            className="px-8 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold rounded-full text-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            Start Conversation
          </button>
        ) : (
          <button
            onClick={onStop}
            className="px-8 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-full text-lg transition-colors cursor-pointer"
          >
            Stop
          </button>
        )}
        <SessionTimer isRunning={isConnected} onTimeout={onStop} />
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/components/conversation-panel.tsx
git commit -m "feat: add conversation panel with current question display and session controls"
```

---

### Task 10: Main page — assemble the two-panel layout

**Files:**
- Modify: `src/app/page.tsx` (replace default content)
- Modify: `src/app/layout.tsx` (update metadata title)

**Step 1: Update the root layout metadata**

Edit `src/app/layout.tsx` — change the metadata title and description:

```typescript
export const metadata: Metadata = {
  title: "CalFresh Application Assistant",
  description: "Voice-assisted CalFresh (SNAP) application form",
};
```

**Step 2: Replace the main page**

Replace the entire content of `src/app/page.tsx`:

```tsx
"use client";

import { useGeminiSession } from "@/app/hooks/use-gemini-session";
import { ConversationPanel } from "@/app/components/conversation-panel";
import { FormSidebar } from "@/app/components/form-sidebar";

export default function Home() {
  const {
    isConnected,
    isComplete,
    currentQuestion,
    formData,
    error,
    aiSpeaking,
    startSession,
    stopSession,
  } = useGeminiSession();

  return (
    <div className="h-screen flex">
      {/* Left panel — conversation */}
      <div className="flex-1 border-r border-gray-200">
        <ConversationPanel
          isConnected={isConnected}
          isComplete={isComplete}
          currentQuestion={currentQuestion}
          error={error}
          aiSpeaking={aiSpeaking}
          onStart={startSession}
          onStop={stopSession}
        />
      </div>

      {/* Right panel — form sidebar */}
      <div className="w-[400px] bg-gray-50 shrink-0">
        <FormSidebar
          formData={formData}
          activeField={currentQuestion?.field ?? null}
        />
      </div>
    </div>
  );
}
```

**Step 3: Verify it compiles**

```bash
npm run dev
```

Visit `http://localhost:3000`. Expected: Two-panel layout renders — left side shows "CalFresh Application Assistant" with start button, right side shows empty form fields grouped by section.

**Step 4: Commit**

```bash
git add src/app/page.tsx src/app/layout.tsx
git commit -m "feat: assemble main page with two-panel layout"
```

---

### Task 11: End-to-end integration test

This is a manual integration test since the app requires a real microphone and API key.

**Step 1: Set up your real API key**

Edit `.env.local` and add your actual Gemini API key:

```
GOOGLE_API_KEY=<your-real-key>
```

**Step 2: Start the dev server**

```bash
npm run dev
```

**Step 3: Test the flow**

1. Open `http://localhost:3000` in Chrome
2. Click "Start Conversation"
3. Grant microphone permission when prompted
4. Verify: Gemini speaks an introduction and asks for your first name
5. Speak your first name
6. Verify: Gemini spells it back and asks for confirmation
7. Confirm "yes"
8. Verify: Sidebar updates with your first name
9. Continue through a few more fields
10. Say "go back, my first name is wrong" — verify Gemini asks for correction
11. Click "Stop" — verify session disconnects cleanly

**Step 4: Debug common issues**

- **"Failed to get ephemeral token"**: Check that `GOOGLE_API_KEY` is set and valid. Check server console for the actual error from Google's API.
- **No audio from Gemini**: Click anywhere on the page first (browser requires user interaction before audio playback). Check that `AudioContext` is not suspended.
- **Mic not working**: Check browser permissions. Ensure HTTPS or localhost.
- **Function calls not updating sidebar**: Check browser console for errors in the `onmessage` callback.

**Step 5: Fix any issues found, then commit**

```bash
git add -A
git commit -m "fix: address integration testing issues"
```

---

### Task 12: Production build verification

**Step 1: Build for production**

```bash
npm run build
```

Expected: Build succeeds with no errors.

**Step 2: Run the production server**

```bash
npm start
```

Visit `http://localhost:3000`. Verify the same flow works as in the dev server.

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: verify production build"
```

---

## Summary

| Task | What it builds | Key files |
|------|---------------|-----------|
| 1 | Project scaffold | `package.json`, `.env.local` |
| 2 | Form field types and constants | `lib/form-schema.ts` |
| 3 | Ephemeral token API route | `api/token/route.ts` |
| 4 | Gemini config + system prompt | `lib/gemini-config.ts` |
| 5 | Mic capture (AudioWorklet) | `audio-worklet-processor.js`, `lib/audio-capture.ts` |
| 6 | Audio playback (24kHz PCM) | `lib/audio-playback.ts` |
| 7 | Gemini session hook | `hooks/use-gemini-session.ts` |
| 8 | Form sidebar component | `components/form-sidebar.tsx` |
| 9 | Conversation panel component | `components/conversation-panel.tsx` |
| 10 | Main page assembly | `page.tsx`, `layout.tsx` |
| 11 | End-to-end manual test | — |
| 12 | Production build check | — |
