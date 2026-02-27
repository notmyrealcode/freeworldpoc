"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI, type LiveServerMessage } from "@google/genai";
import { GEMINI_MODEL, SESSION_CONFIG } from "@/app/lib/gemini-config";
import { AudioCapture } from "@/app/lib/audio-capture";
import { AudioPlayback } from "@/app/lib/audio-playback";
import { type SnapFormData } from "@/app/lib/form-schema";
import {
  MADLIB_SECTIONS,
  getSectionFieldIds,
  type MadlibSection,
  type MadlibConditional,
} from "@/app/lib/madlib-templates";

// Voice activity states for the UI:
//   "listening"   — model's turn is complete, waiting for user input
//   "processing"  — model turn started but audio hasn't begun yet
//   "speaking"    — model audio is playing
export type VoiceStatus = "listening" | "processing" | "speaking";

type SectionMachineState =
  | "idle"
  | "welcome"
  | "prompting"
  | "reviewing"
  | "conditional"
  | "summary"
  | "done";

interface SectionState {
  currentSectionIndex: number;
  machineState: SectionMachineState;
}

interface UseGeminiSessionReturn {
  isConnected: boolean;
  isPaused: boolean;
  isComplete: boolean;
  activeMadlib: MadlibSection | null;
  activeConditional: MadlibConditional | null;
  formData: SnapFormData;
  error: string | null;
  voiceStatus: VoiceStatus;
  getFrequencyData: () => Uint8Array | null;
  startSession: () => Promise<void>;
  stopSession: () => void;
  pauseSession: () => void;
  resumeSession: () => void;
}

// --- Pure helper: build the text instruction sent to Gemini for a section ---

function buildSectionInstruction(
  section: MadlibSection,
  conditional?: MadlibConditional,
): string {
  const template = conditional?.template ?? section.template;
  const fields = conditional?.fields ?? section.fields;

  const lines = [
    conditional
      ? `Follow-up for: ${section.section}`
      : `Section: ${section.section}`,
    `Template: "${template}"`,
    "",
    "Fields:",
  ];

  for (const f of fields) {
    const req = f.required ? "required" : "optional";
    const hint = f.hints ? ` (${f.hints})` : "";
    lines.push(`  - ${f.id}: "${f.label}" [${req}]${hint}`);
  }

  if (!conditional && section.conditionals) {
    lines.push("");
    lines.push("Conditional follow-ups:");
    for (const cond of section.conditionals) {
      lines.push(
        `  - If ${cond.triggerField} matches "${cond.triggerValue}", a follow-up will appear. Handle it before calling next_section.`,
      );
    }
  }

  return lines.join("\n");
}

