"use client";

import { usePathname, useRouter } from "next/navigation";
import api from "@/lib/api";

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();

  // Hide navbar on login page
  if (pathname === "/") return null;

  const handleLogout = async () => {
    try {
      // Backend clears the HttpOnly accessToken cookie - nothing for the
      // frontend to remove from localStorage.
      await api.post("/api/auth/logout");
    } catch (err) {
      console.error("Logout failed:", err);
    } finally {
      router.push("/");
    }
  };

  return (
    <nav className="flex justify-between items-center p-4 bg-white shadow">
      <div className="font-bold text-lg">Mrinmay Quiz</div>
      <button
        onClick={handleLogout}
        className="text-sm font-semibold text-gray-600 hover:text-gray-900 transition"
      >
        Logout
      </button>
    </nav>
  );
}
