"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CurrentQuestion,
  ConfirmationPrompt,
  VoiceStatus,
} from "@/app/hooks/use-gemini-session";

interface ConversationPanelProps {
  isConnected: boolean;
  isPaused: boolean;
  isComplete: boolean;
  currentQuestion: CurrentQuestion | null;
  confirmationPrompt: ConfirmationPrompt | null;
  error: string | null;
  voiceStatus: VoiceStatus;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
}

function SessionTimer({
  isConnected,
  isPaused,
  onTimeout,
}: {
  isConnected: boolean;
  isPaused: boolean;
  onTimeout: () => void;
}) {
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;
  // Wall-clock time since connect — for Gemini's 15-min hard limit
  const connectTimeRef = useRef<number>(0);

  // Reset when session disconnects, record connect time on start
  useEffect(() => {
    if (isConnected) {
      connectTimeRef.current = Date.now();
    } else {
      setDisplaySeconds(0);
      connectTimeRef.current = 0;
    }
  }, [isConnected]);

  // Display timer ticks only when not paused (shows active conversation time)
  useEffect(() => {
    if (!isConnected || isPaused) return;

    const interval = setInterval(() => {
      setDisplaySeconds((s) => s + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isConnected, isPaused]);

  // Wall-clock auto-disconnect — runs regardless of pause state
  // because Gemini's 15-min limit counts from WebSocket open
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(() => {
      const elapsed = (Date.now() - connectTimeRef.current) / 1000;
      if (elapsed >= 14 * 60 + 30) {
        onTimeoutRef.current();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isConnected]);

  const minutes = Math.floor(displaySeconds / 60);
  const secs = displaySeconds % 60;
  const isWarning = minutes >= 12;

  return (
    <span
      className={`text-sm font-mono ${isWarning ? "text-red-500" : "text-gray-500"}`}
    >
      {String(minutes).padStart(2, "0")}:{String(secs).padStart(2, "0")}
      {isPaused && " (paused)"}
      {!isPaused && isWarning && " (session limit approaching)"}
    </span>
  );
}

export function ConversationPanel({
  isConnected,
  isPaused,
  isComplete,
  currentQuestion,
  confirmationPrompt,
  error,
  voiceStatus,
  onStart,
  onStop,
  onPause,
  onResume,
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

        {isConnected && isPaused && (
          <div className="text-center">
            <div className="inline-flex items-center gap-2 text-amber-600 mb-2">
              <span className="relative flex h-3 w-3">
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
              </span>
              Session Paused
            </div>
            <p className="text-gray-500 text-sm">
              Press Resume to continue the conversation
            </p>
          </div>
        )}

        {/* Confirmation card takes precedence over currentQuestion when active */}
        {isConnected && !isPaused && confirmationPrompt && (
          <div className="text-center w-full">
            <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-6 max-w-md mx-auto">
              <p className="text-sm text-blue-600 font-medium mb-2">
                Please confirm
              </p>
              <p className="text-3xl font-bold text-gray-900 mb-3">
                {confirmationPrompt.value}
              </p>
              <p className="text-gray-600">{confirmationPrompt.prompt}</p>
            </div>
          </div>
        )}

        {isConnected && !isPaused && !confirmationPrompt && currentQuestion && (
          <div className="text-center">
            <p className="text-2xl font-medium text-gray-900 leading-relaxed">
              {currentQuestion.question}
            </p>
            {voiceStatus === "processing" && (
              <span className="inline-flex items-center gap-2 text-sm text-amber-600 mt-3">
                <span className="relative flex h-2 w-2">
                  <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                </span>
                Processing...
              </span>
            )}
          </div>
        )}

        {isConnected && !isPaused && !confirmationPrompt && !currentQuestion && (
          <div className="text-center">
            <div className="inline-flex items-center gap-2 text-gray-500">
              {voiceStatus === "listening" ? (
                <>
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                  </span>
                  Listening...
                </>
              ) : voiceStatus === "processing" ? (
                <>
                  <span className="relative flex h-3 w-3">
                    <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
                  </span>
                  Processing...
                </>
              ) : (
                <>
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
                  </span>
                  Assistant is speaking...
                </>
              )}
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

      {/* Audio visualizer — hidden when paused */}
      {isConnected && !isPaused && (
        <div className="w-full max-w-md h-16 mb-6 flex items-center justify-center">
          <div className="flex items-center gap-1">
            {[20, 32, 24, 36, 28].map((h, i) => (
              <div
                key={i}
                className="w-1.5 bg-blue-500 rounded-full animate-pulse"
                style={{
                  height: `${h}px`,
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
          <div className="flex items-center gap-3">
            {isPaused ? (
              <button
                onClick={onResume}
                className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-full text-lg transition-colors cursor-pointer"
              >
                Resume
              </button>
            ) : (
              <button
                onClick={onPause}
                className="px-8 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-full text-lg transition-colors cursor-pointer"
              >
                Pause
              </button>
            )}
            <button
              onClick={onStop}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-full text-sm transition-colors cursor-pointer"
            >
              End Session
            </button>
          </div>
        )}
        <SessionTimer isConnected={isConnected} isPaused={isPaused} onTimeout={onStop} />
      </div>
    </div>
  );
}
