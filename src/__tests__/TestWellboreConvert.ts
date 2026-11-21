// ============================================================================
// Wellbore converter unit tests — pure, no ETP/live-server round-trip.
//
// Covers the client-side pieces of the OSDU Wellbore-DDMS replacement path
// (rddmsmg/rddms/WellboreDdmsReplacement.md):
//   - LAS 2.0 parse: sections, header split, NULL -> NaN, data reshaping;
//   - LAS serialize -> parse round-trip preserves curves/values;
//   - lasToWitsml: one ChannelSet + one Channel per curve + one array per curve;
//   - bridgeWellbore: WellboreFeature + WellboreInterpretation referencing the
//     authoritative WITSML wellbore (FIRP, reference-not-copy).
// ============================================================================

import "jest";

import { parseLas, serializeLas } from "../lib/wellbore/las";
import { lasToWitsml } from "../lib/wellbore/witsmlChannels";
import { csvToCbt } from "../lib/wellbore/csv";
import { parseDlis, dlisToChannels } from "../lib/wellbore/dlis";
import { bridgeWellbore } from "../lib/wellbore/bridge";
import { minimumCurvature, buildWellboreTrajectory } from "../lib/wellbore/trajectory";
import { projectChannelOntoFrame } from "../lib/wellbore/logProject";
import { WellboreBridge } from "../lib/wellbore/facade";
import { validateWitsmlObjects } from "../lib/wellbore/validateWitsml";

const SAMPLE_LAS = [
    "~Version Information",
    "VERS.   2.0 : CWLS LOG ASCII STANDARD - VERSION 2.0",
    "WRAP.   NO  : ONE LINE PER DEPTH STEP",
    "~Well Information",
    "NULL.   -999.25 : NULL VALUE",
    "WELL.   VOLVE-15/9-F-1 : WELL NAME",
    "~Curve Information",
    "DEPT.M   : DEPTH",
    "GR.GAPI  : GAMMA RAY",
    "RHOB.G/C3: BULK DENSITY",
    "~ASCII",
    "1000.0 55.1 2.35",
    "1000.5 60.2 -999.25",
    "1001.0 58.7 2.41",
].join("\n");

describe("LAS parser", () => {
    it("parses version, wrap, null and well name", () => {
        const las = parseLas(SAMPLE_LAS);
        expect(las.version).toBe("2.0");
        expect(las.wrap).toBe(false);
        expect(las.nullValue).toBeCloseTo(-999.25);
        expect(las.wellName).toBe("VOLVE-15/9-F-1");
    });

    it("parses curves with mnemonic + unit and reshapes the data columns", () => {
        const las = parseLas(SAMPLE_LAS);
        expect(las.curves.map((c) => c.mnemonic)).toEqual(["DEPT", "GR", "RHOB"]);
        expect(las.curves[0].unit).toBe("M");
        expect(las.curves[2].unit).toBe("G/C3");
        expect(las.curves[0].data).toEqual([1000.0, 1000.5, 1001.0]);
        expect(las.curves[1].data).toEqual([55.1, 60.2, 58.7]);
    });

    it("normalises the NULL sentinel to NaN", () => {
        const las = parseLas(SAMPLE_LAS);
        expect(Number.isNaN(las.curves[2].data[1])).toBe(true);
        expect(las.curves[2].data[0]).toBeCloseTo(2.35);
    });
});

describe("LAS serialize round-trip", () => {
    it("re-parses to the same curves and values", () => {
        const first = parseLas(SAMPLE_LAS);
        const round = parseLas(serializeLas(first));
        expect(round.curves.map((c) => c.mnemonic)).toEqual(["DEPT", "GR", "RHOB"]);
        expect(round.curves[0].data).toEqual(first.curves[0].data);
        expect(Number.isNaN(round.curves[2].data[1])).toBe(true);
    });
});

