import axios from "axios";

// NEXT_PUBLIC_ is required for Next.js to expose this variable to the browser!
const apiUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";

// withCredentials: true tells the browser to automatically send/receive the
// HttpOnly `accessToken` cookie set by the backend. The frontend never reads
// or stores the JWT itself - no interceptor needed anymore.
const api = axios.create({
  baseURL: apiUrl,
  withCredentials: true,
});

// Global 401 handling: if a protected request comes back unauthenticated
// (no cookie, or the 15-minute token expired), send the user back to login.
// We remember the page they were on so they land back there after logging
// in again - the same behavior the room page used to do manually.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (typeof window !== "undefined" && error.response?.status === 401) {
      if (window.location.pathname !== "/") {
        sessionStorage.setItem("returnTo", window.location.pathname);
        window.location.href = "/";
      }
    }
    return Promise.reject(error);
  }
);

export default api;
