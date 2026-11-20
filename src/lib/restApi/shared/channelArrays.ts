// ─── Domain-neutral channel/array extraction helpers ─────────────────────────
//
// Shared foundation for turning inline, XML-encoded sample data (WITSML logs &
// trajectories, ProdML time-series / DAS / DTS) into external ETP data arrays.
//
// Each domain contributes a thin "extractor" that produces `ChannelArray[]`;
// the common `injectExternalArrayRefs` / `arrayPathFor` helpers then handle the
// storage-side wiring (external-array reference injection + path convention) so
// every domain stores arrays the same way through `ResqmlClient.putDataArray`.

export interface ChannelArray {
  mnemonic: string;
  values: Float64Array;
  /** Dimensions for putDataArray: [length] for scalar, [rows, dim] for array channels. */
  dimensions: number[];
}

/**
 * Canonical pathInResource for an externally-stored channel array.
 * e.g. arrayPathFor("WITSML", uuid, "GR") -> "/WITSML/<uuid>/GR"
 */
export function arrayPathFor(
  pathPrefix: string,
  uuid: string,
  mnemonic: string
): string {
  return `/${pathPrefix}/${uuid}/${mnemonic}`;
}

/**
 * Parse a single data row that may contain bracket-encoded multi-dim arrays.
 * Format: "8496.0,[7.48 40.85 21.6],[1023.09 78.6],42.5"
 * Returns an array of tokens, each being either a scalar number or a number[].
 */
export function parseDataRow(row: string): (number | number[])[] {
  const tokens: (number | number[])[] = [];
  let i = 0;
  const len = row.length;

  while (i < len) {
    // Skip whitespace/commas
    while (i < len && (row[i] === "," || row[i] === " " || row[i] === "\t")) i++;
    if (i >= len) break;

    if (row[i] === "[") {
      // Bracket-encoded array: [v1 v2 v3 ...]
      const end = row.indexOf("]", i);
      if (end < 0) break;
      const inner = row.slice(i + 1, end).trim();
      const arr = inner
        .split(/\s+/)
        .map(v => { const n = parseFloat(v); return isNaN(n) ? NaN : n; });
      tokens.push(arr);
      i = end + 1;
    } else {
      // Scalar value: read until next comma or bracket
      let j = i;
      while (j < len && row[j] !== "," && row[j] !== "[") j++;
      const val = row.slice(i, j).trim();
      if (val.length > 0) {
        const n = parseFloat(val);
        tokens.push(isNaN(n) ? NaN : n);
      }
      i = j;
    }
  }
  return tokens;
}

/**
 * Extract channel data arrays from WITSML XML containing <logData><data> rows.
 * Supports WITSML 1.4.1 (<logData><data>v1,v2,v3</data>...) and
 * WITSML 2.1 ChannelSet data formats, including bracket-encoded multi-dim arrays.
 *
 * Multi-dimensional channels (e.g. T2_DIST[30]) are stored as flattened
 * Float64Array with dimensions [rows, dim].
 *
 * Returns per-channel Float64Array for each mnemonic (including the index curve).
 */
