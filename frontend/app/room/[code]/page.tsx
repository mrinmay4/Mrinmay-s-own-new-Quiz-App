"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { socket } from "@/lib/socket";
import Leaderboard from "@/components/Leaderboard";
import api from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";

interface Question {
  id: string;
  question: string;
  options: string[];
}

interface QuestionPayload {
  question: Question;
  startTime: number;
  questionIndex: number;
  totalQuestions: number;
  timeLimit: number; // seconds - server-authoritative, from the quiz config
}

interface LeaderboardEntry {
  userId: string;
  score: number;
  user?: {
    username: string;
  };
}

export default function RoomPage() {
  const { code } = useParams<{ code: string }>();

  // UI State
  const [question, setQuestion] = useState<Question | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [correctAnswer, setCorrectAnswer] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [quizEnded, setQuizEnded] = useState(false);
  const [hostId, setHostId] = useState<string | null>(null);
  const [timeLimit, setTimeLimit] = useState<number>(30);
  const [timeLeft, setTimeLeft] = useState<number>(30);
  const [copied, setCopied] = useState(false);

  const [isMounted, setIsMounted] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  // ✨ Auth check for friends joining via link!
  // The JWT lives in an HttpOnly cookie now, so we can't check localStorage.
  // We ask the backend who we are via /api/auth/me instead. If that call
  // comes back 401 (no valid cookie), the shared Axios interceptor in
  // lib/api.ts already remembers this URL and redirects to login/signup -
  // same "come back here after logging in" behavior as before.
  const { user, loading: userLoading, error: userError } = useCurrentUser();
  const currentUserId = user?.id ?? null;

  /* ================= TIMER LOGIC =================
   * This is a UI-only countdown for display purposes. The server keeps
   * its own authoritative questionStartTime and computes elapsed time
   * itself when scoring an answer - it never trusts this clock.
   */
  const startTimer = (startTime: number, limitSeconds: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = Math.max(limitSeconds - elapsed, 0);
      setTimeLeft(remaining);
      if (remaining <= 0 && timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
    updateTimer();
    timerRef.current = setInterval(updateTimer, 1000);
  };

  /* ================= SOCKET LOGIC ================= */
  useEffect(() => {
    if (!isMounted || !code || userLoading || userError) return;

    const onQuestion = (data: QuestionPayload) => {
      setQuestion(data.question);
      setSelected(null);
      setCorrectAnswer(null);
      setRevealed(false);
      setQuizEnded(false);
      setTimeLimit(data.timeLimit);
      startTimer(data.startTime, data.timeLimit);
    };

    // Broadcast when the server's authoritative timer expires - reveals
    // the correct answer for everyone, including players who didn't
    // answer, and is the ONLY thing that unlocks "Next Question" for the
    // host. There is no way to reveal or advance early.
    const onRevealAnswer = (data: { correctAnswer: number }) => {
      setCorrectAnswer(data.correctAnswer);
      setRevealed(true);
      setTimeLeft(0);
    };

    // Private acknowledgement sent only to the socket that submitted.
    // Deliberately does NOT include the correct answer - that only comes
    // through reveal-answer once the timer expires.
    const onAnswerResult = () => {
      // Score already lands via leaderboard-update; nothing else to do here.
    };

    const onLeaderboardUpdate = (data: LeaderboardEntry[]) => {
      setLeaderboard(data);
    };

    const onQuizCompleted = () => {
      setQuizEnded(true);
      setQuestion(null);
      if (timerRef.current) clearInterval(timerRef.current);
    };

    const onError = (data: { message: string }) => {
      console.error("Server error:", data.message);
      alert(`Error: ${data.message}`);
    };

    socket.on("question", onQuestion);
    socket.on("reveal-answer", onRevealAnswer);
    socket.on("answer-result", onAnswerResult);
    socket.on("leaderboard-update", onLeaderboardUpdate);
    socket.on("quiz-completed", onQuizCompleted);
    socket.on("error", onError);

    const initRoom = async () => {
      try {
        await api.post(`/api/rooms/join/${code}`);
        const res = await api.get(`/api/rooms/${code}`);
        if (res.data?.hostId) setHostId(res.data.hostId);

        // No token to attach - the browser sends the HttpOnly accessToken
        // cookie automatically because lib/socket.ts sets withCredentials: true.
        if (!socket.connected) socket.connect();
        socket.emit("join-room", { roomCode: code });
      } catch (err) {
        console.error("Init failed:", err);
      }
    };

    initRoom();

    return () => {
      socket.off("question", onQuestion);
      socket.off("reveal-answer", onRevealAnswer);
      socket.off("answer-result", onAnswerResult);
      socket.off("leaderboard-update", onLeaderboardUpdate);
      socket.off("quiz-completed", onQuizCompleted);
      socket.off("error", onError);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [code, isMounted, userLoading, userError]);

  /* ================= ACTIONS ================= */
  const handleStart = () => {
    socket.emit("start-quiz", { roomCode: code });
  };

  const handleNextQuestion = () => {
    if (!revealed) return; // server would reject this anyway - see next-question handler
    socket.emit("next-question", { roomCode: code });
  };

  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const submitAnswer = (index: number) => {
    if (!question || selected !== null || revealed || timeLeft === 0) return;
    setSelected(index); // locks in their choice visually - the server is what actually prevents a duplicate or late submission
    socket.emit("submit-answer", { roomCode: code, questionId: question.id, answer: index });
  };

  /* ================= STYLING LOGIC ================= */
  const getButtonStyle = (index: number) => {
    if (correctAnswer === null) {
      if (selected === index) return "bg-white/20 text-white border-2 border-indigo-500 scale-[1.02] shadow-[0_0_20px_rgba(99,102,241,0.3)]";
      if (selected !== null) return "bg-white/5 text-white/40 cursor-not-allowed";
      return "bg-white/10 hover:bg-white/20 text-white";
    }

    if (index === correctAnswer) return "bg-green-500 text-white border-2 border-green-300 scale-105 shadow-[0_0_30px_rgba(34,197,94,0.4)]";
    if (index === selected && correctAnswer !== null) return "bg-red-500 text-white shadow-[0_0_30px_rgba(239,68,68,0.4)]";
    return "bg-white/5 text-white/40 cursor-not-allowed opacity-50";
  };

  // If not mounted OR still checking who's logged in (or about to be
  // redirected to login), show a loading state.
  if (!isMounted || userLoading || userError) {
    return <div className="min-h-screen bg-[#020617] text-white flex items-center justify-center font-bold animate-pulse">Loading Room...</div>;
  }

  return (
    <div className="min-h-screen bg-[#020617] text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto grid lg:grid-cols-3 gap-8">

        {/* Left Column: Game Area */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900/50 border border-slate-800 rounded-[2rem] p-8 backdrop-blur-xl shadow-2xl relative">

            {/* Header */}
            <div className="flex justify-between items-end mb-12">
              <div className="space-y-1">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Live Room</p>
                <div className="flex items-center gap-4">
                  <p className="text-3xl font-bold text-indigo-400 font-mono">{code}</p>

                  <button
                    onClick={handleShare}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                  >
                    {copied ? '✅ Copied!' : '🔗 Copy Invite Link'}
                  </button>
                </div>
              </div>
              <div className="text-right space-y-1">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Scoreboard</p>
                <p className="text-3xl font-bold text-emerald-400 font-mono">
                  {leaderboard.find(p => p.userId === currentUserId)?.score ?? 0}
                </p>
              </div>
            </div>

            {/* Waiting Room & Host Controls */}
            {!question && !quizEnded && (
              <div className="text-center py-16 bg-slate-800/20 rounded-3xl border border-dashed border-slate-700/50">
                {currentUserId && hostId && currentUserId === hostId ? (
                  <div className="space-y-8 flex flex-col items-center">
                    <button
                      onClick={handleStart}
                      className="group relative bg-indigo-600 hover:bg-indigo-500 px-14 py-5 rounded-2xl font-black text-xl transition-all hover:scale-105 active:scale-95 shadow-[0_0_40px_rgba(79,70,229,0.3)]"
                    >
                      🚀 Start Competition
                    </button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="w-14 h-14 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mx-auto"></div>
                    <p className="text-slate-400 font-medium tracking-wide animate-pulse">Waiting for host to start...</p>
                  </div>
                )}
              </div>
            )}

            {/* Active Quiz */}
            {question && (
              <div className="space-y-10 animate-in fade-in zoom-in-95 duration-500">
                <div className="flex items-center gap-6">
                  <div className="h-3 flex-1 bg-slate-800 rounded-full overflow-hidden p-[2px]">
                    <div
                      className={`h-full rounded-full transition-all duration-1000 ${timeLeft < 10 ? 'bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-indigo-500'}`}
                      style={{ width: `${(timeLeft / timeLimit) * 100}%` }}
                    ></div>
                  </div>
                  <span className={`font-mono font-black text-2xl w-14 ${timeLeft < 10 ? 'text-red-500 animate-pulse' : 'text-slate-300'}`}>
                    {timeLeft}s
                  </span>
                </div>

                <h2 className="text-4xl font-extrabold leading-[1.2] tracking-tight">{question.question}</h2>

                <div className="grid gap-4">
                  {question.options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => submitAnswer(i)}
                      disabled={selected !== null || correctAnswer !== null}
                      className={`w-full p-6 text-left rounded-2xl font-bold text-xl transition-all duration-300 border border-transparent ${getButtonStyle(i)}`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>

                {/* Next Question only unlocks once the server has revealed
                    the answer (its 30-second timer expired) - there is no
                    way to skip a question early, host included. */}
                {currentUserId === hostId && (
                  <div className="mt-8 flex justify-end border-t border-slate-800/80 pt-6">
                    <button
                      onClick={handleNextQuestion}
                      disabled={!revealed}
                      className={`px-8 py-4 rounded-xl font-black text-xl transition-all flex items-center gap-3 ${
                        revealed
                          ? "bg-indigo-600 hover:bg-indigo-500 text-white hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(79,70,229,0.4)]"
                          : "bg-slate-800 text-slate-500 cursor-not-allowed"
                      }`}
                    >
                      {revealed ? "Next Question ⏭️" : "Waiting for reveal..."}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* End Screen */}
            {quizEnded && (
              <div className="text-center py-24 space-y-6">
                <h2 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500 uppercase tracking-tighter">Quiz Over</h2>
                <p className="text-slate-400 text-xl font-medium">Final scores are locked in!</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Leaderboard */}
        <div className="lg:col-span-1">
          <Leaderboard data={leaderboard} currentUserId={currentUserId ?? ""} />
        </div>
      </div>
    </div>
  );
}