describe("lasToWitsml", () => {
    it("emits one ChannelSet, one Channel per curve, and one array per curve", () => {
        const las = parseLas(SAMPLE_LAS);
        const { objects, arrays } = lasToWitsml(las, { originator: "unit-test" });

        const channelSets = objects.filter((o) => o.$type === "witsml21.ChannelSet");
        const channels = objects.filter((o) => o.$type === "witsml21.Channel");
        expect(channelSets).toHaveLength(1);
        expect(channels).toHaveLength(3);
        expect(arrays).toHaveLength(3);

        // The index channel is flagged.
        const idx = channels.find((c) => (c as { Mnemonic?: string }).Mnemonic === "DEPT");
        expect((idx as { IsIndex?: boolean }).IsIndex).toBe(true);

        // Arrays carry the numeric columns.
        expect(arrays[0].Data).toEqual([1000.0, 1000.5, 1001.0]);
    });
});

describe("bridgeWellbore (WITSML -> RESQML FIRP)", () => {
    it("builds a WellboreFeature that references the WITSML wellbore", () => {
        const { feature, interpretation } = bridgeWellbore({
            witsmlWellbore: { uuid: "1f86e6c8-9de9-47fb-a4b0-cd74c74fc96d", title: "F-1" },
            title: "F-1",
        });

        expect(feature.$type).toMatch(/WellboreFeature$/);
        const dor = (feature as { WitsmlWellbore?: Record<string, unknown> }).WitsmlWellbore;
        expect(dor).toBeDefined();
        // DOR points at the WITSML object, not a copied RESQML well.
        const target = (dor?.QualifiedType ?? dor?.ContentType) as string;
        expect(target).toMatch(/witsml/i);

        expect(interpretation.$type).toMatch(/WellboreInterpretation$/);
        expect((interpretation as { InterpretedFeature?: unknown }).InterpretedFeature).toBeDefined();
        expect((interpretation as { Domain?: string }).Domain).toBe("depth");
    });

    it("authors a native (design-first) wellbore with no WITSML backing", () => {
        // A planned well designed in RESQML before it is drilled: the
        // WellboreFeature must carry NO WitsmlWellbore DOR, yet still produce a
        // valid feature + interpretation the trajectory/log routes can reference.
        const { feature, interpretation } = bridgeWellbore({
            title: "Planned-A1",
            domain: "depth",
        });

        expect(feature.$type).toMatch(/WellboreFeature$/);
        expect((feature as { WitsmlWellbore?: unknown }).WitsmlWellbore).toBeUndefined();
        expect((feature as { Citation?: { Title?: string } }).Citation?.Title).toBe("Planned-A1");

        expect(interpretation.$type).toMatch(/WellboreInterpretation$/);
        const interpreted = (interpretation as { InterpretedFeature?: Record<string, unknown> }).InterpretedFeature;
        expect(interpreted).toBeDefined();
        // Interpretation still points back at the native feature.
        expect((interpreted?.Uuid ?? interpreted?.UUID) as string).toBe(feature.Uuid);
    });
});

describe("minimumCurvature (WITSML survey -> XYZ)", () => {
    it("keeps a purely vertical well on the wellhead in plan view", () => {
        const pts = minimumCurvature([
            { md: 0, inclination: 0, azimuth: 0 },
            { md: 1000, inclination: 0, azimuth: 0 },
        ]);
        expect(pts).toHaveLength(2);
        expect(pts[1].x).toBeCloseTo(0, 6);
        expect(pts[1].y).toBeCloseTo(0, 6);
        // TVD grows with MD for a vertical hole.
        expect(pts[1].z).toBeCloseTo(1000, 6);
    });

    it("builds an easting-only tangent for a 90deg E section", () => {
        const pts = minimumCurvature([
            { md: 0, inclination: 90, azimuth: 90 },
            { md: 100, inclination: 90, azimuth: 90 },
        ]);
        // Pure tangent east: dEast = 100, dNorth = 0, dTVD = 0.
        expect(pts[1].x).toBeCloseTo(100, 6);
        expect(pts[1].y).toBeCloseTo(0, 6);
        expect(pts[1].z).toBeCloseTo(0, 6);
    });
});

