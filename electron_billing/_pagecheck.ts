import PDFDocument from 'pdfkit';
import { drawFooters, ensureSpace, MARGIN } from './src/main/pdf/pdfLayout';

function countPages(buf: Buffer): number {
  // Count "/Type /Page" (not /Pages) occurrences in the PDF.
  const s = buf.toString('latin1');
  const m = s.match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : -1;
}

const doc = new PDFDocument({ size: 'A4', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }, bufferPages: true });
const chunks: Buffer[] = [];
doc.on('data', (c: Buffer) => chunks.push(c));
doc.on('end', () => {
  const buf = Buffer.concat(chunks);
  console.log('PAGES=' + countPages(buf));
});
// Simulate a short single-page document that ends near the bottom band.
doc.font('Helvetica').fontSize(10).text('Short invoice body', MARGIN, MARGIN);
doc.y = 700; // near bottom, above CONTENT_BOTTOM
ensureSpace(doc, 40);
doc.text('Last content line', MARGIN, doc.y);
drawFooters(doc, 'Invoice');
doc.end();
