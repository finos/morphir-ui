export const shouldDisposeOnPageHide = (event: Pick<PageTransitionEvent, 'persisted'>): boolean =>
  !event.persisted
