import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { Providers } from "./components/Providers";
import { ReferralCapture } from "./components/ReferralCapture";
import { publicOrigin, rewardsMeta, siteMeta } from "./lib/seo";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/logo-mark.svg", type: "image/svg+xml" },
  { rel: "preload", href: "/hero-banner.jpg", as: "image" },
  { rel: "preload", href: "/logo-full.png", as: "image" },
  {
    rel: "preload",
    href: "/assets/Font/Onest/Onest-VariableFont_wght.ttf",
    as: "font",
    type: "font/ttf",
    crossOrigin: "anonymous",
  },
];

export function loader({ request }: Route.LoaderArgs) {
  return { origin: publicOrigin(request) };
}

export function meta({ loaderData, location }: Route.MetaArgs) {
  if (location.pathname === "/rewards") {
    return rewardsMeta(loaderData?.origin);
  }
  return siteMeta({ origin: loaderData?.origin });
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* Sharing tags come from each route's meta() so og:image is absolute.
            Duplicating them here shadowed those with a relative path. */}
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <Providers>
      <ReferralCapture />
      <Outlet />
    </Providers>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto max-w-lg p-6 pt-20">
      <h1 className="text-2xl font-bold">{message}</h1>
      <p className="mt-2 text-muted">{details}</p>
      {stack && (
        <pre className="mt-4 overflow-x-auto rounded-2xl bg-card p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
