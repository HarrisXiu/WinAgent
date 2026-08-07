declare module 'pdf-parse' {
  interface PdfParseResult {
    numpages: number
    numrender: number
    info: Record<string, any>
    metadata: Record<string, any>
    version: string
    text: string
  }
  function pdfParse(dataBuffer: Buffer, options?: Record<string, any>): Promise<PdfParseResult>
  export default pdfParse
}