export function extractChannelArrays(xml: string): ChannelArray[] {
  // Bound worst-case backtracking cost of the channel-extraction regexes
  // below against adversarially large input (CWE-1333). Default 5 MB.
  const maxInput = Number(
    process.env.RDMS_MAX_WITSML_REGEX_INPUT ?? 5 * 1024 * 1024
  );
  if (xml.length > maxInput) {
    throw new Error(
      `WITSML XML length ${xml.length} exceeds the ${maxInput}-byte channel-extraction limit`
    );
  }
  // --- WITSML 1.4.1 format ---
  // <logCurveInfo><mnemonic>GR</mnemonic>...</logCurveInfo>
  // <logData><data>1000.0, 45.2, 105.3</data>...</logData>
  const curveInfoRegex =
    /<(?:[\w]+:)?(?:logCurveInfo|LogCurveInfo)[^>]*>[\s\S]*?<(?:[\w]+:)?(?:mnemonic|Mnemonic)>([^<]+)<\/[\s\S]*?<\/(?:[\w]+:)?(?:logCurveInfo|LogCurveInfo)>/gi;
  const mnemonics: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = curveInfoRegex.exec(xml)) !== null) {
    mnemonics.push(m[1].trim());
  }

  // WITSML 2.1 ChannelSet format: <Channel><Mnemonic>GR</Mnemonic>...</Channel>
  // Also extract from <Index><Mnemonic>MD</Mnemonic>...</Index>
  if (mnemonics.length === 0) {
    const indexMnemonicRegex =
      /<(?:[\w]+:)?Index[^>]*>[\s\S]*?<(?:[\w]+:)?Mnemonic>([^<]+)<\/[\s\S]*?<\/(?:[\w]+:)?Index>/gi;
    while ((m = indexMnemonicRegex.exec(xml)) !== null) {
      mnemonics.push(m[1].trim());
    }
    const channelRegex =
      /<(?:[\w]+:)?Channel\b[^>]*>[\s\S]*?<(?:[\w]+:)?Mnemonic>([^<]+)<\/[\s\S]*?<\/(?:[\w]+:)?Channel>/gi;
    while ((m = channelRegex.exec(xml)) !== null) {
      mnemonics.push(m[1].trim());
    }
  }

  if (mnemonics.length === 0) return [];

  // Extract <data> rows (nested <Data><Data>... or <logData><data>...)
  const dataRowRegex = /<(?:[\w]+:)?[Dd]ata>([^<]+)<\/(?:[\w]+:)?[Dd]ata>/gi;
  const rawRows: string[] = [];
  while ((m = dataRowRegex.exec(xml)) !== null) {
    const content = m[1].trim();
    // Skip MnemonicList-like rows (all text, no numbers)
    if (content.length > 0 && /[\d.-]/.test(content)) {
      rawRows.push(content);
    }
  }

  if (rawRows.length === 0) return [];

  // Parse all rows to detect scalars vs arrays per channel
  const parsedRows = rawRows.map(parseDataRow);
  if (parsedRows.length === 0 || parsedRows[0].length === 0) return [];

  const numChannels = Math.min(mnemonics.length, parsedRows[0].length);
  const numRows = parsedRows.length;
  const arrays: ChannelArray[] = [];

  for (let col = 0; col < numChannels; col++) {
    // Determine if this channel is scalar or array from first non-NaN row
    const sample = parsedRows.find(r => col < r.length && r[col] !== undefined)?.[col];
    const isArray = Array.isArray(sample);

    if (isArray) {
      // Multi-dimensional channel: flatten into [rows * dim]
      const dim = (sample as number[]).length;
      const values = new Float64Array(numRows * dim);
      for (let row = 0; row < numRows; row++) {
        const cell = col < parsedRows[row].length ? parsedRows[row][col] : undefined;
        if (Array.isArray(cell)) {
          for (let d = 0; d < dim; d++) {
            values[row * dim + d] = d < cell.length ? cell[d] : NaN;
          }
        } else {
          // Missing row - fill with NaN
          for (let d = 0; d < dim; d++) {
            values[row * dim + d] = NaN;
          }
        }
      }
      arrays.push({ mnemonic: mnemonics[col], values, dimensions: [numRows, dim] });
    } else {
      // Scalar channel
      const values = new Float64Array(numRows);
      for (let row = 0; row < numRows; row++) {
        const cell = col < parsedRows[row].length ? parsedRows[row][col] : NaN;
        values[row] = typeof cell === "number" ? cell : NaN;
      }
      arrays.push({ mnemonic: mnemonics[col], values, dimensions: [numRows] });
    }
  }

  return arrays;
}

/**
 * Extract trajectory station data as arrays from WITSML trajectory XML.
 * Supports WITSML 1.4.1 <trajectoryStation> elements with <md>, <incl>, <azi>.
 * Returns arrays for MD, Inclination, and Azimuth.
 */
