import { useState, type FormEvent } from "react";
import { api, call, ApiError } from "../api.js";
import { ErrorMessage, Status, useTitle } from "../components/ui.js";

export function LoginPage() {
  useTitle("Connexion");
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPhase("sending");
    try {
      await call(api.POST("/auth/login", { body: { email: email.trim() } }));
      setPhase("sent");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Une erreur est survenue.",
      );
      setPhase("idle");
    }
  };

  return (
    <>
      <h1>Connexion</h1>
      <p>
        Indiquez votre adresse email : nous vous envoyons un lien de connexion
        valable 15 minutes. Pas de mot de passe à retenir.
      </p>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="login-email">Adresse email</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
          />
          {error ? <ErrorMessage id="login-error">{error}</ErrorMessage> : null}
        </div>
        <button type="submit" disabled={phase === "sending"}>
          {phase === "sending" ? "Envoi…" : "Recevoir le lien"}
        </button>
      </form>
      {phase === "sent" ? (
        <Status>
          Si cette adresse peut se connecter, un lien vient de vous être envoyé.
          Pensez à vérifier vos courriers indésirables.
        </Status>
      ) : null}
    </>
  );
}
