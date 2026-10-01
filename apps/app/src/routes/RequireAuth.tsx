import { Navigate, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { isUnauthorized } from "../api.js";
import { ErrorMessage, Status } from "../components/ui.js";
import { meQuery } from "../queries.js";

export function RequireAuth() {
  const me = useQuery(meQuery);
  if (me.isPending) return <Status>Chargement…</Status>;
  if (isUnauthorized(me.error)) return <Navigate to="/login" replace />;
  if (me.isError) return <ErrorMessage>{me.error.message}</ErrorMessage>;
  return <Outlet />;
}
