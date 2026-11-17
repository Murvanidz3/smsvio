import { COMPANY_ADDRESS, COMPANY_NAME, SALES_URL } from './company';
import { Mark, Wordmark } from './mark';

export function MarketingFooter() {
  return (
    <footer className="mkt-footer">
      <div className="mkt-wrap mkt-footer-grid">
        <div className="mkt-footer-brand">
          <span className="mkt-brand">
            <Mark />
            <Wordmark />
          </span>
          <p>SMS for businesses. One dashboard, one API, and a live delivery status.</p>
        </div>
        <div className="mkt-footer-col">
          <p className="mkt-kicker">Company</p>
          <a className="mkt-text-link" href={SALES_URL} rel="noopener noreferrer">
            Contact sales
          </a>
          <p className="mkt-small">{COMPANY_NAME}</p>
          <p className="mkt-small">{COMPANY_ADDRESS}</p>
        </div>
      </div>
      <div className="mkt-wrap">
        <p className="mkt-copy">
          © {new Date().getFullYear()} {COMPANY_NAME}
        </p>
      </div>
    </footer>
  );
}
