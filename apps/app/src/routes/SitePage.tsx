import { useEffect, useState, type FormEvent } from "react";
import type { ScanFrequency } from "@accessibility/contracts";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, call } from "../api.js";
import { ErrorMessage, Status, useTitle } from "../components/ui.js";
import { auditStatusLabel, formatDateTime } from "../lib/labels.js";
import {
  VERIFICATION_POLL_MS,
  isAuditActive,
  verificationState,
} from "../lib/polling.js";
import { frequencyLabel, scheduleChoices } from "../lib/plan.js";
import { meQuery, siteAuditsQuery, siteQuery } from "../queries.js";

export function SitePage({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const [verifyStartedAt, setVerifyStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [verifyResult, setVerifyResult] = useState<
    "verified" | "not_found" | null
  >(null);

  const site = useQuery(
    siteQuery(siteId, verifyStartedAt === null ? false : VERIFICATION_POLL_MS),
  );
  const audits = useQuery(siteAuditsQuery(siteId));
  const me = useQuery(meQuery);
  useTitle(site.data ? site.data.baseUrl : "Site");

  const verify = useMutation({
    mutationFn: () =>
      call(
        api.POST("/sites/{id}/verify", { params: { path: { id: siteId } } }),
      ),
    onSuccess: () => {
      setVerifyResult(null);
      setNow(Date.now());
      setVerifyStartedAt(Date.now());
    },
  });
  const [frequency, setFrequency] = useState<ScanFrequency | null | undefined>(
    undefined,
  );
  const schedule = useMutation({
    mutationFn: (value: ScanFrequency | null) =>
      call(
        api.PUT("/sites/{id}/schedule", {
          params: { path: { id: siteId } },
          body: { frequency: value },
        }),
      ),
    onSuccess: async () => {
      setFrequency(undefined);
      await queryClient.invalidateQueries({ queryKey: ["site", siteId] });
    },
  });
  const launch = useMutation({
    mutationFn: () =>
      call(
        api.POST("/sites/{id}/audits", { params: { path: { id: siteId } } }),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["site-audits", siteId] }),
  });

  // The worker answers asynchronously: look again until the date appears.
  useEffect(() => {
    if (verifyStartedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [verifyStartedAt]);
  useEffect(() => {
    if (verifyStartedAt === null || !site.data) return;
    const state = verificationState(site.data, now - verifyStartedAt);
    if (state !== "waiting") {
      setVerifyStartedAt(null);
      setVerifyResult(state);
    }
  }, [site.data, now, verifyStartedAt]);

  if (site.isPending) return <Status>Chargement…</Status>;
  if (site.isError) return <ErrorMessage>{site.error.message}</ErrorMessage>;
  const data = site.data;
  const verifying = verifyStartedAt !== null;
  const active = audits.data?.some((a) => isAuditActive(a.status)) ?? false;

  return (
    <>
      <h1>{data.baseUrl}</h1>

      <section aria-labelledby="verif-title">
        <h2 id="verif-title">Propriété du site</h2>
        {data.verifiedAt ? (
          <p>
            Propriété vérifiée le {formatDateTime(data.verifiedAt)}
            {data.verificationMethod === "dns" ? " (enregistrement DNS)" : ""}
            {data.verificationMethod === "file" ? " (fichier sur le site)" : ""}
            .
          </p>
        ) : (
          <>
            <p>
              Avant de lancer des audits, prouvez que vous contrôlez ce site,
              par l'<strong>une</strong> des deux méthodes suivantes.
            </p>
            <h3>Option 1 : enregistrement DNS</h3>
            <p>
              Ajoutez un enregistrement de type{" "}
              <strong>{data.verification.dnsRecord.type}</strong> sur le nom{" "}
              <code>{data.verification.dnsRecord.name}</code> avec la valeur :
            </p>
            <pre>{data.verification.dnsRecord.value}</pre>
            <h3>Option 2 : fichier sur votre site</h3>
            <p>
              Publiez à l'adresse <code>{data.verification.file.path}</code> un
              fichier texte contenant exactement :
            </p>
            <pre>{data.verification.file.content}</pre>
            <button
              type="button"
              onClick={() => verify.mutate()}
              disabled={verify.isPending || verifying}
            >
              {verifying ? "Vérification en cours…" : "Vérifier maintenant"}
            </button>
            {verify.isError ? (
              <ErrorMessage>{verify.error.message}</ErrorMessage>
            ) : null}
            {verifying ? (
              <Status>Recherche de la preuve sur votre site…</Status>
            ) : null}
            {verifyResult === "not_found" ? (
              <ErrorMessage>
                La preuve n'a pas été trouvée. Vérifiez l'enregistrement ou le
                fichier (un changement DNS peut mettre du temps à se propager),
                puis réessayez.
              </ErrorMessage>
            ) : null}
          </>
        )}
        {verifyResult === "verified" ? (
          <Status>Propriété vérifiée.</Status>
        ) : null}
      </section>

      {data.verifiedAt ? (
        <section aria-labelledby="schedule-title">
          <h2 id="schedule-title">Audits programmés</h2>
          {(() => {
            const org = me.data?.organizations.find((o) => o.id === data.orgId);
            if (!org) return null;
            const choices = scheduleChoices(org.limits);
            const selected =
              frequency === undefined ? data.scanFrequency : frequency;
            const inactive =
              data.scanFrequency !== null &&
              org.limits.scheduledFrequencies.length === 0;
            const submit = (event: FormEvent) => {
              event.preventDefault();
              schedule.mutate(selected);
            };
            return (
              <form onSubmit={submit}>
                <div className="field">
                  <label htmlFor="schedule-frequency">
                    Fréquence des re-scans
                  </label>
                  <select
                    id="schedule-frequency"
                    value={selected ?? ""}
                    onChange={(e) =>
                      setFrequency(
                        e.target.value === ""
                          ? null
                          : (e.target.value as ScanFrequency),
                      )
                    }
                    aria-describedby={
                      schedule.isError ? "schedule-error" : "schedule-hint"
                    }
                  >
                    {choices.map((choice) => (
                      <option
                        key={choice.value ?? "none"}
                        value={choice.value ?? ""}
                        disabled={!choice.allowed}
                      >
                        {choice.label}
                        {choice.reason ? ` (${choice.reason})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <p id="schedule-hint">
                  {data.scanFrequency !== null &&
                  data.nextScanAt !== null &&
                  !inactive
                    ? `${frequencyLabel(data.scanFrequency)} · prochain audit vers le ${formatDateTime(data.nextScanAt)}.`
                    : "Un email vous prévient quand un re-scan détecte une régression ou un nouveau problème sérieux."}
                </p>
                {inactive ? (
                  <Status>
                    Cette programmation est suspendue : elle n'est pas incluse
                    dans votre formule actuelle.
                  </Status>
                ) : null}
                <button
                  type="submit"
                  disabled={
                    schedule.isPending || selected === data.scanFrequency
                  }
                >
                  {schedule.isPending
                    ? "Enregistrement…"
                    : "Enregistrer la fréquence"}
                </button>
                {schedule.isError ? (
                  <ErrorMessage id="schedule-error">
                    {schedule.error.message}
                  </ErrorMessage>
                ) : null}
                {schedule.isSuccess ? (
                  <Status>Fréquence enregistrée.</Status>
                ) : null}
              </form>
            );
          })()}
        </section>
      ) : null}

      <section aria-labelledby="audits-title">
        <h2 id="audits-title">Audits</h2>
        <button
          type="button"
          onClick={() => launch.mutate()}
          disabled={!data.verifiedAt || launch.isPending || active}
          aria-describedby={!data.verifiedAt ? "audit-hint" : undefined}
        >
          {launch.isPending ? "Lancement…" : "Lancer un audit"}
        </button>
        {!data.verifiedAt ? (
          <p id="audit-hint">Vérifiez d'abord la propriété du site.</p>
        ) : null}
        {active ? <Status>Un audit est en cours…</Status> : null}
        {launch.isError ? (
          <ErrorMessage>{launch.error.message}</ErrorMessage>
        ) : null}

        {audits.isPending ? <Status>Chargement de l'historique…</Status> : null}
        {audits.isError ? (
          <ErrorMessage>{audits.error.message}</ErrorMessage>
        ) : null}
        {audits.data && audits.data.length === 0 ? (
          <p>Aucun audit pour l'instant.</p>
        ) : null}
        {audits.data && audits.data.length > 0 ? (
          <table>
            <caption>
              Historique des audits, du plus récent au plus ancien
            </caption>
            <thead>
              <tr>
                <th scope="col">Statut</th>
                <th scope="col">Score automatisé</th>
                <th scope="col">Pages analysées</th>
                <th scope="col">Terminé le</th>
                <th scope="col">Détail</th>
              </tr>
            </thead>
            <tbody>
              {audits.data.map((audit, index) => (
                <tr key={audit.id}>
                  <td>{auditStatusLabel(audit.status)}</td>
                  <td>{audit.score === null ? "—" : `${audit.score}/100`}</td>
                  <td>{audit.pagesScanned}</td>
                  <td>{formatDateTime(audit.finishedAt)}</td>
                  <td>
                    <Link to="/audits/$auditId" params={{ auditId: audit.id }}>
                      Voir
                      <span className="sr-only">
                        {" "}
                        l'audit n° {audits.data.length - index}
                      </span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <p>
        <Link to="/sites/$siteId/audit-manuel" params={{ siteId }}>
          Audit manuel
        </Link>{" "}
        ·{" "}
        <Link to="/sites/$siteId/declaration" params={{ siteId }}>
          Déclaration d'accessibilité
        </Link>{" "}
        ·{" "}
        <Link to="/sites/$siteId/tasks" params={{ siteId }}>
          Voir le plan de correction
        </Link>{" "}
        ·{" "}
        <Link to="/sites/$siteId/findings" params={{ siteId }}>
          Voir les problèmes suivis dans le temps
        </Link>
      </p>
    </>
  );
}
