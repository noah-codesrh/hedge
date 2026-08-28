import { TelegramIcon, XIcon } from "./icons";

export const DOCS_URL = "https://docs.hedgeapp.trade";
export const SUPPORT_EMAIL = "support@hedgeapp.trade";

/**
 * Shared by the footer and the mobile menu so the two cannot drift apart.
 *
 * `label` is the accessible name for the icon-only footer buttons, while
 * `name` and `handle` are what the menu shows as text.
 */
export const SOCIALS = [
  {
    href: "https://x.com/Hedgetradex",
    name: "X",
    handle: "@Hedgetradex",
    label: "Hedge on X",
    icon: <XIcon size={15} />,
  },
  {
    href: "https://t.me/hedgeapptrade",
    name: "Telegram",
    handle: "@hedgeapptrade",
    label: "Hedge on Telegram",
    icon: <TelegramIcon size={16} />,
  },
];
