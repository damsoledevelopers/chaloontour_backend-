const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const BACKEND_ROOT = path.join(__dirname, '..');
const UPLOADS_ROOT = path.resolve(BACKEND_ROOT, 'uploads');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fileExists(filePath) {
  try {
    return !!filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (_) {
    return false;
  }
}

/** First existing file from a STRING array of candidate paths (env override should be first in the array). */
function resolveFirstExistingFile(candidatePaths) {
  if (!Array.isArray(candidatePaths)) return null;
  for (const candidate of candidatePaths) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const resolved = path.resolve(candidate.trim());
    if (fileExists(resolved)) return resolved;
  }
  return null;
}

function mimeFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function fileToDataUri(filePath) {
  const resolved = path.resolve(String(filePath));
  const buf = fs.readFileSync(resolved);
  return `data:${mimeFromExt(resolved)};base64,${buf.toString('base64')}`;
}

function buildLogoCandidates() {
  const candidates = [];
  const envLogo = (process.env.PDF_LOGO_PATH || process.env.LOGO_PATH || '').trim();
  if (envLogo) candidates.push(envLogo);

  candidates.push(
    path.join(BACKEND_ROOT, 'public', 'Chalo-on-tour.jpg.jpeg'),
    path.join(BACKEND_ROOT, 'public', 'chalo-on-tour-e1766686260447.png'),
    path.join(process.cwd(), 'public', 'Chalo-on-tour.jpg.jpeg'),
    path.join(process.cwd(), 'public', 'chalo-on-tour-e1766686260447.png'),
    path.join(BACKEND_ROOT, '..', 'chaloontour_frontend', 'public', 'Chalo-on-tour.jpg.jpeg'),
    path.join(BACKEND_ROOT, '..', 'chaloontour_frontend', 'public', 'chalo-on-tour-e1766686260447.png')
  );

  return candidates;
}

function buildLetterheadCandidates() {
  const candidates = [];
  const envLetterhead = (process.env.PDF_LETTERHEAD_PATH || '').trim();
  if (envLetterhead) candidates.push(envLetterhead);

  candidates.push(
    path.join(BACKEND_ROOT, 'public', 'letterhead.png'),
    path.join(BACKEND_ROOT, 'public', 'letterhead.jpg'),
    path.join(process.cwd(), 'public', 'letterhead.png')
  );

  return candidates;
}

function getLogoDataUri() {
  const logoPath = resolveFirstExistingFile(buildLogoCandidates());
  if (!logoPath) return '';
  try {
    return fileToDataUri(logoPath);
  } catch (_) {
    return '';
  }
}

function getLetterheadDataUri() {
  const letterheadPath = resolveFirstExistingFile(buildLetterheadCandidates());
  if (!letterheadPath) return '';
  try {
    return fileToDataUri(letterheadPath);
  } catch (_) {
    return '';
  }
}

function fetchUrlToBuffer(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

function resolveLocalImagePath(input) {
  const value = String(input || '').trim();
  if (!value || value.startsWith('data:')) return null;

  if (/^https?:\/\//i.test(value)) return null;

  const withoutFileScheme = value.replace(/^file:\/\//i, '');
  const normalized = withoutFileScheme.replace(/^\/+/, '');

  const directCandidates = [
    value,
    withoutFileScheme,
    path.join(UPLOADS_ROOT, normalized),
    path.join(BACKEND_ROOT, normalized),
    path.join(BACKEND_ROOT, 'public', normalized),
    path.join(process.cwd(), normalized)
  ];

  if (normalized.startsWith('uploads/') || normalized.startsWith('uploads\\')) {
    directCandidates.push(path.join(BACKEND_ROOT, normalized));
  }

  return resolveFirstExistingFile(directCandidates);
}

/**
 * Resolve an image reference to a base64 data URI for Puppeteer HTML embedding.
 */
async function resolveImageToDataUri(input, options = {}) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (value.startsWith('data:')) return value;

  const localPath = resolveLocalImagePath(value);
  if (localPath) {
    try {
      return fileToDataUri(localPath);
    } catch (_) {
      return '';
    }
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      const buf = await fetchUrlToBuffer(value, options.timeoutMs || 8000);
      const contentType = options.contentType || 'image/jpeg';
      return `data:${contentType};base64,${buf.toString('base64')}`;
    } catch (_) {
      return '';
    }
  }

  const apiBase = String(options.apiBaseUrl || '').replace(/\/+$/, '');
  if (apiBase) {
    const absoluteUrl = `${apiBase}/${value.replace(/^\/+/, '')}`;
    try {
      const buf = await fetchUrlToBuffer(absoluteUrl, options.timeoutMs || 8000);
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch (_) {
      return '';
    }
  }

  return '';
}

const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function sanitizePdfFileName(name) {
  const base = String(name || 'tour-quotation')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 120);
  return base.endsWith('.pdf') ? base : `${base}.pdf`;
}

/**
 * Resolve a safe output path under uploads/ (blocks path traversal).
 */
function resolvePdfOutputPath(leadId, fileName) {
  const safeFileName = sanitizePdfFileName(fileName);
  const leadSegment = String(leadId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.resolve(UPLOADS_ROOT, 'leads', leadSegment);
  const fullPath = path.resolve(dir, safeFileName);

  if (!fullPath.startsWith(UPLOADS_ROOT + path.sep) && fullPath !== UPLOADS_ROOT) {
    throw new Error('Invalid PDF output path');
  }

  fs.mkdirSync(dir, { recursive: true });
  const relativePath = path.join('leads', leadSegment, safeFileName).replace(/\\/g, '/');
  return { fullPath, relativePath, fileName: safeFileName };
}

module.exports = {
  UPLOADS_ROOT,
  escapeHtml,
  resolveFirstExistingFile,
  fileToDataUri,
  buildLogoCandidates,
  buildLetterheadCandidates,
  getLogoDataUri,
  getLetterheadDataUri,
  resolveImageToDataUri,
  resolveLocalImagePath,
  sanitizePdfFileName,
  resolvePdfOutputPath,
  TRANSPARENT_PIXEL
};
