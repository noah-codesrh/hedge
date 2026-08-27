import type { Route } from "./+types/terms";
import { originFromMatches, siteMeta } from "../lib/seo";

export function meta({ matches }: Route.MetaArgs) {
  return siteMeta({
    title: "Terms & Conditions - Hedge",
    origin: originFromMatches(matches),
  });
}

const EFFECTIVE_DATE = "27 August 2026";
const WEBSITE = "hedgeapp.trade";

/**
 * Placeholders from the source document. Both still need real values before
 * these Terms can be relied on.
 */
const JURISDICTION = "[Insert Jurisdiction]";
const CONTACT_EMAIL = "[Insert Email]";

/** A paragraph, or a bullet list when the block is an array. */
type Block = string | string[];

const SECTIONS: { title: string; body: Block[]; contact?: boolean }[] = [
  {
    title: "Acceptance of Terms",
    body: [
      "By accessing or using Hedge, you acknowledge that you have read, understood, and agreed to these Terms & Conditions.",
      "If you do not agree to these Terms, you must not use the Platform.",
    ],
  },
  {
    title: "Nature of the Platform",
    body: [
      "Hedge is a prediction platform that allows eligible users to participate in prediction markets and/or prediction-based activities.",
      "Participation involves financial risk. The outcome of a prediction may result in the loss of some or all of the assets or funds committed by a user.",
      "Hedge does not guarantee profits, successful predictions, returns, or preservation of deposited or committed funds.",
    ],
  },
  {
    title: "User Responsibility",
    body: [
      "You are solely responsible for:",
      [
        "Evaluating each prediction or market before participating.",
        "Determining the amount you are willing to risk.",
        "Understanding the rules and settlement conditions of each market.",
        "Ensuring that your participation complies with applicable laws and regulations.",
        "Maintaining the security of your wallet, private keys, passwords, and account credentials.",
        "Accepting any losses resulting from your participation.",
      ],
      "You should never commit funds that you cannot afford to lose.",
    ],
  },
  {
    title: "Risk of Loss",
    body: [
      "Participation on Hedge may result in a partial or complete loss of funds.",
      "You acknowledge and agree that:",
      [
        "Predictions may be incorrect.",
        "Market outcomes may be unexpected.",
        "Markets may experience low liquidity or volatility.",
        "Smart contracts and other technology may contain vulnerabilities or bugs.",
        "Transactions may fail, be delayed, or incur unexpected network fees.",
        "Blockchain transactions may be irreversible.",
        "Technical failures, network congestion, exploits, or third-party infrastructure failures may affect the Platform.",
        "You may lose the entire amount committed to a prediction.",
      ],
      "Hedge shall not be responsible for losses arising from a user’s prediction, trading decision, market outcome, or participation, except to the extent liability cannot legally be excluded.",
    ],
  },
  {
    title: "No Guarantee of Accuracy",
    body: [
      "Information displayed on Hedge, including market data, statistics, probabilities, forecasts, feeds, or other information, may contain errors or become outdated.",
      "Hedge does not guarantee that information displayed on the Platform is accurate, complete, timely, or reliable.",
      "Users are responsible for conducting their own research and making their own decisions.",
    ],
  },
  {
    title: "No Financial or Investment Advice",
    body: [
      "Nothing provided through Hedge constitutes financial, investment, legal, tax, or other professional advice.",
      "Hedge does not recommend that users participate in any particular prediction or market.",
      "Any decision to participate is made entirely at the user’s own discretion and risk.",
    ],
  },
  {
    title: "Blockchain and Smart-Contract Risks",
    body: [
      "Where Hedge uses blockchain networks or smart contracts, users acknowledge that blockchain technology involves inherent risks.",
      "These may include:",
      [
        "Smart-contract vulnerabilities or exploits.",
        "Blockchain network failures.",
        "Network congestion.",
        "Transaction failures.",
        "Incorrect or delayed transaction execution.",
        "Oracle or data-feed failures.",
        "Blockchain reorganizations.",
        "Gas or network-fee fluctuations.",
        "Loss or theft of private keys.",
        "Third-party protocol failures.",
      ],
      "Hedge is not responsible for losses caused by blockchain infrastructure, third-party protocols, wallets, networks, or other services outside its reasonable control, except where applicable law provides otherwise.",
    ],
  },
  {
    title: "Limitation of Liability",
    body: [
      "To the maximum extent permitted by applicable law, Hedge and its founders, operators, employees, contributors, affiliates, and service providers shall not be liable for any direct, indirect, incidental, consequential, special, punitive, or other losses arising from or relating to:",
      [
        "Use of the Platform.",
        "Participation in prediction markets.",
        "Incorrect predictions.",
        "Loss of funds or digital assets.",
        "Market movements or outcomes.",
        "Smart-contract failures or exploits.",
        "Blockchain network failures.",
        "Technical interruptions.",
        "Security incidents.",
        "Third-party services or protocols.",
        "User errors.",
        "Loss of wallet access, private keys, or credentials.",
      ],
      "Nothing in these Terms excludes or limits liability that cannot legally be excluded or limited under applicable law.",
    ],
  },
  {
    title: "User’s Own Risk",
    body: [
      "By using Hedge, you expressly acknowledge that you understand the risks associated with prediction markets and voluntarily assume those risks.",
      "You participate entirely at your own risk.",
      "You acknowledge that you could lose some or all of the funds committed to a prediction and that Hedge does not guarantee that you will receive any return.",
    ],
  },
  {
    title: "Eligibility",
    body: [
      "You may only use Hedge if you are legally permitted to do so under the laws applicable to you.",
      "You are responsible for determining whether your use of Hedge is lawful in your jurisdiction.",
      "Hedge may restrict, suspend, or terminate access to users or jurisdictions where participation is prohibited or presents regulatory, legal, or operational concerns.",
    ],
  },
  {
    title: "Prohibited Use",
    body: [
      "Users must not use Hedge for unlawful activities, fraud, manipulation, money laundering, sanctions evasion, or any other activity prohibited by applicable law.",
      "Hedge reserves the right to suspend or terminate accounts or restrict participation where it reasonably believes these Terms or applicable laws have been violated.",
    ],
  },
  {
    title: "Fees and Transactions",
    body: [
      "Users may be required to pay Platform fees, blockchain network fees, transaction fees, or other applicable charges.",
      "Fees may be non-refundable once a transaction has been initiated or executed.",
      "Users are responsible for reviewing applicable fees before confirming transactions.",
    ],
  },
  {
    title: "Platform Availability",
    body: [
      "Hedge does not guarantee that the Platform will always be available, uninterrupted, secure, or error-free.",
      "The Platform may be temporarily unavailable due to maintenance, upgrades, technical problems, blockchain congestion, cybersecurity incidents, or circumstances beyond our reasonable control.",
    ],
  },
  {
    title: "Changes to Markets",
    body: [
      "Hedge may modify, suspend, pause, or terminate markets where reasonably necessary due to technical problems, invalid data, security concerns, unforeseen circumstances, or other legitimate reasons.",
      "Market-specific rules displayed at the time of participation may contain additional settlement conditions.",
    ],
  },
  {
    title: "Intellectual Property",
    body: [
      "All Platform materials, branding, logos, software, interfaces, and content owned or licensed by Hedge remain the property of Hedge or the applicable rights holder.",
      "Users may not reproduce, distribute, modify, or commercially exploit such materials without appropriate authorization.",
    ],
  },
  {
    title: "Indemnification",
    body: [
      "To the maximum extent permitted by law, you agree to indemnify and hold harmless Hedge and its founders, operators, employees, affiliates, contributors, and service providers from claims, damages, losses, liabilities, and expenses arising from:",
      [
        "Your use of the Platform.",
        "Your violation of these Terms.",
        "Your violation of applicable law.",
        "Your participation in prediction markets.",
        "Your actions or omissions while using Hedge.",
      ],
    ],
  },
  {
    title: "Assumption of Risk",
    body: [
      "By clicking “I Agree,” connecting a wallet, depositing funds, or participating in a prediction, you confirm that:",
      "You understand that prediction markets involve significant financial risk, you may lose all funds committed, and you voluntarily accept those risks.",
    ],
  },
  {
    title: "Governing Law",
    body: [
      `These Terms shall be governed by the laws of ${JURISDICTION}, without regard to its conflict-of-law principles.`,
      "Any disputes shall be handled in the courts or dispute-resolution forum specified by Hedge, subject to applicable law.",
    ],
  },
  {
    title: "Severability",
    body: [
      "If any provision of these Terms is determined to be invalid or unenforceable, the remaining provisions shall continue in full force and effect to the maximum extent permitted by law.",
    ],
  },
  {
    title: "Contact",
    body: ["For questions regarding these Terms, contact:"],
    contact: true,
  },
];

