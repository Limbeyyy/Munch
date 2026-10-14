/**
 * Whether this is a machine somebody sits at, or one they hold.
 *
 * The one answer the whole app asks. There used to be two - a user-agent
 * test here that nothing called, and a pointer test inside the home
 * redirect that only ran when somebody landed on "/" - so the question
 * had two answers and neither reached the routes that needed it.
 *
 * A mouse is what actually separates a desk from a hand: a pointer fine
 * enough to aim and able to hover. Screen width is the wrong question -
 * a narrowed window on a laptop is still a laptop, and a tablet held in
 * landscape is still not one. A touchscreen laptop reports a fine
 * primary pointer, which is the answer we want from it.
 *
 * The user agent is only the fallback, for a browser too old to answer.
 */
export const onDesktop = (): boolean => {
  try {
    const fine = window.matchMedia?.('(pointer: fine)');
    const hovers = window.matchMedia?.('(hover: hover)');
    if (fine && hovers) return fine.matches && hovers.matches;
  } catch {
    // Fall through to the user agent.
  }
  return !/Android|iPhone|iPad|iPod|Mobile|Tablet|BlackBerry|IEMobile|Opera Mini|Windows Phone|Kindle|Silk|PlayBook/i
    .test(window.navigator?.userAgent ?? '');
};

/** The other side of the same question, so neither caller has to negate. */
export const onMobile = (): boolean => !onDesktop();
