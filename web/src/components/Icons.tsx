// Shaida's line icons, drawn for this repo on a 24 px grid at Muuve's icon weight (1.8 stroke, round caps; DESIGN.md).
import type { ReactNode } from "react";

const line = (size: number, width = 1.8) =>
  ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: width, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true });

const icon = (paths: ReactNode, defaultSize = 18, width?: number) =>
  function Icon({ size = defaultSize }: { size?: number }) {
    return <svg {...line(size, width)}>{paths}</svg>;
  };

export const CheckIcon = icon(<path d="M5 12l5 5L20 7" />, 14, 3);
export const WarnIcon = icon(<><path d="M12 7v6" /><path d="M12 17h.01" /></>, 14, 3);
export const CrossIcon = icon(<path d="M7 7l10 10M17 7L7 17" />, 14, 3);
export const ArrowRightIcon = icon(<path d="M5 12h14M13 6l6 6-6 6" />);
export const ArrowUpRightIcon = icon(<path d="M7 17L17 7M8 7h9v9" />, 20);
export const PlayIcon = icon(<path d="M8 5.5v13l10.5-6.5z" />);
export const SendIcon = icon(<><path d="M4 12l16-8-6 16-2.5-6.5z" /><path d="M11.5 13.5L20 4" /></>);
export const InboxIcon = icon(<><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5.5 5h13L21 13v6H3v-6z" /></>);
export const ProofIcon = icon(<><path d="M12 3l7.5 3v5.5c0 4.4-3.1 8.2-7.5 9.5-4.4-1.3-7.5-5.1-7.5-9.5V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>);
export const LinkIcon = icon(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>);
export const ClockIcon = icon(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const CopyIcon = icon(<><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>, 16);
export const LockIcon = icon(<><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>);

/** An envelope, sealed: the landing strip's line drawing (Muuve uses a sprout there; this one is Shaida's). */
export const SealedLetter = ({ size = 110 }: { size?: number }) => (
  <svg {...line(size, 1.4)} viewBox="0 0 120 120">
    <rect x="18" y="34" width="84" height="58" rx="8" />
    <path d="M20 38l40 30 40-30" />
    <circle cx="60" cy="74" r="9" />
    <path d="M60 65a9 9 0 0 0 0 18z" fill="currentColor" />
  </svg>
);

/** Shaida's mark: a ring, half filled (shows half, hides half). Also web/public/brand/shaida-mark.svg. */
export const BrandMark = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="brand-mark">
    <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 2.8a9.2 9.2 0 0 0 0 18.4z" fill="currentColor" />
  </svg>
);

export const GitHubIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1-.02-1.96-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.04 11.04 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
  </svg>
);
