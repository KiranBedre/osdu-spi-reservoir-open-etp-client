# RESQML EPC Workflow Guide

**From raw data to validated EPC + OSDU manifest — covering RESQML 2.0.1 and 2.2**

This guide documents the complete pipeline for constructing, validating, importing,
and generating manifests for RESQML EPC files, including critical pitfalls discovered
during the Drogon dataset ingestion.

---

## Table of Contents

1. [EPC Structure Overview](#epc-structure-overview)
2. [Version Differences: 2.0.1 vs 2.2](#version-differences)
3. [Building an EPC](#building-an-epc)
4. [Validation Pipeline](#validation-pipeline)
5. [Import Pipelines](#import-pipelines)
6. [Manifest Generation](#manifest-generation)
7. [Pitfalls & Lessons Learned](#pitfalls--lessons-learned)
8. [Automation Opportunities](#automation-opportunities)

---

## EPC Structure Overview

An EPC file is an **OPC (Open Packaging Convention)** ZIP archive containing:

```
[Content_Types].xml          # Maps part names → MIME content types
_rels/.rels                  # Root relationships (minimal in v2.2)
_rels/TypeName_UUID.xml.rels # Per-object relationship files
TypeName_UUID.xml            # RESQML data objects (one per file)
```

### Critical Files

| File | Purpose | v2.0.1 | v2.2 |
|------|---------|--------|------|
| `[Content_Types].xml` | Part→ContentType map | `version=2.0;type=obj_TypeName` | `version=2.2;type=TypeName` |
| `_rels/.rels` | Root relationships | References all objects + EPR | Minimal (just default) |
| Per-object `.rels` | DOR relationship graph | `sourceObject`/`destinationObject` | `sourceObject`/`destinationObject` |
| `obj_EpcExternalPartReference_UUID.xml` | HDF5 file reference | **Required** | **Not used** |

---

## Version Differences

### RESQML 2.0.1 (EML 2.0)

```xml
<!-- Data Object Reference (DOR) format -->
<resqml2:LocalCrs>
  <eml:ContentType>application/x-resqml+xml;version=2.0;type=obj_LocalDepth3dCrs</eml:ContentType>
  <eml:Title>Default CRS</eml:Title>
  <eml:UUID>abc123-...</eml:UUID>
</resqml2:LocalCrs>

<!-- HDF5 array reference -->
<resqml2:Values>
  <resqml2:PathInHdfFile>/RESQML/uuid/values_patch0</resqml2:PathInHdfFile>
  <resqml2:HdfProxy>
    <eml:ContentType>application/x-eml+xml;version=2.0;type=obj_EpcExternalPartReference</eml:ContentType>
    <eml:Title>drogon.h5</eml:Title>
    <eml:UUID>23998a69-...</eml:UUID>
  </resqml2:HdfProxy>
</resqml2:Values>
```

- Filenames: `obj_TypeName_UUID.xml`
- Root element: `xsi:type="resqml2:obj_TypeName"` **required**
- ExtraMetadata: must be **last** child elements
- EpcExternalPartReference: **required** for HDF5 data

### RESQML 2.2 (EML 2.3)

```xml
<!-- Data Object Reference (DOR) format -->
<resqml2:LocalCrs>
  <eml:Uuid>abc123-...</eml:Uuid>
  <eml:QualifiedType>resqml22.LocalDepth3dCrs</eml:QualifiedType>
  <eml:Title>Default CRS</eml:Title>
</resqml2:LocalCrs>

<!-- HDF5 array reference -->
<eml:ExternalDataArrayPart>
  <eml:Count>1</eml:Count>
  <eml:PathInExternalFile>/RESQML/uuid/values_patch0</eml:PathInExternalFile>
  <eml:StartIndex>0</eml:StartIndex>
  <eml:URI>drogon.h5</eml:URI>
</eml:ExternalDataArrayPart>
```

- Filenames: `TypeName_UUID.xml` (no `obj_` prefix)
- Root element: no `xsi:type` needed
- ExtensionNameValue: replaces ExtraMetadata
- No EpcExternalPartReference (URI embedded in ExternalDataArrayPart)

### Key Type Renames (2.0.1 → 2.2)

| v2.0.1 | v2.2 |
|--------|------|
| `GeneticBoundaryFeature` | `BoundaryFeature` |
| `TectonicBoundaryFeature` | `BoundaryFeature` |
| `obj_FaultInterpretation` | `FaultInterpretation` |
| `StratigraphicColumn` | `StratigraphicColumn` (unchanged) |
| `StandardPropertyKind` (inline) | Standalone `PropertyKind` objects |

---

## Building an EPC

### Step 1: Prepare XML Objects

Each RESQML object is a standalone XML file. Key requirements:

- **UUID**: Must be unique RFC 4122 format, set as `uuid="..."` attribute on root
- **Citation**: `<eml:Citation>` with `<eml:Title>`, `<eml:Originator>`, `<eml:Creation>`
- **schemaVersion**: Root attribute matching the version ("2.0.1" or "2.2")

### Step 2: Build Content_Types.xml

**v2.0.1:**
```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/obj_IjkGridRepresentation_UUID.xml"
            ContentType="application/x-resqml+xml;version=2.0;type=obj_IjkGridRepresentation"/>
</Types>
```

**v2.2:**
```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/IjkGridRepresentation_UUID.xml"
            ContentType="application/x-resqml+xml;version=2.2;type=IjkGridRepresentation"/>
</Types>
```

> **⚠️ PITFALL**: Do NOT include `<Default Extension="xml">` — it conflicts with
> per-part Override entries and causes server parsing issues.

### Step 3: Build .rels Files

**Root `_rels/.rels`:**
```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>
```

**Per-object `_rels/TypeName_UUID.xml.rels`:**
```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rel1"
    Type="http://schemas.energistics.org/package/2012/relationships/destinationObject"
    Target="/LocalDepth3dCrs_REFERENCED-UUID.xml"/>
  <Relationship Id="rel2"
    Type="http://schemas.energistics.org/package/2012/relationships/sourceObject"
    Target="/IjkGridRepresentation_PARENT-UUID.xml"/>
</Relationships>
```

Build .rels by scanning each XML for DOR references (UUID elements) and creating
`destinationObject` relationships for each referenced object. The referenced object
gets a reciprocal `sourceObject` relationship.

### Step 4: Package as ZIP

```python
import zipfile

with zipfile.ZipFile("output.epc", "w", zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("[Content_Types].xml", content_types_xml)
    zf.writestr("_rels/.rels", root_rels_xml)
    for obj_name, xml_content in objects.items():
        zf.writestr(obj_name, xml_content)
        zf.writestr(f"_rels/{obj_name}.rels", per_object_rels[obj_name])
```

---

## Validation Pipeline

### 9-Layer Validation (TypeScript + Python)

Both validators (`src/lib/validation/ResqmlValidator.ts` and
`rddmsmg/docs/tools/validate/src/resqml_converter/strict_validation.py`)
implement these layers:

| Layer | Check | Severity |
|-------|-------|----------|
| 1. EPC Structure | ZIP validity, [Content_Types].xml, _rels/.rels | ERROR |
| 2. XSD Schema | Per-object XML validation against RESQML/EML XSD | ERROR |
| 3. DOR Integrity | All referenced UUIDs exist in the EPC | ERROR |
| 4. HDF5 References | Dataset paths exist in H5 file | ERROR |
| 5. Cross-Object | UUID uniqueness | ERROR |
| 6. Business Rules | S01-S18 (grid dimensions, geometry, properties) | ERROR |
| 7. PWLS | PropertyKind names match PWLS catalog | WARNING |
| 8. fesapi Compat | xsi:type, obj_ prefix, ExtraMetadata ordering | WARNING/ERROR |
| 9. RDDMS Compat | ContentType format, .rels integrity, DOR format | ERROR |

### What the Validator NOW Catches (Post-Improvements)

**v2.2-specific checks added:**
- ❌ ContentType with `obj_` prefix → **ERROR** (causes server mismatch)
- ❌ ContentType with `version=2.0` in v2.2 EPC → **ERROR**
- ❌ v2.0.1-style DOR `<ContentType>` elements in v2.2 XML → **ERROR** (causes "Missing reference" on commit)
- ❌ `obj_` prefix in filenames → **ERROR**
- ❌ `<Default Extension="xml">` in Content_Types.xml → **WARNING**
- ❌ EpcExternalPartReference present in v2.2 EPC → **WARNING**
- ❌ Missing .rels for objects with DOR references → **WARNING**

### Running Validation

**TypeScript (RDDMS REST API):**
```bash
curl -X POST http://localhost:3000/api/reservoir-ddms/v2/validate/epc \
  -F "epc=@drogon22.epc" -F "h5=@drogon.h5" \
  -H "data-partition-id: opendes"
```

**Python (CLI):**
```bash
cd rddmsmg/docs/tools/validate
python -m resqml_converter.strict_validation_cli --epc drogon22.epc --h5 drogon.h5
```

---

## Import Pipelines

### Pipeline 1: Docker ETP Binary (Direct Import)

The fastest approach. Uses the `openETPServer` binary's `--import-epc` command.

**Local M27 server (no auth):**
```bash
# Create dataspace
docker run --rm --network etp12 \
  -v ./tmp:/data \
  open-etp-server-main:latest \
  openETPServer space -S ws://etp-server:9004 -u foo -p bar \
  -s local/mydata --new

# Import EPC
docker run --rm --network etp12 \
  -v ./tmp:/data \
  open-etp-server-main:latest \
  openETPServer space -S ws://etp-server:9004 -u foo -p bar \
  -s local/mydata --import-epc /data/mydata.epc -j -M 50MB
```

**Interop (bearer auth, SSL):**
```bash
# Save token to file (avoid CLI arg exposure)
python3 -c "import requests; ..." > tmp/.etp_token

# Import via Docker SSL client
docker run --rm \
  -v ./tmp:/data \
  --entrypoint=sh \
  osdu-etp-sslclient:latest \
  -c 'export JWT=$(cat /data/.etp_token) && \
      /bin/openETPServer space \
      -S "wss://host:443/api/reservoir-ddms-etp/v2/" \
      -P partition --auth bearer -T "$JWT" \
      -s dataspace/name --import-epc /data/file.epc -j -M 50MB'
```

### Pipeline 2: REST API EPC Upload

Available on **M27+** deployments with the EPC upload endpoint.

```bash
curl -X POST "http://localhost:3000/api/reservoir-ddms/v2/dataspaces/mydata/epc-upload" \
  -F "epc=@mydata.epc" -F "h5=@data.h5" \
  -H "data-partition-id: opendes" \
  -H "Authorization: Bearer $TOKEN"
```

> **Note**: The EPC upload controller now handles **both v2.0.1 and v2.2** HDF5
> reference patterns. Previously it only detected v2.0.1 `PathInHdfFile`+`HdfProxy`
> patterns and would report "Found 0 HDF5 dataset reference(s)" for v2.2 EPCs.

### Pipeline 3: ETP Client SDK

```typescript
import { RddmsClient } from "./sdk/RddmsClient";

const client = new RddmsClient({ baseUrl: "http://localhost:3000", partition: "opendes" });
// Use ETP protocol directly via the client SDK
```

---

## Manifest Generation

### REST API

```bash
curl -X POST "http://localhost:3000/api/reservoir-ddms/v2/manifests/build" \
  -H "Authorization: Bearer $TOKEN" \
  -H "data-partition-id: opendes" \
  -H "Content-Type: application/json" \
  -d '{
    "uris": ["eml:///dataspace('\''mydata/space'\'')"],
    "createMissingReferences": true,
    "includeArrayData": false,
    "propertyFilter": "canonical"
  }'
```

**Returns HTTP 201** (not 200) with the manifest JSON.

### Manifest Structure

```json
{
  "Data": {
    "Datasets": [...],           // HDF5 dataset records
    "WorkProductComponents": [...],  // RESQML object OSDU records
    "WorkProduct": null          // Optional work product wrapper
  },
  "MasterData": [...],          // Well, Wellbore records
  "ReferenceData": [...]        // CRS, PropertyType records
}
```

### Pre-Manifest Validation

Before generating a manifest, ensure:
1. All objects imported successfully (check `Final progress: 100%`)
2. No "Missing reference" errors during CommitTransaction
3. The dataspace has correct legal tags and ACL in CustomData

---

## Pitfalls & Lessons Learned

### 🔴 CRITICAL: lxml Iterator Invalidation During DOR Conversion

**Problem**: When converting v2.0.1 → v2.2 DOR format, using `for el in root.iter()`
while `_convert_dor(el)` modifies the element's children invalidates the iterator.
Subsequent sibling elements are **silently skipped**.

**Impact**: 93 out of 787 DOR references remained in v2.0.1 format (ContentType with
`obj_` prefix) while the server stored objects under v2.2 names. Result:
`"93 Missing reference(s)"` on CommitTransaction.

**Fix**: Collect elements into a list first, then mutate:
```python
# ❌ WRONG: modifying tree during iteration
for el in root.iter():
    if should_convert(el):
        convert_dor(el)  # Removes/adds children → invalidates iterator!

# ✅ CORRECT: collect-then-mutate
to_convert = [el for el in root.iter() if should_convert(el)]
for el in to_convert:
    convert_dor(el)
```

**Affected DOR types**: LocalCrs (41), Trajectory (18), Faults (6), Horizon (6),
Unit (5), PartOf (4), DirectObject (4), Subject (4), ChronostratigraphicTop (3).

### 🔴 CRITICAL: v2.2 HDF5 Scanner Only Detected v2.0.1 Patterns

**Problem**: The EPC upload controller (`EpcUpload.controller.ts`) only scanned for
`<PathInHdfFile>` + `<HdfProxy><UUID>` patterns. v2.2 EPCs use
`<PathInExternalFile>` + `<URI>` inside `<ExternalDataArrayPart>`.

**Impact**: v2.2 EPCs uploaded with **zero arrays** — all array data silently skipped.

**Fix**: Added second regex pattern for v2.2, using the parent object's URI as the
array container instead of an EpcExternalPartReference URI.

### 🟡 HIGH: ContentType vs QualifiedType Confusion

**v2.0.1 DOR format:**
```xml
<eml:ContentType>application/x-resqml+xml;version=2.0;type=obj_TypeName</eml:ContentType>
<eml:UUID>uuid-here</eml:UUID>
```

**v2.2 DOR format:**
```xml
<eml:Uuid>uuid-here</eml:Uuid>
<eml:QualifiedType>resqml22.TypeName</eml:QualifiedType>
```

The server resolves references by matching the DOR's type identifier against stored
object types. Mixing formats (v2.0.1 ContentType in a v2.2 EPC) causes "Missing
reference" errors because `obj_TypeName` ≠ `TypeName`.

### 🟡 HIGH: Content_Types.xml Default Extension="xml"

Having `<Default Extension="xml" ContentType="..."/>` makes ALL `.xml` files in the
ZIP use that content type, overriding per-part `<Override>` entries. This can cause
the server to misidentify object types. Always use `<Override>` entries only.

### 🟡 MEDIUM: ETP URL Trailing Slash

The ETP WebSocket URL for interop **requires a trailing slash**:
```
wss://admeinterop.energy.azure.com:443/api/reservoir-ddms-etp/v2/   ← correct
wss://admeinterop.energy.azure.com:443/api/reservoir-ddms-etp/v2    ← 404
```

### 🟡 MEDIUM: PostgreSQL Port Conflict

The local Docker compose ETP server uses PostgreSQL. If the host already runs
PostgreSQL on port 5432, use `-p 5433:5432` to avoid conflicts.

### 🟢 INFO: "Cannot read part: xml"

The `Error: Cannot read part: xml` message from the import binary is harmless —
it refers to an unrecognized `<Default Extension="xml">` entry in Content_Types.xml.
The import still succeeds.

---

## Automation Opportunities

### What Can Be Automated

| Task | Tool | Status |
|------|------|--------|
| EPC structure validation | TS/Python validators (Layer 1-9) | ✅ Implemented |
| v2.0.1 → v2.2 conversion | `resqml_v22_converter.py` | ✅ Implemented (fixed) |
| .rels regeneration | `build_drogon22_epc.py` `_build_rels_from_dors()` | ✅ Implemented |
| Content_Types.xml generation | `build_drogon22_epc.py` | ✅ Implemented |
| DOR format validation | TS/Python validators (Layer 9) | ✅ **NEW** |
| v2.2 HDF5 reference scanning | `EpcUpload.controller.ts` | ✅ **FIXED** |
| Manifest generation | REST API `/manifests/build` | ✅ Implemented |
| Manifest SRN validation | Check 0 errors in response | ✅ Automated |
| Pre-import DOR audit | Count ContentType vs QualifiedType DORs | 📋 Script below |

### Pre-Import DOR Audit Script

Run this before importing to catch DOR format issues early:

```python
#!/usr/bin/env python3
"""Audit an EPC for DOR format consistency before import."""
import zipfile, re, sys

epc_path = sys.argv[1]
z = zipfile.ZipFile(epc_path)

ct_dors = 0  # v2.0.1 ContentType DORs
qt_dors = 0  # v2.2 QualifiedType DORs
mixed_objects = []

for name in z.namelist():
    if not name.endswith('.xml') or 'Content_Types' in name: continue
    content = z.read(name).decode()
    ct = len(re.findall(r'<eml:ContentType>.*?</eml:ContentType>', content))
    qt = len(re.findall(r'<eml:QualifiedType>.*?</eml:QualifiedType>', content))
    ct_dors += ct
    qt_dors += qt
    if ct > 0 and qt > 0:
        mixed_objects.append(name)

total = ct_dors + qt_dors
print(f"Total DOR references: {total}")
print(f"  ContentType (v2.0.1): {ct_dors}")
print(f"  QualifiedType (v2.2): {qt_dors}")
if mixed_objects:
    print(f"\n⚠️  {len(mixed_objects)} objects have MIXED DOR formats:")
    for m in mixed_objects[:10]:
        print(f"    {m}")
if ct_dors > 0 and qt_dors > 0:
    print("\n❌ EPC has mixed DOR formats! This will cause 'Missing reference' errors.")
elif ct_dors > 0:
    print("\n✅ All DORs use v2.0.1 ContentType format")
elif qt_dors > 0:
    print("\n✅ All DORs use v2.2 QualifiedType format")
```

### Recommended CI/CD Pipeline

```
1. Build EPC (converter + packager)
2. Validate EPC (9-layer validator, strict mode)
3. Audit DOR format (pre-import check)
4. Import to test dataspace
5. Verify object count (list resources)
6. Generate manifest
7. Verify manifest (0 errors, expected record counts)
8. Import to production dataspace
```
