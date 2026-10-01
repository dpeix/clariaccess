import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ManualCheckList, ManualStatus } from "@accessibility/contracts";
import { MANUAL_STATUSES } from "@accessibility/contracts";
import { api, call } from "../api.js";
import { ErrorMessage, Status, useTitle } from "../components/ui.js";
import {
  criteriaOfTheme,
  manualStatusLabel,
  progressLabel,
  visibleCriteria,
  type CriteriaFilter,
} from "../lib/statement.js";
import { formatDateTime } from "../lib/labels.js";
import { manualChecksQuery } from "../queries.js";

type Criterion = ManualCheckList["criteria"][number];

const FILTERS: [CriteriaFilter, string][] = [
  ["all", "Tous les critères"],
  ["todo", "Restant à vérifier"],
  ["ko", "Non conformes"],
  ["problems", "À revoir (non conformes ou contredits par le scan)"],
];

export function ManualAuditPage({ siteId }: { siteId: string }) {
  useTitle("Audit manuel");
  const queryClient = useQueryClient();
  const list = useQuery(manualChecksQuery(siteId));
  const [theme, setTheme] = useState(1);
  const [filter, setFilter] = useState<CriteriaFilter>("all");
  const [announcement, setAnnouncement] = useState("");

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["manual-checks", siteId] });
  const save = useMutation({
    mutationFn: (input: {
      id: string;
      status: ManualStatus;
      notes: string;
      evidenceUrl: string | null;
    }) =>
      call(
        api.PUT("/sites/{id}/manual-checks/{criterionId}", {
          params: { path: { id: siteId, criterionId: input.id } },
          body: {
            status: input.status,
            notes: input.notes,
            evidenceUrl: input.evidenceUrl,
          },
        }),
      ),
    onSuccess: async (_data, input) => {
      await refresh();
      setAnnouncement(`Critère ${input.id} enregistré.`);
    },
  });
  const clear = useMutation({
    mutationFn: (id: string) =>
      call(
        api.DELETE("/sites/{id}/manual-checks/{criterionId}", {
          params: { path: { id: siteId, criterionId: id } },
        }),
      ),
    onSuccess: async (_data, id) => {
      await refresh();
      setAnnouncement(`Vérification du critère ${id} effacée.`);
    },
  });

  if (list.isPending) return <Status>Chargement des critères…</Status>;
  if (list.isError) return <ErrorMessage>{list.error.message}</ErrorMessage>;
  const data = list.data;
  const criteria = visibleCriteria(
    criteriaOfTheme(data.criteria, theme),
    filter,
  );

  return (
    <>
      <h1>Audit manuel RGAA {data.referentialVersion}</h1>
      <p>
        <Link to="/sites/$siteId" params={{ siteId }}>
          Retour au site
        </Link>{" "}
        ·{" "}
        <Link to="/sites/$siteId/declaration" params={{ siteId }}>
          Préparer la déclaration d'accessibilité
        </Link>
      </p>
      <p className="notice">
        Un audit automatisé ne valide aucun critère : il ne peut que révéler des
        problèmes. Chaque critère doit être vérifié par une personne, selon les
        tests du RGAA.
      </p>
      <p>
        <strong>{progressLabel(data.progress)}</strong>
      </p>
      <progress
        max={data.progress.total}
        value={data.progress.checked}
        aria-label="Progression de l'audit manuel"
      />

      <div className="field">
        <label htmlFor="theme-select">Thématique</label>
        <select
          id="theme-select"
          value={theme}
          onChange={(e) => setTheme(Number(e.target.value))}
        >
          {data.themes.map((t) => {
            const inTheme = criteriaOfTheme(data.criteria, t.number);
            const done = inTheme.filter((c) => c.check !== null).length;
            return (
              <option key={t.number} value={t.number}>
                {t.number}. {t.title} ({done}/{inTheme.length})
              </option>
            );
          })}
        </select>
      </div>
      <div className="field">
        <label htmlFor="criteria-filter">Afficher</label>
        <select
          id="criteria-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as CriteriaFilter)}
        >
          {FILTERS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div role="status" className="sr-only">
        {announcement}
      </div>
      {save.isError ? <ErrorMessage>{save.error.message}</ErrorMessage> : null}
      {clear.isError ? (
        <ErrorMessage>{clear.error.message}</ErrorMessage>
      ) : null}
      {criteria.length === 0 ? (
        <p>Aucun critère à afficher pour ce filtre.</p>
      ) : null}

      {criteria.map((criterion) => (
        <CriterionForm
          key={`${criterion.id}-${criterion.check?.checkedAt ?? "none"}`}
          criterion={criterion}
          busy={save.isPending || clear.isPending}
          onSave={(values) => save.mutate({ id: criterion.id, ...values })}
          onClear={() => clear.mutate(criterion.id)}
        />
      ))}
    </>
  );
}

