'use client';

import { Pin, PinOff } from 'lucide-react';
import { useSyncExternalStore } from 'react';

const KEY = 'smsvio.menu.pin';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('smsvio-menu-pin', onChange);
  return () => {
    window.removeEventListener('smsvio-menu-pin', onChange);
  };
}

function readPinned(): boolean {
  return window.localStorage.getItem(KEY) !== 'off';
}

export function useMenuPin(): { pinned: boolean; togglePin: () => void } {
  const pinned = useSyncExternalStore(subscribe, readPinned, () => true);

  function togglePin() {
    window.localStorage.setItem(KEY, readPinned() ? 'off' : 'on');
    window.dispatchEvent(new Event('smsvio-menu-pin'));
  }

  return { pinned, togglePin };
}

export function MenuPin({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  const Icon = pinned ? PinOff : Pin;
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={pinned ? 'Unpin menu' : 'Pin menu'}
      title={pinned ? 'Unpin menu' : 'Pin menu'}
      className="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground mt-auto flex min-h-11 items-center gap-3 rounded-[10px] px-[13px] text-sm font-medium"
      onClick={onToggle}
    >
      <Icon className="size-[22px] shrink-0" strokeWidth={1.7} aria-hidden />
      <span className="vio-lbl">{pinned ? 'Unpin' : 'Pin'}</span>
    </button>
  );
}
