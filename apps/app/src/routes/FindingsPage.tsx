import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  FINDING_STATUSES,
  type Finding,
  type FindingStatus,
} from "@accessibility/contracts";
import { api, call } from "../api.js";
import { ErrorMessage, Status, useTitle } from "../components/ui.js";
import { findingStatusLabel, impactLabel } from "../lib/labels.js";

const PAGE_SIZE = 50;

export function FindingsPage({ siteId }: { siteId: string }) {
  useTitle("Problèmes suivis");
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<FindingStatus | "">("");
  const [announcement, setAnnouncement] = useState("");
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  const findings = useInfiniteQuery({
    queryKey: ["findings", siteId, status],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      call(
        api.GET("/sites/{id}/findings", {
          params: {
            path: { id: siteId },
            query: {
              status: status === "" ? undefined : status,
              limit: PAGE_SIZE,
              offset: pageParam,
            },
          },
        }),
      ),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });

  const change = useMutation({
    mutationFn: (input: { id: string; status: "open" | "ignored" }) =>
      call(
        api.PATCH("/findings/{id}", {
          params: { path: { id: input.id } },
          body: { status: input.status },
        }),
      ),
    onSuccess: async (updated: Finding) => {
      await queryClient.invalidateQueries({ queryKey: ["findings", siteId] });
      setAnnouncement(
        updated.status === "ignored" ? "Constat ignoré." : "Constat rouvert.",
      );
      // The row may leave the filtered list: keep focus inside the page.
      itemRefs.current.get(updated.id)?.focus();
    },
  });

  const items = findings.data?.pages.flatMap((page) => page.items) ?? [];
  const total = findings.data?.pages[0]?.total ?? 0;

  return (
    <>
      <h1>Problèmes suivis</h1>
      <p>
        <Link to="/sites/$siteId" params={{ siteId }}>
          Retour au site
        </Link>
      </p>

      <div className="field">
        <label htmlFor="status-filter">Filtrer par statut</label>
        <select
          id="status-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as FindingStatus | "")}
        >
          <option value="">Tous</option>
          {FINDING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {findingStatusLabel(s)}
            </option>
          ))}
        </select>
      </div>

      <div role="status" className="sr-only">
        {announcement}
      </div>
      {change.isError ? (
        <ErrorMessage>{change.error.message}</ErrorMessage>
      ) : null}

      {findings.isPending ? <Status>Chargement…</Status> : null}
      {findings.isError ? (
        <ErrorMessage>{findings.error.message}</ErrorMessage>
      ) : null}
      {findings.data ? (
        <p>
          {total} problème{total > 1 ? "s" : ""}
        </p>
      ) : null}
      {findings.data && items.length === 0 ? (
        <p>Aucun problème pour ce filtre.</p>
      ) : null}

      <ol className="issues">
        {items.map((finding) => (
          <li
            key={finding.id}
            tabIndex={-1}
            ref={(node) => {
              if (node) itemRefs.current.set(finding.id, node);
              else itemRefs.current.delete(finding.id);
            }}
          >
            <h2 className="h3">{finding.ruleId}</h2>
            <p>
              <strong>{findingStatusLabel(finding.status)}</strong> · Impact :{" "}
              {impactLabel(finding.impact)} · Priorité {finding.priorityScore}
            </p>
            <p>Page : {finding.pageUrl}</p>
            <p>
              Élément : <code>{finding.selector}</code>
            </p>
            <p>{finding.message}</p>
            {finding.status === "open" || finding.status === "regressed" ? (
              <button
                type="button"
                disabled={change.isPending}
                onClick={() =>
                  change.mutate({ id: finding.id, status: "ignored" })
                }
              >
                Ignorer
                <span className="sr-only"> ce problème ({finding.ruleId})</span>
              </button>
            ) : null}
            {finding.status === "ignored" ? (
              <button
                type="button"
                disabled={change.isPending}
                onClick={() =>
                  change.mutate({ id: finding.id, status: "open" })
                }
              >
                Rouvrir
                <span className="sr-only"> ce problème ({finding.ruleId})</span>
              </button>
            ) : null}
          </li>
        ))}
      </ol>

      {findings.hasNextPage ? (
        <button
          type="button"
          onClick={() => void findings.fetchNextPage()}
          disabled={findings.isFetchingNextPage}
        >
          {findings.isFetchingNextPage ? "Chargement…" : "Afficher plus"}
        </button>
      ) : null}
    </>
  );
}
