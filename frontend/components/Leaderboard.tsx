"use client";

interface LeaderboardEntry {
  userId: string;
  score: number;
  user?: {
    username: string;
  };
}

interface LeaderboardProps {
  data: LeaderboardEntry[];
  currentUserId: string | null;
}

export default function Leaderboard({ data, currentUserId }: LeaderboardProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl h-fit sticky top-6">
      <h4 className="font-black text-xl mb-6 text-slate-400 uppercase tracking-widest flex items-center gap-2">
        <span>🏆</span> Rankings
      </h4>

      <ul className="space-y-3">
        {data.length === 0 ? (
          <p className="text-slate-600 text-center py-4 italic">No participants yet</p>
        ) : (
          data.map((player, index) => {
            const isCurrentUser = player.userId === currentUserId;

            return (
              <li
                key={player.userId}
                className={`flex justify-between items-center p-4 rounded-2xl transition-all ${
                  isCurrentUser
                    ? "bg-indigo-500/20 border border-indigo-500/50"
                    : "bg-slate-800/50 border border-slate-700/50"
                }`}
              >
                <div className="flex items-center gap-4">
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                    index === 0 ? "bg-yellow-500 text-black" : "bg-slate-700 text-slate-400"
                  }`}>
                    {index + 1}
                  </span>
                  <span className={`font-bold ${isCurrentUser ? "text-indigo-300" : "text-slate-200"}`}>
                    {player.user?.username ?? "Anonymous"}
                    {isCurrentUser && <span className="text-[10px] ml-2 uppercase opacity-60">(You)</span>}
                  </span>
                </div>
                <span className="font-mono font-black text-xl text-indigo-400">
                  {player.score}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
