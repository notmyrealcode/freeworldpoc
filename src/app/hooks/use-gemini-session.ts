"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI, type LiveServerMessage } from "@google/genai";
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

        switch (name) {
          case "update_field":
            if (!VALID_FIELD_IDS.has(args.field)) {
              console.warn(`Unknown field ID from Gemini: "${args.field}"`);
              responses.push({
                id,
                name,
                response: {
                  result: `error: unknown field "${args.field}". Valid fields: ${[...VALID_FIELD_IDS].join(", ")}`,
                },
              });
              continue;
            }
            setFormData((prev: SnapFormData) => ({
              ...prev,
              [args.field]: args.value,
            }));
            break;

          case "set_current_question":
            setCurrentQuestion({
              field: args.field,
              question: args.question,
            });
            break;

          case "mark_complete":
            setIsComplete(true);
            break;
        }

        responses.push({
          id,
          name,
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
      const playback = new AudioPlayback((playing: boolean) => {
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
          onmessage: (message: LiveServerMessage) => {
            // Handle audio response
            if (message.serverContent?.interrupted) {
              playback.interrupt();
            }

            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  playback.play(part.inlineData.data);
                }
              }
            }

            // Handle function calls
            if (message.toolCall?.functionCalls) {
              const responses = handleFunctionCall(message.toolCall.functionCalls);
              session.sendToolResponse({
                functionResponses: responses,
              });
            }
          },
          onerror: (e: ErrorEvent) => {
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
  }, [handleFunctionCall]);

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