describe("buildWellboreTrajectory", () => {
    it("emits a trajectory representation with control-point arrays", () => {
        const built = buildWellboreTrajectory({
            title: "F-1 traj",
            hdfUuid: "3d0b3d2e-0000-4000-8000-000000000001",
            stations: [
                { md: 0, inclination: 0, azimuth: 0 },
                { md: 500, inclination: 30, azimuth: 45 },
                { md: 1000, inclination: 60, azimuth: 45 },
            ],
        });
        expect(built.object.$type).toMatch(/WellboreTrajectoryRepresentation$/);
        // One array for parameters + one for control points.
        expect(built.arrays.length).toBeGreaterThanOrEqual(2);
    });
});

describe("projectChannelOntoFrame (WITSML channel -> RESQML property)", () => {
    it("emits a frame plus a continuous property on its nodes", () => {
        const res = projectChannelOntoFrame({
            hdfUuid: "3d0b3d2e-0000-4000-8000-000000000002",
            nodeMd: [1000, 1000.5, 1001],
            trajectoryUuid: "3d0b3d2e-0000-4000-8000-000000000003",
            curve: { mnemonic: "GR", kind: "gamma ray", uom: "gAPI", values: [55.1, 60.2, 58.7] },
        });
        const frame = res.objects.find((o) => /obj_WellboreFrameRepresentation$/.test(o.$type));
        const prop = res.objects.find((o) => /obj_ContinuousProperty$/.test(o.$type));
        expect(frame).toBeDefined();
        expect(prop).toBeDefined();
        expect(res.frameUuid).toBeTruthy();
        expect(res.propertyUuid).toBeTruthy();
    });
});

describe("WellboreBridge facade", () => {
    it("routes raw curves to WITSML and geomodel views to RESQML", () => {
        const bridge = new WellboreBridge({
            hdfUuid: "3d0b3d2e-0000-4000-8000-000000000004",
            originator: "unit-test",
        });

        bridge.importLas(SAMPLE_LAS);
        const link = bridge.linkWitsmlWellbore({
            uuid: "1f86e6c8-9de9-47fb-a4b0-cd74c74fc96d",
            title: "F-1",
        });
        const traj = bridge.convertTrajectory([
            { md: 0, inclination: 0, azimuth: 0 },
            { md: 1000, inclination: 0, azimuth: 0 },
        ], { interpretationUuid: link.interpretationUuid });
        bridge.projectCurve({
            trajectoryUuid: traj.trajectoryUuid,
            nodeMd: [1000, 1000.5, 1001],
            curve: { mnemonic: "GR", kind: "gamma ray", uom: "gAPI", values: [55.1, 60.2, 58.7] },
            interpretationUuid: link.interpretationUuid,
        });

        const { witsml, resqml } = bridge.build();
        // WITSML side has the raw ChannelSet + Channels only.
        expect(witsml.objects.some((o) => o.$type === "witsml21.ChannelSet")).toBe(true);
        expect(resqml.objects.some((o) => o.$type === "witsml21.ChannelSet")).toBe(false);
        // RESQML side has feature/interp/trajectory/frame/property.
        expect(resqml.objects.some((o) => /WellboreFeature$/.test(o.$type))).toBe(true);
        expect(resqml.objects.some((o) => /WellboreTrajectoryRepresentation$/.test(o.$type))).toBe(true);
        expect(resqml.arrays.length).toBeGreaterThan(0);
    });
});

