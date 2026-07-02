// www/apex is the SSO hub (login + launcher only); the staff portal lives at
// portal.bluebayoustaff.com. Dev (localhost) behaves as the portal.
const HUB_HOSTS = ['bluebayoustaff.com', 'www.bluebayoustaff.com'];
export const IS_HUB = HUB_HOSTS.includes(window.location.hostname);

// The portal's own "Return Home" button (and every satellite client's)
// lands here — signing out only happens from the hub's launcher.
export function hubUrl() {
  if (window.location.hostname === 'localhost') return 'http://localhost:5173/apps';
  return 'https://www.bluebayoustaff.com/apps';
}
