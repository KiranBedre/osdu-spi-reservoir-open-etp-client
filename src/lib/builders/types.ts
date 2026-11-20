/**
 * Shared data-object primitives for the RESQML object-graph builders.
 *
 * These are the wire-shape interfaces used by both the standalone SDK
 * (`sdk/RddmsClient.ts`, which re-exports them) and the server-side REST
 * controllers (`src/lib/restApi/**`). Keeping them under `src/` (inside the
 * server `rootDir`) lets the NestJS build import the builders directly while
 * the SDK continues to expose the same types to external consumers.
 */

/** Energistics Citation block attached to every RESQML DataObject. */
export interface Citation {
    Title: string;
    Originator: string;
    Creation: string;
    Format?: string;
}

/** A single RESQML/EML data object as consumed by the write path. */
export interface DataObject {
    $type: string;
    Uuid: string;
    SchemaVersion: string;
    Citation: Citation;
    [key: string]: unknown;
}

/** An external/HDF array payload referenced by a DataObject. */
export interface DataArrayInput {
    ContainerType: string;
    ContainerUuid: string;
    PathInResource: string;
    Dimensions: number[];
    ArrayType: string;
    Data?: number[] | string;
    Starts?: number[];
    Counts?: number[];
}
