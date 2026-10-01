import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, call } from "../api.js";
import { ErrorMessage, useTitle } from "../components/ui.js";
import { meQuery } from "../queries.js";

export function NewOrgPage() {
  useTitle("Créer une organisation");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => call(api.POST("/orgs", { body: { name } })),
    onSuccess: async (org) => {
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
      await navigate({ to: "/orgs/$orgId", params: { orgId: org.id } });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <>
      <h1>Créer votre organisation</h1>
      <p>Elle regroupe vos sites et les personnes qui y ont accès.</p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="org-name">Nom de l'organisation</label>
          <input
            id="org-name"
            required
            maxLength={100}
            autoComplete="organization"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={create.isError ? true : undefined}
            aria-describedby={create.isError ? "org-error" : undefined}
          />
          {create.isError ? (
            <ErrorMessage id="org-error">{create.error.message}</ErrorMessage>
          ) : null}
        </div>
        <button type="submit" disabled={create.isPending}>
          {create.isPending ? "Création…" : "Créer l'organisation"}
        </button>
      </form>
    </>
  );
}
