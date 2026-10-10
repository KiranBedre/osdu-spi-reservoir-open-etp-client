import { expect, jest } from "@jest/globals";
import { Energistics, ResqmlClient as OpenETPClient } from "../index";
import config, { describeif, logger } from "./testConfig";
import { ErrorCode } from "../lib/common/EtpTypes";
import { v4 as uuidv4 } from 'uuid';
import {
  verifyProtocolExceptionResponse,
  verifyErrorMessage,
  verifyTotalErrors,
  verifyMessage,
  verifyGetStoreResponseContent
} from "./helper/testHelpers";
import { DataObjectFactory } from "./helper/DataObjectFactory";
import { EventName } from "./helper/constants";

import GetDataObjectsResponse = Energistics.Etp.v12.Protocol.Store.GetDataObjectsResponse;
import DeleteDataObjectsResponse = Energistics.Etp.v12.Protocol.Store.DeleteDataObjectsResponse;
import PutDataObjectsResponse = Energistics.Etp.v12.Protocol.Store.PutDataObjectsResponse;
import GetDataObjectsResponseTypeId = Energistics.Etp.v12.Protocol.Store.MsgGetDataObjectsResponse;
import MsgDeleteDataObjectsResponseTypeId = Energistics.Etp.v12.Protocol.Store.MsgDeleteDataObjectsResponse;
import MsgPutDataObjectsResponseTypeId = Energistics.Etp.v12.Protocol.Store.MsgPutDataObjectsResponse;
import DataObject = Energistics.Etp.v12.Datatypes.Object.DataObject;

// Sub-protocol parameters. Each may be overridden via the test config
// (protocols.store.*); when absent we fall back to the historical default
// so existing certification configs keep working unchanged.
const volveWellUuid = config.protocols.store.wellUuidForGet ?? 'ca96314d-a048-46bf-9a1e-a27edd9bac09';
const volveWellboreUuid = config.protocols.store.wellboreUuidForGet ?? '1f86e6c8-9de9-47fb-a4b0-cd74c74fc96d';
const invalidUri = config.protocols.store.invalidUri ?? "eml://invalidUri";
const invalidUuid = config.protocols.store.invalidUuid ?? "invalid";
const unsupportedDataObjectUri =
  config.protocols.store.unsupportedDataObjectUri ?? "eml:///witsml21.Unsupported(301b6ebe-a211-49e2-a556-f7378576ddc9)";

jest.setTimeout(3 * 1000);

if (!config.etpServerUrl.startsWith("ws")) {
  logger.error("Invalid ETP server URL. Must start with ws:// or wss://");
  process.exit(1);
}

