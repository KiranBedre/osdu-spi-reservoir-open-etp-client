# Copyright © 2020 Amazon Web Services
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

########################################################
FROM public.ecr.aws/docker/library/node:22-alpine3.24 AS BASE

ENV NODE_ENV=production

# Create app directory
WORKDIR /usr/src/app

# add first the package in a dedicated layer
COPY package.json package-lock.json ./

# clean install of production modules and clean private registry access
RUN npm pkg delete scripts.prepare && npm ci --quiet

###############################################################################
FROM public.ecr.aws/docker/library/node:22-alpine3.24

# env
ENV NODE_ENV=production

USER node
# Create app directory
WORKDIR /usr/src/app

# node modules from BASE
COPY --from=BASE --chown=node:node /usr/src/app .

# Bundle app source
COPY --chown=node:node dist dist


# Environment variables used by server
# RDMS_REST_MAIN_URL : Base url for openAPI
# RDMS_REST_ROOT_PATH : local path inside url
# RDMS_REST_PORT : Port of api in container
#  --- OpenAPI url is `${RDMS_REST_MAIN_URL}:${OPEN_API_PORT}${RDMS_REST_ROOT_PATH}` ---


# RDMS_ETP_PROTOCOL websocket protocol "ws" or "wss"
# RDMS_ETP_HOST domain of etp server
# RDMS_ETP_PORT port of ETP server
# RDMS_ETP_PATH local path in ETP server url
#  --- ETP server url is `${RDMS_ETP_PROTOCOL}://${RDMS_ETP_HOST}:${RDMS_ETP_PORT}${RDMS_ETP_PATH}/` ---

EXPOSE 80
CMD [ "node", "dist/src/lib/restApi/RestServer.js" ]
