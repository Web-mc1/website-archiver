const express = require('express');
const dns = require('node:dns').promises;
const net = require('node:net');
const path = require('node:path');
const AdmZip = require('adm-zip');
const ipaddr = require('ipaddr.js');
const { JSDOM } = require('jsdom');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_PAGES = 10;
const MAX_FILES = 100;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function isPublicAddress(address) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

async function validatePublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid website URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only public HTTP or HTTPS website URLs are supported.');
  }
  if (url.username || url.password) {
    throw new Error('URLs containing login credentials are not allowed.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Local and private network addresses are not allowed.');
  }

  if (net.isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('Local and private network addresses are not allowed.');
  } else {
    let records;
    try {
      records = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new Error('The website hostname could not be resolved.');
    }
    if (!records.length || records.some(record => !isPublicAddress(record.address))) {
      throw new Error('The website must resolve only to public IP addresses.');
    }
  }

  return url;
}

async function requestPublic(url, acceptedTypes = null) {
  let current = new URL(url);

  for (let redirects = 0; redirects <= 5; redirects += 1) {
    await validatePublicUrl(current.toString());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'WebsiteArchiver/1.0 (authorized public-site archiving)' }
      });
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('The website returned an invalid redirect.');
      current = new URL(location, current);
      continue;
    }

    if (!response.ok) throw new Error(`The website returned HTTP ${response.status}.`);
    const contentType = response.headers.get('content-type') || '';
    if (acceptedTypes && !acceptedTypes.some(type => contentType.toLowerCase().includes(type))) {
      throw new Error('Unsupported file type.');
    }

    const declaredLength = Number(response.headers.get('content-length'));
    if (declaredLength > MAX_FILE_BYTES) throw new Error('A file exceeded the size limit.');

    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) {
        await reader.cancel();
        throw new Error('A file exceeded the size limit.');
      }
      chunks.push(Buffer.from(value));
    }

    return { buffer: Buffer.concat(chunks), contentType, finalUrl: current.toString() };
  }
  throw new Error('The website redirected too many times.');
}

function safeRelativePath(url, fallback = 'index.html') {
  const parsed = new URL(url);
  const parts = decodeURIComponent(parsed.pathname)
    .split('/')
    .filter(Boolean)
    .map(part => part.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, '_'));
  if (!parts.length) return fallback;
  let result = parts.join('/');
  if (parsed.pathname.endsWith('/')) result += '/index.html';
  return result;
}

function pagePath(url) {
  let result = safeRelativePath(url);
  if (!path.posix.extname(result)) result += '/index.html';
  return result;
}

async function buildArchive(startUrl) {
  const origin = startUrl.origin;
  const queue = [startUrl.toString()];
  const queued = new Set(queue);
  const saved = new Map();
  const assets = new Set();
  let totalBytes = 0;
  let pages = 0;

  while (queue.length && pages < MAX_PAGES && saved.size < MAX_FILES) {
    const pageUrl = queue.shift();
    try {
      const result = await requestPublic(pageUrl, ['text/html', 'application/xhtml+xml']);
      if (new URL(result.finalUrl).origin !== origin) continue;
      const html = result.buffer.toString('utf8');
      const archivePath = pagePath(result.finalUrl);
      if (!saved.has(archivePath)) {
        saved.set(archivePath, Buffer.from(html));
        totalBytes += Buffer.byteLength(html);
        pages += 1;
      }

      const dom = new JSDOM(html);
      const doc = dom.window.document;
      const assetSelectors = [
        'img[src]', 'script[src]', 'source[src]', 'video[src]', 'audio[src]',
        'link[rel~="stylesheet"][href]', 'link[rel~="icon"][href]'
      ];
      for (const selector of assetSelectors) {
        for (const element of doc.querySelectorAll(selector)) {
          const raw = element.getAttribute('src') || element.getAttribute('href');
          try {
            const assetUrl = new URL(raw, result.finalUrl);
            if (assetUrl.origin === origin && !assets.has(assetUrl.toString())) assets.add(assetUrl.toString());
          } catch { /* Ignore malformed asset references. */ }
        }
      }

      for (const element of doc.querySelectorAll('a[href]')) {
        try {
          const link = new URL(element.getAttribute('href'), result.finalUrl);
          link.hash = '';
          if (link.origin === origin && !queued.has(link.toString()) && queue.length + pages < MAX_PAGES) {
            queued.add(link.toString());
            queue.push(link.toString());
          }
        } catch { /* Ignore malformed links. */ }
      }
      dom.window.close();
    } catch { /* Skip pages that are unavailable or not safe to fetch. */ }
  }

  for (const assetUrl of assets) {
    if (saved.size >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) break;
    try {
      const result = await requestPublic(assetUrl);
      if (new URL(result.finalUrl).origin !== origin) continue;
      const archivePath = safeRelativePath(result.finalUrl, 'asset');
      if (saved.has(archivePath)) continue;
      if (totalBytes + result.buffer.length > MAX_TOTAL_BYTES) continue;
      saved.set(archivePath, result.buffer);
      totalBytes += result.buffer.length;
    } catch { /* Skip assets that fail, are too large, or are not publicly reachable. */ }
  }

  if (!saved.size) throw new Error('No downloadable pages were found. Check the URL and try a public website.');

  const zip = new AdmZip();
  for (const [filePath, contents] of saved) zip.addFile(filePath, contents);
  zip.addFile('README.txt', Buffer.from(
    'Website archive created with Website Archiver.\n\nOnly use archives for websites you own or have permission to save.\nSome dynamic or protected content may not be included.\n',
    'utf8'
  ));

  return { zip: zip.toBuffer(), pageCount: pages, fileCount: saved.size };
}

app.post('/api/archive', async (req, res) => {
  try {
    if (typeof req.body?.url !== 'string') {
      return res.status(400).json({ error: 'Please enter a website URL.' });
    }
    const startUrl = await validatePublicUrl(req.body.url);
    const archive = await buildArchive(startUrl);
    const filename = 'website-archive.zip';
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Page-Count': String(archive.pageCount),
      'X-File-Count': String(archive.fileCount)
    });
    return res.send(archive.zip);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to archive that website.' });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Website Archiver is running at http://localhost:${PORT}`));
