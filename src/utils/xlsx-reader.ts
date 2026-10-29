import fs from "node:fs";
import zlib from "node:zlib";

/**
 * Lector ligero y seguro de archivos `.xlsx` (OpenXML ZIP) usando únicamente `node:zlib`,
 * eliminando dependencias externas con vulnerabilidades conocidas (Prototype Pollution / ReDoS).
 */
function extraerEntradasZip(buffer: Buffer): Map<string, string> {
  const entradas = new Map<string, string>();
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    const firma = buffer.readUInt32LE(offset);
    if (firma !== 0x04034b50) {
      break;
    }

    const metodoCompresion = buffer.readUInt16LE(offset + 8);
    const tamComprimido = buffer.readUInt32LE(offset + 18);
    const lenNombre = buffer.readUInt16LE(offset + 26);
    const lenExtra = buffer.readUInt16LE(offset + 28);

    const inicioNombre = offset + 30;
    const nombreArchivo = buffer.subarray(inicioNombre, inicioNombre + lenNombre).toString("utf-8");
    const inicioDatos = inicioNombre + lenNombre + lenExtra;
    const datosComprimidos = buffer.subarray(inicioDatos, inicioDatos + tamComprimido);

    if (nombreArchivo.endsWith(".xml")) {
      if (metodoCompresion === 0) {
        entradas.set(nombreArchivo, datosComprimidos.toString("utf-8"));
      } else if (metodoCompresion === 8) {
        const descomprimido = zlib.inflateRawSync(datosComprimidos);
        entradas.set(nombreArchivo, descomprimido.toString("utf-8"));
      }
    }

    offset = inicioDatos + tamComprimido;
  }

  return entradas;
}

function decodificarXml(texto: string): string {
  return texto
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function indiceColumnaExcel(referenciaCelda: string): number {
  const letras = referenciaCelda.replace(/[0-9]/g, "").toUpperCase();
  let indice = 0;
  for (let i = 0; i < letras.length; i++) {
    indice = indice * 26 + (letras.charCodeAt(i) - 64);
  }
  return Math.max(0, indice - 1);
}

export function leerFilasXlsx(rutaArchivo: string): Array<Record<string, string | number>> {
  const buffer = fs.readFileSync(rutaArchivo);
  const entradas = extraerEntradasZip(buffer);

  const sharedStringsXml = entradas.get("xl/sharedStrings.xml") ?? "";
  const sharedStrings: string[] = [];
  const regexSi = /<si[\s>][\s\S]*?<\/si>/g;
  let matchSi: RegExpExecArray | null;
  while ((matchSi = regexSi.exec(sharedStringsXml)) !== null) {
    const textos: string[] = [];
    const regexT = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let matchT: RegExpExecArray | null;
    while ((matchT = regexT.exec(matchSi[0])) !== null) {
      textos.push(decodificarXml(matchT[1] ?? ""));
    }
    sharedStrings.push(textos.join(""));
  }

  const sheetXml = entradas.get("xl/worksheets/sheet1.xml");
  if (!sheetXml) {
    throw new Error("El archivo .xlsx no contiene xl/worksheets/sheet1.xml válido.");
  }

  const matrizFilas: Array<Array<string | number>> = [];
  const regexRow = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let matchRow: RegExpExecArray | null;

  while ((matchRow = regexRow.exec(sheetXml)) !== null) {
    const filaActual: Array<string | number> = [];
    const regexCell = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let matchCell: RegExpExecArray | null;
    let colFallback = 0;

    while ((matchCell = regexCell.exec(matchRow[1] ?? "")) !== null) {
      const attrs = matchCell[1] ?? "";
      const body = matchCell[2] ?? "";
      const refMatch = /\br="([A-Z]+[0-9]+)"/.exec(attrs);
      const tipoMatch = /\bt="([^"]+)"/.exec(attrs);
      const colIdx = refMatch?.[1] ? indiceColumnaExcel(refMatch[1]) : colFallback;
      colFallback = colIdx + 1;

      const valorMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
      const inlineMatch = /<is>[\s\S]*?<t(?:\s[^>]*)?>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(body);

      let valorFinal: string | number = "";
      if (tipoMatch?.[1] === "s" && valorMatch?.[1] !== undefined) {
        const idx = Number.parseInt(valorMatch[1], 10);
        valorFinal = sharedStrings[idx] ?? "";
      } else if (inlineMatch?.[1] !== undefined) {
        valorFinal = decodificarXml(inlineMatch[1]);
      } else if (valorMatch?.[1] !== undefined) {
        const rawVal = decodificarXml(valorMatch[1]);
        const num = Number(rawVal);
        valorFinal = Number.isNaN(num) || rawVal.trim() === "" ? rawVal : num;
      }

      filaActual[colIdx] = valorFinal;
    }

    if (filaActual.some((v) => v !== undefined && v !== "")) {
      matrizFilas.push(filaActual);
    }
  }

  if (matrizFilas.length <= 1) {
    return [];
  }

  const encabezados = (matrizFilas[0] ?? []).map((h, i) =>
    String(h ?? `columna_${i + 1}`).trim()
  );

  return matrizFilas.slice(1).map((valores) => {
    const obj: Record<string, string | number> = {};
    encabezados.forEach((clave, idx) => {
      obj[clave] = valores[idx] ?? "";
    });
    return obj;
  });
}
