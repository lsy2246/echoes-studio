import type { SVGProps } from "react";

export type IconName =
  | "article"
  | "calendar"
  | "check"
  | "chevron"
  | "close"
  | "cloud"
  | "command"
  | "edit"
  | "external"
  | "file"
  | "filter"
  | "folder"
  | "history"
  | "logout"
  | "menu"
  | "metadata"
  | "move"
  | "plus"
  | "preview"
  | "publish"
  | "refresh"
  | "save"
  | "search"
  | "settings"
  | "trash"
  | "warning";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    ...props,
  };

  switch (name) {
    case "article":
      return <svg {...common}><path d="M5 3.5h10l4 4V21H5z" /><path d="M15 3.5V8h4M8.5 12h7M8.5 15.5h7" /></svg>;
    case "calendar":
      return <svg {...common}><path d="M5 4.5h14a2 2 0 0 1 2 2v13H3v-13a2 2 0 0 1 2-2Z" /><path d="M8 2.5v4M16 2.5v4M3 9h18" /></svg>;
    case "check":
      return <svg {...common}><path d="m5 12.5 4.2 4L19 7" /></svg>;
    case "chevron":
      return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
    case "close":
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case "cloud":
      return <svg {...common}><path d="M6.5 18.5h11a4 4 0 0 0 .6-7.96A6.5 6.5 0 0 0 5.8 9.2 4.7 4.7 0 0 0 6.5 18.5Z" /></svg>;
    case "command":
      return <svg {...common}><path d="M9 6.5A2.5 2.5 0 1 0 6.5 9H18M15 6.5A2.5 2.5 0 1 1 17.5 9H6M9 15.5A2.5 2.5 0 1 1 6.5 13H18M15 17.5A2.5 2.5 0 1 0 17.5 15.5H6" /></svg>;
    case "edit":
      return <svg {...common}><path d="m4 20 4.4-1 10-10a2.2 2.2 0 0 0-3.1-3.1l-10 10zM14 7.2l3.1 3.1" /></svg>;
    case "external":
      return <svg {...common}><path d="M14 5h5v5M19 5l-8 8" /><path d="M19 14v5H5V5h5" /></svg>;
    case "file":
      return <svg {...common}><path d="M6 3.5h8l4 4V21H6z" /><path d="M14 3.5V8h4" /></svg>;
    case "filter":
      return <svg {...common}><path d="M4 6h16M7 12h10M10 18h4" /></svg>;
    case "folder":
      return <svg {...common}><path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><path d="M3.5 9h17" /></svg>;
    case "history":
      return <svg {...common}><path d="M4 5v5h5" /><path d="M5.6 16.5A8 8 0 1 0 4 10" /><path d="M12 7.5V12l3 2" /></svg>;
    case "logout":
      return <svg {...common}><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" /></svg>;
    case "menu":
      return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
    case "metadata":
      return <svg {...common}><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></svg>;
    case "move":
      return <svg {...common}><path d="M4 7h10M10 3l4 4-4 4M20 17H10M14 13l-4 4 4 4" /></svg>;
    case "plus":
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "preview":
      return <svg {...common}><path d="M2.8 12s3.4-5 9.2-5 9.2 5 9.2 5-3.4 5-9.2 5-9.2-5-9.2-5Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
    case "publish":
      return <svg {...common}><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5M5 14v6h14v-6" /></svg>;
    case "refresh":
      return <svg {...common}><path d="M20 7v5h-5" /><path d="M18.2 16.5A8 8 0 1 1 20 12" /></svg>;
    case "save":
      return <svg {...common}><path d="M4 4h13l3 3v13H4zM8 4v6h8V4M8 20v-6h8v6" /></svg>;
    case "search":
      return <svg {...common}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5L9 6.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.5 3.1h5l.5-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" /></svg>;
    case "trash":
      return <svg {...common}><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v5M14 11v5" /></svg>;
    case "warning":
      return <svg {...common}><path d="M10.3 4.2 2.7 18a2 2 0 0 0 1.8 3h15a2 2 0 0 0 1.8-3L13.7 4.2a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01" /></svg>;
  }
}