describe("validateWitsmlObjects", () => {
    it("passes a well-formed ChannelSet + Channels batch", () => {
        const las = parseLas(SAMPLE_LAS);
        const { objects } = lasToWitsml(las, { originator: "unit-test" });
        const report = validateWitsmlObjects(objects);
        expect(report.is_valid).toBe(true);
        expect(report.error_count).toBe(0);
    });

    it("flags a non-witsml $type and a missing citation", () => {
        const report = validateWitsmlObjects([
            // Wrong namespace.
            { $type: "resqml22.WellboreFeature", Uuid: "1f86e6c8-9de9-47fb-a4b0-cd74c74fc96d", SchemaVersion: "2.1" } as never,
            // WITSML object with no Citation.
            {
                $type: "witsml21.Channel",
                Uuid: "1f86e6c8-9de9-47fb-a4b0-cd74c74fc96e",
                SchemaVersion: "2.1",
                Mnemonic: "GR",
            } as never,
        ]);
        expect(report.is_valid).toBe(false);
        expect(report.error_count).toBeGreaterThanOrEqual(2);
    });
});

// ── DLIS (RP66 V1) fixture builder ──────────────────────────────────────────
// Hand-encode a minimal-but-valid DLIS stream: one Visible Record holding a
// CHANNEL EFLR (DEPT + GR, FSINGL), a FRAME EFLR (FRAME1 = [DEPT, GR]) and two
// IFLR FDATA rows. Encoding follows RP66 V1 component/representation rules so it
// exercises the real parser rather than a mock.
type Bytes = number[];

const u8 = (n: number): Bytes => [n & 0xff];
const u16 = (n: number): Bytes => [(n >> 8) & 0xff, n & 0xff];
const ident = (s: string): Bytes => [s.length, ...Array.from(s, (c) => c.charCodeAt(0))];
const uvari = (n: number): Bytes => {
    if (n < 0x80) return [n];
    if (n < 0x4000) return [0x80 | (n >> 8), n & 0xff];
    return [0xc0 | ((n >> 24) & 0x3f), (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};
const f32 = (n: number): Bytes => {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, n, false);
    return [dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)];
};
const obname = (origin: number, copy: number, id: string): Bytes => [...uvari(origin), ...u8(copy), ...ident(id)];

// Component descriptors.
const SET = 0xf0; // SET role + Type
const TATTR = 0x34; // ATTRIB + Label + RepCode  (template)
const OBJ = 0x70; // OBJECT + Name
const VAL = 0x21; // ATTRIB + Value
const CVAL = 0x29; // ATTRIB + Count + Value

const RC_FSINGL = 2;
const RC_USHORT = 15;
const RC_UVARI = 18;
const RC_IDENT = 19;
const RC_OBNAME = 23;

/** Wrap a logical-record body into an even-length Logical Record Segment. */
function lrs(attrs: number, type: number, body: Bytes): Bytes {
    let payload = body.slice();
    let pad = 0;
    if ((4 + payload.length) % 2 !== 0) {
        pad = 1;
        payload = [...payload, 1]; // pad byte value = number of pad bytes
        attrs |= 0x01; // set the padding attribute
    }
    void pad;
    const len = 4 + payload.length;
    return [...u16(len), attrs & 0xff, type & 0xff, ...payload];
}

/** Wrap logical-record segments into a single Visible Record. */
function visibleRecord(...segments: Bytes[]): Bytes {
    const body = segments.flat();
    const len = 4 + body.length;
    return [...u16(len), 0xff, 0x01, ...body];
}