export function extractTrajectoryArrays(xml: string): ChannelArray[] {
  // Match individual <trajectoryStation> blocks
  const stationRegex =
    /<(?:[\w]+:)?trajectoryStation[^>]*>([\s\S]*?)<\/(?:[\w]+:)?trajectoryStation>/gi;
  const mdValues: number[] = [];
  const inclValues: number[] = [];
  const aziValues: number[] = [];

  let m: RegExpExecArray | null;
  while ((m = stationRegex.exec(xml)) !== null) {
    const block = m[1];
    const mdMatch = block.match(/<(?:[\w]+:)?md[^>]*>([^<]+)<\//i);
    const inclMatch = block.match(/<(?:[\w]+:)?incl[^>]*>([^<]+)<\//i);
    const aziMatch = block.match(/<(?:[\w]+:)?azi[^>]*>([^<]+)<\//i);

    if (mdMatch) mdValues.push(parseFloat(mdMatch[1]));
    if (inclMatch) inclValues.push(parseFloat(inclMatch[1]));
    if (aziMatch) aziValues.push(parseFloat(aziMatch[1]));
  }

  if (mdValues.length === 0) return [];

  const arrays: ChannelArray[] = [];
  if (mdValues.length > 0) {
    arrays.push({ mnemonic: "MD", values: Float64Array.from(mdValues), dimensions: [mdValues.length] });
  }
  if (inclValues.length > 0) {
    arrays.push({
      mnemonic: "Inclination",
      values: Float64Array.from(inclValues),
      dimensions: [inclValues.length]
    });
  }
  if (aziValues.length > 0) {
    arrays.push({ mnemonic: "Azimuth", values: Float64Array.from(aziValues), dimensions: [aziValues.length] });
  }
  return arrays;
}

/**
 * Extract ProdML time-series sample arrays from an XML document.
 *
 * Handles the common ProdML shape where a growing time-series is expressed as a
 * repeated block carrying a numeric value and a timestamp, e.g.:
 *   <DataValue><Value uom="...">123.4</Value><dTim>2020-01-01T00:00:00Z</dTim></DataValue>
 * (also accepts <DoubleValue>/<value> and <time>/<index> variants).
 *
 * Produces two aligned channels:
 *   - "Time"  : the sample index (epoch-millis for timestamps, else numeric index)
 *   - "Value" : the sample value
 *
 * Returns [] when no recognizable samples are present so callers can cheaply
 * skip objects that carry no growing data.
 */
export function extractProdmlTimeSeriesArrays(xml: string): ChannelArray[] {
  const sampleRegex =
    /<(?:[\w]+:)?DataValue\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?DataValue>/gi;
  const valueTag =
    /<(?:[\w]+:)?(?:Value|DoubleValue|value)\b[^>]*>([^<]+)<\/(?:[\w]+:)?(?:Value|DoubleValue|value)>/i;
  const timeTag =
    /<(?:[\w]+:)?(?:dTim|Time|time|Index|index)\b[^>]*>([^<]+)<\/(?:[\w]+:)?(?:dTim|Time|time|Index|index)>/i;

  const times: number[] = [];
  const values: number[] = [];

  let m: RegExpExecArray | null;
  let ordinal = 0;
  while ((m = sampleRegex.exec(xml)) !== null) {
    const block = m[1];
    const valMatch = block.match(valueTag);
    if (!valMatch) continue;
    const val = parseFloat(valMatch[1].trim());

    const tMatch = block.match(timeTag);
    let t: number;
    if (tMatch) {
      const raw = tMatch[1].trim();
      const asNum = parseFloat(raw);
      // ISO timestamp -> epoch millis; plain number -> numeric index
      t = /[T:\-]/.test(raw) && isNaN(asNum) === false && /[TZ:]/.test(raw)
        ? Date.parse(raw)
        : (isNaN(asNum) ? Date.parse(raw) : asNum);
      if (isNaN(t)) t = ordinal;
    } else {
      t = ordinal;
    }

    times.push(t);
    values.push(isNaN(val) ? NaN : val);
    ordinal++;
  }

  if (values.length === 0) return [];

  return [
    { mnemonic: "Time", values: Float64Array.from(times), dimensions: [times.length] },
    { mnemonic: "Value", values: Float64Array.from(values), dimensions: [values.length] }
  ];
}

/**
 * True when the object is a ProdML DAS acquisition/processed product whose
 * sample & time arrays live exclusively in companion HDF5 files (per the
 * Energistics DAS schema: DasRaw/DasFbe/DasSpectra reference external HDF5
 * datasets; the XML carries only metadata + refs). Such objects have NO inline
 * numeric arrays to extract — they must be ingested via the HDF5/EPC route
 * (`/epc/upload`), so the inline-extraction path skips them.
 */
export function isDasHdf5Object(uriOrType: string): boolean {
  return /\bDas(?:Acquisition|Raw|Fbe|Spectra|Processed)\b/i.test(uriOrType);
}

/**
 * True when the object carries ProdML DTS (distributed temperature sensing)
 * data. In ProdML 2.x the temperature-vs-distance samples live in ChannelSet /
 * MeasurementTrace elements that share the Energistics channel serialization,
 * so `extractChannelArrays` handles the numeric payload directly.
 */
export function isDtsChannelObject(uriOrType: string): boolean {
  return /\bDts(?:Measurement|MeasurementTrace|InterpretationData|InterpretationLogSet)\b|\bChannelSet\b/i.test(
    uriOrType
  );
}

/** Byte size at/below which the server inlines an array in the `ary` table;
 *  above this it spills to `bin` chunks, so shipping big inline XML is wasteful. */
export const INLINE_ARRAY_THRESHOLD_BYTES = 64 * 1024;

/**
 * First-class ingest policy: decide whether a ProdML object's inline samples
 * should be extracted into external arrays.
 *
 * - `override === "false"` → never (explicit opt-out).
 * - `override === "true"`  → always (explicit opt-in, any size).
 * - otherwise              → auto: extract only when the serialized payload
 *   exceeds `inlineThreshold` (default {@link INLINE_ARRAY_THRESHOLD_BYTES}),
 *   since small objects are cheaper left inline.
 */
export function shouldExtractArrays(opts: {
  override?: string;
  byteLength: number;
  inlineThreshold?: number;
}): boolean {
  if (opts.override === "false") return false;
  if (opts.override === "true") return true;
  const threshold = opts.inlineThreshold ?? INLINE_ARRAY_THRESHOLD_BYTES;
  return opts.byteLength > threshold;
}

/**
 * Domain-neutral ProdML array extraction dispatcher.
 *
 * - DAS objects → returns [] (their arrays are HDF5-only; use the EPC route).
 * - Time-series objects (`<DataValue>` blocks) → aligned Time/Value channels.
 * - DTS / ChannelSet objects → per-mnemonic channels via `extractChannelArrays`.
 *
 * Returns the array set plus the `kind` so callers know which inline blocks to
 * strip before injecting external references.
 */
export function extractProdmlArrays(
  xml: string,
  uriOrType = ""
): { arrays: ChannelArray[]; kind: "das" | "timeseries" | "channel" | "none" } {
  if (isDasHdf5Object(uriOrType) || isDasHdf5Object(xml)) {
    return { arrays: [], kind: "das" };
  }
  const ts = extractProdmlTimeSeriesArrays(xml);
  if (ts.length > 0) return { arrays: ts, kind: "timeseries" };
  const ch = extractChannelArrays(xml);
  if (ch.length > 0) return { arrays: ch, kind: "channel" };
  return { arrays: [], kind: "none" };
}

/**
 * Inject EML ExternalDataArrayPart references into the XML so the ETP server
 * doesn't consider the arrays "orphans" during transaction commit.
 *
 * @param pathPrefix domain path segment (e.g. "WITSML", "PRODML") used to build
 *                   the PathInExternalFile; must match the pathInResource used
 *                   when storing the array via putDataArray (see arrayPathFor).
 */
export function injectExternalArrayRefs(
  xml: string,
  uuid: string,
  arrays: ChannelArray[],
  pathPrefix = "WITSML"
): string {
  // Ensure xmlns:eml is declared on root element
  if (!xml.includes('xmlns:eml=') && !xml.includes('xmlns:eml =')) {
    xml = xml.replace(
      /(<[\w:]+)/,
      `$1 xmlns:eml="http://www.energistics.org/energyml/data/commonv2"`
    );
  }

  const refs = arrays
    .map(
      ch =>
        `<eml:ExternalDataArrayPart>` +
        `<eml:Count>${ch.values.length}</eml:Count>` +
        `<eml:PathInExternalFile>${arrayPathFor(pathPrefix, uuid, ch.mnemonic)}</eml:PathInExternalFile>` +
        `</eml:ExternalDataArrayPart>`
    )
    .join("");

  // Insert before the closing root element tag
  const closingTagMatch = xml.match(/<\/[\w:]+>\s*$/);
  if (closingTagMatch && closingTagMatch.index != null) {
    return (
      xml.slice(0, closingTagMatch.index) +
      refs +
      xml.slice(closingTagMatch.index)
    );
  }
  // Fallback: append before end
  return xml + refs;
}
