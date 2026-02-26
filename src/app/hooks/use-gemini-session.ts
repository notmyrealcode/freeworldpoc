"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI, type LiveServerMessage } from "@google/genai";
import { GEMINI_MODEL, SESSION_CONFIG } from "@/app/lib/gemini-config";
import { AudioCapture } from "@/app/lib/audio-capture";
import { AudioPlayback } from "@/app/lib/audio-playback";
import { type SnapFormData } from "@/app/lib/form-schema";
import {
  FIELD_ORDER,
  fieldIndex,
  completedFieldsSummary,
  type FieldDefinition,
} from "@/app/lib/field-definitions";

export interface CurrentQuestion {
  field: string;
  question: string;
}

export interface ConfirmationPrompt {
  field: string;
  value: string;
  prompt: string;
}

// Voice activity states for the UI:
//   "listening"   — model's turn is complete, waiting for user input
//   "processing"  — model turn started but audio hasn't begun yet
//   "speaking"    — model audio is playing
export type VoiceStatus = "listening" | "processing" | "speaking";

export type FieldMachineState =
  | "idle"
  | "welcome"
  | "asking"
  | "confirming"
  | "correcting"
  | "summary"
  | "done";

interface FieldState {
  currentIndex: number;
  returnToIndex: number | null;
  machineState: FieldMachineState;
}

interface UseGeminiSessionReturn {
  isConnected: boolean;
  isPaused: boolean;
  isComplete: boolean;
  currentQuestion: CurrentQuestion | null;
  confirmationPrompt: ConfirmationPrompt | null;
  formData: SnapFormData;
  error: string | null;
  voiceStatus: VoiceStatus;
  machineState: FieldMachineState;
  startSession: () => Promise<void>;
  stopSession: () => void;
  pauseSession: () => void;
  resumeSession: () => void;
}

