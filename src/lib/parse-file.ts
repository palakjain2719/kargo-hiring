export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export class ParseError extends Error {}

export async function extractText(fileName: string, data: Uint8Array): Promise<string> {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  if (data.byteLength > MAX_FILE_BYTES) throw new ParseError("File is larger than 4 MB");
  let text: string;
  try {
    if (ext === ".pdf") {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const res = await pdfText(pdf, { mergePages: true });
      text = Array.isArray(res.text) ? res.text.join("\n") : res.text;
    } else if (ext === ".docx") {
      const mammoth = await import("mammoth");
      const res = await mammoth.extractRawText({ buffer: Buffer.from(data) });
      text = res.value;
    } else if (ext === ".txt" || ext === ".md") {
      text = new TextDecoder("utf-8").decode(data);
    } else {
      throw new ParseError(`Unsupported file type "${ext}". Use PDF, DOCX or TXT.`);
    }
  } catch (e) {
    if (e instanceof ParseError) throw e;
    throw new ParseError(`Could not read file: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Postgres rejects NUL; strip it and other non-printing control characters some PDFs emit.
  text = text.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (text.length < 200) {
    throw new ParseError("Too little text could be extracted. The file may be a scanned image; upload a text-based PDF or DOCX.");
  }
  return text;
}
