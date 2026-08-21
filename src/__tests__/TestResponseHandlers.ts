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

import "jest";
import { Energistics } from "../lib/common/Etp12";
import { MessageFlags } from "../lib/common/EtpTypes";

import {
  ArrayResponseHandler,
  MapResponseHandler,
  SingleResponseHandler,
  SuccessMapResponseHandler,
  Timer
} from "../lib/common/ResponseHandlers";

jest.setTimeout(150000);

const createTimer = (
  initialTime: number,
  expectedTime: number,
  done: jest.DoneCallback
): Timer => {
  const date = Date.now();
  return new Timer(() => {
    const time = (Date.now() - date) / 1000;
    expect(time).toBeCloseTo(expectedTime, 0);
    done();
  }, initialTime * 1000);
};

describe("Timer", () => {
  it("Normal 3s", done => {
    const timer = createTimer(3, 3, done);
    expect(timer.finished).toBeFalsy();
  });

  it("Add 2s", done => {
    const timer = createTimer(3, 5, done);
    timer.add(2000); // add 2s => 3+2
  });

  it("Add minimum 2s after 2s", done => {
    const timer = createTimer(3, 4, done);
    setTimeout(() => timer.noTimeoutBefore(2000), 2000); // add 2s => 2+2
  });

  it("Add maximum 1s after 1s", done => {
    const timer = createTimer(3, 2, done);
    setTimeout(() => timer.alwaysTimeoutBefore(1000), 1000); // add 1s => 1+1
  });

  it("Reset", done => {
    const timer = createTimer(3, 4, done);
    setTimeout(() => timer.reset(), 1000); // reset after 1s => 1+3;
  });

  it("Cancel", done => {
    const timer = createTimer(3, 0, done);
    timer.cancel(true);
  });
});

const finalHeader: Energistics.Etp.v12.Datatypes.MessageHeader =
  new Energistics.Etp.v12.Datatypes.MessageHeader();
finalHeader.messageFlags = MessageFlags.FINALPART;
const intermediateHeader: Energistics.Etp.v12.Datatypes.MessageHeader =
  new Energistics.Etp.v12.Datatypes.MessageHeader();

const checkTimeOutTime = (
  time: number,
  expectedInterval: number,
  done: jest.DoneCallback,
  reason: any
) => {
  expect(reason).toBeTruthy();
  const interval = (Date.now() - time) / 1000;
  expect(interval).toBeCloseTo(expectedInterval, 0);
  done();
};

const checkValidArrayTime = (
  time: number,
  expectedInterval: number,
  done: jest.DoneCallback,
  value: (boolean | null)[]
) => {
  expect(value).toStrictEqual([true, false]);
  const interval = (Date.now() - time) / 1000;
  expect(interval).toBeCloseTo(expectedInterval, 1);
  done();
};

describe("Single Handler", () => {
  it(`On Valid Response`, done => {
    const handler = new SingleResponseHandler<boolean>(1000);
    const time = Date.now();
    handler
      .waitForRequest(BigInt(0))
      .then(value => {
        expect(value).toStrictEqual(true);
        const interval = (Date.now() - time) / 1000;
        expect(interval).toBeCloseTo(0, 0);
        done();
      })
      .catch();
    handler.onResponse(finalHeader, true);
  });

  it(`On Error`, done => {
    const handler = new SingleResponseHandler<boolean>(1000);
    const time = Date.now();
    handler
      .waitForRequest(BigInt(0))
      .catch(checkTimeOutTime.bind(this, time, 0, done));
    handler.onError(finalHeader, null);
  });

  it(`Time Out`, done => {
    const handler = new SingleResponseHandler<boolean>(1000);
    const time = Date.now();
    handler
      .waitForRequest(BigInt(0))
      .catch(checkTimeOutTime.bind(this, time, 1, done));
  });
  it(`Time Out delayed by intermediate message`, done => {
    const handler = new SingleResponseHandler<boolean>(2000, 1000);
    const time = Date.now();
    handler
      .waitForRequest(BigInt(0))
      .catch(checkTimeOutTime.bind(this, time, 1, done));
    handler.onResponse(intermediateHeader, true);
  });
});

