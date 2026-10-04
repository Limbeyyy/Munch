export const isMobileDevice = (): boolean => {
  if (typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  const mobileUserAgent =
    /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Windows Phone|Tablet|Kindle|Silk|PlayBook/i
      .test(userAgent);
  const touchMac = navigator.platform === 'MacIntel'
    && navigator.maxTouchPoints > 1;

  return mobileUserAgent || touchMac;
};
