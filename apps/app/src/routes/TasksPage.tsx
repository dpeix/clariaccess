import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  TASK_STATUSES,
  type Task,
  type TaskStatus,
} from "@accessibility/contracts";
import { api, call } from "../api.js";
import { ErrorMessage, Status, useTitle } from "../components/ui.js";
import { taskStatusLabel } from "../lib/plan.js";
import { meQuery, membersQuery, siteQuery } from "../queries.js";

const PAGE_SIZE = 50;

export function TasksPage({ siteId }: { siteId: string }) {
  useTitle("Plan de correction");
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [announcement, setAnnouncement] = useState("");
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  const site = useQuery(siteQuery(siteId));
  const orgId = site.data?.orgId;
  const members = useQuery({
    ...membersQuery(orgId ?? ""),
    enabled: orgId !== undefined,
  });
  useQuery(meQuery);

  const tasks = useInfiniteQuery({
    queryKey: ["tasks", siteId, status],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      call(
        api.GET("/sites/{id}/tasks", {
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

  const update = useMutation({
    mutationFn: (input: {
      id: string;
      status?: TaskStatus;
      assigneeUserId?: string | null;
    }) =>
      call(
        api.PATCH("/tasks/{id}", {
          params: { path: { id: input.id } },
          body: { status: input.status, assigneeUserId: input.assigneeUserId },
        }),
      ),
    onSuccess: async (updated: Task) => {
      await queryClient.invalidateQueries({ queryKey: ["tasks", siteId] });
      setAnnouncement(`Tâche « ${updated.ruleId} » mise à jour.`);
      itemRefs.current.get(updated.id)?.focus();
    },
  });

  const items = tasks.data?.pages.flatMap((page) => page.items) ?? [];
  const total = tasks.data?.pages[0]?.total ?? 0;

  return (
    <>
      <h1>Plan de correction</h1>
      <p>
        <Link to="/sites/$siteId" params={{ siteId }}>
          Retour au site
        </Link>
      </p>
      <p>
        Une tâche par type de problème, classées par priorité : corriger une
        règle règle en général toutes ses occurrences.
      </p>

      <div className="field">
        <label htmlFor="task-filter">Filtrer par statut</label>
        <select
          id="task-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as TaskStatus | "")}
        >
          <option value="">Tous</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {taskStatusLabel(s)}
            </option>
          ))}
        </select>
      </div>

      <div role="status" className="sr-only">
        {announcement}
      </div>
      {update.isError ? (
        <ErrorMessage>{update.error.message}</ErrorMessage>
      ) : null}
      {tasks.isPending ? <Status>Chargement…</Status> : null}
      {tasks.isError ? (
        <ErrorMessage>{tasks.error.message}</ErrorMessage>
      ) : null}
      {tasks.data ? (
        <p>
          {total} tâche{total > 1 ? "s" : ""}
        </p>
      ) : null}
      {tasks.data && items.length === 0 ? (
        <p>Aucune tâche pour ce filtre. Lancez un audit pour en générer.</p>
      ) : null}

      <ol className="issues">
        {items.map((task) => (
          <li
            key={task.id}
            tabIndex={-1}
            ref={(node) => {
              if (node) itemRefs.current.set(task.id, node);
              else itemRefs.current.delete(task.id);
            }}
          >
            <h2 className="h3">{task.ruleId}</h2>
            <p>
              <strong>{taskStatusLabel(task.status)}</strong> · Priorité{" "}
              {task.priorityScore} · {task.openFindings} problème
              {task.openFindings > 1 ? "s" : ""} sur {task.pagesAffected} page
              {task.pagesAffected > 1 ? "s" : ""}
            </p>
            {task.wcagCriteria.length > 0 || task.rgaaCriteria.length > 0 ? (
              <p>
                {[
                  task.wcagCriteria.length > 0
                    ? `WCAG ${task.wcagCriteria.join(", ")}`
                    : null,
                  task.rgaaCriteria.length > 0
                    ? `RGAA ${task.rgaaCriteria.join(", ")}`
                    : null,
                ]
                  .filter((part) => part !== null)
                  .join(" · ")}
              </p>
            ) : null}
            <details>
              <summary>Comment corriger</summary>
              <p>{task.guide.summary}</p>
              <ul>
                {task.guide.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </details>
            <div className="field">
              <label htmlFor={`status-${task.id}`}>
                Statut
                <span className="sr-only"> de la tâche {task.ruleId}</span>
              </label>
              <select
                id={`status-${task.id}`}
                value={task.status}
                disabled={update.isPending}
                onChange={(e) =>
                  update.mutate({
                    id: task.id,
                    status: e.target.value as TaskStatus,
                  })
                }
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {taskStatusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`assignee-${task.id}`}>
                Assignée à
                <span className="sr-only"> pour la tâche {task.ruleId}</span>
              </label>
              <select
                id={`assignee-${task.id}`}
                value={task.assignee?.id ?? ""}
                disabled={update.isPending || !members.data}
                onChange={(e) =>
                  update.mutate({
                    id: task.id,
                    assigneeUserId:
                      e.target.value === "" ? null : e.target.value,
                  })
                }
              >
                <option value="">Personne</option>
                {(members.data ?? []).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.email}
                  </option>
                ))}
              </select>
            </div>
          </li>
        ))}
      </ol>

      {tasks.hasNextPage ? (
        <button
          type="button"
          onClick={() => void tasks.fetchNextPage()}
          disabled={tasks.isFetchingNextPage}
        >
          {tasks.isFetchingNextPage ? "Chargement…" : "Afficher plus"}
        </button>
      ) : null}
    </>
  );
}
