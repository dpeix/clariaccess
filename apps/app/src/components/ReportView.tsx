import type { AuditReport } from "@accessibility/contracts";
import { impactLabel } from "../lib/labels.js";
import { safeHttpUrl } from "../lib/messages.js";

// Strings from the audited site are rendered as text by React, never as HTML.
export function ReportView({ report }: { report: AuditReport }) {
  const { audit, groups, totalIssues } = report;
  return (
    <section aria-labelledby="report-title">
      <h2 id="report-title">
        {audit.score === null
          ? "Score automatisé indisponible"
          : `Score automatisé : ${audit.score}/100`}
      </h2>
      <p className="notice">{report.automatedCoverageNotice}</p>
      <h3>
        {totalIssues === 0
          ? "Aucun problème détecté automatiquement"
          : `${totalIssues} problème${totalIssues > 1 ? "s" : ""} détecté${totalIssues > 1 ? "s" : ""}`}
      </h3>
      {groups.length > 0 ? (
        <ol className="issues">
          {groups.map((group) => {
            const helpUrl = safeHttpUrl(group.helpUrl);
            const criteria = [
              group.wcagCriteria.length > 0
                ? `WCAG ${group.wcagCriteria.join(", ")}`
                : null,
              group.rgaaCriteria.length > 0
                ? `RGAA ${group.rgaaCriteria.join(", ")}`
                : null,
            ].filter((value) => value !== null);
            return (
              <li key={group.ruleId}>
                <h4>{group.title}</h4>
                <p>
                  Impact : {impactLabel(group.impact)} · {group.occurrences}{" "}
                  occurrence
                  {group.occurrences > 1 ? "s" : ""}
                </p>
                {criteria.length > 0 ? <p>{criteria.join(" · ")}</p> : null}
                {helpUrl ? (
                  <p>
                    <a href={helpUrl} rel="noopener noreferrer">
                      Comment corriger
                    </a>
                  </p>
                ) : null}
                {group.examples.length > 0 ? (
                  <details>
                    <summary>Éléments concernés</summary>
                    {group.examples.map((example, index) => (
                      <div key={index}>
                        <code>{example.selector}</code>
                        <pre>{example.htmlExcerpt}</pre>
                      </div>
                    ))}
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
