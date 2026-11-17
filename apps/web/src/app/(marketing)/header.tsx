'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import { Mark, Wordmark } from './mark';

export function MarketingHeader({ signedIn }: { signedIn: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 4);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <header className="mkt-header" data-scrolled={scrolled ? 'true' : 'false'}>
      <div className="mkt-wrap mkt-header-bar">
        <Link href="/" className="mkt-brand" aria-label="SMSVIO home">
          <Mark />
          <Wordmark />
        </Link>
        <nav className="mkt-nav-desktop" aria-label="Main">
          <AccountLinks signedIn={signedIn} />
        </nav>
        <button
          type="button"
          className="mkt-icon-button mkt-menu-button"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => {
            setOpen(true);
          }}
        >
          <Menu strokeWidth={1.5} aria-hidden />
          <span className="mkt-sr">Open menu</span>
        </button>
      </div>
      {open ? (
        <div className="mkt-sheet" id={menuId} role="dialog" aria-modal="true" aria-label="Menu">
          <div className="mkt-sheet-bar">
            <Link
              href="/"
              className="mkt-brand"
              aria-label="SMSVIO home"
              onClick={() => {
                setOpen(false);
              }}
            >
              <Mark />
              <Wordmark />
            </Link>
            <button
              type="button"
              className="mkt-icon-button"
              onClick={() => {
                setOpen(false);
              }}
            >
              <X strokeWidth={1.5} aria-hidden />
              <span className="mkt-sr">Close menu</span>
            </button>
          </div>
          <nav className="mkt-sheet-nav" aria-label="Mobile">
            <AccountLinks
              signedIn={signedIn}
              onNavigate={() => {
                setOpen(false);
              }}
            />
          </nav>
        </div>
      ) : null}
    </header>
  );
}

function AccountLinks({ signedIn, onNavigate }: { signedIn: boolean; onNavigate?: () => void }) {
  if (signedIn) {
    return (
      <Link className="mkt-button mkt-button-brand" href="/dashboard" onClick={onNavigate}>
        Open dashboard
      </Link>
    );
  }
  return (
    <>
      <Link className="mkt-button mkt-button-quiet" href="/signin" onClick={onNavigate}>
        Sign in
      </Link>
      <Link className="mkt-button mkt-button-brand" href="/signup" onClick={onNavigate}>
        Get started
      </Link>
    </>
  );
}
