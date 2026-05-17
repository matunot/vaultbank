import React, { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../config/apiConfig";

/**
 * Component that handles the magic‑link verification flow.
 * It reads the `token` query parameter, calls the server endpoint to verify the token,
 * stores the returned JWT and user data in localStorage, and redirects to the home page.
 */
export default function MagicLinkCallback() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    if (!token) {
      // No token – redirect back to login
      navigate("/");
      return;
    }

    const verifyToken = async () => {
      try {
        const response = await api.get(
          `/api/auth/magic-link/verify?token=${token}`,
        );
        if (response.success) {
          // Store JWT and minimal user info
          localStorage.setItem("token", response.token);
          const userData = {
            email: response.user.email,
            token: response.token,
          };
          localStorage.setItem("user", JSON.stringify(userData));
          // Redirect to dashboard (home route will render the dashboard if verified)
          navigate("/");
        } else {
          console.error("Magic link verification failed:", response.message);
          navigate("/");
        }
      } catch (err) {
        console.error("Magic link verification error:", err);
        navigate("/");
      }
    };

    verifyToken();
  }, [location, navigate]);

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center"
      style={{ background: "#000000" }}
    >
      <p className="text-gray-400">Verifying magic link…</p>
    </div>
  );
}
