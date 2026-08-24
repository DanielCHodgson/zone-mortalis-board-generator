import type { ReactNode } from "react";

export type UiIconName =
  | "brand" | "sun" | "moon" | "palette" | "download" | "wand"
  | "pointer" | "zone" | "copy" | "paste" | "duplicate" | "rotate"
  | "trash" | "grid" | "shrink";

const ICON_PATHS:Record<UiIconName, ReactNode> = {
  brand:<><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" /><rect x="3" y="13" width="8" height="8" rx="1" /><path d="M13 17h8M17 13v8" /></>,
  sun:<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon:<path d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2Z" />,
  palette:<><path d="M12 3a9 9 0 0 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a1.5 1.5 0 0 1 0-3h3.5A5.5 5.5 0 0 0 21 7.5C21 4.8 17 3 12 3Z" /><circle cx="7.5" cy="10" r=".8" fill="currentColor" stroke="none" /><circle cx="9.5" cy="6.8" r=".8" fill="currentColor" stroke="none" /><circle cx="14" cy="6.5" r=".8" fill="currentColor" stroke="none" /></>,
  download:<><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 19h16" /></>,
  wand:<><path d="m4 20 11-11" /><path d="m14 4 1-2 1 2 2 1-2 1-1 2-1-2-2-1 2-1ZM18 12l.7-1.5.8 1.5 1.5.8-1.5.7-.8 1.5-.7-1.5-1.5-.7 1.5-.8Z" /></>,
  pointer:<path d="m5 3 13 9-6 1-3 6Z" />,
  zone:<><rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3" /><path d="M9 12h6M12 9v6" /></>,
  copy:<><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  paste:<><path d="M9 5h6v3H9z" /><path d="M8 7H6v14h12V7h-2" /></>,
  duplicate:<><rect x="7" y="7" width="13" height="13" rx="2" /><path d="M4 16V5a1 1 0 0 1 1-1h11M13.5 10v7M10 13.5h7" /></>,
  rotate:<><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 1-2-5" /></>,
  trash:<><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
  grid:<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18M3 9h18M3 15h18" /></>,
  shrink:<><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /><path d="m3 3 6 6M21 3l-6 6M3 21l6-6M21 21l-6-6" /></>,
};

export function UiIcon({ name }: { name:UiIconName }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON_PATHS[name]}</svg>;
}
