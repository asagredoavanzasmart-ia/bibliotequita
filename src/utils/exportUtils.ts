// Export utilities for Citas and Resumen Inteligente IA
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, User } from 'firebase/auth';

// Lazy Firebase Setup to prevent crashing on startup if configuration is not yet available
let firebaseAuth: any = null;
let googleProvider: any = null;
let isFirebaseInitialized = false;

export async function tryInitFirebase() {
  if (isFirebaseInitialized) return firebaseAuth;
  try {
    // Bypass static Rollup compilation checks by passing a variable rather than a string literal
    const configPath = '../../firebase-applet-config.json';
    // @ts-ignore
    const configModule = await import(/* @vite-ignore */ configPath);
    // @ts-ignore
    const firebaseConfig = configModule.default || configModule;
    if (firebaseConfig && firebaseConfig.apiKey) {
      const app = initializeApp(firebaseConfig);
      firebaseAuth = getAuth(app);
      googleProvider = new GoogleAuthProvider();
      googleProvider.addScope('https://www.googleapis.com/auth/drive.file');
      isFirebaseInitialized = true;
    }
  } catch (e) {
    console.warn("Firebase Auth setup details not fully provisioned yet.", e);
  }
  return firebaseAuth;
}

export async function loginWithGoogle(): Promise<{ user: User; token: string } | null> {
  const auth = await tryInitFirebase();
  if (!auth) {
    throw new Error("La autenticación de Google no está disponible todavía en esta sesión. Por favor, aprueba la ventana de integración de Google Workspace.");
  }
  
  const result = await signInWithPopup(auth, googleProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('No se pudo adquirir el token de acceso de Google.');
  }
  return {
    user: result.user,
    token: credential.accessToken
  };
}

// Convert markdown summary text into beautiful XHTML content
export function markdownToHtml(md: string): string {
  if (!md) return '';
  const lines = md.split('\n');
  let inList = false;
  let html = '';

  for (let line of lines) {
    let trimmed = line.trim();
    if (!trimmed) {
      if (inList) {
        html += '</ul>\n';
        inList = false;
      }
      continue;
    }

    // Convert headings
    if (trimmed.startsWith('###')) {
      if (inList) { html += '</ul>\n'; inList = false; }
      html += `<h3 style="font-size: 14pt; font-weight: bold; color: #00558F; margin-top: 16pt; margin-bottom: 6pt;">${trimmed.replace(/^###\s*/, '')}</h3>\n`;
    } else if (trimmed.startsWith('##')) {
      if (inList) { html += '</ul>\n'; inList = false; }
      html += `<h2 style="font-size: 16pt; font-weight: bold; color: #00558F; margin-top: 18pt; margin-bottom: 8pt;">${trimmed.replace(/^##\s*/, '')}</h2>\n`;
    } else if (trimmed.startsWith('#')) {
      if (inList) { html += '</ul>\n'; inList = false; }
      html += `<h1 style="font-size: 20pt; font-weight: bold; color: #00558F; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-top: 20pt; margin-bottom: 10px;">${trimmed.replace(/^#\s*/, '')}</h1>\n`;
    }
    // Blockquotes
    else if (trimmed.startsWith('>')) {
      if (inList) { html += '</ul>\n'; inList = false; }
      html += `<blockquote style="border-left: 3px solid #cbd5e1; padding-left: 12px; margin: 12px 0; color: #475569; font-style: italic;">${trimmed.replace(/^>\s*/, '')}</blockquote>\n`;
    }
    // Unordered lists
    else if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
      if (!inList) {
        html += '<ul style="margin-top: 6pt; margin-bottom: 6pt; padding-left: 20px; list-style-type: disc;">\n';
        inList = true;
      }
      const itemText = trimmed.replace(/^[-*]\s*/, '');
      html += `<li style="margin-bottom: 4pt; font-size: 11pt; line-height: 1.5; color: #334155;">${itemText}</li>\n`;
    }
    // Standard paragraphs
    else {
      if (inList) { html += '</ul>\n'; inList = false; }
      // Process inline bold (**text**)
      let lineHtml = trimmed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      // Process inline italic (*text*)
      lineHtml = lineHtml.replace(/\*(.*?)\*/g, '<em>$1</em>');
      html += `<p style="margin-bottom: 8pt; font-size: 11pt; line-height: 1.5; color: #334155;">${lineHtml}</p>\n`;
    }
  }

  if (inList) {
    html += '</ul>\n';
  }

  return html;
}

