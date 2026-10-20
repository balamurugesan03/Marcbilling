// Applies the saved / system theme before React renders (avoids a light flash). External file so CSP stays strict.
try {
  var t = localStorage.getItem('fpos-theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch (e) { /* storage unavailable */ }
