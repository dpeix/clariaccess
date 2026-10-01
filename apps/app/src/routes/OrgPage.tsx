import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, call } from "../api.js";
import { ErrorMessage, Status, useTitle } from "../components/ui.js";
import { limitsSummary, planLabel } from "../lib/plan.js";
import { meQuery, sitesQuery } from "../queries.js";

export function OrgPage({ orgId }: { orgId: string }) {
  const me = useQuery(meQuery);
  const org = me.data?.organizations.find((o) => o.id === orgId);
  useTitle(org ? `Sites de ${org.name}` : "Sites");
  const queryClient = useQueryClient();
  const sites = useQuery(sitesQuery(orgId));
  const [baseUrl, setBaseUrl] = useState("");
  const add = useMutation({
    mutationFn: () =>
      call(
        api.POST("/orgs/{orgId}/sites", {
          params: { path: { orgId } },
          body: { baseUrl },
        }),
      ),
    onSuccess: async () => {
      setBaseUrl("");
      await queryClient.invalidateQueries({ queryKey: ["sites", orgId] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate();
  };

  if (me.data && !org) {
    return <ErrorMessage>Organisation introuvable.</ErrorMessage>;
  }

  return (
    <>
      <h1>{org ? `Sites de ${org.name}` : "Sites"}</h1>

      {org ? (
        <section aria-labelledby="plan-title" className="notice">
          <h2 id="plan-title">Formule : {planLabel(org.plan)}</h2>
          <ul>
            {limitsSummary(org.limits).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {org.plan === "free" ? (
            <p>
              Le passage à la formule Pro (plusieurs sites, re-scans programmés,
              alertes) sera bientôt disponible.
            </p>
          ) : null}
        </section>
      ) : null}

      {sites.isPending ? <Status>Chargement des sites…</Status> : null}
      {sites.isError ? (
        <ErrorMessage>{sites.error.message}</ErrorMessage>
      ) : null}
      {sites.data && sites.data.length === 0 ? (
        <p>Aucun site pour l'instant. Ajoutez le premier ci-dessous.</p>
      ) : null}
      {sites.data && sites.data.length > 0 ? (
        <ul className="cards">
          {sites.data.map((site) => (
            <li key={site.id}>
              <Link to="/sites/$siteId" params={{ siteId: site.id }}>
                {site.baseUrl}
              </Link>{" "}
              <span>
                {site.verifiedAt
                  ? "Propriété vérifiée"
                  : "Propriété à vérifier"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <h2>Ajouter un site</h2>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="site-url">Adresse du site</label>
          <p id="site-url-hint">Exemple : https://www.monsite.fr</p>
          <input
            id="site-url"
            type="url"
            required
            autoComplete="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            aria-invalid={add.isError ? true : undefined}
            aria-describedby={
              add.isError ? "site-url-hint site-url-error" : "site-url-hint"
            }
          />
          {add.isError ? (
            <ErrorMessage id="site-url-error">{add.error.message}</ErrorMessage>
          ) : null}
        </div>
        <button type="submit" disabled={add.isPending}>
          {add.isPending ? "Ajout…" : "Ajouter le site"}
        </button>
      </form>
    </>
  );
}