const ACKNOWLEDGEMENT = [
  "I have read and accepted these Terms & Conditions.",
  "I understand that I can lose some or all of the funds I commit.",
  "I understand that Hedge does not guarantee profits or successful predictions.",
  "I understand that I participate at my own risk.",
  "I understand that this platform does not provide financial or investment advice.",
  "I am legally permitted to use the Platform in my jurisdiction.",
];

/** Anchor id so a clause can be linked directly, e.g. /terms#governing-law. */
function slug(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold">{children}</dd>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 pl-1">
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          <span
            aria-hidden
            className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-gold/70"
          />
          <span className="text-[15px] leading-relaxed text-[#cfcfcf]">
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ContactCard() {
  return (
    <dl className="rounded-2xl bg-card-2 px-5 py-4 text-[15px] ring-1 ring-white/5">
      <dd className="font-semibold">Hedge</dd>
      <div className="mt-2 flex gap-2">
        <dt className="text-muted">Email:</dt>
        <dd>{CONTACT_EMAIL}</dd>
      </div>
      <div className="mt-1 flex gap-2">
        <dt className="text-muted">Website:</dt>
        <dd>
          <a
            href={`https://${WEBSITE}`}
            className="text-gold hover:underline"
          >
            {WEBSITE}
          </a>
        </dd>
      </div>
    </dl>
  );
}

export default function Terms() {
  return (
    <main className="mx-auto min-w-0 max-w-3xl px-4 pt-6 pb-[calc(6.75rem+env(safe-area-inset-bottom))] sm:pt-10 lg:pb-16">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
        Legal
      </p>
      <h1 className="mt-2 text-[1.85rem] font-bold leading-tight tracking-tight sm:text-4xl">
        Terms &amp; Conditions
      </h1>

      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-2xl bg-card-2 px-5 py-4 ring-1 ring-white/5 sm:grid-cols-3">
        <Meta label="Effective date">{EFFECTIVE_DATE}</Meta>
        <Meta label="Platform">Hedge</Meta>
        <Meta label="Website">
          <a
            href="https://hedgeapp.trade"
            className="text-gold hover:underline"
          >
            hedgeapp.trade
          </a>
        </Meta>
      </dl>

      <div className="mt-9 space-y-9">
        {SECTIONS.map((section, index) => (
          <section
            key={section.title}
            id={slug(section.title)}
            className="scroll-mt-20"
          >
            <h2 className="text-[1.05rem] font-semibold tracking-tight sm:text-lg">
              <span className="mr-2 text-muted tabular-nums">{index + 1}.</span>
              {section.title}
            </h2>
            <div className="mt-3 space-y-3">
              {section.body.map((block) =>
                Array.isArray(block) ? (
                  <Bullets key={block[0]} items={block} />
                ) : (
                  <p
                    key={block}
                    className="text-[15px] leading-relaxed text-[#cfcfcf]"
                  >
                    {block}
                  </p>
                ),
              )}
              {section.contact ? <ContactCard /> : null}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-10 rounded-2xl bg-card-2 px-5 py-6 ring-1 ring-white/5 sm:px-6">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
          User acknowledgement
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-[#cfcfcf]">
          By using Hedge, I confirm that:
        </p>
        <div className="mt-3">
          <Bullets items={ACKNOWLEDGEMENT} />
        </div>
      </section>
    </main>
  );
}
