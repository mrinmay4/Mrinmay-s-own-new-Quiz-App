"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";

interface CurrentUser {
  id: string;
  email: string;
  username: string;
}

/**
 * Since the JWT lives in an HttpOnly cookie, the frontend can't read or
 * decode it anymore. This hook simply asks the backend "who am I?" via
 * GET /api/auth/me - the browser attaches the cookie automatically
 * (api.ts has withCredentials: true).
 *
 * If the request fails with 401, the shared Axios interceptor in
 * lib/api.ts already redirects to the login page, so callers just need
 * to handle the loading state.
 */
export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api
      .get<CurrentUser>("/api/auth/me")
      .then((res) => {
        if (!cancelled) setUser(res.data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading, error };
}
