import {
  ArrowRight,
  CalendarClock,
  CircleDollarSign,
  ClipboardCheck,
  CreditCard,
  FileCheck2,
  Info,
  Landmark,
  ShieldCheck,
  Wallet,
} from 'lucide-react';

interface Props {
  onOpenCards: () => void;
}

const requirements = [
  {
    number: '01',
    icon: FileCheck2,
    title: 'Account and identity checks',
    description: 'The account and identity information required for a supported credit product must be verified.',
  },
  {
    number: '02',
    icon: ClipboardCheck,
    title: 'Affordability assessment',
    description: 'A lender assesses eligibility, affordability and the rules that apply in your jurisdiction.',
  },
  {
    number: '03',
    icon: ShieldCheck,
    title: 'Terms before activation',
    description: 'Any approved limit, pricing, billing cycle and repayment terms must be disclosed before use.',
  },
];

export default function CreditOverviewSection({ onOpenCards }: Props) {
  return (
    <section className="bank-credit" aria-labelledby="credit-page-title">
      <header className="bank-page-intro bank-credit__intro">
        <div>
          <p className="bank-eyebrow">Borrowing &amp; credit</p>
          <h1 id="credit-page-title" className="bank-page-title">Credit, clearly understood.</h1>
          <p className="bank-page-subtitle">
            Credit is a borrowing facility. A card is one way to access an approved facility — they are not the same product.
          </p>
        </div>
      </header>

      <div className="bank-credit__hero">
        <div className="bank-credit__hero-main">
          <div className="bank-credit__hero-top">
            <span className="bank-credit__icon"><CircleDollarSign size={21} /></span>
            <span className="bank-credit__status"><span /> No active facility</span>
          </div>
          <p className="bank-credit__eyebrow">Your credit facility</p>
          <h2>No credit limit has been issued</h2>
          <p className="bank-credit__hero-copy">
            There is currently no active credit facility attached to this account. No borrowing balance or repayment schedule is being shown.
          </p>
          <div className="bank-credit__hero-foot">
            <span><ShieldCheck size={15} /> No credit or payment action is available here</span>
          </div>
        </div>

        <div className="bank-credit__facts-wrap">
          <p className="bank-label">Facility details</p>
          <dl className="bank-credit__facts">
            <div><dt>Credit limit</dt><dd>Not assigned</dd></div>
            <div><dt>Outstanding balance</dt><dd>—</dd></div>
            <div><dt>Interest rate</dt><dd>Not set</dd></div>
            <div><dt>Next payment</dt><dd>Not scheduled</dd></div>
          </dl>
          <p className="bank-credit__facts-note">Details appear here only after a supported facility is formally approved and issued.</p>
        </div>
      </div>

      <section className="bank-credit__products" aria-labelledby="credit-products-title">
        <div className="bank-credit__section-heading">
          <div>
            <p className="bank-eyebrow">Know the difference</p>
            <h2 id="credit-products-title" className="bank-section-title">Credit facility vs. card</h2>
          </div>
        </div>
        <div className="bank-credit__product-grid">
          <article className="bank-credit__product bank-credit__product--facility">
            <span className="bank-credit__product-icon"><Landmark size={20} /></span>
            <p className="bank-credit__product-kicker">The borrowing agreement</p>
            <h3>Credit facility</h3>
            <p>A lender-approved amount you may borrow under defined terms, pricing, billing and repayment rules.</p>
            <ul>
              <li><span>01</span> Approved credit limit</li>
              <li><span>02</span> Interest and fees disclosed</li>
              <li><span>03</span> Statement and repayment terms</li>
            </ul>
          </article>

          <article className="bank-credit__product">
            <span className="bank-credit__product-icon"><CreditCard size={20} /></span>
            <p className="bank-credit__product-kicker">The payment instrument</p>
            <h3>Credit card</h3>
            <p>A card can access a credit facility, but it must be separately issued by a supported card programme.</p>
            <ul>
              <li><span>01</span> Physical or virtual card</li>
              <li><span>02</span> Card controls and servicing</li>
              <li><span>03</span> Subject to issuer approval</li>
            </ul>
            <button type="button" onClick={onOpenCards} className="bank-credit__link">
              View card options <ArrowRight size={15} />
            </button>
          </article>
        </div>
      </section>

      <section className="bank-credit__readiness" aria-labelledby="credit-readiness-title">
        <div className="bank-credit__section-heading">
          <div>
            <p className="bank-eyebrow">Before a facility exists</p>
            <h2 id="credit-readiness-title" className="bank-section-title">What a proper credit setup requires</h2>
          </div>
          <span className="bank-credit__not-offer">Information only</span>
        </div>
        <div className="bank-credit__steps">
          {requirements.map((item) => {
            const Icon = item.icon;
            return (
              <article className="bank-credit__step" key={item.number}>
                <span className="bank-credit__step-number">{item.number}</span>
                <span className="bank-credit__step-icon"><Icon size={18} /></span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <div className="bank-credit__disclosure" role="note">
        <Info size={17} />
        <p>This is an account information screen, not a credit offer. No credit score, limit, interest rate or approval is being estimated. No funds can be borrowed or repaid from this page.</p>
      </div>
    </section>
  );
}
