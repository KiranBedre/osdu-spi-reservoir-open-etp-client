#!/usr/bin/env python3
"""Enrich PwlsProperties.json with parent lineage from the official PWLS v4.0 dictionary.

The Energistics PWLS v4.0 package ships the authoritative property model as an
EML 2.3 ``PropertyKindDictionary`` (``PWLS_PropertyKindDictionary_v4.0_eml23.xml``),
a single recursive tree of ``PropertyKind`` objects linked by ``<eml:Parent>``.

Our bundled ``PwlsProperties.json`` historically kept only ``property`` /
``quantityClass`` / ``propertyTypeId`` and dropped the parent links, so the
vendor-neutral hierarchy (e.g. ``bulk density`` -> ``density`` -> ``property``)
could not be walked. This script re-reads the official dictionary and adds
``parent`` (parent property name) and ``parentPropertyTypeId`` (parent UUID) to
each existing entry, matched by name against the dictionary ``Title``.

The property *set* is preserved (curve-catalog subset); only parent lineage is
added. UUIDs are validated against the dictionary and mismatches are reported.

Usage:
    python devops/scripts/generate_pwls_properties.py \
        --dictionary /path/to/PWLS_PropertyKindDictionary_v4.0_eml23.xml \
        [--properties src/lib/jsonTypes/PwlsProperties.json] \
        [--check]

``--check`` validates without writing (non-zero exit if changes would be made).
"""
from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

EML_NS = "{http://www.energistics.org/energyml/data/commonv2}"
ROOT_TITLE = "property"

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PROPERTIES = REPO_ROOT / "src" / "lib" / "jsonTypes" / "PwlsProperties.json"


def _text(elem: ET.Element | None) -> str | None:
    return elem.text.strip() if elem is not None and elem.text else None


def parse_dictionary(xml_path: Path) -> dict[str, dict[str, str | None]]:
    """Return {lowercased title -> {uuid, quantityClass, parentTitle, parentUuid}}."""
    tree = ET.parse(xml_path)
    root = tree.getroot()
    by_uuid: dict[str, dict[str, str | None]] = {}
    kinds: list[dict[str, str | None]] = []

    for pk in root.findall(f"{EML_NS}PropertyKind"):
        uuid = pk.get("uuid")
        title = _text(pk.find(f"{EML_NS}Citation/{EML_NS}Title"))
        qc = _text(pk.find(f"{EML_NS}QuantityClass"))
        parent = pk.find(f"{EML_NS}Parent")
        parent_uuid = _text(parent.find(f"{EML_NS}Uuid")) if parent is not None else None
        parent_title = _text(parent.find(f"{EML_NS}Title")) if parent is not None else None
        entry = {
            "uuid": uuid,
            "title": title,
            "quantityClass": qc,
            "parentUuid": parent_uuid,
            "parentTitle": parent_title,
        }
        if uuid:
            by_uuid[uuid] = entry
        kinds.append(entry)

    catalog: dict[str, dict[str, str | None]] = {}
    for entry in kinds:
        title = entry["title"]
        if not title:
            continue
        # A kind whose parent is itself, or the abstract root "property", has no
        # meaningful neutral parent to expose.
        parent_uuid = entry["parentUuid"]
        parent_title = entry["parentTitle"]
        if parent_uuid == entry["uuid"] or (parent_title or "").lower() == ROOT_TITLE:
            parent_uuid = None
            parent_title = None
        catalog[title.lower()] = {
            "uuid": entry["uuid"],
            "quantityClass": entry["quantityClass"],
            "parentUuid": parent_uuid,
            "parentTitle": parent_title,
        }
    return catalog


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dictionary", required=True, type=Path,
                    help="Path to PWLS_PropertyKindDictionary_v4.0_eml23.xml")
    ap.add_argument("--properties", type=Path, default=DEFAULT_PROPERTIES,
                    help="Path to PwlsProperties.json (default: bundled file)")
    ap.add_argument("--check", action="store_true",
                    help="Validate only; exit non-zero if changes would be made")
    args = ap.parse_args()

    if not args.dictionary.exists():
        print(f"ERROR: dictionary not found: {args.dictionary}", file=sys.stderr)
        return 2

    catalog = parse_dictionary(args.dictionary)
    print(f"Parsed {len(catalog)} PropertyKind titles from dictionary")

    data = json.loads(args.properties.read_text(encoding="utf-8"))
    props = data["properties"]

    matched = 0
    with_parent = 0
    uuid_mismatch: list[str] = []
    unmatched: list[str] = []
    changed = False

    for entry in props:
        name = entry["property"].lower()
        ref = catalog.get(name)
        if not ref:
            unmatched.append(entry["property"])
            continue
        matched += 1
        if ref["uuid"] and entry.get("propertyTypeId") and ref["uuid"] != entry["propertyTypeId"]:
            uuid_mismatch.append(f'{entry["property"]}: json={entry["propertyTypeId"]} dict={ref["uuid"]}')

        new_parent = ref["parentTitle"]
        new_parent_id = ref["parentUuid"]
        if entry.get("parent") != new_parent or entry.get("parentPropertyTypeId") != new_parent_id:
            changed = True
        if new_parent:
            entry["parent"] = new_parent
            entry["parentPropertyTypeId"] = new_parent_id
            with_parent += 1
        else:
            entry.pop("parent", None)
            entry.pop("parentPropertyTypeId", None)

    print(f"Matched {matched}/{len(props)} properties; {with_parent} gained parent lineage")
    if unmatched:
        print(f"WARNING: {len(unmatched)} properties not found in dictionary: "
              f"{', '.join(unmatched[:10])}{' ...' if len(unmatched) > 10 else ''}")
    if uuid_mismatch:
        print(f"WARNING: {len(uuid_mismatch)} UUID mismatches vs dictionary:")
        for m in uuid_mismatch[:10]:
            print(f"  {m}")

    if args.check:
        if changed:
            print("CHECK FAILED: PwlsProperties.json is out of date; re-run without --check")
            return 1
        print("CHECK OK: parent lineage up to date")
        return 0

    data["lineageSource"] = "PWLS_PropertyKindDictionary_v4.0_eml23.xml (EML2.3 PropertyKind Parent tree)"
    args.properties.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {args.properties}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
