const form = document.querySelector('#archive-form');
const input = document.querySelector('#website-url');
const button = document.querySelector('#submit-button');
const status = document.querySelector('#status');
const downloadLink = document.querySelector('#download-link');
let previousObjectUrl;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  downloadLink.hidden = true;
  if (previousObjectUrl) URL.revokeObjectURL(previousObjectUrl);

  button.disabled = true;
  button.querySelector('span').textContent = 'Working…';
  status.textContent = 'Collecting pages and files. This can take a little while…';
  status.className = 'status busy';

  try {
    const response = await fetch('/api/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: input.value.trim() })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Could not create an archive for that URL.');
    }

    const blob = await response.blob();
    previousObjectUrl = URL.createObjectURL(blob);
    downloadLink.href = previousObjectUrl;
    downloadLink.download = 'website-archive.zip';
    downloadLink.hidden = false;

    const pages = response.headers.get('X-Page-Count');
    const files = response.headers.get('X-File-Count');
    status.textContent = `Your ZIP is ready${pages ? ` — ${pages} page${pages === '1' ? '' : 's'} and ${files} file${files === '1' ? '' : 's'} included` : ''}.`;
    status.className = 'status success';
  } catch (error) {
    status.textContent = error.message || 'Something went wrong. Please try again.';
    status.className = 'status error';
  } finally {
    button.disabled = false;
    button.querySelector('span').textContent = 'Build ZIP';
  }
});
