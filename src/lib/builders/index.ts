/**
 * RESQML object-graph builders — pure, I/O-free functions that emit
 * spec-correct RESQML objects + their bulk arrays.
 *
 * Domain-agnostic core used across every RESQML domain (structural, seismic
 * interpretation, reservoir grids, properties). Every tool that emits RESQML
 * through the SDK should build with these so the object graphs, DORs and
 * citations are identical — the fix for "same data, different graph" drift.
 *
 * Composed by `RddmsClient` (see the `build` namespace + `putModel` helper),
 * which layers on the existing server components: strict `validate`, `pwls`
 * curve resolution, and CRS completeness. RDF/SHACL/federated-query views are
 * a planned SDK element (see ToDoEtpClient §6) and are intentionally not here
 * yet.
 */

export * from "./types";
export * from "./core";
export * from "./crs";
export * from "./vocabulary";
export * from "./interpretation";
export * from "./geometry";
export * from "./seismic";
export * from "./grdecl";
export * from "./egrid";
export * from "./init";
export * from "./gridPropertyRegistry";
export * from "./ijkgrid";
export * from "./connectionSet";
export * from "./property";
export * from "./channelSet";
export * from "./reservoir";
export * from "./wellbore";
export * from "./columnBasedTable";
export * from "./bridge";
export * from "./manifest";
