# ============================================================================
# Copyright 2019-2022 Emerson Paradigm Holding LLC. All rights reserved.
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
# ============================================================================

########################################################
# Build stage
ARG docker_node_image_version=22-alpine

FROM node:${docker_node_image_version} as runtime_builder

# env
ENV NODE_ENV=production

# Add build dependencies
RUN apk add --update python3 make g++

# add first the package in a dedicated layer
COPY package.json package-lock.json ./
# clean install of production modules and clean private registry access
RUN npm pkg delete scripts.prepare && npm ci --quiet --production

########################################################
# Release stage

FROM node:${docker_node_image_version} as release

ARG VERSION=0.1
ARG DIST=dist.tgz

LABEL version="${VERSION}"
LABEL vendor="OSDU Reservoir DMS"
LABEL description="Open ETP Client Runtime Image"

# Create new non-root user and use it
RUN addgroup -g 10001 -S nonroot && \
    adduser -S -u 10001 -G nonroot nonroot

USER 10001:10001

# env
ENV NODE_ENV=production

# add first the package in a dedicated layer
COPY --chown=nonroot:nonroot package.json package-lock.json /usr/src/api/
COPY --chown=nonroot:nonroot --from=runtime_builder node_modules /usr/src/api/

ADD --chown=nonroot:nonroot ${DIST} /usr/src/api/

WORKDIR /usr/src/api/

EXPOSE 80
CMD [ "node", "dist/src/lib/restApi/RestServer.js" ]