export function useGeminiSession(): UseGeminiSessionReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [formData, setFormData] = useState<SnapFormData>({});
  const [error, setError] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("listening");

  const [sectionState, setSectionState] = useState<SectionState>({
    currentSectionIndex: 0,
    machineState: "idle",
  });
  const sectionStateRef = useRef<SectionState>(sectionState);
  sectionStateRef.current = sectionState;
  const formDataRef = useRef<SnapFormData>(formData);
  formDataRef.current = formData;

  const [activeMadlib, setActiveMadlib] = useState<MadlibSection | null>(null);
  const [activeConditional, setActiveConditional] =
    useState<MadlibConditional | null>(null);
  const activeConditionalRef = useRef<MadlibConditional | null>(null);

  const sessionRef = useRef<Awaited<
    ReturnType<InstanceType<typeof GoogleGenAI>["live"]["connect"]>
  > | null>(null);
  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const audioPlaybackRef = useRef<AudioPlayback | null>(null);
  // Track speaking state in a ref for the audio capture callback
  const aiSpeakingRef = useRef(false);
  // Track paused state in a ref so the onmessage closure can check it
  const pausedRef = useRef(false);

  // --- Tool handler ---

  const handleFunctionCall = useCallback(
    (
      functionCalls: Array<{
        id?: string;
        name?: string;
        args?: Record<string, unknown>;
      }>,
    ) => {
      const responses: Array<{
        id: string;
        name: string;
        response: { result: string };
      }> = [];

      for (const fc of functionCalls) {
        const args = (fc.args ?? {}) as Record<string, unknown>;
        const id = fc.id ?? "";
        const name = fc.name ?? "";
        const ss = sectionStateRef.current;
        const currentSection = MADLIB_SECTIONS[ss.currentSectionIndex];

        switch (name) {
          case "complete_section": {
            const fieldsMap = (args.fields ?? {}) as Record<string, string>;
            console.log(
              "[complete_section]",
              fieldsMap,
              "machineState:",
              ss.machineState,
            );

            // Merge all values into formData
            const updatedFormData = { ...formDataRef.current };
            const targetFields = activeConditionalRef.current
              ? activeConditionalRef.current.fields
              : currentSection?.fields ?? [];

            for (const f of targetFields) {
              const val = fieldsMap[f.id] ?? "";
              if (val || !f.required) {
                updatedFormData[f.id] = val;
              }
            }
            setFormData(updatedFormData);
            formDataRef.current = updatedFormData;

            // Check for conditionals
            if (
              currentSection &&
              !activeConditionalRef.current &&
              currentSection.conditionals
            ) {
              for (const cond of currentSection.conditionals) {
                const triggerVal = updatedFormData[cond.triggerField] ?? "";
                // Normalize: "is"/"yes" trigger, "do"/"yes" trigger
                const normalized = triggerVal.toLowerCase();
                const condValue = cond.triggerValue.toLowerCase();
                const matches =
                  normalized === condValue ||
                  (normalized === "yes" &&
                    ["is", "do", "have", "am"].includes(condValue)) ||
                  (condValue === "yes" &&
                    ["is", "do", "have", "am"].includes(normalized));

                if (matches) {
                  setActiveConditional(cond);
                  activeConditionalRef.current = cond;
                  const newState: SectionState = {
                    ...ss,
                    machineState: "conditional",
                  };
                  setSectionState(newState);
                  sectionStateRef.current = newState;

                  const conditionalInstruction = buildSectionInstruction(
                    currentSection,
                    cond,
                  );
                  responses.push({
                    id,
                    name,
                    response: { result: conditionalInstruction },
                  });
                  // Early return — skip further processing
                  return responses;
                }
              }
            }

            // No conditional triggered (or already handling conditional) — go to reviewing
            const newState: SectionState = {
              ...ss,
              machineState: "reviewing",
            };
            setSectionState(newState);
            sectionStateRef.current = newState;
            setActiveConditional(null);
            activeConditionalRef.current = null;

            responses.push({
              id,
              name,
              response: {
                result: "OK. Do not speak. Wait for the user's response.",
              },
            });
            break;
          }

          case "fix_field": {
            const fieldId = args.field_id as string;
            const value = args.value as string;
            console.log(
              "[fix_field]",
              fieldId,
              "=",
              value,
              "machineState:",
              ss.machineState,
            );

            // Validate field belongs to current section
            const allFieldIds = currentSection
              ? getSectionFieldIds(currentSection)
              : [];
            if (!allFieldIds.includes(fieldId)) {
              responses.push({
                id,
                name,
                response: {
                  result: `error: unknown field "${fieldId}" in current section. Valid fields: ${allFieldIds.join(", ")}`,
                },
              });
              break;
            }

            const updatedFormData = {
              ...formDataRef.current,
              [fieldId]: value,
            };
            setFormData(updatedFormData);
            formDataRef.current = updatedFormData;

            responses.push({
              id,
              name,
              response: {
                result: "OK. Do not speak. Wait for the user's response.",
              },
            });
            break;
          }

          case "next_section": {
            console.log("[next_section] machineState:", ss.machineState);
            if (ss.machineState !== "reviewing") {
              responses.push({
                id,
                name,
                response: {
                  result:
                    "PROTOCOL VIOLATION: next_section is only valid in reviewing state. Wait for the user to confirm the section looks correct.",
                },
              });
              break;
            }

            const nextIdx = ss.currentSectionIndex + 1;
            if (nextIdx >= MADLIB_SECTIONS.length) {
              // All sections done — go to summary
              const newState: SectionState = {
                currentSectionIndex: nextIdx,
                machineState: "summary",
              };
              setSectionState(newState);
              sectionStateRef.current = newState;
              setActiveMadlib(null);
              setActiveConditional(null);
              activeConditionalRef.current = null;

              responses.push({
                id,
                name,
                response: {
                  result:
                    "All sections complete. Please briefly summarize what was collected and ask if everything looks correct. If the user confirms, call mark_complete.",
                },
              });
            } else {
              // Advance to next section
              const nextSection = MADLIB_SECTIONS[nextIdx];
              const newState: SectionState = {
                currentSectionIndex: nextIdx,
                machineState: "prompting",
              };
              setSectionState(newState);
              sectionStateRef.current = newState;
              setActiveMadlib(nextSection);
              setActiveConditional(null);
              activeConditionalRef.current = null;

              const instruction = buildSectionInstruction(nextSection);
              responses.push({
                id,
                name,
                response: { result: instruction },
              });
            }
            break;
          }

          case "mark_complete": {
            if (ss.machineState !== "summary") {
              responses.push({
                id,
                name,
                response: {
                  result:
                    "PROTOCOL VIOLATION: mark_complete is only valid after all sections have been completed and summarized.",
                },
              });
              break;
            }
            const newState: SectionState = { ...ss, machineState: "done" };
            setSectionState(newState);
            sectionStateRef.current = newState;
            setIsComplete(true);
            responses.push({ id, name, response: { result: "ok" } });
            break;
          }

          default: {
            responses.push({
              id,
              name,
              response: { result: `error: unknown tool "${name}"` },
            });
          }
        }
      }

      return responses;
    },
    [],
  );

  // Shared cleanup — nulls refs first, then closes resources.
  // Safe to call multiple times (idempotent).
  const cleanup = useCallback(() => {
    const capture = audioCaptureRef.current;
    const playback = audioPlaybackRef.current;

    // Null refs before closing so callbacks see null and no-op
    audioCaptureRef.current = null;
    audioPlaybackRef.current = null;
    sessionRef.current = null;

    capture?.stop();
    playback?.close();

    setIsConnected(false);
    setIsPaused(false);
    setVoiceStatus("listening");
    aiSpeakingRef.current = false;
    pausedRef.current = false;
    setSectionState({ currentSectionIndex: 0, machineState: "idle" });
    sectionStateRef.current = { currentSectionIndex: 0, machineState: "idle" };
    setActiveMadlib(null);
    setActiveConditional(null);
    activeConditionalRef.current = null;
  }, []);

  const pauseSession = useCallback(() => {
    pausedRef.current = true;
    audioCaptureRef.current?.pause();
    audioPlaybackRef.current?.pause();
    setIsPaused(true);
    setVoiceStatus("listening");
    aiSpeakingRef.current = false;
  }, []);

  const getFrequencyData = useCallback((): Uint8Array | null => {
    return audioPlaybackRef.current?.getFrequencyData() ?? null;
  }, []);

  const resumeSession = useCallback(() => {
    pausedRef.current = false;
    audioCaptureRef.current?.resume();
    audioPlaybackRef.current?.unpause();
    setIsPaused(false);
  }, []);

  const stopSession = useCallback(() => {
    const session = sessionRef.current;
    cleanup();
    session?.close();
  }, [cleanup]);

  const startSession = useCallback(async () => {
    // Guard against double-start
    if (sessionRef.current) {
      return;
    }

    try {
      setError(null);
      setIsComplete(false);
      // Preserve existing formData — don't reset on reconnect

      // 1. Get ephemeral token
      const tokenRes = await fetch("/api/token", { method: "POST" });
      if (!tokenRes.ok) {
        throw new Error("Failed to get ephemeral token");
      }
      const { token } = await tokenRes.json();

      // 2. Create GenAI client with ephemeral token (v1alpha required for ephemeral tokens)
      const ai = new GoogleGenAI({
        apiKey: token,
        httpOptions: { apiVersion: "v1alpha" },
      });

      // 3. Set up audio playback with speaking state callback
      const playback = new AudioPlayback((playing: boolean) => {
        if (playing) {
          setVoiceStatus("speaking");
        } else {
          setVoiceStatus("listening");
        }
        aiSpeakingRef.current = playing;
      });
      await playback.resumeAudioContext();
      audioPlaybackRef.current = playback;

      // 4. Connect to Gemini Live API
      console.log(
        "[session] connecting with config:",
        JSON.stringify(SESSION_CONFIG, null, 2),
      );
      const session = await ai.live.connect({
        model: GEMINI_MODEL,
        config: SESSION_CONFIG,
        callbacks: {
          onopen: () => {
            setIsConnected(true);
          },
          onmessage: (message: LiveServerMessage) => {
            // Log message types (skip audio data to avoid console spam)
            const msgTypes = Object.keys(message).filter(
              (k) =>
                k !== "serverContent" || !message.serverContent?.modelTurn,
            );
            if (
              msgTypes.length > 0 ||
              message.serverContent?.turnComplete ||
              message.toolCall
            ) {
              console.log(
                "[ws-msg]",
                message.toolCall
                  ? "toolCall"
                  : message.serverContent?.turnComplete
                    ? "turnComplete"
                    : message.serverContent?.modelTurn
                      ? "audio"
                      : JSON.stringify(message).slice(0, 200),
              );
            }
            // Discard incoming data while paused so the session doesn't
            // advance to questions the user never heard
            if (pausedRef.current) return;

            // Handle audio response
            if (message.serverContent?.interrupted) {
              playback.interrupt();
            }

            // Model turn started — show "processing" until audio arrives
            if (message.serverContent?.modelTurn) {
              if (!playback.isPlaying) {
                setVoiceStatus("processing");
              }
              for (const part of message.serverContent.modelTurn.parts ?? []) {
                if (part.inlineData?.data) {
                  playback.play(part.inlineData.data);
                }
              }
            }

            // Model turn complete — back to listening
            if (message.serverContent?.turnComplete) {
              console.log(
                "[turnComplete] machineState:",
                sectionStateRef.current.machineState,
                "isPlaying:",
                playback.isPlaying,
                "aiSpeaking:",
                aiSpeakingRef.current,
              );

              // After welcome turn completes, send the first section
              const ss = sectionStateRef.current;
              if (ss.machineState === "welcome") {
                setVoiceStatus("processing");
                aiSpeakingRef.current = true;

                const firstSection = MADLIB_SECTIONS[0];
                const newState: SectionState = {
                  currentSectionIndex: 0,
                  machineState: "prompting",
                };
                setSectionState(newState);
                sectionStateRef.current = newState;
                setActiveMadlib(firstSection);

                const instruction = buildSectionInstruction(firstSection);
                session.sendClientContent({
                  turns: [
                    { role: "user", parts: [{ text: instruction }] },
                  ],
                  turnComplete: true,
                });
              } else {
                // Normal turn complete — back to listening
                if (!playback.isPlaying) {
                  setVoiceStatus("listening");
                }
              }
            }

            // Handle function calls — use ref to avoid sending on dead socket
            if (message.toolCall?.functionCalls) {
              console.log(
                "[tool-call] received:",
                message.toolCall.functionCalls
                  .map(
                    (fc) => `${fc.name}(${JSON.stringify(fc.args)})`,
                  )
                  .join(", "),
              );
              setVoiceStatus("processing");
              aiSpeakingRef.current = false; // tool calls don't produce audio
              const responses = handleFunctionCall(
                message.toolCall.functionCalls,
              );
              console.log(
                "[tool-call] responses:",
                responses
                  .map(
                    (r) =>
                      `${r.name} → ${r.response.result.slice(0, 80)}`,
                  )
                  .join(", "),
              );
              sessionRef.current?.sendToolResponse({
                functionResponses: responses,
              });
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error(
              "Gemini session error:",
              e.message || e.error || e,
            );
            setError(e.message || "WebSocket connection error");
          },
          onclose: (e: CloseEvent) => {
            console.error("[session] closed:", e.code, e.reason);
            cleanup();
          },
        },
      });

      sessionRef.current = session;

      // 5. Kick off the conversation before starting mic capture —
      //    sending text and audio simultaneously confuses Gemini's turn-taking
      setSectionState({ currentSectionIndex: 0, machineState: "welcome" });
      sectionStateRef.current = {
        currentSectionIndex: 0,
        machineState: "welcome",
      };

      try {
        session.sendClientContent({
          turns: [
            {
              role: "user",
              parts: [
                { text: "Hi, I'm ready to start the application." },
              ],
            },
          ],
          turnComplete: true,
        });
        // Gemini will respond with audio — mark as processing immediately
        // so the UI shows status instead of "Listening..."
        setVoiceStatus("processing");
        aiSpeakingRef.current = true;
      } catch (e) {
        console.warn("Failed to send kick-off message:", e);
      }

      // 6. Start mic capture — suppress sending while AI is speaking (echo prevention)
      const capture = new AudioCapture();
      audioCaptureRef.current = capture;

      await capture.start((base64Pcm: string) => {
        // Don't send mic audio while AI is speaking to prevent echo feedback loop
        if (aiSpeakingRef.current) {
          return;
        }
        // Use the ref — the local `session` variable stays alive after close,
        // but the ref is nulled out on disconnect, preventing sends on a dead socket
        sessionRef.current?.sendRealtimeInput({
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
      // Clean up any partially-created resources (e.g. session connected
      // but mic permission denied — would leak WebSocket + AudioContext)
      const session = sessionRef.current;
      cleanup();
      session?.close();
    }
  }, [handleFunctionCall, cleanup]);

  // Cleanup on unmount — prevent WebSocket/mic/AudioContext leaks
  useEffect(() => {
    return () => {
      const session = sessionRef.current;
      audioCaptureRef.current?.stop();
      audioCaptureRef.current = null;
      audioPlaybackRef.current?.close();
      audioPlaybackRef.current = null;
      sessionRef.current = null;
      session?.close();
    };
  }, []);

  return {
    isConnected,
    isPaused,
    isComplete,
    activeMadlib,
    activeConditional,
    formData,
    error,
    voiceStatus,
    getFrequencyData,
    startSession,
    stopSession,
    pauseSession,
    resumeSession,
  };
}
