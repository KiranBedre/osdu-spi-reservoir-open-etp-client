#!/usr/bin/env python3
"""Generate pwls_property_kinds.json (ResqmlValidator resource) from the official PWLS dictionary.

The validator (`src/lib/validation/ResqmlValidator.ts`, layer 7) loads this file
as the authoritative set of standard Energistics/PWLS PropertyKinds. It was
previously generated from ``pwls_v3.0_property_kind_dictionary.xml`` (3,661
entries). This regenerates it from the official PWLS v4.0 EML2.3
``PropertyKindDictionary`` (3,934 entries), preserving the exact JSON schema the
validator expects: ``{ source, generated_by, count, entries:[{ uuid, title,
is_abstract, parent_uuid, quantity_class }] }``.

Usage:
    python devops/scripts/generate_pwls_property_kinds.py \
        --dictionary /path/to/PWLS_PropertyKindDictionary_v4.0_eml23.xml \
        [--out src/lib/validation/resources/pwls_property_kinds.json]
"""
from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

EML_NS = "{http://www.energistics.org/energyml/data/commonv2}"
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = REPO_ROOT / "src" / "lib" / "validation" / "resources" / "pwls_property_kinds.json"


def _text(elem: ET.Element | None) -> str | None:
    return elem.text.strip() if elem is not None and elem.text else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dictionary", required=True, type=Path,
                    help="Path to PWLS_PropertyKindDictionary_v4.0_eml23.xml")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    if not args.dictionary.exists():
        print(f"ERROR: dictionary not found: {args.dictionary}", file=sys.stderr)
        return 2

    root = ET.parse(args.dictionary).getroot()
    entries = []
    for pk in root.findall(f"{EML_NS}PropertyKind"):
        uuid = pk.get("uuid")
        if not uuid:
            continue
        title = _text(pk.find(f"{EML_NS}Citation/{EML_NS}Title"))
        is_abstract = (_text(pk.find(f"{EML_NS}IsAbstract")) or "false").lower() == "true"
        qc = _text(pk.find(f"{EML_NS}QuantityClass"))
        parent = pk.find(f"{EML_NS}Parent")
        parent_uuid = _text(parent.find(f"{EML_NS}Uuid")) if parent is not None else None
        # A kind whose parent is itself has no meaningful parent.
        if parent_uuid == uuid:
            parent_uuid = None
        entries.append({
            "uuid": uuid,
            "title": title,
            "is_abstract": is_abstract,
            "parent_uuid": parent_uuid,
            "quantity_class": qc,
        })

    payload = {
        "source": args.dictionary.name,
        "generated_by": "devops/scripts/generate_pwls_property_kinds.py",
        "count": len(entries),
        "entries": entries,
    }
    args.out.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(entries)} PropertyKinds to {args.out} (source={args.dictionary.name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
