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

const TITLE = "Hedge";
const DESCRIPTION = "Trade predictions. Up to 10x leverage";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/logo-mark.svg", type: "image/svg+xml" },
];

export function loader({ request }: Route.LoaderArgs) {
  return { origin: new URL(request.url).origin };
}

export function meta({ loaderData }: Route.MetaArgs) {
  const origin = loaderData?.origin ?? "";
  const image = `${origin}/og-preview.jpg`;
  return [
    { title: TITLE },
    { name: "description", content: DESCRIPTION },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: TITLE },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESCRIPTION },
    { property: "og:image", content: image },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: TITLE },
    { name: "twitter:description", content: DESCRIPTION },
    { name: "twitter:image", content: image },
  ];
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
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
