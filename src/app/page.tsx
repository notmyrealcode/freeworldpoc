"use client";

import { useGeminiSession } from "@/app/hooks/use-gemini-session";
import { ConversationPanel } from "@/app/components/conversation-panel";
import { FormSidebar } from "@/app/components/form-sidebar";

export default function Home() {
  const {
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
  } = useGeminiSession();

  return (
    <div className="h-screen flex">
      {/* Left panel — conversation */}
      <div className="flex-1 border-r border-gray-200">
        <ConversationPanel
          isConnected={isConnected}
          isPaused={isPaused}
          isComplete={isComplete}
          activeMadlib={activeMadlib}
          activeConditional={activeConditional}
          formData={formData}
          error={error}
          voiceStatus={voiceStatus}
          getFrequencyData={getFrequencyData}
          onStart={startSession}
          onStop={stopSession}
          onPause={pauseSession}
          onResume={resumeSession}
        />
      </div>

      {/* Right panel — form sidebar */}
      <div className="w-[400px] bg-gray-50 shrink-0">
        <FormSidebar
          formData={formData}
          activeSection={activeMadlib?.section ?? null}
        />
      </div>
    </div>
  );
}
