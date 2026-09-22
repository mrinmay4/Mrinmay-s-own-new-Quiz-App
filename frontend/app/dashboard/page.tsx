"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

type Mode = "choice" | "create" | "join";

export default function Dashboard() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("choice");

  // Create Room flow
  const [topic, setTopic] = useState("JavaScript");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Join Room flow
  const [roomCode, setRoomCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  const createRoom = async () => {
    try {
      setCreating(true);
      setCreateError("");

      const quizRes = await api.post("/api/quiz/generate", {
        topic,
        difficulty: "easy",
        questionCount: 10,
        timeLimit: 30,
      });

      const roomRes = await api.post("/api/rooms/create", {
        quizId: quizRes.data.id,
        maxPlayers: 5,
      });

      router.push(`/room/${roomRes.data.room.code}`);
    } catch (err) {
      console.error(err);
      setCreateError("Something went wrong. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const joinRoom = async () => {
    const code = roomCode.trim().toUpperCase();
    if (!code) {
      setJoinError("Enter a room code.");
      return;
    }

    try {
      setJoining(true);
      setJoinError("");

      // Validate + join here so a bad code or full room shows an error
      // right on this screen, before navigating into the room page.
      await api.post(`/api/rooms/join/${code}`);

      router.push(`/room/${code}`);
    } catch (err: any) {
      console.error(err);
      setJoinError(err?.response?.data?.error || "Couldn't join that room. Check the code and try again.");
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-800 flex items-center justify-center px-6">
      <div className="w-full max-w-lg bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl rounded-3xl p-10 text-white">

        {mode === "choice" && (
          <>
            <h1 className="text-4xl font-extrabold text-center mb-2 tracking-wide">
              🎯 QuizApp
            </h1>
            <p className="text-center text-white/70 mb-10">
              Create a new quiz room, or join one with a code
            </p>

            <div className="space-y-4">
              <button
                onClick={() => setMode("create")}
                className="w-full py-5 rounded-xl text-lg font-bold bg-gradient-to-r from-pink-500 to-indigo-500 hover:scale-105 hover:shadow-2xl transition-all duration-300"
              >
                🚀 Create Room
              </button>
              <button
                onClick={() => setMode("join")}
                className="w-full py-5 rounded-xl text-lg font-bold bg-white/10 border border-white/30 hover:bg-white/20 transition-all duration-300"
              >
                🔑 Join Room
              </button>
            </div>
          </>
        )}

        {mode === "create" && (
          <>
            <button
              onClick={() => setMode("choice")}
              className="text-white/60 hover:text-white text-sm mb-6"
            >
              ← Back
            </button>

            <h1 className="text-3xl font-extrabold text-center mb-2 tracking-wide">
              🎯 Quiz Room Generator
            </h1>
            <p className="text-center text-white/70 mb-8">
              Instantly create a live quiz room
            </p>

            <div className="mb-6">
              <label className="block mb-2 text-sm font-semibold text-white/80">
                Quiz Topic
              </label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Enter topic..."
                className="w-full p-4 rounded-xl bg-white/20 border border-white/30 placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-pink-400 transition"
              />
            </div>

            {createError && (
              <div className="mb-4 text-red-300 text-sm text-center">
                {createError}
              </div>
            )}

            <button
              onClick={createRoom}
              disabled={creating}
              className={`w-full py-4 rounded-xl text-lg font-bold transition-all duration-300 ${
                creating
                  ? "bg-gray-500 cursor-not-allowed"
                  : "bg-gradient-to-r from-pink-500 to-indigo-500 hover:scale-105 hover:shadow-2xl"
              }`}
            >
              {creating ? "Generating Room..." : "Generate & Create Room 🚀"}
            </button>
          </>
        )}

        {mode === "join" && (
          <>
            <button
              onClick={() => setMode("choice")}
              className="text-white/60 hover:text-white text-sm mb-6"
            >
              ← Back
            </button>

            <h1 className="text-3xl font-extrabold text-center mb-2 tracking-wide">
              🔑 Join a Room
            </h1>
            <p className="text-center text-white/70 mb-8">
              Enter the 6-letter code your host shared
            </p>

            <div className="mb-6">
              <label className="block mb-2 text-sm font-semibold text-white/80">
                Room Code
              </label>
              <input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={6}
                className="w-full p-4 rounded-xl bg-white/20 border border-white/30 placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-pink-400 transition uppercase tracking-[0.3em] text-center font-mono text-2xl"
              />
            </div>

            {joinError && (
              <div className="mb-4 text-red-300 text-sm text-center">
                {joinError}
              </div>
            )}

            <button
              onClick={joinRoom}
              disabled={joining}
              className={`w-full py-4 rounded-xl text-lg font-bold transition-all duration-300 ${
                joining
                  ? "bg-gray-500 cursor-not-allowed"
                  : "bg-gradient-to-r from-pink-500 to-indigo-500 hover:scale-105 hover:shadow-2xl"
              }`}
            >
              {joining ? "Joining..." : "Join Room →"}
            </button>
          </>
        )}

      </div>
    </div>
  );
}
