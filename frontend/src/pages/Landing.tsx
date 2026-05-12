import { Link } from "react-router-dom";

const competitors = [
  {
    name: "Sarcophagus",
    desc: "Decentralized dead man's switch on Ethereum + Arweave.",
    fail: "Token crashed 96% to $0.002. Operators have no incentive to stay online. Effectively dead.",
  },
  {
    name: "Casa",
    desc: "$250/year semi-custodial inheritance.",
    fail: "Closed source, centralized, expensive. Trusting a company with your keys.",
  },
  {
    name: "Multisig wallets",
    desc: "2-of-3 with spouse + child + lawyer.",
    fail: "Requires the whole family to be crypto-literate forever. Most can't.",
  },
  {
    name: "Deadhand Protocol",
    desc: "CLI tool that splits seed into shards.",
    fail: "CLI proof-of-concept. No TEE, no autonomous execution.",
  },
];

export default function Landing() {
  return (
    <div className="container-wide py-16">
      <section className="grid lg:grid-cols-2 gap-12 items-center mb-24">
        <div>
          <span className="badge bg-neutral-900 border border-neutral-800 text-neutral-300 mb-6">
            Eigen Labs · private preview · 2026
          </span>
          <h1 className="text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05]">
            Your wallet shouldn't<br />die with you.
          </h1>
          <p className="mt-6 text-lg text-neutral-400 max-w-lg">
            Heirloom is a sovereign agent that protects your crypto when you can't.
            Sealed inside hardware-encrypted memory on EigenCompute — your seed
            phrase is unreachable, even by us.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/setup" className="btn-primary">Set up your plan</Link>
            <a href="#how" className="btn-secondary">How it works</a>
          </div>
          <div className="mt-12 grid grid-cols-3 gap-6 max-w-md">
            <Stat n="3.8M" l="BTC permanently lost" />
            <Stat n="$400B+" l="value, gone forever" />
            <Stat n="0" l="working solutions today" />
          </div>
        </div>
        <div className="card p-8 lg:p-10 bg-gradient-to-br from-neutral-950 to-neutral-900">
          <div className="text-xs uppercase tracking-wider text-neutral-500 mb-4">trust chain</div>
          <ul className="space-y-3 text-sm">
            {[
              ["Intel TDX silicon", "hardware-encrypted memory; even host root can't read"],
              ["Google Confidential Space", "attested boot + sealed env vars"],
              ["Eigen Labs KMS", "auto-injects MNEMONIC; deterministic per app ID"],
              ["EigenAI verifiable inference", "deterministic prompts, signed receipts"],
              ["On-chain transparency", "AppUpgraded events watched by verifiers"],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                <div>
                  <div className="font-medium">{t}</div>
                  <div className="text-neutral-500 text-xs">{d}</div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs text-neutral-500">
            We frame this as <em>minimized, verifiable trust</em> — not "trustless."
            EigenVerify slashing is roadmap, not live in alpha.
          </p>
        </div>
      </section>

      <section id="how" className="mb-24">
        <h2 className="text-3xl font-semibold tracking-tight mb-2">How it works</h2>
        <p className="text-neutral-400 mb-10 max-w-2xl">
          Five phases, every one resolvable by simply checking in. The agent never has access
          while you're alive — only your encrypted seed and your beneficiary plan.
        </p>
        <ol className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            ["1 · Active", "You check in within your interval (30/60/90 days). Each heartbeat resets the clock."],
            ["2 · Reminder", "If you miss the window, daily reminders to your phone and email."],
            ["3 · Emergency contact", "Your spouse, kids, lawyer get notified — they can have you log in if you're okay."],
            ["4 · Verification", "EigenAI analyzes recent on-chain activity. Wallet active? Plan extends. Inactive? Move on."],
            ["5 · Execution", "The agent unseals your seed inside the TEE, scans balances, and distributes by your percentages. Signed log written to the audit trail."],
          ].map(([t, d]) => (
            <li key={t} className="card">
              <div className="font-medium mb-2">{t}</div>
              <p className="text-sm text-neutral-400">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-24">
        <h2 className="text-3xl font-semibold tracking-tight mb-2">What exists today</h2>
        <p className="text-neutral-400 mb-10 max-w-2xl">
          The crypto inheritance category is littered with abandoned protocols, expensive
          custodians, and tooling that family members can't actually use. Heirloom is the
          first that holds keys in hardware no operator can read, and executes autonomously
          on a verifiable schedule.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          {competitors.map((c) => (
            <div key={c.name} className="card">
              <div className="flex items-baseline justify-between mb-2">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-red-400">why it fails</div>
              </div>
              <p className="text-sm text-neutral-300 mb-2">{c.desc}</p>
              <p className="text-sm text-neutral-500">{c.fail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card text-center py-16">
        <h2 className="text-3xl font-semibold tracking-tight mb-2">Set your plan in 5 minutes</h2>
        <p className="text-neutral-400 mb-6">No accounts. No tokens. Self-custody throughout.</p>
        <Link to="/setup" className="btn-primary">Set up your plan</Link>
      </section>
    </div>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tracking-tight">{n}</div>
      <div className="text-xs text-neutral-500 mt-1">{l}</div>
    </div>
  );
}
