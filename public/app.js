// Isoloir : les quelques comportements côté navigateur (pas de script en ligne : la CSP l'interdit).

// Confirmation avant les actions définitives (dépôt d'un bulletin, ouverture, clôture…).
document.addEventListener('submit', (event) => {
  const form = event.target;
  let message = form.dataset.confirm;
  if (message && 'ballot' in form.dataset) {
    const empty = [...form.querySelectorAll('fieldset')]
      .filter((fieldset) => !fieldset.querySelector('input:checked'))
      .map((fieldset) => fieldset.querySelector('legend').firstChild.textContent.trim());
    if (empty.length) message = `Sans réponse, vous vous abstenez pour : ${empty.join(', ')}.\n\n${message}`;
  }
  if (message && !window.confirm(message)) event.preventDefault();
});

// Participation en direct sur la page d'admin, pendant le vote.
const participation = document.getElementById('participation');
if (participation?.dataset.src) {
  setInterval(async () => {
    try {
      const response = await fetch(participation.dataset.src, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const data = await response.json();
      for (const field of participation.querySelectorAll('[data-field]')) field.textContent = data[field.dataset.field];
    } catch {
      // Réseau coupé un instant : on réessaiera au prochain tour.
    }
  }, 5000);
}

// Copier le résumé des résultats pour Discord.
for (const copy of document.querySelectorAll('[data-copy]')) {
  copy.addEventListener('click', async () => {
    const source = document.getElementById(copy.dataset.copy);
    try {
      await navigator.clipboard.writeText(source.value);
    } catch {
      source.select();
      document.execCommand('copy');
    }
    const label = copy.textContent;
    copy.textContent = 'Copié ✓';
    setTimeout(() => { copy.textContent = label; }, 2000);
  });
}
