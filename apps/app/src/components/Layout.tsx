import { useEffect, useRef } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, call } from "../api.js";
import { meQuery } from "../queries.js";

export function Layout() {
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);
  const mainRef = useRef<HTMLElement>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const firstRender = useRef(true);

  // A single-page app does not reload: move focus to the content on every
  // navigation so keyboard and screen reader users start at the new page.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [pathname]);

  const user = me.data?.user;
  const logout = async () => {
    try {
      await call(api.POST("/auth/logout"));
    } finally {
      queryClient.clear();
      window.location.assign("/login");
    }
  };

  return (
    <>
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>
      <header className="site-header">
        <div className="container">
          <span className="brand">Espace client</span>
          {user ? (
            <nav aria-label="Navigation principale">
              <ul>
                <li>
                  <Link to="/">Mes sites</Link>
                </li>
                <li>
                  <button
                    type="button"
                    className="link-button"
                    onClick={logout}
                  >
                    Se déconnecter ({user.email})
                  </button>
                </li>
              </ul>
            </nav>
          ) : null}
        </div>
      </header>
      <main id="contenu" tabIndex={-1} ref={mainRef}>
        <div className="container">
          <Outlet />
        </div>
      </main>
    </>
  );
}
