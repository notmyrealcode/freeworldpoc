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
        if (next === 14 * 60 + 30) {
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
