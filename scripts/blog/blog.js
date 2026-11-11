// Skrypt stron wpisów bloga (blog/blog.js, wczytywany z `defer`): jedyny kod JS bloga, bo polityka treści stron
// (render.mjs, CSP) nie dopuszcza skryptów w treści dokumentu. Bez JS strona działa, brakuje tylko poniższych udogodnień.

// Kopiowanie linku i systemowe „Udostępnij” (telefon) wymagają JS: bez niego przyciski zostają ukryte, linki do serwisów działają zawsze
(() => {
  for (const box of document.querySelectorAll('.share')) {
    const { url, title } = box.dataset;
    const native = box.querySelector('[data-share="native"]');
    const copy = box.querySelector('[data-share="copy"]');
    const label = copy.querySelector('span');
    if (navigator.share) {
      native.hidden = false;
      native.addEventListener('click', () => navigator.share({ title, url }).catch(() => {}));
    }
    copy.hidden = false;
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        window.prompt('Link do wpisu', url);
        return;
      }
      copy.dataset.done = '';
      label.textContent = 'Skopiowano';
      setTimeout(() => {
        delete copy.dataset.done;
        label.textContent = 'Kopiuj link';
      }, 2000);
    });
  }
})();

// Po 7 dniach nagrania już nie ma: zamiast powtórki tej chwili W sesji na żywo i powtórka ostatniej doby
(() => {
  const box = document.querySelector('.replay[data-until]');
  if (box && Date.now() > Number(box.dataset.until)) {
    box.querySelector('.replay-on').hidden = true;
    box.querySelector('.replay-off').hidden = false;
  }
})();
