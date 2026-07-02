// www/apex is the SSO hub (login + launcher only); the staff portal lives at
// portal.bluebayoustaff.com. Dev (localhost) behaves as the portal.
const HUB_HOSTS = ['bluebayoustaff.com', 'www.bluebayoustaff.com'];
export const IS_HUB = HUB_HOSTS.includes(window.location.hostname);
