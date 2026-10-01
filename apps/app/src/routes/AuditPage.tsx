import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ErrorMessage, Status, useTitle } from "../components/ui.js";
import { ReportView } from "../components/ReportView.js";
import {
  auditStatusLabel,
  failureLabel,
  formatDateTime,
  pageStatusLabel,
} from "../lib/labels.js";
import { isAuditActive } from "../lib/polling.js";
import { auditPagesQuery, auditQuery, reportQuery } from "../queries.js";

export function AuditPage({ auditId }: { auditId: string }) {
  useTitle("Détail de l'audit");
  const audit = useQuery(auditQuery(auditId));
  const active = audit.data ? isAuditActive(audit.data.status) : true;
  const pages = useQuery(auditPagesQuery(auditId, active));
  const completed = audit.data?.status === "completed";
  const report = useQuery({ ...reportQuery(auditId), enabled: completed });

  if (audit.isPending) return <Status>Chargement…</Status>;
  if (audit.isError) return <ErrorMessage>{audit.error.message}</ErrorMessage>;
  const data = audit.data;

  return (
    <>
      <h1>Audit de {data.url}</h1>
      <p>
        <Link to="/">Retour à mes sites</Link>
      </p>
      <dl>
        <dt>Statut</dt>
        <dd>{auditStatusLabel(data.status)}</dd>
        <dt>Démarré le</dt>
        <dd>{formatDateTime(data.startedAt)}</dd>
        <dt>Terminé le</dt>
        <dd>{formatDateTime(data.finishedAt)}</dd>
        <dt>Pages analysées</dt>
        <dd>{data.pagesScanned}</dd>
      </dl>

      {active ? (
        <Status>
          Analyse en cours : cette page se met à jour toute seule.
        </Status>
      ) : null}
      {data.status === "failed" ? (
        <ErrorMessage>{failureLabel(data.failureReason)}</ErrorMessage>
      ) : null}

      <section aria-labelledby="pages-title">
        <h2 id="pages-title">Pages</h2>
        {pages.isError ? (
          <ErrorMessage>{pages.error.message}</ErrorMessage>
        ) : null}
        {pages.data ? (
          <table>
            <caption>Pages de l'audit et leur état</caption>
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">État</th>
              </tr>
            </thead>
            <tbody>
              {pages.data.map((page) => (
                <tr key={page.url}>
                  <td>{page.url}</td>
                  <td>{pageStatusLabel(page.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {report.isPending && completed ? (
        <Status>Chargement du rapport…</Status>
      ) : null}
      {report.isError ? (
        <ErrorMessage>{report.error.message}</ErrorMessage>
      ) : null}
      {report.data ? <ReportView report={report.data} /> : null}
    </>
  );
}
