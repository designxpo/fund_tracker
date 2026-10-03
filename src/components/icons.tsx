const base = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const HomeIcon = () => (<svg {...base}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>);
export const ChartIcon = () => (<svg {...base}><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></svg>);
export const WalletIcon = () => (<svg {...base}><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M3 10h18M16 15h2" /></svg>);
export const TargetIcon = () => (<svg {...base}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>);
export const MoreIcon = () => (<svg {...base}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>);
export const PlusIcon = () => (<svg {...base} strokeWidth={2.4}><path d="M12 5v14M5 12h14" /></svg>);
