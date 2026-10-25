// Run before deploying: the Worker must point at a published D1 database.

import dataset from "../dataset.json" with { type: "json" };

if (!dataset.version || /^0{8}-/.test(dataset.d1.id)) {
  console.error("dataset.json names no published dataset: run npm run data:publish first (or check out a dataset.json that does).");
  process.exit(1);
}
console.log(`Deploying with dataset ${dataset.version} (D1 ${dataset.d1.name})`);
