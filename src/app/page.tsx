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
