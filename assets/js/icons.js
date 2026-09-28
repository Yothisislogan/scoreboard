// Inline SVG icons (24px grid, drawn with currentColor).

const icon = (body, extra = '') =>
  `<svg class="icon${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  star: icon('<path d="M12 3.6l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.62 6.9 19.3l.98-5.68L3.75 9.6l5.7-.83L12 3.6z"/>', ' icon-star'),
  heart: icon('<path d="M12 20.2s-7.6-4.55-7.6-10.05A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.6 2.55c0 5.5-7.6 10.05-7.6 10.05z"/>', ' icon-heart'),
  grid: icon('<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>'),
  trophy: icon('<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M16 5.5h3V7a3 3 0 0 1-3 3M8 5.5H5V7a3 3 0 0 0 3 3"/><path d="M12 13v4M9 20.5h6M10 17h4"/>'),
  bolt: icon('<path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z"/>'),
  search: icon('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  close: icon('<path d="M6 6l12 12M18 6L6 18"/>'),
  chevronLeft: icon('<path d="M15 5l-7 7 7 7"/>'),
  chevronRight: icon('<path d="M9 5l7 7-7 7"/>'),
  refresh: icon('<path d="M20 11.5A8 8 0 0 0 5.6 7"/><path d="M5 3.5V7.5h4"/><path d="M4 12.5A8 8 0 0 0 18.4 17"/><path d="M19 20.5v-4h-4"/>'),
  sun: icon('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>'),
  moon: icon('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  tv: icon('<rect x="3" y="6.5" width="18" height="12" rx="2"/><path d="M8.5 21.5h7M9 3l3 3.5L15 3"/>'),
  pin: icon('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  external: icon('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  calendar: icon('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
  sliders: icon('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  ball:
    '<svg class="icon icon-ball" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-40 12 12)" fill="currentColor"/>' +
    '<path d="M9 15l6-6M10.6 11.4l2 2M12.2 9.8l2 2M9 13l2 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>',
};