describeif(config.protocols.store.supported)("(4) Store protocol", () => {

  const client = new OpenETPClient();

  beforeAll(async () => {
    await client.connect(
      config.etpServerUrl,
      config.jwtToken,
      config.dataPartition
    );
    await client.requestSession();
  });

  afterAll(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  const resourceNotFoundUri =  DataObjectFactory.createWellUri(uuidv4());

  describe("9.3.1: GetDataObjects with errors", () => {
    let successResponse: any;
    let errorResponse: any;
    const validWellUri = DataObjectFactory.createUri(volveWellUuid, "Well");
    const validWellboreUri = DataObjectFactory.createUri(volveWellboreUuid, "Wellbore");
    const getRequestUris = [validWellUri, validWellboreUri, resourceNotFoundUri, invalidUri, unsupportedDataObjectUri];
    const getRequestExpectedErrors = [
      { uri: resourceNotFoundUri, code: ErrorCode.ENOT_FOUND },
      { uri: invalidUri, code: ErrorCode.EINVALID_URI },
      // TODO: verify this error case, bardazz returns ENOT_FOUND for this case but should be EDATAOBJECTTYPE_NOTSUPPORTED
      { uri: unsupportedDataObjectUri, code: ErrorCode.EDATAOBJECTTYPE_NOTSUPPORTED }
    ];

    beforeAll(done => {
      const successPromise = new Promise(resolve => {
        client.store.once(EventName.GET_DATA_OBJECT_RESPONSE, data => {
          successResponse = data;
          resolve(data);
        });
      });
      const exceptionPromise = new Promise(resolve => {
        client.store.once(EventName.PROTOCOL_EXCEPTION, data => {
          errorResponse = data;
          resolve(data);
        });
      });

      Promise.all([successPromise, exceptionPromise])
        .then(() => {
          done();
        })
        .catch(error => {
          done(error);
        });
      client.getDataObjects(getRequestUris);
    });

    it("Validate success response is GetDataObjectsResponse message from GetDataObject request", () => {
      verifyMessage(successResponse, new GetDataObjectsResponse(), GetDataObjectsResponseTypeId);
    });

    it("Verify success GetDataObjectResponse contains well & wellbore those were created in PutDataObject request", () => {
      verifyGetStoreResponseContent(successResponse, validWellUri, volveWellUuid, validWellboreUri, volveWellboreUuid);
    });

    it("Wrong uri's should emit ProtocolException etp message", () => {
      verifyProtocolExceptionResponse(errorResponse);
    });

    it("ProtocolException should contain 3 errors ", () => {
      verifyTotalErrors(errorResponse, 3);
    });

    getRequestExpectedErrors.forEach(({ uri, code }) => {
      it(`Error for ${uri}: should be code ${code}`, () => {
        verifyErrorMessage(errorResponse, `${uri}`, code);
      });
    });
  });


  describeif(config.protocols.store.supportsWrite)("9.3.4 Test PUT, GET & DELETE for store", () => {
    let putSuccessResponse: any;
    let putExceptionResponse: any;
    let getSuccessResponse: any;
    let getExceptionResponse: any;
    let deleteWellboreSuccessResponse: any;
    let deleteWellboreExceptionResponse: any;
    let deleteWellSuccessResponse: any;

    const validWellUuid = uuidv4();
    const validWellboreUuid = uuidv4();
    const validWellUri = DataObjectFactory.createWellUri(validWellUuid);
    const validWellboreUri = DataObjectFactory.createWellboreUri(validWellboreUuid);

    const validWell = DataObjectFactory.generateWellObject(validWellUuid);
    const validWellbore = DataObjectFactory.generateWellboreObject(validWellboreUuid, validWellUuid);
    const invalidWell = DataObjectFactory.generateWellObject(invalidUuid);
    const invalidGenericObject = DataObjectFactory.createInvalidObject();

    const putRequestUris: DataObject[] = [validWell, validWellbore, invalidWell, invalidGenericObject];
    const putRequestExpectedErrors = [
      { uri: putRequestUris[2].resource.uri, code: ErrorCode.EINVALID_URI },
      { uri: putRequestUris[3].resource.uri, code: ErrorCode.EINVALID_OBJECT }
    ];

    it("9.3.2 : Verify responses are received for PutDataObject request", done => {
      const putSuccessPromise = new Promise(resolve => {
        client.store.once(EventName.PUT_DATA_OBJECTS_RESPONSE, data => {
          putSuccessResponse = data;
          resolve(data);
        });
      });

      const putExceptionPromise = new Promise(resolve => {
        client.store.once(EventName.PROTOCOL_EXCEPTION, data => {
          putExceptionResponse = data;
          resolve(data);
        });
      });

      Promise.all([putSuccessPromise, putExceptionPromise])
        .then(() => {
          done();
        });

      client.putDataObjects(putRequestUris);
    });

    it("9.3.3 Message: PutDataObjectsResponse => Response should be a PutDataObjectsResponse etp message", () => {
      verifyMessage(putSuccessResponse, new PutDataObjectsResponse(), MsgPutDataObjectsResponseTypeId);
    });

    it("Verify for PutDataObjectsResponse there was two success objects", () => {
      expect(putSuccessResponse.body.success.size).toBe(2);
      expect(putSuccessResponse.body.success.has(validWellUri)).toBe(true);
      expect(putSuccessResponse.body.success.has(validWellboreUri)).toBe(true);
    });

    it("5.3.8 Message: ProtocolException => Response for PutDataObjects should be a ProtocolException etp message", () => {
      verifyProtocolExceptionResponse(putExceptionResponse);
    });

    it("Verify for Response for PutDataObjects should contain 2 errors", () => {
      verifyTotalErrors(putExceptionResponse, 2);
    });

    putRequestExpectedErrors.forEach(({ uri, code }) => {
      it(`Error for ${uri} should be code ${code}`, () => {
        verifyErrorMessage(putExceptionResponse, uri, code);
      });
    });

    const getRequestUris = [validWellUri, validWellboreUri, resourceNotFoundUri, invalidUri, unsupportedDataObjectUri];
    const getRequestExpectedErrors = [
      { uri: invalidUri, code: ErrorCode.EINVALID_URI },
      { uri: resourceNotFoundUri, code: ErrorCode.ENOT_FOUND },
      // TODO: verify this error case, bardazz returns ENOT_FOUND for this case but should be EDATAOBJECTTYPE_NOTSUPPORTED
      { uri: unsupportedDataObjectUri, code: ErrorCode.EDATAOBJECTTYPE_NOTSUPPORTED }
    ];

    it("Verify responses are received for GetDataObject request", done => {
      const getSuccessPromise = new Promise(resolve => {
        client.store.once(EventName.GET_DATA_OBJECT_RESPONSE, data => {
          getSuccessResponse = data;
          resolve(data);
        });
      });

      const getExceptionPromise = new Promise(resolve => {
        client.store.once(EventName.PROTOCOL_EXCEPTION, data => {
          getExceptionResponse = data;
          resolve(data);
        });
      });

      Promise.all([getSuccessPromise, getExceptionPromise])
        .then(() => {
          done();
        });

      client.getDataObjects(getRequestUris);
    });

    it("Validate success response is GetDataObjectsResponse message from GetDataObject request", () => {
      verifyMessage(getSuccessResponse, new GetDataObjectsResponse(), GetDataObjectsResponseTypeId);
    });

    it("Verify success GetDataObjectResponse contains well & wellbore those were created in PutDataObject request", () => {
      verifyGetStoreResponseContent(getSuccessResponse, validWellUri, validWellUuid, validWellboreUri, validWellboreUuid);
    });

    it("Validate error response is ProtocolException message from GetDataObject request", () => {
      verifyProtocolExceptionResponse(getExceptionResponse);
    });

    it("ProtocolException from GetDataObject request should contain 3 errors ", () => {
      verifyTotalErrors(getExceptionResponse, 3);
    });

    getRequestExpectedErrors.forEach(({ uri, code }) => {
      it(`Error for ${uri}: should be code ${code}`, () => {
        verifyErrorMessage(getExceptionResponse, `${uri}`, code);
      });
    });

    const deleteWellboreRequestUris = [validWellboreUri, resourceNotFoundUri, invalidUri, unsupportedDataObjectUri];
    const deleteRequestExpectedErrors = [
      { uri: invalidUri, code: ErrorCode.EINVALID_URI },
      { uri: resourceNotFoundUri, code: ErrorCode.ENOT_FOUND },
      // TODO: verify this error case, bardazz returns ENOT_FOUND for this case but should be EDATAOBJECTTYPE_NOTSUPPORTED
      { uri: unsupportedDataObjectUri, code: ErrorCode.EDATAOBJECTTYPE_NOTSUPPORTED }
    ];

    it("9.3.1: Verify responses are received for DeleteDataObject request for wellbore", done => {
      const deleteSuccessPromise = new Promise(resolve => {
        client.store.once(EventName.DELETE_DATA_OBJECTS_RESPONSE, data => {
          deleteWellboreSuccessResponse = data;
          resolve(data);
        });
      });

      const deleteExceptionPromise = new Promise(resolve => {
        client.store.once(EventName.PROTOCOL_EXCEPTION, data => {
          deleteWellboreExceptionResponse = data;
          resolve(data);
        });
      });

      Promise.all([deleteSuccessPromise, deleteExceptionPromise])
        .then(() => {
          done();
        });

      client.deleteObjects(deleteWellboreRequestUris);
    });

    it("9.3.5: Validate DeleteDataObject response for wellbore is Valid DeleteDataObjectResponse message", () => {
      verifyMessage(deleteWellboreSuccessResponse, new DeleteDataObjectsResponse(), MsgDeleteDataObjectsResponseTypeId);
    });

    it("There should be one deletedUri's", () => {
      expect(deleteWellboreSuccessResponse.body.deletedUris.size).toBe(1);
    });

    it(`Deleted uris should be ${validWellboreUri}`, () => {
      expect(deleteWellboreSuccessResponse.body.deletedUris.has(validWellboreUri)).toBe(true);
    });

    it("Validate error response is ProtocolException message from DeleteDataObject request", () => {
      verifyProtocolExceptionResponse(deleteWellboreExceptionResponse);
    });

    it("ProtocolException from DeleteDataObject request should contain 3 errors ", () => {
      verifyTotalErrors(deleteWellboreExceptionResponse, 3);
    });

    deleteRequestExpectedErrors.forEach(({ uri, code }) => {
      it(`Error for ${uri}: should be code ${code}`, () => {
        verifyErrorMessage(deleteWellboreExceptionResponse, `${uri}`, code);
      });
    });

    it("9.3.1: Verify response is received for DeleteDataObject request for well", done => {
      client.store.once(EventName.DELETE_DATA_OBJECTS_RESPONSE, data => {
        deleteWellSuccessResponse = data;
        done();
      });
      client.deleteObjects([validWellUri]);
    });

    it("9.3.5: Validate DeleteDataObject response for well is Valid DeleteDataObjectResponse message", () => {
      verifyMessage(deleteWellSuccessResponse, new DeleteDataObjectsResponse(), MsgDeleteDataObjectsResponseTypeId);
    });

    it("There should be one deletedUri's", () => {
      expect(deleteWellSuccessResponse.body.deletedUris.size).toBe(1);
    });

    it(`Deleted uris should be ${validWellUri}`, () => {
      expect(deleteWellSuccessResponse.body.deletedUris.has(validWellUri)).toBe(true);
    });

    it("Verify objects were deleted", done => {
      client.store.once(EventName.GET_DATA_OBJECT_RESPONSE, data => {
        expect(data.body.dataObjects.size).toBe(0);
        done();
      });
      client.getDataObjects([validWellUri, validWellboreUri]);
    })
  });
});
