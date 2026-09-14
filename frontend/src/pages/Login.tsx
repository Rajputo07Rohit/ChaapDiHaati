import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button, Input } from "../components/ui/Primitives";
import { ApiError } from "../api/client";
import logo from "../assets/logo.png";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to log in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6 text-white">
          <img src={logo} alt="Chaap Di Haati" className="w-20 h-20 object-contain mb-2 drop-shadow-lg" />
          <h1 className="text-xl font-bold">Chaap Di Haati</h1>
          <p className="text-slate-400 text-sm">Restaurant Management System</p>
        </div>
        <form onSubmit={onSubmit} className="bg-white rounded-xl shadow-xl p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full" autoFocus required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full" required />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
