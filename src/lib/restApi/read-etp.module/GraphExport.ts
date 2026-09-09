// ============================================================================
// Tabular / graph-interchange exports for the ETP relationship graph.
//
// Complements the RDF serializers (RdfSerialization.ts) with two widely
// supported non-RDF representations of the same nodes-and-edges graph:
//   - CSV  (text/csv)             - a flat node attribute table for
//                                   spreadsheets / pandas.
//   - GraphML (application/graphml+xml) - full nodes + edges topology for
//                                   graph tools (Gephi, yEd, Cytoscape).
// Both are opt-in via `Accept:` or `?format=` and never change the default
// JSON response.
// ============================================================================

import {
    RdfEdge,
    RdfGraph,
    dataObjectClassToken,
    parseEtpUri
} from "./RdfSerialization";

/** Export media types this module can emit. */
export const EXPORT_MIME_CSV = "text/csv";
export const EXPORT_MIME_GRAPHML = "application/graphml+xml";

export type GraphExportFormat = "csv" | "graphml";

/** Map an explicit `?format=` query value to a graph-export format. */
export const graphExportFromParam = (
    format?: string
): GraphExportFormat | undefined => {
    switch (format?.trim().toLowerCase()) {
        case "csv":
            return "csv";
        case "graphml":
        case "graph-ml":
            return "graphml";
        default:
            return undefined;
    }
};

/** Inspect an HTTP `Accept` header for a graph-export media type. */
export const negotiateGraphExport = (
    accept?: string
): GraphExportFormat | undefined => {
    if (!accept) return undefined;
    const value = accept.toLowerCase();
    if (value.includes(EXPORT_MIME_GRAPHML)) return "graphml";
    if (value.includes(EXPORT_MIME_CSV)) return "csv";
    return undefined;
};

/**
 * Resolve the graph-export format for a request. An explicit `?format=` value
 * takes precedence over the `Accept` header; returns `undefined` when neither
 * selects an export format (caller falls back to RDF or JSON).
 */
export const resolveGraphExportFormat = (
    accept?: string,
    formatParam?: string
): GraphExportFormat | undefined =>
    graphExportFromParam(formatParam) ?? negotiateGraphExport(accept);

const isoString = (value?: Date | string): string => {
    if (value === undefined || value === null) return "";
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
};

// --- CSV --------------------------------------------------------------------

/** Quote a CSV cell per RFC 4180 when it contains a comma, quote or newline. */
const csvCell = (value: unknown): string => {
    const s = value === undefined || value === null ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const CSV_COLUMNS = [
    "uri",
    "name",
    "type",
    "dataspace",
    "uuid",
    "version",
    "activeStatus",
    "sourceCount",
    "targetCount",
    "storeCreated",
    "storeLastWrite"
] as const;

/**
 * Serialize the graph nodes to a CSV attribute table (one row per resource).
 * Edges are intentionally omitted - use GraphML for full topology.
 */
export const graphToCsv = (graph: RdfGraph): string => {
    const rows: string[] = [CSV_COLUMNS.join(",")];
    for (const r of graph.resources) {
        const parts = parseEtpUri(r.uri);
        rows.push(
            [
                r.uri,
                r.name ?? "",
                dataObjectClassToken(r.uri) ?? "",
                parts.dataspace ?? "",
                parts.uuid ?? "",
                parts.version ?? "",
                r.activeStatus ?? "",
                r.sourceCount ?? "",
                r.targetCount ?? "",
                isoString(r.storeCreated),
                isoString(r.storeLastWrite ?? r.lastChanged)
            ]
                .map(csvCell)
                .join(",")
        );
    }
    return rows.length > 1 ? `${rows.join("\r\n")}\r\n` : `${rows[0]}\r\n`;
};

// --- GraphML ----------------------------------------------------------------

/** Escape a string for use in XML text / attribute values. */
const xmlEscape = (value: string): string =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

/** GraphML node/edge attribute keys (id -> [for, attr.name, type]). */
const GRAPHML_KEYS: ReadonlyArray<
    readonly [string, "node" | "edge", string, string]
> = [
        ["name", "node", "name", "string"],
        ["type", "node", "type", "string"],
        ["dataspace", "node", "dataspace", "string"],
        ["uuid", "node", "uuid", "string"],
        ["version", "node", "objectVersion", "string"],
        ["activeStatus", "node", "activeStatus", "string"],
        ["sourceCount", "node", "sourceCount", "long"],
        ["targetCount", "node", "targetCount", "long"],
        ["storeCreated", "node", "storeCreated", "string"],
        ["storeLastWrite", "node", "storeLastWrite", "string"],
        ["path", "edge", "path", "string"]
    ];

const dataTag = (key: string, value: unknown): string =>
    value === undefined || value === null || value === ""
        ? ""
        : `      <data key="${key}">${xmlEscape(String(value))}</data>\n`;

/**
 * Serialize the graph to GraphML (nodes + edges with attributes). ETP URIs are
 * used as node ids so cross-references resolve without a mapping table.
 */
export const graphToGraphML = (graph: RdfGraph): string => {
    const lines: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">'
    ];
    for (const [id, domain, name, type] of GRAPHML_KEYS)
        lines.push(
            `  <key id="${id}" for="${domain}" attr.name="${name}" attr.type="${type}"/>`
        );
    lines.push('  <graph edgedefault="directed">');

    for (const r of graph.resources) {
        const parts = parseEtpUri(r.uri);
        lines.push(`    <node id="${xmlEscape(r.uri)}">`);
        const body =
            dataTag("name", r.name) +
            dataTag("type", dataObjectClassToken(r.uri)) +
            dataTag("dataspace", parts.dataspace) +
            dataTag("uuid", parts.uuid) +
            dataTag("version", parts.version) +
            dataTag("activeStatus", r.activeStatus) +
            dataTag("sourceCount", r.sourceCount) +
            dataTag("targetCount", r.targetCount) +
            dataTag("storeCreated", isoString(r.storeCreated)) +
            dataTag(
                "storeLastWrite",
                isoString(r.storeLastWrite ?? r.lastChanged)
            );
        if (body) lines.push(body.replace(/\n$/, ""));
        lines.push("    </node>");
    }

    graph.links.forEach((e: RdfEdge, i: number) => {
        lines.push(
            `    <edge id="e${i}" source="${xmlEscape(
                e.source
            )}" target="${xmlEscape(e.target)}">`
        );
        const body = dataTag("path", e.path);
        if (body) lines.push(body.replace(/\n$/, ""));
        lines.push("    </edge>");
    });

    lines.push("  </graph>", "</graphml>", "");
    return lines.join("\n");
};

/** Serialize a graph to the requested export format. */
export const serializeGraphExport = (
    graph: RdfGraph,
    format: GraphExportFormat
): { body: string; contentType: string } => {
    switch (format) {
        case "csv":
            return { body: graphToCsv(graph), contentType: EXPORT_MIME_CSV };
        case "graphml":
        default:
            return {
                body: graphToGraphML(graph),
                contentType: EXPORT_MIME_GRAPHML
            };
    }
};
