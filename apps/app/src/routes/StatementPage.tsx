import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ComplianceStatus, Statement } from "@accessibility/contracts";
import { api, call } from "../api.js";
import { ErrorMessage, Status, useTitle } from "../components/ui.js";
import { formatDateTime } from "../lib/labels.js";
import {
  complianceExplanation,
  fieldLabel,
  levelLabel,
  parseSamplePages,
  samplePagesText,
  statementStatusLabel,
} from "../lib/statement.js";
import { statementsQuery } from "../queries.js";

const apiBase = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export function StatementPage({ siteId }: { siteId: string }) {
  useTitle("Déclaration d'accessibilité");
  const queryClient = useQueryClient();
  const list = useQuery(statementsQuery(siteId));
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["statements", siteId] });

  const create = useMutation({
    mutationFn: () =>
      call(
        api.POST("/sites/{id}/statements", {
          params: { path: { id: siteId } },
        }),
      ),
    onSuccess: refresh,
  });

  if (list.isPending) return <Status>Chargement…</Status>;
  if (list.isError) return <ErrorMessage>{list.error.message}</ErrorMessage>;
  const statements = list.data;
  const draft = statements.find((s) => s.status === "draft");
  const current = statements.find((s) => s.status === "published");

  return (
    <>
      <h1>Déclaration d'accessibilité</h1>
      <p>
        <Link to="/sites/$siteId" params={{ siteId }}>
          Retour au site
        </Link>{" "}
        ·{" "}
        <Link to="/sites/$siteId/audit-manuel" params={{ siteId }}>
          Audit manuel
        </Link>
      </p>
      <p className="notice">
        La déclaration engage son éditeur. Elle se fonde sur votre audit :
        l'outil propose le niveau de conformité que cet audit permet d'affirmer,
        vous décidez de publier. Il ne remplace pas un audit réalisé par un
        auditeur qualifié.
      </p>

      {current ? <PublishedCard statement={current} /> : null}

      {draft ? (
        <DraftEditor statement={draft} onChanged={refresh} />
      ) : (
        <section aria-labelledby="new-title">
          <h2 id="new-title">
            {current
              ? "Préparer une nouvelle version"
              : "Préparer la déclaration"}
          </h2>
          <p>
            Le brouillon est pré-rempli à partir de votre audit manuel et du
            dernier audit automatisé.
          </p>
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending}
          >
            {create.isPending ? "Création…" : "Créer un brouillon"}
          </button>
          {create.isError ? (
            <ErrorMessage>{create.error.message}</ErrorMessage>
          ) : null}
        </section>
      )}

      {statements.length > 0 ? (
        <section aria-labelledby="history-title">
          <h2 id="history-title">Versions</h2>
          <table>
            <caption>
              Versions de la déclaration, de la plus récente à la plus ancienne
            </caption>
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">État</th>
                <th scope="col">Niveau déclaré</th>
                <th scope="col">Publiée le</th>
                <th scope="col">Pages</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((s) => (
                <tr key={s.id}>
                  <td>{s.version}</td>
                  <td>{statementStatusLabel(s.status)}</td>
                  <td>
                    {s.declaredStatus ? levelLabel(s.declaredStatus) : "—"}
                  </td>
                  <td>{formatDateTime(s.publishedAt)}</td>
                  <td>
                    {s.publicPath ? (
                      <>
                        <a href={`${apiBase}${s.publicPath}`}>
                          Page
                          <span className="sr-only">
                            {" "}
                            de la version {s.version}
                          </span>
                        </a>
                        {s.pdfReady ? (
                          <>
                            {" · "}
                            <a href={`${apiBase}${s.publicPath}/pdf`}>
                              PDF
                              <span className="sr-only">
                                {" "}
                                de la version {s.version}
                              </span>
                            </a>
                          </>
                        ) : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}

function PublishedCard({ statement }: { statement: Statement }) {
  return (
    <section aria-labelledby="current-title" className="notice">
      <h2 id="current-title">
        Déclaration en vigueur : version {statement.version}
      </h2>
      <p>
        {statement.declaredStatus ? levelLabel(statement.declaredStatus) : ""},
        publiée le {formatDateTime(statement.publishedAt)}.
      </p>
      {statement.publicPath ? (
        <p>
          Adresse publique à placer sur votre site :{" "}
          <a
            href={`${apiBase}${statement.publicPath}`}
          >{`${apiBase}${statement.publicPath}`}</a>
          {statement.pdfReady ? (
            <>
              {" "}
              ·{" "}
              <a href={`${apiBase}${statement.publicPath}/pdf`}>
                Télécharger le PDF
              </a>
            </>
          ) : (
            <> (PDF en cours de génération)</>
          )}
        </p>
      ) : null}
    </section>
  );
}

function DraftEditor({
  statement,
  onChanged,
}: {
  statement: Statement;
  onChanged: () => unknown;
}) {
  const [fields, setFields] = useState({
    entityName: statement.entityName ?? "",
    contactEmail: statement.contactEmail ?? "",
    contactUrl: statement.contactUrl ?? "",
    derogations: statement.derogations ?? "",
    samplePages: samplePagesText(statement.samplePages),
    technologies: statement.technologies ?? "",
    testEnvironment: statement.testEnvironment ?? "",
    tools: statement.tools ?? "",
  });
  const [declared, setDeclared] = useState<ComplianceStatus | "">("");
  const [confirmed, setConfirmed] = useState(false);
  const set = (key: keyof typeof fields) => (value: string) =>
    setFields((f) => ({ ...f, [key]: value }));

  const nullable = (v: string) => (v.trim() === "" ? null : v.trim());
  const save = useMutation({
    mutationFn: () =>
      call(
        api.PUT("/statements/{id}", {
          params: { path: { id: statement.id } },
          body: {
            entityName: nullable(fields.entityName),
            contactEmail: nullable(fields.contactEmail),
            contactUrl: nullable(fields.contactUrl),
            derogations: nullable(fields.derogations),
            samplePages: parseSamplePages(fields.samplePages),
            technologies: nullable(fields.technologies),
            testEnvironment: nullable(fields.testEnvironment),
            tools: nullable(fields.tools),
          },
        }),
      ),
    onSuccess: onChanged,
  });
  const publish = useMutation({
    mutationFn: (level: ComplianceStatus) =>
      call(
        api.POST("/statements/{id}/publish", {
          params: { path: { id: statement.id } },
          body: { declaredStatus: level },
        }),
      ),
    onSuccess: onChanged,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  const canPublish =
    declared !== "" && confirmed && statement.missing.length === 0;

  return (
    <>
      <section aria-labelledby="level-title">
        <h2 id="level-title">Brouillon, version {statement.version}</h2>
        <p>
          Niveau que l'audit permet d'affirmer :{" "}
          <strong>{levelLabel(statement.computedStatus)}</strong>
          {statement.complianceRate !== null
            ? ` (${statement.complianceRate} % des critères applicables conformes)`
            : ""}
          .
        </p>
        <p>
          {complianceExplanation(
            statement.computedStatus,
            statement.counts,
            statement.unattributed,
          )}
        </p>
        {statement.nonAccessibleContent.length > 0 ? (
          <table>
            <caption>
              Critères non conformes qui seront listés dans la déclaration
            </caption>
            <thead>
              <tr>
                <th scope="col">Critère</th>
                <th scope="col">Intitulé</th>
                <th scope="col">Origine</th>
              </tr>
            </thead>
            <tbody>
              {statement.nonAccessibleContent.map((item) => (
                <tr key={item.criterionId}>
                  <th scope="row">{item.criterionId}</th>
                  <td>{item.title}</td>
                  <td>
                    {item.sources
                      .map((s) =>
                        s === "manual"
                          ? "Vérification manuelle"
                          : "Test automatisé",
                      )
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <form onSubmit={submit} aria-labelledby="fields-title">
        <h2 id="fields-title">Informations de la déclaration</h2>
        <TextField
          id="entity"
          label="Nom de l'éditeur"
          value={fields.entityName}
          onChange={set("entityName")}
        />
        <TextField
          id="email"
          label="Courriel de contact"
          type="email"
          value={fields.contactEmail}
          onChange={set("contactEmail")}
        />
        <TextField
          id="contact-url"
          label="Page ou formulaire de contact"
          type="url"
          value={fields.contactUrl}
          onChange={set("contactUrl")}
        />
        <AreaField
          id="sample"
          label="Pages vérifiées (une adresse par ligne)"
          value={fields.samplePages}
          onChange={set("samplePages")}
          rows={5}
        />
        <AreaField
          id="tech"
          label="Technologies utilisées pour la réalisation du site"
          value={fields.technologies}
          onChange={set("technologies")}
        />
        <AreaField
          id="env"
          label="Environnement de test (navigateurs, lecteurs d'écran)"
          value={fields.testEnvironment}
          onChange={set("testEnvironment")}
        />
        <AreaField
          id="tools"
          label="Outils pour évaluer l'accessibilité"
          value={fields.tools}
          onChange={set("tools")}
        />
        <AreaField
          id="derog"
          label="Dérogations pour charge disproportionnée (facultatif)"
          value={fields.derogations}
          onChange={set("derogations")}
        />
        <button type="submit" disabled={save.isPending}>
          {save.isPending ? "Enregistrement…" : "Enregistrer le brouillon"}
        </button>
        {save.isError ? (
          <ErrorMessage>{save.error.message}</ErrorMessage>
        ) : null}
        {save.isSuccess ? <Status>Brouillon enregistré.</Status> : null}
      </form>

      <section aria-labelledby="publish-title">
        <h2 id="publish-title">Publication</h2>
        {statement.missing.length > 0 ? (
          <>
            <p>Avant de publier, il manque :</p>
            <ul>
              {statement.missing.map((m) => (
                <li key={m}>{fieldLabel(m)}</li>
              ))}
            </ul>
          </>
        ) : null}
        {statement.allowedStatuses.length === 0 ? (
          <p>
            La publication n'est pas possible tant que l'audit n'est pas
            complet.
          </p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="declared">Niveau de conformité à déclarer</label>
              <select
                id="declared"
                value={declared}
                onChange={(e) =>
                  setDeclared(e.target.value as ComplianceStatus | "")
                }
              >
                <option value="">Choisir…</option>
                {statement.allowedStatuses.map((level) => (
                  <option key={level} value={level}>
                    {levelLabel(level)}
                  </option>
                ))}
              </select>
            </div>
            <div className="choice">
              <input
                id="confirm"
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <label htmlFor="confirm" className="inline">
                Je confirme que cette déclaration est exacte : une fois publiée,
                elle devient publique et engage mon organisation.
              </label>
            </div>
            <button
              type="button"
              disabled={!canPublish || publish.isPending}
              onClick={() => declared !== "" && publish.mutate(declared)}
            >
              {publish.isPending ? "Publication…" : "Publier la déclaration"}
            </button>
          </>
        )}
        {publish.isError ? (
          <ErrorMessage>{publish.error.message}</ErrorMessage>
        ) : null}
      </section>
    </>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function AreaField({
  id,
  label,
  value,
  onChange,
  rows = 3,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
