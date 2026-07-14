// Applies the saved / OS-preferred color theme before first paint, to avoid a light-mode
// flash. Externalized from index.html (SQEM-111 CSP) so the page carries no inline <script>
// and can run under a strict `script-src 'self'`. Must stay render-blocking in <head>.
(function () {
  var t = localStorage.getItem('theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
})();
