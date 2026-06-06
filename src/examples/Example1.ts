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

import http from "http";

import {
  Energistics,
  IResqmlDataObject,
  Resource,
  ResqmlClient,
  XmlUtils
} from "..";

import { serverHost, serverPath, serverPort, serverProtocol } from "./Config";
import { allMessageBodyType } from "src/lib/common/EtpTypes";
const serverUrl = `${serverProtocol}://${serverHost}:${serverPort}${serverPath}/`;

// eslint-disable-next-line no-console
const log = console.log;

http.get(
  {
    host: serverHost,
    path: `${serverPath}/.well-known/etp-server-capabilities?GetVersion=etp12.energistics.org`,
    port: serverPort
  },
  res => {
    if (res.statusCode === 200 || res.statusCode === 301) {
      log("Website Up and Running ..");
    } else {
      log("Website down");
    }
  }
);

const ct = new ResqmlClient();
ct.addMessageTracer((header: Energistics.Etp.v12.Datatypes.MessageHeader) => {
  console.log(
    `Received message ${header.protocol}.${header.messageType} #${header.messageId}`
  );
});
ct.addCertificationTracer("messageId", (messageId: bigint) => {
  console.log(`Sent message with ID ${messageId}`);
});
ct.addCertificationTracer(
  "message",
  (
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    body: allMessageBodyType
  ) => {
    console.log(
      `Received message ${header.protocol}.${header.messageType} #${
        header.messageId
      }. Body has ${Object.getOwnPropertyNames(body).length} properties.`
    );
  }
);
ct.openSession(serverUrl, XmlUtils.createDefaultJWT())
  .then(() => ct.getDataspaces())
  .then(d => {
    if (d && d.length > 0) {
      ct.getDataspaceResources(d[0].uri).then(r => {
        const time = new Date().getTime();
        const p = [];
        for (let i = 1000; i > 0; i--) {
          p.push(ct.getTargets(r[1].uri));
        }
        Promise.all(p).then(() =>
          log(`transcription: ${new Date().getTime() - time}`)
        );
      });
    }
  })
  .then(() => ct.closeSession());

// Check direct requests
const c = new ResqmlClient();
c.setCallsTraceability(false);
c.openSession(serverUrl, XmlUtils.createDefaultJWT())
  .then(() => c.getDataspaces())
  .then(d => (d === null ? null : d.filter(r => r && r.uri !== "eml:///")))
  .then(d => {
    if (d?.length) {
      c.getSources(
        `${d[0].uri}/resqml20.obj_GenericFeatureInterpretation(67a64380-962b-45bf-8a7b-3f511c8fbb77)`,
        true
      );
      c.getSources(
        `${d[0].uri}/resqml20.obj_FaultInterpretation(eee0a101-fdaf-486b-8915-a9d065f88672)`,
        true
      );
    }
    return d;
  })
  .then(d => (d ? c.getDataspaceResources(d[0].uri) : []))
  .then(async (objects: Resource[]) => {
    c.getObjects(objects.map(o => o.uri)).then(obs => {
      obs.forEach(o => {
        log(JSON.stringify(o));
      });
    });
    // Objects
    const externalObjects = new Map<string, IResqmlDataObject>();
    return c.getResolvedObjects(
      objects.filter((_, i) => i > 20 && i < 40).map(o => o.uri),
      externalObjects
    );
  })
  .then(resourceObjects => {
    resourceObjects.forEach(obj => {
      try {
        const obj1 =
          obj &&
          new XmlUtils.ResqmlTypeUtils(true).checkInterface(
            obj,
            "resqml20.AbstractResqmlDataObject"
          );
        log(`Object is ${obj1 ? "valid" : "not valid"} `);
        log(JSON.stringify(obj));
      } catch (err) {
        log("error");
      }
    });
    log("Direct requests done");
    return c.closeSession();
  })
  .catch((reason: any) => {
    log(reason);
  });
