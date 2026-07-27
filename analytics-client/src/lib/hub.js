// Every client returns to the SSO hub instead of signing out locally —
// signing out only happens from the hub's own launcher page.
export function hubUrl() {
  if (window.location.hostname === 'localhost') return 'http://localhost:5173/apps';
  return 'https://www.bluebayoustaff.com/apps';
}
