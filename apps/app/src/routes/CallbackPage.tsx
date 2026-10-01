import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, call, ApiError } from "../api.js";
import { meQuery } from "../queries.js";
import { ErrorMessage, Status, useTitle } from "../components/ui.js";

// The link is single-use: React's development double-run of effects must not
// spend it twice.
export function CallbackPage({ token }: { token: string | undefined }) {
  useTitle("Connexion en cours");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(
    token ? null : "Ce lien est incomplet. Demandez-en un nouveau.",
  );

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    call(api.POST("/auth/verify", { body: { token } })).then(
      (me) => {
        queryClient.setQueryData(meQuery.queryKey, me);
        void navigate({ to: "/", replace: true });
      },
      (caught: unknown) =>
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Une erreur est survenue.",
        ),
    );
  }, [token, navigate, queryClient]);

  return (
    <>
      <h1>Connexion</h1>
      {error ? (
        <>
          <ErrorMessage>{error}</ErrorMessage>
          <p>
            <Link to="/login">Demander un nouveau lien</Link>
          </p>
        </>
      ) : (
        <Status>Connexion en cours…</Status>
      )}
    </>
  );
}
