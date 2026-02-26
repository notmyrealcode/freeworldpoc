# SNAP Voice Assistant — Design Document

**Date:** 2026-02-26
**Status:** Approved
**Scope:** Prototype — CF 285 Question 1 (Applicant Information page)

## Problem

Customers filling out the California CalFresh (SNAP) application (CF 285) face a lengthy paper/PDF form. We want to let them complete it via a natural voice conversation instead, with a live sidebar showing collected data for real-time verification and corrections.

## Architecture

Client-direct connection with ephemeral tokens and Gemini function calling.

```
Browser (Next.js client)
├── Audio Engine (Web Audio API)
│   ├── Mic capture: 16kHz mono PCM via AudioWorklet
│   └── Speaker playback: 24kHz mono PCM via AudioContext
├── Gemini WebSocket Client (@google/genai SDK)
│   ├── Connects directly to Gemini Live API
│   ├── Sends/receives audio streams
│   └── Handles function call messages (update_field, set_current_question, mark_complete)
└── React UI
    ├── Left panel: current question display, audio visualizer, start/stop button
    └── Right panel (sidebar): structured form data, progress tracker

Next.js Server
└── API Route: POST /api/token
    └── Creates ephemeral token via @google/genai SDK (v1alpha)
```

### Token Flow

1. Page loads → client calls `GET /api/token`
2. Server creates ephemeral token (1 use, 30 min expiry, 1 min new session window)
3. Client receives token → creates `GoogleGenAI` instance with token as API key
4. Client calls `ai.live.connect()` → direct WebSocket to Gemini

### Audio Flow

1. `navigator.mediaDevices.getUserMedia()` captures mic
2. `AudioWorklet` processes raw audio → downsamples to 16kHz mono PCM
3. PCM chunks sent via `session.sendRealtimeInput({audio: {data, mimeType: "audio/pcm;rate=16000"}})`
4. Gemini responds with base64-encoded 24kHz PCM audio
5. Client decodes and plays via `AudioContext`

### Data Flow (Function Calling)

Gemini is configured with three tools:

#### `update_field`
Called when Gemini confirms a field value with the user.
```json
{
  "field": "first_name",
  "value": "John"
}
```

#### `set_current_question`
Called when Gemini moves to a new question.
```json
{
  "field": "home_address",
  "question": "What is your home address?"
}
```

#### `mark_complete`
Called when all Q1 fields are collected. No parameters.

When the client receives a function call, it:
1. Updates React state (form data or current question)
2. Sends `FunctionResponse` with `{result: "ok"}` back to Gemini
3. Gemini continues the conversation

## UI Layout

Two-panel layout:

**Left panel (conversation area):**
- Current question being asked (large text, updates via `set_current_question`)
- Audio level visualizer (shows mic active / AI speaking)
- Start/Stop conversation button
- Session timer (15 min max)

**Right panel (sidebar):**
- Structured form data grouped by section
- Each field shows current value or "—" if not yet collected
- Progress tracker showing section completion status (checkmark, in-progress, pending)

## Form Fields (CF 285 Q1)

| Field ID | Label | Type |
|---|---|---|
| `first_name` | First Name | text |
| `middle_name` | Middle Name | text |
| `last_name` | Last Name | text |
| `other_names` | Other Names (maiden, nicknames) | text |
| `ssn` | Social Security Number | text |
| `home_address` | Home Address | text |
| `home_city` | City | text |
| `home_state` | State | text |
| `home_zip` | ZIP Code | text |
| `has_different_mailing` | Mailing address different? | yes/no |
| `mailing_address` | Mailing Address | text |
| `mailing_city` | City | text |
| `mailing_state` | State | text |
| `mailing_zip` | ZIP Code | text |
| `home_phone` | Home Phone | text |
| `cell_phone` | Cell Phone | text |
| `work_phone` | Work/Alt Phone | text |
| `email` | Email Address | text |
| `text_opt_in` | OK to text? | yes/no |
| `is_homeless` | Homeless? | yes/no |
| `preferred_read_language` | Preferred read language | text |
| `preferred_speak_language` | Preferred speak language | text |
| `is_deaf_hard_of_hearing` | Deaf/hard of hearing? | yes/no |
| `has_disability` | Has disability? | yes/no |
| `needs_accommodation` | Needs accommodation? | yes/no |
| `domestic_violence_history` | History of domestic violence? | yes/no |
| `interested_in_medical` | Interested in Medi-Cal? | yes/no |
| `expedited_low_income` | Gross income < $150 & cash < $100? | yes/no |
| `expedited_housing_costs` | Housing costs > income + cash? | yes/no |
| `expedited_migrant` | Migrant farmworker? | yes/no |

## System Prompt Direction

Gemini will be instructed to:
- Introduce itself as a CalFresh application assistant
- Ask for each field conversationally, not like a robot reading a form
- Spell back names and addresses letter by letter for confirmation
- Ask "Did I get that right?" after spelling back
- Only call `update_field` after the user confirms
- Call `set_current_question` when moving to a new topic
- Handle corrections gracefully when user says "go back" or "that's wrong"
- Be sensitive with screening questions (disability, domestic violence) — explain they're optional
- Skip mailing address fields if user says it's the same as home address
- Call `mark_complete` when all fields are filled

## Tech Stack

- **Next.js 16** (App Router, React 19.2, Turbopack)
- **`@google/genai` ^1.43.0** — ephemeral tokens + Live API connection
- **Web Audio API** — mic capture and speaker playback
- **Tailwind CSS v4** — styling
- **React state** (`useState`) — form data and UI state

## Session Constraints

- Audio-only sessions: 15 min max
- Reconnect required every 10 min (same ephemeral token)
- Ephemeral token API is `v1alpha` (preview)
- Context window: 128k tokens (native audio models)

## Out of Scope (Prototype)

- Form pages beyond Q1
- Data persistence / database
- PDF generation
- Multi-language audio support
- Authentication / user accounts
- Mobile-specific UI optimizations
