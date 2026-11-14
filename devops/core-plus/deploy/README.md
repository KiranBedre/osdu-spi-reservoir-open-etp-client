<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Deploy helm chart](#deploy-helm-chart)
  - [Introduction](#introduction)
  - [Prerequisites](#prerequisites)
    - [Operation system](#operation-system)
    - [Packages](#packages)
  - [Installation](#installation)
    - [Global variables](#global-variables)
    - [Configmap variables](#configmap-variables)
    - [Deployment variables](#deployment-variables)
    - [Configuration variables](#configuration-variables)
    - [Horizontal Pod Autoscaling (HPA) variables (works only if tier=PROD and autoscaling=true)](#horizontal-pod-autoscaling-hpa-variables-works-only-if-tierprod-and-autoscalingtrue)
    - [Limits variables](#limits-variables)
    - [Probes variables](#probes-variables)
    - [Install the helm chart](#install-the-helm-chart)
  - [Uninstalling the Chart](#uninstalling-the-chart)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Deploy helm chart

## Introduction

This chart installs a deployment on a [Kubernetes](https://kubernetes.io) cluster using [Helm](https://helm.sh) package manager.

## Prerequisites

The code was tested on **Kubernetes cluster** (v1.24.12) with **Istio** (1.13.3)

> It is possible to use other versions, but it hasn't been tested

### Operation system

The code works in Debian-based Linux (Debian 10 and Ubuntu 20.04) and Windows WSL 2. Also, it works but is not guaranteed in Google Cloud Shell. All other operating systems, including macOS, are not verified and supported.

### Packages

Packages are only needed for installation from a local computer.

- **HELM** (version: v3.11.2 or higher) [helm](https://helm.sh/docs/intro/install/)
- **Kubectl** (version: v1.24.12 or higher) [kubectl](https://kubernetes.io/docs/tasks/tools/#kubectl)

## Installation

First you need to set variables in **values.yaml** file using any code editor. Some of the values are prefilled, but you need to specify some values as well. You can find more information about them below.

### Global variables

| Name                     | Description                                             | Type    | Default | Required |
|--------------------------|---------------------------------------------------------|---------|---------|----------|
| **global.domain**        | your domain for the external endpoint, ex `example.com` | string  | -       | yes      |
| **global.onPremEnabled** | whether on-prem is enabled                              | boolean | false   | yes      |
| **global.limitsEnabled** | whether CPU and memory limits are enabled               | boolean | true    | yes      |
| **global.tier**          | Only PROD must be used to enable autoscaling            | string  | ""      | no       |
| **global.autoscaling**   | enables horizontal pod autoscaling, when tier=PROD      | boolean | true    | yes      |

### Configmap variables

| Name                      | Description                                                            | Type   | Default         | Required |
|---------------------------|------------------------------------------------------------------------|--------|-----------------|----------|
| **data.cloudProvider**    | variable for using clients and configuration for Google Cloud provider | string | `google`        | yes      |
| **data.rdmsRestRootPath** | api endpoint inside url                                                | string | `/api/reservoir-ddms/v2` | yes      |
| **data.rdmsRestPort**     | port of api in container                                               | string | `8003`          | yes      |
| **data.rdmsEtpHost**      | name of kubernetes service for `oetp-server`                           | string | `oetp-server`   | yes      |
| **data.rdmsEtpPort**      | port of `oetp-server`                                                  | string | `9002`          | yes      |
| **data.rdmsEtpProtocol**  | websocket protocol                                                     | string | `ws`            | yes      |
| **data.logLevel**         | logging level                                                          | string | `error`         | yes      |

### Deployment variables

| Name                        | Description                            | Type   | Default        | Required                               |
|-----------------------------|----------------------------------------|--------|----------------|----------------------------------------|
| **data.requestsCpu**        | amount of requested CPU                | string | `5m`           | yes                                    |
| **data.requestsMemory**     | amount of requested memory             | string | `250Mi`        | yes                                    |
| **data.limitsCpu**          | CPU limit                              | string | `1`            | only if `global.limitsEnabled` is true |
| **data.limitsMemory**       | memory limit                           | string | `1G`           | only if `global.limitsEnabled` is true |
| **data.image**              | service image                          | string | -              | yes                                    |
| **data.imagePullPolicy**    | when to pull image                     | string | `IfNotPresent` | yes                                    |
| **data.serviceAccountName** | name of service account for deployment | string | `oetp-client`  | yes                                    |

### Configuration variables

| Name                      | Description                            | Type    | Default              | Required |
|---------------------------|----------------------------------------|---------|----------------------|----------|
| **conf.appName**          | application name                       | string  | `oetp-client`        | yes      |
| **conf.configmap**        | configmap to be used                   | string  | `oetp-client-config` | yes      |
| **conf.oetpClientSecret** | secret for connection to `oetp-server` | string  | `oetp-client-secret` | yes      |
| **conf.replicas**         | Number of pods for service             | integer | 2                    | yes      |

### Horizontal Pod Autoscaling (HPA) variables (works only if tier=PROD and autoscaling=true)

| Name                                                | Description                                                                   | Type    | Default          | Required                                                       |
|-----------------------------------------------------|-------------------------------------------------------------------------------|---------|------------------|----------------------------------------------------------------|
| **hpa.minReplicas**                                 | minimum number of replicas                                                    | integer | `6`              | only if `global.autoscaling` is true and `global.tier` is PROD |
| **hpa.maxReplicas**                                 | maximum number of replicas                                                    | integer | `15`             | only if `global.autoscaling` is true and `global.tier` is PROD |
| **hpa.targetType**                                  | type of measurements: AverageValue or Value                                   | string  | `"AverageValue"` | only if `global.autoscaling` is true and `global.tier` is PROD |
| **hpa.targetValue**                                 | threshold value to trigger the scaling up                                     | integer | `16`             | only if `global.autoscaling` is true and `global.tier` is PROD |
| **hpa.behaviorScaleUpStabilizationWindowSeconds**   | time to start implementing the scale up when it is triggered                  | integer | `10`             | only if `global.autoscaling` is true and `global.tier` is PROD |
| **hpa.behaviorScaleUpPoliciesValue**                | the maximum number of new replicas to create (in percents from current state) | integer | `50`             | only if `global.autoscaling` is true and `global.tier` is PROD |
| **hpa.behaviorScaleUpPoliciesPeriodSeconds**        | pause for every new scale up decision                                         | integer | `15`             | only if `global.autoscaling` is true and `global.tier` is PROD |
| **hpa.behaviorScaleDownStabilizationWindowSeconds** | time to start implementing the scale down when it is triggered                | integer | `60`             | only if `global.autoscaling` is true and `global.tier` is PROD |
| **hpa.behaviorScaleDownPoliciesValue**              | the maximum number of replicas to destroy (in percents from current state)    | integer | `25`             | only if `global.autoscaling` is true and `global.tier` is PROD |
| **hpa.behaviorScaleDownPoliciesPeriodSeconds**      | pause for every new scale down decision                                       | integer | `60`             | only if `global.autoscaling` is true and `global.tier` is PROD |

### Limits variables

| Name                     | Description                                     | Type    | Default | Required                                                       |
|--------------------------|-------------------------------------------------|---------|---------|----------------------------------------------------------------|
| **limits.maxTokens**     | maximum number of requests per fillInterval     | integer | `12`    | only if `global.autoscaling` is true and `global.tier` is PROD |
| **limits.tokensPerFill** | number of new tokens allowed every fillInterval | integer | `12`    | only if `global.autoscaling` is true and `global.tier` is PROD |
| **limits.fillInterval**  | time interval                                   | string  | `"1s"`  | only if `global.autoscaling` is true and `global.tier` is PROD |

### Methodology for Parameter Calculation variables: **hpa.targetValue**, **limits.maxTokens** and **limits.tokensPerFill**

The parameters **hpa.targetValue**, **limits.maxTokens** and **limits.tokensPerFill** were determined through empirical testing during load testing. These tests were conducted using the N2D machine series, which can run on either AMD EPYC Milan or AMD EPYC Rome processors. The values were fine-tuned to ensure optimal performance under typical workloads.

### Recommendations for New Instance Types

When changing the instance type to a newer generation, such as the C3D series, it is essential to conduct new load testing. This ensures the parameters are recalibrated to match the performance characteristics of the new processor architecture, optimizing resource utilization and maintaining application stability.

### Probes variables

| Name                                   | Description                                              | Type    | Default                                   | Required |
|----------------------------------------|----------------------------------------------------------|---------|-------------------------------------------|----------|
| **conf.probes.readiness.enabled**      | enable Kubernetes readiness probe                        | boolean | `true`                                    | yes      |
| **conf.probes.readiness.path**         | HTTP path for the readiness probe                        | string  | `/api/reservoir-ddms/v2/health/readiness` | yes      |
| **conf.probes.readiness.periodSeconds**    | how often (in seconds) to perform the readiness probe    | integer | `20`                                      | yes      |
| **conf.probes.readiness.successThreshold** | consecutive successes required to mark the pod ready     | integer | `1`                                       | yes      |
| **conf.probes.readiness.timeoutSeconds**   | seconds after which the readiness probe times out        | integer | `3`                                       | yes      |
| **conf.probes.liveness.enabled**       | enable Kubernetes liveness probe                         | boolean | `true`                                    | yes      |
| **conf.probes.liveness.path**          | HTTP path for the liveness probe                         | string  | `/api/reservoir-ddms/v2/health/liveness`  | yes      |
| **conf.probes.liveness.periodSeconds**     | how often (in seconds) to perform the liveness probe     | integer | `20`                                      | yes      |
| **conf.probes.liveness.successThreshold**  | must be `1` for liveness (Kubernetes requirement)        | integer | `1`                                       | yes      |
| **conf.probes.liveness.timeoutSeconds**    | seconds after which the liveness probe times out         | integer | `3`                                       | yes      |

### Install the helm chart

Run this command from within this directory:

```console
helm install gc-oetp-client-deploy .
```

## Uninstalling the Chart

To uninstall the helm deployment:

```console
helm uninstall gc-oetp-client-deploy
```