describe("Array Handler", () => {
  it(`On Valid Response`, done => {
    const handler = new ArrayResponseHandler<boolean>(1000);
    const time = Date.now();
    handler
      .waitForRequest(BigInt(0))
      .then(checkValidArrayTime.bind(this, time, 0, done))
      .catch();
    handler.onResponse(finalHeader, [true, false]);
  });

  it(`On Error`, done => {
    const handler = new ArrayResponseHandler<boolean>(1000);
    const time = Date.now();
    handler
      .waitForRequest(BigInt(0))
      .catch(checkTimeOutTime.bind(this, time, 0, done));
    handler.onException(finalHeader, {
      error: { message: "error", code: 0 },
      errors: new Map()
    });
  });

  it(`Time Out`, done => {
    const handler = new ArrayResponseHandler<boolean>(1000);
    const time = Date.now();
    handler
      .waitForRequest(BigInt(0))
      .catch(checkTimeOutTime.bind(this, time, 1, done));
  });

  it(`Time Out delayed by intermediate message`, done => {
    const handler = new ArrayResponseHandler<boolean>(2000, 1000);
    const time = Date.now();
    handler
      .waitForRequest(BigInt(0))
      .catch(checkTimeOutTime.bind(this, time, 1, done));
    handler.onResponse(intermediateHeader, [true]);
  });
});

describe("Map Handler", () => {
  it(`On Valid Response`, done => {
    const handler = new MapResponseHandler<boolean>(10000000);
    const time = Date.now();
    const keys = ["key1", "key2"];
    handler
      .waitForRequest(BigInt(0), keys)
      .then(checkValidArrayTime.bind(this, time, 0, done))
      .catch();
    const map = new Map<string, boolean>();
    map.set("key1", true);
    map.set("key2", false);
    handler.onResponse(finalHeader, map);
  });

  it(`On Error`, done => {
    const handler = new MapResponseHandler<boolean>(1000);
    const time = Date.now();
    const keys = ["key1", "key2"];
    handler
      .waitForRequest(BigInt(0), keys)
      .catch(checkTimeOutTime.bind(this, time, 0, done));
    handler.onException(finalHeader, {
      error: { message: "error", code: 0 },
      errors: new Map()
    });
  });

  it(`Time Out`, done => {
    const handler = new MapResponseHandler<boolean>(1000);
    const time = Date.now();
    const keys = ["key1", "key2"];
    handler
      .waitForRequest(BigInt(0), keys)
      .catch(checkTimeOutTime.bind(this, time, 1, done));
  });

  it(`Time Out delayed by intermediate message`, done => {
    const handler = new MapResponseHandler<boolean>(2000, 1000);
    const time = Date.now();
    const keys = ["key1", "key2"];
    handler
      .waitForRequest(BigInt(0), keys)
      .catch(checkTimeOutTime.bind(this, time, 1, done));
    const map = new Map<string, boolean>();
    map.set("key1", true);
    handler.onResponse(intermediateHeader, map);
  });
});

describe("Success Map Handler", () => {
  it(`On Valid Response`, done => {
    const handler = new SuccessMapResponseHandler(10000000);
    const time = Date.now();
    const keys = ["key1", "key2"];
    handler
      .waitForRequest(BigInt(0), keys)
      .then(value => {
        expect(value[0].code).toStrictEqual(0);
        expect(value[1].code).toStrictEqual(0);
        const interval = (Date.now() - time) / 1000;
        expect(interval).toBeCloseTo(0, 0);
        done();
      })
      .catch();
    const map = new Map<string, string>();
    map.set("key1", "");
    map.set("key2", "");
    handler.onResponse(finalHeader, map);
  });

  it(`On Error`, done => {
    const handler = new SuccessMapResponseHandler(1000);
    const time = Date.now();
    const keys = ["key1", "key2"];
    handler
      .waitForRequest(BigInt(0), keys)
      .catch(checkTimeOutTime.bind(this, time, 0, done));
    handler.onException(finalHeader, {
      error: { message: "error", code: 0 },
      errors: new Map()
    });
  });

  it(`Time Out`, done => {
    const handler = new SuccessMapResponseHandler(1000);
    const time = Date.now();
    const keys = ["key1", "key2"];
    handler
      .waitForRequest(BigInt(0), keys)
      .catch(checkTimeOutTime.bind(this, time, 1, done));
  });

  it(`Time Out delayed by intermediate message`, done => {
    const handler = new SuccessMapResponseHandler(2000, 1000);
    const time = Date.now();
    const keys = ["key1", "key2"];
    handler
      .waitForRequest(BigInt(0), keys)
      .catch(checkTimeOutTime.bind(this, time, 1, done));
    const map = new Map<string, string>();
    map.set("key1", "");
    handler.onResponse(intermediateHeader, map);
  });
});
