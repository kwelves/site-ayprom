import type { SVGProps } from "react";

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function HydraulicPumpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="5" y="8" width="11" height="8" rx="3" />
      <circle cx="10.5" cy="12" r="1.8" />
      <path d="M2 12 L5 12" />
      <path d="M16 10 L20 10 L20 6" />
    </svg>
  );
}

export function PtoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="8" width="7" height="8" rx="1" />
      <line x1="10.5" y1="12" x2="15" y2="12" />
      <circle cx="18.5" cy="12" r="3.3" />
    </svg>
  );
}

export function PtoShaftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <line x1="8.5" y1="12" x2="15.5" y2="12" />
      <polygon points="6,9.5 8.5,12 6,14.5 3.5,12" />
      <polygon points="18,9.5 20.5,12 18,14.5 15.5,12" />
    </svg>
  );
}

export function TankIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="10" y="3.5" width="4" height="3" rx="0.6" />
      <rect x="6" y="7" width="12" height="13.5" rx="2" />
      <line x1="7.3" y1="13.5" x2="16.7" y2="13.5" />
    </svg>
  );
}
