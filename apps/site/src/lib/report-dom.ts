import type { AuditReport } from "@accessibility/contracts";
import { impactLabel, safeHttpUrl } from "./audit-flow.js";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  // textContent only: the report holds strings taken from the audited page.
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function renderReport(
  report: AuditReport,
  container: HTMLElement,
): void {
  const { audit, groups, totalIssues } = report;
  const nodes: HTMLElement[] = [];

  nodes.push(
    el(
      "h2",
      audit.score === null
        ? "Score automatisé indisponible"
        : `Score automatisé : ${audit.score}/100`,
    ),
  );
  nodes.push(el("p", report.automatedCoverageNotice, "notice"));

  nodes.push(
    el(
      "h2",
      totalIssues === 0
        ? "Aucun problème détecté automatiquement"
        : `${totalIssues} problème${totalIssues > 1 ? "s" : ""} détecté${totalIssues > 1 ? "s" : ""}`,
    ),
  );

  if (groups.length > 0) {
    const list = el("ol", undefined, "issues");
    for (const group of groups) {
      const item = el("li");
      item.append(el("h3", group.title));
      item.append(
        el(
          "p",
          `Impact : ${impactLabel(group.impact)} · ${group.occurrences} occurrence${group.occurrences > 1 ? "s" : ""}`,
        ),
      );
      const criteria = [
        group.wcagCriteria.length > 0
          ? `WCAG ${group.wcagCriteria.join(", ")}`
          : null,
        group.rgaaCriteria.length > 0
          ? `RGAA ${group.rgaaCriteria.join(", ")}`
          : null,
      ].filter((value) => value !== null);
      if (criteria.length > 0) item.append(el("p", criteria.join(" · ")));

      const helpUrl = safeHttpUrl(group.helpUrl);
      if (helpUrl !== null) {
        const link = el("a", "Comment corriger");
        link.href = helpUrl;
        link.rel = "noopener noreferrer";
        const p = el("p");
        p.append(link);
        item.append(p);
      }

      if (group.examples.length > 0) {
        const details = el("details");
        details.append(el("summary", "Éléments concernés"));
        for (const example of group.examples) {
          const block = el("div");
          block.append(el("code", example.selector));
          block.append(el("pre", example.htmlExcerpt));
          details.append(block);
        }
        item.append(details);
      }
      list.append(item);
    }
    nodes.push(list);
  }

  container.replaceChildren(...nodes);
}