function buildSampleDlis(): Uint8Array {
    const channelEflr: Bytes = [
        SET, ...ident("CHANNEL"),
        // template
        TATTR, ...ident("LONG-NAME"), RC_IDENT,
        TATTR, ...ident("REPRESENTATION-CODE"), RC_USHORT,
        TATTR, ...ident("UNITS"), RC_IDENT,
        TATTR, ...ident("DIMENSION"), RC_UVARI,
        // DEPT
        OBJ, ...obname(1, 0, "DEPT"),
        VAL, ...ident("Depth"),
        VAL, ...u8(RC_FSINGL),
        VAL, ...ident("m"),
        VAL, ...uvari(1),
        // GR
        OBJ, ...obname(1, 0, "GR"),
        VAL, ...ident("Gamma"),
        VAL, ...u8(RC_FSINGL),
        VAL, ...ident("gAPI"),
        VAL, ...uvari(1),
    ];

    const frameEflr: Bytes = [
        SET, ...ident("FRAME"),
        TATTR, ...ident("INDEX-TYPE"), RC_IDENT,
        TATTR, ...ident("CHANNELS"), RC_OBNAME,
        OBJ, ...obname(1, 0, "FRAME1"),
        VAL, ...ident("BOREHOLE-DEPTH"),
        CVAL, ...uvari(2), ...obname(1, 0, "DEPT"), ...obname(1, 0, "GR"),
    ];

    const row = (n: number, dept: number, gr: number): Bytes => [
        ...obname(1, 0, "FRAME1"), ...uvari(n), ...f32(dept), ...f32(gr),
    ];

    const vr = visibleRecord(
        lrs(0x80, 3, channelEflr), // EFLR CHANNEL
        lrs(0x80, 4, frameEflr), // EFLR FRAME
        lrs(0x00, 0, row(1, 1000.0, 50.0)), // IFLR FDATA
        lrs(0x00, 0, row(2, 1000.5, 55.0)),
    );
    return Uint8Array.from(vr);
}

describe("DLIS parser (RP66 V1)", () => {
    it("decodes a frame's channels, units and sample rows", () => {
        const parsed = parseDlis(buildSampleDlis());
        expect(parsed.version).toBe("DLIS");
        expect(parsed.curves.map((c) => c.mnemonic)).toEqual(["DEPT", "GR"]);
        expect(parsed.curves[0].unit).toBe("m");
        expect(parsed.curves[1].unit).toBe("gAPI");
        expect(parsed.curves[0].data).toEqual([1000.0, 1000.5]);
        expect(parsed.curves[1].data).toEqual([50.0, 55.0]);
    });

    it("accepts a base64 blob and maps to WITSML channels", () => {
        const b64 = Buffer.from(buildSampleDlis()).toString("base64");
        const { objects, arrays } = dlisToChannels(b64, { title: "DLIS Set" });
        expect(objects.some((o) => o.$type === "witsml21.ChannelSet")).toBe(true);
        // One Channel per curve, one bulk array per curve.
        expect(objects.filter((o) => o.$type === "witsml21.Channel")).toHaveLength(2);
        expect(arrays).toHaveLength(2);
    });
});

describe("csvToCbt (CSV -> RESQML ColumnBasedTable)", () => {
    const SAMPLE_CSV = ["SW,KRW,KROW", "0.2,0.0,0.8", "0.5,0.1,0.3", "0.8,0.4,0.0"].join("\n");

    it("builds a 2.2 ColumnBasedTable with a key column + one array per column", () => {
        const { object, arrays } = csvToCbt(SAMPLE_CSV, {
            hdfUuid: "3d0b3d2e-0000-4000-8000-000000000004",
            title: "KrPc",
        });
        expect(object.$type).toBe("eml23.ColumnBasedTable");
        // SW is the default key column; KRW/KROW are data columns.
        expect((object as { KeyColumn?: unknown[] }).KeyColumn).toHaveLength(1);
        expect((object as { Column?: unknown[] }).Column).toHaveLength(2);
        // One external array per column (1 key + 2 data).
        expect(arrays).toHaveLength(3);
        expect(arrays.every((a) => a.ArrayType === "Float64Array")).toBe(true);
    });

    it("honours explicit key columns on the 2.2 line", () => {
        const { object } = csvToCbt(SAMPLE_CSV, {
            hdfUuid: "3d0b3d2e-0000-4000-8000-000000000004",
            version: "2.2.0",
            keyColumns: ["SW", "KRW"],
        });
        expect((object as { KeyColumn?: unknown[] }).KeyColumn).toHaveLength(2);
        expect((object as { Column?: unknown[] }).Column).toHaveLength(1);
        expect(object.SchemaVersion).toBe("2.3"); // ColumnBasedTable is an eml23 object;
    });
});


