import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("api/events", "routes/api.events.ts"),
  route("api/assets", "routes/api.assets.ts"),
  route("api/quotes", "routes/api.quotes.ts"),
  route("api/convert", "routes/api.convert.ts"),
  route("api/pm/builder-sign", "routes/api.pm.builder-sign.ts"),
  route("api/pm/relayer-key", "routes/api.pm.relayer-key.ts"),
  route("api/pm/config", "routes/api.pm.config.ts"),
  route("api/pm/balance", "routes/api.pm.balance.ts"),
  route("api/pm/portfolio", "routes/api.pm.portfolio.ts"),
  route("api/pm/account", "routes/api.pm.account.ts"),
  route("api/pm/status", "routes/api.pm.status.ts"),
  route("api/pm/sponsor-tx", "routes/api.pm.sponsor-tx.ts"),
  route("api/relay/quote", "routes/api.relay.quote.ts"),
  route("api/relay/status", "routes/api.relay.status.ts"),
  route("api/relay/forward", "routes/api.relay.forward.ts"),
  layout("routes/shell.tsx", [
    index("routes/home.tsx"),
    route("market/:id", "routes/market.$id.tsx"),
    route("profile", "routes/profile.tsx"),
  ]),
] satisfies RouteConfig;
