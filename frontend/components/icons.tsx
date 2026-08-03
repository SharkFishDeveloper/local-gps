function CarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 11l1.4-4.4A2 2 0 0 1 8.3 5h7.4a2 2 0 0 1 1.9 1.6L19 11" />
      <rect x="3" y="11" width="18" height="6" rx="2" />
      <circle cx="7.5" cy="17.3" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="17.3" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function WalkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.2" cy="4" r="1.6" fill="currentColor" stroke="none" />
      <path d="M10.5 21l1.3-5.6-2-1.4.7-4.2L13 8l2 2.2 2.6 1" />
      <path d="M11.6 15.6L8.2 18.4" />
      <path d="M13.4 12.4L16 14.2l1 3" />
    </svg>
  );
}

function BikeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="17.5" r="3.4" />
      <circle cx="18.5" cy="17.5" r="3.4" />
      <path d="M5.5 17.5L10 8h4l3 4.5" />
      <path d="M10 8h3" />
      <path d="M12 17.5L10 8" />
    </svg>
  );
}

export {CarIcon,BikeIcon,WalkIcon};