/**
 * SDK Example 5: Dataspace management.
 *
 * Demonstrates create, list, info, lock/unlock, clone, and delete.
 *
 * Usage:
 *   npx ts-node src/examples/sdk/05-dataspaces.ts
 */

import { RddmsClient } from "../../../sdk";

const BASE = process.env.RDDMS_URL || "http://localhost:8080/api/reservoir-ddms/v2";
const PARTITION = process.env.RDDMS_PARTITION || "dev";

async function main() {
    const rddms = new RddmsClient({ baseUrl: BASE, partitionId: PARTITION });

    console.log("1. Create two dataspaces");
    await rddms.dataspaces.create([
        { DataspaceId: "sdk-examples/ds-a", Path: "sdk-examples/ds-a" },
        { DataspaceId: "sdk-examples/ds-b", Path: "sdk-examples/ds-b" },
    ]).catch(() => { });

    console.log("2. List all dataspaces");
    const all = await rddms.dataspaces.list();
    console.log("   Count:", (all as any[]).length);

    console.log("3. Get info for ds-a");
    const info = await rddms.dataspaces.info("sdk-examples/ds-a");
    console.log("   Info:", JSON.stringify(info));

    console.log("4. Lock ds-a");
    await rddms.dataspaces.lock("sdk-examples/ds-a");
    console.log("   Locked");

    console.log("5. Unlock ds-a");
    await rddms.dataspaces.unlock("sdk-examples/ds-a");
    console.log("   Unlocked");

    console.log("6. Clone ds-a → ds-clone");
    await rddms.dataspaces.clone("sdk-examples/ds-a", { targetDataspaceId: "sdk-examples/ds-clone" }).catch(() => { });
    console.log("   Cloned");

    console.log("7. Cleanup");
    await rddms.dataspaces.delete("sdk-examples/ds-a").catch(() => { });
    await rddms.dataspaces.delete("sdk-examples/ds-b").catch(() => { });
    await rddms.dataspaces.delete("sdk-examples/ds-clone").catch(() => { });
    console.log("   Done!");
}

main().catch(err => { console.error(err); process.exit(1); });
