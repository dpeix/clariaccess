import { Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Status } from "../components/ui.js";
import { meQuery } from "../queries.js";

export function HomeRedirect() {
  const me = useQuery(meQuery);
  if (!me.data) return <Status>Chargement…</Status>;
  const first = me.data.organizations[0];
  return first ? (
    <Navigate to="/orgs/$orgId" params={{ orgId: first.id }} replace />
  ) : (
    <Navigate to="/orgs/new" replace />
  );
}
