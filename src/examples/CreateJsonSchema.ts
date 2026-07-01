// ============================================================================
// Copyright 2019-2022 Emerson Paradigm Holding LLC. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ============================================================================

import fs from "fs";
import path from "path";

import { XmlUtils } from "..";

const jsonSchemaDir = path.resolve(".");

const resqmlTypes = new XmlUtils.ResqmlTypeUtils();
const resqmlInterfaces = resqmlTypes
  .getInterfaces("resqml20")
  .filter(t => t.getName().startsWith("obj_"));

fs.mkdirSync(path.join(jsonSchemaDir, "resqml_json"));
resqmlInterfaces.forEach(i => {
  const s = resqmlTypes.createJSONSchemas("resqml20." + i.getName());
  fs.writeFileSync(
    path.join(jsonSchemaDir, "resqml_json", i.getName() + ".json"),
    s
  );
});

// RESQML 2.2 schemas
const resqml22Interfaces = resqmlTypes
  .getInterfaces("resqml22")
  .filter(t => !t.getName().startsWith("_") && !t.getName().startsWith("Abstract"));

fs.mkdirSync(path.join(jsonSchemaDir, "resqml22_json"));
resqml22Interfaces.forEach(i => {
  const s = resqmlTypes.createJSONSchemas("resqml22." + i.getName());
  fs.writeFileSync(
    path.join(jsonSchemaDir, "resqml22_json", i.getName() + ".json"),
    s
  );
});

const witsmlTypes = new XmlUtils.WitsmlTypeUtils();
const baseObject = witsmlTypes.findInterface("_AbstractObject");
if (baseObject) {
  const witsmlInterfaces = witsmlTypes
    .getInterfaces("witsml20")
    .filter(
      t =>
        !t.getName().startsWith("_") &&
        witsmlTypes.isDerivingFrom(t, baseObject[0])
    );
  fs.mkdirSync(path.join(jsonSchemaDir, "witsml_json"));
  witsmlInterfaces.forEach(i => {
    const s = witsmlTypes.createJSONSchemas("witsml20." + i.getName());
    fs.writeFileSync(
      path.join(jsonSchemaDir, "witsml_json", i.getName() + ".json"),
      s
    );
  });
}