export function useGeminiSession(): UseGeminiSessionReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [currentQuestion, setCurrentQuestion] =
    useState<CurrentQuestion | null>(null);
  const [confirmationPrompt, setConfirmationPrompt] =
    useState<ConfirmationPrompt | null>(null);
  const [formData, setFormData] = useState<SnapFormData>({});
  const [error, setError] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("listening");

  const [fieldState, setFieldState] = useState<FieldState>({
    currentIndex: 0,
    returnToIndex: null,
    machineState: "idle",
  });
  const fieldStateRef = useRef<FieldState>(fieldState);
  fieldStateRef.current = fieldState;
  const formDataRef = useRef<SnapFormData>(formData);
  formDataRef.current = formData;

  const sessionRef = useRef<Awaited<
    ReturnType<InstanceType<typeof GoogleGenAI>["live"]["connect"]>
  > | null>(null);
  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const audioPlaybackRef = useRef<AudioPlayback | null>(null);
  // Track speaking state in a ref for the audio capture callback
  const aiSpeakingRef = useRef(false);
  // Track paused state in a ref so the onmessage closure can check it
  const pausedRef = useRef(false);

  const sendFieldMessage = useCallback(
    (field: FieldDefinition, isCorrection: boolean, currentFormData: SnapFormData) => {
      const session = sessionRef.current;
      if (!session) return;

      const completed = completedFieldsSummary(currentFormData);
      const typeLabel = field.required ? `${field.type}, required` : `${field.type}, optional`;
      const hints = field.hints ? `Hints: ${field.hints}` : "Hints: (none)";

      let text: string;
      if (isCorrection) {
        const currentValue = currentFormData[field.id] ?? "(no value)";
        text = [
          `Correction: ${field.id}`,
          `Label: ${field.label}`,
          `Type: ${typeLabel}`,
          `Current value: ${currentValue}`,
          hints,
          `Previously completed: ${completed}`,
          "",
          "The user wants to correct this value. Ask them for the updated value.",
        ].join("\n");
      } else {
        text = [
          `Next field: ${field.id}`,
          `Label: ${field.label}`,
          `Type: ${typeLabel}`,
          hints,
          `Previously completed: ${completed}`,
          "",
          "Ask the user for this value.",
        ].join("\n");
      }

      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      });
    },
    []
  );

  const sendResumeFieldMessage = useCallback(
    (field: FieldDefinition, currentFormData: SnapFormData) => {
      const session = sessionRef.current;
      if (!session) return;

      const completed = completedFieldsSummary(currentFormData);
      const typeLabel = field.required ? `${field.type}, required` : `${field.type}, optional`;
      const hints = field.hints ? `Hints: ${field.hints}` : "Hints: (none)";

      const text = [
        `Resuming: ${field.id}`,
        `Label: ${field.label}`,
        `Type: ${typeLabel}`,
        hints,
        `Previously completed: ${completed}`,
        "",
        "A correction was just completed. Continue collecting this field from where you left off.",
      ].join("\n");

      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      });
    },
    []
  );

  const advanceToNextField = useCallback(
    (fromIndex: number, currentFormData: SnapFormData) => {
      let nextIndex = fromIndex;
      while (nextIndex < FIELD_ORDER.length) {
        const field = FIELD_ORDER[nextIndex];
        if (field.skipIf && field.skipIf(currentFormData)) {
          nextIndex++;
          continue;
        }
        break;
      }

      if (nextIndex >= FIELD_ORDER.length) {
        setFieldState((prev) => ({
          ...prev,
          currentIndex: nextIndex,
          machineState: "summary",
        }));
        setCurrentQuestion(null);
        sessionRef.current?.sendClientContent({
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: "All fields have been collected. Please summarize everything you've gathered and ask if it all looks correct. If the user confirms, call mark_complete to finish.",
                },
              ],
            },
          ],
          turnComplete: true,
        });
      } else {
        const field = FIELD_ORDER[nextIndex];
        setFieldState((prev) => ({
          ...prev,
          currentIndex: nextIndex,
          machineState: "asking",
        }));
        setCurrentQuestion({ field: field.id, question: field.label });
        sendFieldMessage(field, false, currentFormData);
      }
    },
    [sendFieldMessage]
  );

  const handleFunctionCall = useCallback(
    (functionCalls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>) => {
      const responses: Array<{
        id: string;
        name: string;
        response: { result: string };
      }> = [];

      for (const fc of functionCalls) {
        const args = (fc.args ?? {}) as Record<string, string>;
        const id = fc.id ?? "";
        const name = fc.name ?? "";
        const fs = fieldStateRef.current;
        const currentField = FIELD_ORDER[fs.currentIndex];

        switch (name) {
          case "confirm_value": {
            setConfirmationPrompt({
              field: currentField?.id ?? "",
              value: args.value,
              prompt: args.prompt,
            });
            setFieldState((prev) => ({
              ...prev,
              machineState: "confirming",
            }));
            responses.push({
              id,
              name,
              response: {
                result:
                  "Value is now displayed on screen. STOP and wait for the user to verbally confirm or deny before calling field_complete. Do NOT call field_complete yet.",
              },
            });
            return responses;
          }

          case "field_complete": {
            const confirmedValue = args.value;
            const fieldId = currentField?.id;

            if (fieldId) {
              const updatedFormData = { ...formDataRef.current, [fieldId]: confirmedValue };
              setFormData(updatedFormData);
              formDataRef.current = updatedFormData;

              setConfirmationPrompt(null);

              if (fs.returnToIndex !== null) {
                const returnIdx = fs.returnToIndex;
                setFieldState({
                  currentIndex: returnIdx,
                  returnToIndex: null,
                  machineState: "asking",
                });
                const returnField = FIELD_ORDER[returnIdx];
                if (returnField) {
                  setCurrentQuestion({
                    field: returnField.id,
                    question: returnField.label,
                  });
                  sendResumeFieldMessage(returnField, updatedFormData);
                }
              } else {
                advanceToNextField(fs.currentIndex + 1, updatedFormData);
              }
            }

            responses.push({ id, name, response: { result: "ok" } });
            break;
          }

          case "request_correction": {
            const targetFieldId = args.field_id;
            const targetIndex = fieldIndex(targetFieldId);

            if (targetIndex === -1) {
              responses.push({
                id,
                name,
                response: {
                  result: `error: unknown field "${targetFieldId}". Ask the user to clarify which field they want to correct.`,
                },
              });
              break;
            }

            if (!formDataRef.current[targetFieldId]) {
              responses.push({
                id,
                name,
                response: {
                  result: `Field "${targetFieldId}" hasn't been filled yet. Ask the user which completed field they want to correct.`,
                },
              });
              break;
            }

            setFieldState((prev) => {
              const returnTo = prev.returnToIndex === null ? prev.currentIndex : prev.returnToIndex;
              return {
                currentIndex: targetIndex,
                returnToIndex: returnTo,
                machineState: "correcting",
              };
            });

            const targetField = FIELD_ORDER[targetIndex];
            setCurrentQuestion({
              field: targetField.id,
              question: targetField.label,
            });
            setConfirmationPrompt(null);
            sendFieldMessage(targetField, true, formDataRef.current);

            responses.push({ id, name, response: { result: "ok" } });
            break;
          }

          case "mark_complete": {
            setFieldState((prev) => ({
              ...prev,
              machineState: "done",
            }));
            setIsComplete(true);
            setConfirmationPrompt(null);
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
    [advanceToNextField, sendFieldMessage, sendResumeFieldMessage]
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
    setFieldState({
      currentIndex: 0,
      returnToIndex: null,
      machineState: "idle",
    });
  }, []);

  const pauseSession = useCallback(() => {
    pausedRef.current = true;
    audioCaptureRef.current?.pause();
    audioPlaybackRef.current?.pause();
    setIsPaused(true);
    setVoiceStatus("listening");
    aiSpeakingRef.current = false;
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
      setCurrentQuestion(null);
      setConfirmationPrompt(null);

      // 1. Get ephemeral token
      const tokenRes = await fetch("/api/token", { method: "POST" });
      if (!tokenRes.ok) {
        throw new Error("Failed to get ephemeral token");
      }
      const { token } = await tokenRes.json();

      // 2. Create GenAI client with ephemeral token (v1alpha required for ephemeral tokens)
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });

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
      const session = await ai.live.connect({
        model: GEMINI_MODEL,
        config: SESSION_CONFIG,
        callbacks: {
          onopen: () => {
            setIsConnected(true);
          },
          onmessage: (message: LiveServerMessage) => {
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
              // Only set listening if playback has already stopped;
              // otherwise the playback onended callback will handle it
              if (!playback.isPlaying) {
                setVoiceStatus("listening");
              }

              // After welcome turn completes, send the first field
              const fs = fieldStateRef.current;
              if (fs.machineState === "welcome") {
                fieldStateRef.current = { ...fs, machineState: "asking" };

                const currentFormData = formDataRef.current;
                let firstIdx = 0;
                while (firstIdx < FIELD_ORDER.length) {
                  const f = FIELD_ORDER[firstIdx];
                  if (f.skipIf && f.skipIf(currentFormData)) {
                    firstIdx++;
                    continue;
                  }
                  break;
                }
                if (firstIdx < FIELD_ORDER.length) {
                  const field = FIELD_ORDER[firstIdx];
                  setFieldState({
                    currentIndex: firstIdx,
                    returnToIndex: null,
                    machineState: "asking",
                  });
                  setCurrentQuestion({ field: field.id, question: field.label });
                  sendFieldMessage(field, false, currentFormData);
                }
              }
            }

            // Handle function calls — use ref to avoid sending on dead socket
            if (message.toolCall?.functionCalls) {
              setVoiceStatus("processing");
              aiSpeakingRef.current = false; // tool calls don't produce audio
              const responses = handleFunctionCall(message.toolCall.functionCalls);
              sessionRef.current?.sendToolResponse({
                functionResponses: responses,
              });
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error("Gemini session error:", e.message || e.error || e);
            setError(e.message || "WebSocket connection error");
          },
          onclose: () => {
            cleanup();
          },
        },
      });

      sessionRef.current = session;

      // 5. Kick off the conversation before starting mic capture —
      //    sending text and audio simultaneously confuses Gemini's turn-taking
      setFieldState({
        currentIndex: 0,
        returnToIndex: null,
        machineState: "welcome",
      });

      try {
        session.sendClientContent({
          turns: [
            {
              role: "user",
              parts: [{ text: "Hi, I'm ready to start the application." }],
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
  }, [handleFunctionCall, cleanup, sendFieldMessage]);

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
    currentQuestion,
    confirmationPrompt,
    formData,
    error,
    voiceStatus,
    machineState: fieldState.machineState,
    startSession,
    stopSession,
    pauseSession,
    resumeSession,
  };
}