function CriterionForm({
  criterion,
  busy,
  onSave,
  onClear,
}: {
  criterion: Criterion;
  busy: boolean;
  onSave: (values: {
    status: ManualStatus;
    notes: string;
    evidenceUrl: string | null;
  }) => void;
  onClear: () => void;
}) {
  const [status, setStatus] = useState<ManualStatus | null>(
    criterion.check?.status ?? null,
  );
  const [notes, setNotes] = useState(criterion.check?.notes ?? "");
  const [evidence, setEvidence] = useState(criterion.check?.evidenceUrl ?? "");
  const id = criterion.id.replace(".", "-");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (status === null) return;
    onSave({
      status,
      notes,
      evidenceUrl: evidence.trim() === "" ? null : evidence.trim(),
    });
  };

  return (
    <form
      onSubmit={submit}
      className="criterion"
      aria-labelledby={`legend-${id}`}
    >
      <fieldset>
        <legend id={`legend-${id}`}>
          <strong>Critère {criterion.id}</strong> — {criterion.title}
        </legend>
        {criterion.autoTested ? (
          <p>
            Le scan automatique examine ce critère (règles axe :{" "}
            {criterion.axeRules.join(", ")}) ; un scan sans problème ne le
            valide pas.
          </p>
        ) : (
          <p>Ce critère ne peut être vérifié que manuellement.</p>
        )}
        {criterion.autoProblems > 0 ? (
          <p className="error">
            Le scan signale {criterion.autoProblems} problème
            {criterion.autoProblems > 1 ? "s" : ""} ouvert
            {criterion.autoProblems > 1 ? "s" : ""} sur ce critère : il sera
            compté non conforme dans la déclaration
            {criterion.check?.status === "ok"
              ? ", malgré votre vérification"
              : ""}
            .
          </p>
        ) : null}
        <div
          role="radiogroup"
          aria-label={`Résultat de la vérification du critère ${criterion.id}`}
        >
          {MANUAL_STATUSES.map((value) => (
            <div className="choice" key={value}>
              <input
                type="radio"
                id={`${id}-${value}`}
                name={`status-${id}`}
                value={value}
                checked={status === value}
                onChange={() => setStatus(value)}
              />
              <label htmlFor={`${id}-${value}`} className="inline">
                {manualStatusLabel(value)}
              </label>
            </div>
          ))}
        </div>
        <div className="field">
          <label htmlFor={`notes-${id}`}>Constat, notes</label>
          <textarea
            id={`notes-${id}`}
            rows={3}
            maxLength={5000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`evidence-${id}`}>
            Lien vers une preuve (facultatif)
          </label>
          <input
            id={`evidence-${id}`}
            type="url"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </div>
        <button type="submit" disabled={busy || status === null}>
          Enregistrer<span className="sr-only"> le critère {criterion.id}</span>
        </button>{" "}
        {criterion.check !== null ? (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClear}
          >
            Effacer
            <span className="sr-only">
              {" "}
              la vérification du critère {criterion.id}
            </span>
          </button>
        ) : null}
        {criterion.check !== null ? (
          <p>
            <small>
              Vérifié le {formatDateTime(criterion.check.checkedAt)}
              {criterion.check.checkedBy
                ? ` par ${criterion.check.checkedBy}`
                : ""}
              .
            </small>
          </p>
        ) : null}
      </fieldset>
    </form>
  );
}
