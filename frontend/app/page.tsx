"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import axios from "axios";

// The backend now sets the JWT as an HttpOnly cookie itself - the response
// body just confirms success and returns basic (non-sensitive) user info.
interface AuthResponse {
  message: string;
  user: {
    id: string;
    email: string;
    username: string;
  };
}

export default function AuthPage() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

 
const handleAuth = async () => {
    try {
      if (isLogin) {
        await api.post<AuthResponse>("/api/auth/signin", { email, password });
      } else {
        await api.post<AuthResponse>("/api/auth/signup", { email, username, password });
      }
      // JWT is now set as an HttpOnly cookie by the backend - nothing for
      // the frontend to store or read.

      // ✨ NEW LOGIC: Check if they were trying to join a room!
      const returnUrl = sessionStorage.getItem("returnTo");
      if (returnUrl) {
        sessionStorage.removeItem("returnTo"); // Clean up
        router.push(returnUrl); // Send them directly to the room
      } else {
        router.push("/dashboard"); // Normal login goes to dashboard
      }

    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        alert(error.response?.data?.error ?? "Authentication failed");
      } else {
        alert("Something went wrong");
      }
    }
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-blue-600">
      <div className="backdrop-blur-xl bg-white/20 border border-white/30 shadow-2xl rounded-3xl p-10 w-full max-w-md text-white">

        <h1 className="text-3xl font-bold text-center mb-6">
          {isLogin ? "Welcome Back 👋" : "Create Account 🚀"}
        </h1>

        <div className="flex flex-col gap-4">

          {!isLogin && (
            <input
              placeholder="Username"
              className="p-3 rounded-lg bg-white/20 placeholder-white focus:outline-none focus:ring-2 focus:ring-white"
              onChange={(e) => setUsername(e.target.value)}
            />
          )}

          <input
            placeholder="Email"
            className="p-3 rounded-lg bg-white/20 placeholder-white focus:outline-none focus:ring-2 focus:ring-white"
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            type="password"
            placeholder="Password"
            className="p-3 rounded-lg bg-white/20 placeholder-white focus:outline-none focus:ring-2 focus:ring-white"
            onChange={(e) => setPassword(e.target.value)}
          />

          <button
            onClick={handleAuth}
            className="bg-white text-purple-700 font-semibold py-3 rounded-lg hover:bg-gray-100 transition"
          >
            {isLogin ? "Login" : "Sign Up"}
          </button>

          <p className="text-center text-sm">
            {isLogin
              ? "Don't have an account?"
              : "Already have an account?"}

            <span
              onClick={() => setIsLogin(!isLogin)}
              className="ml-2 underline cursor-pointer"
            >
              {isLogin ? "Sign Up" : "Login"}
            </span>
          </p>

        </div>
      </div>
    </div>
  );
}
