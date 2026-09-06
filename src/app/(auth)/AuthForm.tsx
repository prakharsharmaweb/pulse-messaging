"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { m } from "framer-motion";
import Brand from "@/components/Brand";

type Mode = "login" | "register";

const HIGHLIGHTS = [
  "Real-time delivery, typing & read receipts",
  "Server-side image & profanity moderation",
  "Reliable across reconnects and multiple tabs",
];

export default function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ username: "", displayName: "", password: "" });

  const isRegister = mode === "register";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isRegister ? form : { username: form.username, password: form.password }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      router.replace("/chat");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Branded panel */}
      <div className="relative hidden overflow-hidden bg-aurora p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(closest-side, rgba(255,255,255,0.5), transparent), radial-gradient(closest-side, rgba(255,255,255,0.3), transparent)",
            backgroundPosition: "10% 10%, 85% 75%",
            backgroundSize: "45% 45%, 40% 40%",
            backgroundRepeat: "no-repeat",
          }}
        />
        <div className="relative flex items-center gap-2.5">
          <Brand size={36} />
        </div>
        <div className="relative">
          <h2 className="text-3xl font-bold leading-tight tracking-tight">
            Messaging that behaves
            <br />
            like a real product.
          </h2>
          <ul className="mt-6 space-y-3">
            {HIGHLIGHTS.map((h) => (
              <li key={h} className="flex items-center gap-3 text-sm text-white/90">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/20 text-[11px]">
                  ✓
                </span>
                {h}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/60">Pulse — real-time messaging module</p>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center px-4 py-10">
        <m.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-sm"
        >
          <div className="mb-7 lg:hidden">
            <Brand size={34} />
          </div>
          <h1 className="text-xl font-semibold">
            {isRegister ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {isRegister ? "Join Pulse in a few seconds." : "Sign in to continue to Pulse."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field
              label="Username"
              value={form.username}
              onChange={(v) => setForm({ ...form, username: v })}
              placeholder="jane_doe"
              autoComplete="username"
            />
            {isRegister && (
              <Field
                label="Display name"
                value={form.displayName}
                onChange={(v) => setForm({ ...form, displayName: v })}
                placeholder="Jane Doe"
              />
            )}
            <Field
              label="Password"
              type="password"
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
              placeholder="••••••••"
              autoComplete={isRegister ? "new-password" : "current-password"}
            />

            {error && (
              <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
                {error}
              </p>
            )}

            <button className="btn-primary w-full" disabled={loading}>
              {loading ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-ink-muted">
            {isRegister ? "Already have an account? " : "New to Pulse? "}
            <Link
              href={isRegister ? "/login" : "/register"}
              className="font-medium text-brand hover:underline"
            >
              {isRegister ? "Sign in" : "Create one"}
            </Link>
          </p>
        </m.div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-muted">{label}</span>
      <input
        className="input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
      />
    </label>
  );
}
