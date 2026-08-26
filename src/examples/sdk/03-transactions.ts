/**
 * SDK Example 3: Transaction lifecycle.
 *
 * Demonstrates start → write → rollback vs start → write → commit,
 * and verifies that rolled-back data does not persist.
 *
 * Usage:
 *   npx ts-node src/examples/sdk/03-transactions.ts
 */

import { RddmsClient, DataObject } from "../../../sdk";

const BASE = process.env.RDDMS_URL || "http://localhost:8080/api/reservoir-ddms/v2";
const PARTITION = process.env.RDDMS_PARTITION || "dev";

async function main() {
    const rddms = new RddmsClient({ baseUrl: BASE, partitionId: PARTITION });
    const DS = "sdk-examples/transactions";

    console.log("1. Create dataspace");
    await rddms.dataspaces.create([{ DataspaceId: DS, Path: DS }]).catch(() => { });

    const obj: DataObject = {
        $type: "eml20.obj_EpcExternalPartReference",
        Uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001",
        SchemaVersion: "2.0.0.20140822",
        Citation: { Title: "Rollback Test", Originator: "sdk", Creation: new Date().toISOString() },
        MimeType: "application/x-hdf5",
    };

    // --- Rollback scenario ---
    console.log("\n2. Start transaction → write → ROLLBACK");
    const tx1 = await rddms.transactions.start(DS);
    console.log("   TX started:", tx1);
    await rddms.resources.put(DS, [obj], { transactionId: tx1 });
    console.log("   Object written (inside tx)");
    await rddms.transactions.rollback(DS, tx1);
    console.log("   TX rolled back");

    const typesAfterRollback = await rddms.resources.types(DS);
    console.log("   Types after rollback:", typesAfterRollback.length === 0 ? "EMPTY (correct!)" : typesAfterRollback);

    // --- Commit scenario ---
    console.log("\n3. Start transaction → write → COMMIT");
    const tx2 = await rddms.transactions.start(DS);
    console.log("   TX started:", tx2);
    await rddms.resources.put(DS, [obj], { transactionId: tx2 });
    console.log("   Object written (inside tx)");
    await rddms.transactions.commit(DS, tx2);
    console.log("   TX committed");

    const typesAfterCommit = await rddms.resources.types(DS);
    console.log("   Types after commit:", typesAfterCommit);

    // --- atomicWrite helper ---
    console.log("\n4. atomicWrite helper (auto-tx)");
    const obj2: DataObject = {
        $type: "eml20.obj_EpcExternalPartReference",
        Uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0002",
        SchemaVersion: "2.0.0.20140822",
        Citation: { Title: "Auto-TX Object", Originator: "sdk", Creation: new Date().toISOString() },
        MimeType: "application/x-hdf5",
    };
    const result = await rddms.atomicWrite(DS, [obj2]);
    console.log("   atomicWrite result:", result);

    const finalTypes = await rddms.resources.types(DS);
    console.log("   Final types:", finalTypes);

    console.log("\n5. Cleanup");
    await rddms.dataspaces.delete(DS);
    console.log("   Done!");
}

main().catch(err => { console.error(err); process.exit(1); });