// DOCX (Word Document) Client-Side Exporter via Office XML/HTML wrap.
export function exportToDocx(filename: string, rawMarkdown: string) {
  const htmlBody = markdownToHtml(rawMarkdown);
  const fullHtml = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8">
      <title>${filename}</title>
      <!--[if gte mso 9]>
      <xml>
        <w:WordDocument>
          <w:View>Print</w:View>
          <w:Zoom>100</w:Zoom>
          <w:DoNotOptimizeForBrowser/>
        </w:WordDocument>
      </xml>
      <![endif]-->
      <style>
        body {
          font-family: 'Arial', sans-serif;
          font-size: 11.5pt;
          line-height: 1.6;
          color: #1e293b;
          margin: 1in;
        }
        h1, h2, h3 {
          font-family: 'Arial', sans-serif;
          color: #00558F;
        }
        h1 { font-size: 20pt; font-weight: bold; margin-top: 18pt; margin-bottom: 6pt; border-bottom: 1.5pt solid #00558F; padding-bottom: 4pt; }
        h2 { font-size: 15pt; font-weight: bold; margin-top: 15pt; margin-bottom: 5pt; }
        h3 { font-size: 12pt; font-weight: bold; margin-top: 12pt; margin-bottom: 4pt; }
        p { margin-bottom: 8pt; }
        ul, ol { margin-top: 4pt; margin-bottom: 8pt; padding-left: 20pt; }
        li { margin-bottom: 3pt; }
        blockquote {
          border-left: 3pt solid #cbd5e1;
          padding-left: 10pt;
          margin-left: 0;
          margin-right: 0;
          color: #475569;
          font-style: italic;
        }
        strong { font-weight: bold; }
        em { font-style: italic; }
      </style>
    </head>
    <body>
      ${htmlBody}
    </body>
    </html>
  `;
  
  const blob = new Blob([fullHtml], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// PDF Exporter via standard High-Fidelity window.print() view
export function exportToPrintPdf(title: string, rawMarkdown: string) {
  const htmlBody = markdownToHtml(rawMarkdown);
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert("No se pudo abrir la ventana de impresión. Comprueba que el navegador permita popups.");
    return;
  }
  
  printWindow.document.write(`
    <html>
      <head>
        <title>${title}</title>
        <style>
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #1e293b;
            max-width: 800px;
            margin: 40px auto;
            padding: 0 20px;
            line-height: 1.7;
          }
          h1, h2, h3 {
            color: #00558F;
            font-weight: 700;
          }
          h1 {
            font-size: 24px;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 12px;
            margin-top: 30px;
            margin-bottom: 20px;
          }
          h2 {
            font-size: 18px;
            margin-top: 24px;
            margin-bottom: 12px;
          }
          h3 {
            font-size: 15px;
            margin-top: 18px;
            margin-bottom: 10px;
          }
          p { margin-bottom: 12px; }
          blockquote {
            border-left: 4px solid #cbd5e1;
            padding-left: 16px;
            margin: 16px 0;
            color: #475569;
            font-style: italic;
          }
          ul {
            padding-left: 20px;
            margin-bottom: 16px;
            list-style-type: disc;
          }
          li { margin-bottom: 6px; }
          .meta {
            font-size: 12px;
            color: #64748b;
            margin-bottom: 24px;
            border-bottom: 1px solid #f1f5f9;
            padding-bottom: 12px;
          }
          @media print {
            body { margin: 20px auto; }
          }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        <div class="meta">Generado el ${new Date().toLocaleDateString('es-ES')}</div>
        <div>
          ${htmlBody}
        </div>
        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 500);
          }
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

// Google Doc Creation via direct Google Drive upload conversion api.
export async function createGoogleDoc(title: string, rawMarkdown: string, accessToken: string) {
  const content = markdownToHtml(rawMarkdown);
  
  // Google Drive REST API multipart upload
  const metadata = {
    name: title,
    mimeType: 'application/vnd.google-apps.document' // Google Drive automatically converts HTML uploaded here into Google Doc!
  };

  const boundary = 'googledoc_multipart_boundary';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartResponseBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: text/html; charset=UTF-8\r\n\r\n' +
    content +
    closeDelimiter;

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartResponseBody,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive API failed: ${errText}`);
  }

  return await res.json();
}
