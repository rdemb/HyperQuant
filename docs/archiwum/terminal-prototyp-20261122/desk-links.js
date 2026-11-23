/* Wykresy otwierają się na tym samym rynku, w bieżącym języku terminala. */
(() => {
  'use strict';
  const update = () => {
    const home = new URL('../', location.href);
    home.searchParams.set('lang', HQ.lang);
    const coin = document.getElementById('mkt').value || 'BTC';
    const charts = new URL(home);
    charts.hash = 'charts?' + new URLSearchParams({ m: coin });
    document.querySelectorAll('[data-home-link]').forEach((link) => { link.href = home.href; });
    document.querySelectorAll('[data-chart-link]').forEach((link) => { link.href = charts.href; });
  };
  HQ.ready(update);
  document.addEventListener('hq:market', update);
  document.addEventListener('hq:lang', update);
})();
