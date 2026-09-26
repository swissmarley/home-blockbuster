import { create } from 'zustand';
import type { ContinueItem, TitleSummary } from '@shared/types';
import { readLocal, writeLocal } from '../lib/storage';

export interface PopupTarget {
  title: TitleSummary;
  /** Card rectangle in page coordinates. */
  rect: { left: number; top: number; width: number; height: number };
  continueItem?: ContinueItem;
  key: string;
}

interface PreviewState {
  popup: PopupTarget | null;
  muted: boolean;
  openPopup(target: PopupTarget): void;
  closePopup(): void;
  setMuted(muted: boolean): void;
}

export const usePreview = create<PreviewState>()((set) => ({
  popup: null,
  muted: readLocal('hb.previews.muted') !== 'false',
  openPopup: (target) => set({ popup: target }),
  closePopup: () => set({ popup: null }),
  setMuted: (muted) => {
    writeLocal('hb.previews.muted', String(muted));
    set({ muted });
  },
}));

export function pageRect(el: Element): PopupTarget['rect'] {
  const r = el.getBoundingClientRect();
  return { left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height };
}
