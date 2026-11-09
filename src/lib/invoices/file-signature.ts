/**
 * Comprueba que el contenido del archivo coincida con el tipo declarado, mirando sus primeros
 * bytes («firma»). El navegador informa el tipo según la extensión, así que un archivo de texto
 * renombrado a .pdf llegaría como application/pdf.
 */
export function matchesDeclaredType(mimeType: string, data: Uint8Array): boolean {
  const starts = (bytes: number[], offset = 0) => bytes.every((b, i) => data[offset + i] === b);
  const ascii = (text: string, offset = 0) => starts([...text].map((c) => c.charCodeAt(0)), offset);
  switch (mimeType) {
    case "application/pdf":
      // Algunos generadores dejan bytes antes de la cabecera: se busca %PDF- en el primer KB.
      return Buffer.from(data.subarray(0, 1024)).includes("%PDF-");
    case "image/jpeg":
      return starts([0xff, 0xd8, 0xff]);
    case "image/png":
      return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      return ascii("RIFF") && ascii("WEBP", 8);
    default:
      return false;
  }
}
